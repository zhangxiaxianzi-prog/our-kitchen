const mysql = require('mysql2/promise');
const { calendarEntries } = require('./calendar.cjs');
// 每次数据库操作都带厨房编号，不接受页面指定另一个人的厨房。
class MysqlKitchenRepository {
  constructor(options) { this.pool = mysql.createPool(options); }
  async initialize() {
    // 单独建厨房表，不删除模板原来的业务表；两个实例同时启动也能重复执行。
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kitchen_records (
      id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      version INT UNSIGNED NOT NULL, state MEDIUMTEXT NOT NULL,
      restore_hash VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kitchen_login_attempts (
      id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      bucket INT UNSIGNED NOT NULL, count INT UNSIGNED NOT NULL, INDEX bucket_index (bucket)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // 历史单独存，每行只保存一道完成双人评分的菜，不随厨房的30轮上限删除。
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kitchen_calendar (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      kitchen_id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      entry_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      meal_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      meal_date VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      date_label VARCHAR(40) NOT NULL, round_rank BIGINT NOT NULL, record TEXT NOT NULL,
      UNIQUE KEY kitchen_entry (kitchen_id, entry_key),
      KEY kitchen_date (kitchen_id, meal_date, round_rank, id), KEY kitchen_meal (kitchen_id, meal_id), KEY kitchen_rank (kitchen_id, round_rank)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kitchen_calendar_imports (
      kitchen_id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.ready();
  }
  // 就绪检查实际访问数据库，不能只证明进程还活着。
  async ready() { await this.pool.query({ sql: 'SELECT 1', timeout: 5000 }); }
  async execute(sql, values) {
    // 限制单次查询等待时间，数据库故障时不让请求一直占住内存。
    const [result] = await this.pool.execute({ sql, timeout: 5000 }, values);
    return result;
  }
  // 已经存在的厨房保持原样，重新登录不会重置食材和评分。
  async ensure(id, state) {
    await this.execute('INSERT INTO kitchen_records (id, version, state) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE id = id', [id, state]);
  }
  // 返回版本和完整厨房，供下一次保存检查是否有人先改过。
  async read(id) {
    const rows = await this.execute('SELECT version, state, restore_hash FROM kitchen_records WHERE id = ?', [id]);
    return rows[0];
  }
  // 使用同一连接提交评分和历史；历史写入失败时评分也回退，不能只成功一半。
  async save(id, version, state, entries = []) { return this.saveWithHistory(id, version, state, entries, null); }
  // 旧备份导入也一并归档完整评分，原来的未公开评分仍只放在厨房里。
  async restore(id, version, state, hash) { return this.saveWithHistory(id, version, state, calendarEntries(JSON.parse(state)), hash); }
  // 先锁厨房再按固定顺序归档，所有实例使用相同顺序，避免互相反着等待。
  async saveWithHistory(id, version, state, entries, hash) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const sql = hash === null ? 'UPDATE kitchen_records SET state = ?, version = version + 1 WHERE id = ? AND version = ?' : 'UPDATE kitchen_records SET state = ?, restore_hash = ?, version = version + 1 WHERE id = ? AND version = ? AND restore_hash IS NULL';
      const values = hash === null ? [state, id, version] : [state, hash, id, version];
      const [result] = await connection.execute({ sql, timeout: 5000 }, values);
      if (result.affectedRows !== 1) { await connection.rollback(); return false; }
      await this.appendHistory(connection, id, entries, hash === null ? version + 1 : null);
      await connection.commit(); return true;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  // 同一轮后续完成的菜沿用第一次归档的排序；重复评分不产生另一条记录。
  async appendHistory(connection, id, entries, rank) {
    if (!entries.length) return;
    if (rank !== null) { const [latest] = await connection.execute({ sql: 'SELECT MAX(round_rank) AS rank FROM kitchen_calendar WHERE kitchen_id = ?', timeout: 5000 }, [id]); rank = Math.max(rank, Number(latest[0].rank || 0) + 1); }
    const ordered = [...entries].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key)); const ranks = new Map();
    for (const entry of ordered) {
      if (!ranks.has(entry.mealId)) {
        const [rows] = await connection.execute({ sql: 'SELECT round_rank FROM kitchen_calendar WHERE kitchen_id = ? AND meal_id = ? LIMIT 1', timeout: 5000 }, [id, entry.mealId]);
        ranks.set(entry.mealId, rows[0] ? Number(rows[0].round_rank) : rank === null ? entry.rank : rank);
      }
    }
    // 每批100条；不会把多年的记录读到内存，也不会生成无限长的SQL。
    for (let offset = 0; offset < ordered.length; offset += 100) {
      const batch = ordered.slice(offset, offset + 100); const values = batch.flatMap(e => [id, e.key, e.mealId, e.date, e.dateLabel, ranks.get(e.mealId), JSON.stringify(e.record)]);
      await connection.execute({ sql: 'INSERT INTO kitchen_calendar (kitchen_id, entry_key, meal_id, meal_date, date_label, round_rank, record) VALUES ' + batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',') + ' ON DUPLICATE KEY UPDATE id = id', timeout: 5000 }, values);
    }
  }
  // 每个厨房只补入一次仍存在的旧记录；锁住该厨房后再检查标记，两个实例不会同时搬。
  async seedHistory(id) {
    const done = await this.execute('SELECT kitchen_id FROM kitchen_calendar_imports WHERE kitchen_id = ?', [id]);
    if (done.length) return;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute({ sql: 'SELECT state FROM kitchen_records WHERE id = ? FOR UPDATE', timeout: 5000 }, [id]);
      if (!rows.length) throw new Error('厨房记录不存在');
      const [markers] = await connection.execute({ sql: 'SELECT kitchen_id FROM kitchen_calendar_imports WHERE kitchen_id = ?', timeout: 5000 }, [id]);
      if (!markers.length) {
        await this.appendHistory(connection, id, calendarEntries(JSON.parse(rows[0].state)), null);
        await connection.execute({ sql: 'INSERT INTO kitchen_calendar_imports (kitchen_id) VALUES (?)', timeout: 5000 }, [id]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  // 月历只查当天数量，详细菜品等用户点击日期再读取。
  async calendarMonth(id, query) {
    const rows = await this.execute('SELECT meal_date AS date, COUNT(*) AS count FROM kitchen_calendar WHERE kitchen_id = ? AND meal_date >= ? AND meal_date < ? GROUP BY meal_date', [id, query.start, query.end]);
    const unknown = await this.execute("SELECT COUNT(*) AS count FROM kitchen_calendar WHERE kitchen_id = ? AND meal_date = 'unknown'", [id]);
    return { days: rows.map(x => ({ date: x.date, count: Number(x.count) })), unknownCount: Number(unknown[0].count) };
  }
  // 一次最多40道，按轮次和记录编号继续读取，不使用越来越大的OFFSET。
  async calendarDay(id, query) {
    const values = [id, query.date]; let condition = '';
    if (query.cursor) { condition = ' AND (round_rank < ? OR (round_rank = ? AND id < ?))'; values.push(query.cursor.rank, query.cursor.rank, query.cursor.id); }
    const rows = await this.execute('SELECT CAST(id AS CHAR) AS id, meal_id, meal_date, date_label, round_rank, record FROM kitchen_calendar WHERE kitchen_id = ? AND meal_date = ?' + condition + ' ORDER BY round_rank DESC, id DESC LIMIT 41', values);
    const page = rows.slice(0, 40); const last = page[page.length - 1];
    return { entries: page.map(r => ({ id: r.id, mealId: r.meal_id, date: r.meal_date, dateLabel: r.date_label, rank: Number(r.round_rank), record: JSON.parse(r.record) })), next: rows.length > 40 ? { rank: Number(last.round_rank), id: last.id } : null };
  }
  // 备份每次只读100条，固定截止编号后，新评分不会让本次备份一直追着新增记录跑。
  async calendarExport(id, after, maximum) {
    if (!maximum) { const rows = await this.execute('SELECT CAST(COALESCE(MAX(id), 0) AS CHAR) AS maximum FROM kitchen_calendar WHERE kitchen_id = ?', [id]); maximum = rows[0].maximum; }
    const rows = await this.execute('SELECT CAST(id AS CHAR) AS id, meal_id, meal_date, date_label, round_rank, record FROM kitchen_calendar WHERE kitchen_id = ? AND id > ? AND id <= ? ORDER BY id LIMIT 101', [id, after, maximum]);
    const page = rows.slice(0, 100);
    return { maximum, entries: page.map(r => ({ mealId: r.meal_id, date: r.meal_date, dateLabel: r.date_label, rank: Number(r.round_rank), record: JSON.parse(r.record) })), next: rows.length > 100 ? page[page.length - 1].id : null };
  }
  // 历史恢复只追加；已经存在但内容不同就拒绝，不能用旧文件改写真实评分。
  async restoreCalendar(id, entries) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [kitchens] = await connection.execute({ sql: 'SELECT version FROM kitchen_records WHERE id = ? FOR UPDATE', timeout: 5000 }, [id]);
      if (!kitchens.length) throw new Error('厨房记录不存在');
      const [existing] = await connection.execute({ sql: 'SELECT entry_key, meal_date, date_label, record FROM kitchen_calendar WHERE kitchen_id = ? AND entry_key IN (' + entries.map(() => '?').join(',') + ')', timeout: 5000 }, [id, ...entries.map(e => e.key)]);
      for (const saved of existing) {
        const source = entries.find(e => e.key === saved.entry_key);
        if (saved.meal_date !== source.date || saved.date_label !== source.dateLabel || JSON.stringify(JSON.parse(saved.record)) !== JSON.stringify(source.record)) { const error = new Error('日历已有不同记录，停止恢复，请核对备份'); error.code = 'CALENDAR_CONFLICT'; throw error; }
      }
      await this.appendHistory(connection, id, entries, null);
      await connection.execute({ sql: 'UPDATE kitchen_records SET version = version + 1 WHERE id = ?', timeout: 5000 }, [id]);
      await connection.commit(); return { imported: entries.length - existing.length };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async allowLogin(id, bucket, maximum = 20) {
    // 用一次条件更新领取登录次数，多个实例不会各自放行20次。
    await this.execute('INSERT INTO kitchen_login_attempts (id, bucket, count) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE id = id', [id, bucket]);
    const result = await this.execute('UPDATE kitchen_login_attempts SET count = count + 1 WHERE id = ? AND count < ?', [id, maximum]);
    // 每次最多清理100条旧记录，避免一条清理语句长时间锁住整批记录。
    await this.execute('DELETE FROM kitchen_login_attempts WHERE bucket < ? LIMIT 100', [bucket - 1]);
    return result.affectedRows === 1;
  }
  // 发布停止服务时关闭连接，不让退出中的实例继续占数据库连接。
  async close() { await this.pool.end(); }
}
module.exports = { MysqlKitchenRepository };
