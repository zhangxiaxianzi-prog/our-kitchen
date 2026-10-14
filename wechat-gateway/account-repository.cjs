const { KitchenError } = require('./service.cjs');
// 账号关系和名单与厨房内容分开保存；复用已有连接池，所有查询只读写一张表。
class AccountRepository {
  constructor(kitchens) { this.kitchens = kitchens; }
  execute(sql, values = []) { return this.kitchens.execute(sql, values); }
  async initialize() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS kitchen_accounts (user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, owned INT UNSIGNED NOT NULL DEFAULT 0, create_day CHAR(10) NOT NULL DEFAULT '', daily_count INT UNSIGNED NOT NULL DEFAULT 0, version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS kitchen_spaces (id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, owner_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, name VARCHAR(80) NOT NULL, phrase_hash VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY phrase_lookup (phrase_hash), KEY owner_lookup (owner_id,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS kitchen_members (user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, kitchen_id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, name VARCHAR(80) NOT NULL, is_owner TINYINT UNSIGNED NOT NULL DEFAULT 0, last_visit TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id,kitchen_id), KEY kitchen_lookup (kitchen_id,user_id), KEY visit_lookup (user_id,last_visit,kitchen_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS kitchen_join_requests (kitchen_id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'pending', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (kitchen_id,user_id), KEY request_lookup (kitchen_id,status,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS kitchen_whitelist (user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, enabled TINYINT UNSIGNED NOT NULL, note VARCHAR(80) NOT NULL DEFAULT '', version INT UNSIGNED NOT NULL DEFAULT 1, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS kitchen_permission_audit (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, target_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, enabled TINYINT UNSIGNED NOT NULL, note VARCHAR(80) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS kitchen_admin_logins (id VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, browser_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, scan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'pending', user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL, expires BIGINT UNSIGNED NOT NULL, KEY expiry_lookup (expires)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ];
    for (const sql of tables) await this.execute(sql);
    // 旧厨房也保留申请记录；多个实例同时升级时，另一个实例已加好的字段不用再加。
    const upgrades = [
      { table: 'kitchen_accounts', column: 'nickname', sql: "ALTER TABLE kitchen_accounts ADD COLUMN nickname VARCHAR(20) NOT NULL DEFAULT ''" },
      { table: 'kitchen_join_requests', column: 'nickname', sql: "ALTER TABLE kitchen_join_requests ADD COLUMN nickname VARCHAR(20) NOT NULL DEFAULT ''" },
      { table: 'kitchen_join_requests', index: 'applicant_lookup', sql: 'ALTER TABLE kitchen_join_requests ADD INDEX applicant_lookup (user_id,kitchen_id)' },
      { table: 'kitchen_join_requests', index: 'pending_lookup', sql: 'ALTER TABLE kitchen_join_requests ADD INDEX pending_lookup (kitchen_id,status,user_id)' }
    ];
    for (const upgrade of upgrades) {
      // 正常重启只查是否已升级，不反复执行改表，减少对业务请求的影响。
      const found = upgrade.column
        ? await this.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [upgrade.table, upgrade.column])
        : await this.execute('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [upgrade.table, upgrade.index]);
      if (found.length) continue;
      try { await this.execute(upgrade.sql); }
      catch (error) { if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error; }
    }
  }
  async ensureUser(userId) { await this.execute('INSERT INTO kitchen_accounts (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id', [userId]); }
  async nickname(userId) { const rows = await this.execute('SELECT nickname FROM kitchen_accounts WHERE user_id = ?', [userId]); return rows[0]?.nickname || ''; }
  async saveNickname(userId, nickname) { await this.execute('UPDATE kitchen_accounts SET nickname = ? WHERE user_id = ?', [nickname, userId]); }
  // 一次只返回一页申请，不把别人的申请或厨房内容交给申请人。
  async applications(userId, after) {
    const rows = await this.execute('SELECT kitchen_id AS id, status, nickname, created_at AS createdAt FROM kitchen_join_requests WHERE user_id = ? AND kitchen_id > ? ORDER BY kitchen_id LIMIT 21', [userId, after]);
    return { items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null };
  }
  // 只查当前页里本人创建的厨房，用一次分组查询显示数量，不逐个请求数据库。
  async pendingCounts(ids) {
    if (!ids.length) return new Map();
    const rows = await this.execute('SELECT kitchen_id AS id, COUNT(*) AS total FROM kitchen_join_requests WHERE status = ? AND kitchen_id IN (' + ids.map(() => '?').join(',') + ') GROUP BY kitchen_id', ['pending', ...ids]);
    return new Map(rows.map(row => [row.id, Number(row.total)]));
  }
  async whitelist(userId) { const rows = await this.execute('SELECT enabled FROM kitchen_whitelist WHERE user_id = ?', [userId]); return rows[0]?.enabled === 1; }
  async member(userId, id) { const rows = await this.execute('SELECT name, is_owner FROM kitchen_members WHERE user_id = ? AND kitchen_id = ?', [userId, id]); return rows[0]; }
  async space(id) { const rows = await this.execute('SELECT id, owner_id, name FROM kitchen_spaces WHERE id = ?', [id]); return rows[0]; }
  async findPhrase(hash) { const rows = await this.execute('SELECT id, owner_id, name FROM kitchen_spaces WHERE phrase_hash = ?', [hash]); return rows[0]; }
  async list(userId, after) { const rows = await this.execute('SELECT kitchen_id AS id, name, is_owner AS owner, last_visit AS lastVisit FROM kitchen_members WHERE user_id = ? AND kitchen_id > ? ORDER BY kitchen_id LIMIT 21', [userId, after]); return { items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null }; }
  // 计数和新厨房一起提交；按版本更新使两个实例不会同时占用最后一个名额。
  async create(userId, space, state, unlimited, day) {
    const rows = await this.execute('SELECT owned, create_day, daily_count, version FROM kitchen_accounts WHERE user_id = ?', [userId]);
    const user = rows[0]; if (!user) throw new KitchenError('请重新微信登录', 401);
    const daily = user.create_day === day ? user.daily_count : 0;
    if (!unlimited && (user.owned >= 3 || daily >= 1)) throw new KitchenError(user.owned >= 3 ? '最多创建三个厨房' : '今天已经创建过厨房，请明天再试', 429);
    const connection = await this.kitchens.pool.getConnection();
    const execute = async (sql, values) => (await connection.execute({ sql, timeout: 5000 }, values))[0];
    try {
      await connection.beginTransaction();
      const changed = await execute('UPDATE kitchen_accounts SET owned = owned + 1, create_day = ?, daily_count = ?, version = version + 1 WHERE user_id = ? AND version = ?', [day, daily + 1, userId, user.version]);
      if (changed.affectedRows !== 1) throw new KitchenError('账号刚被修改，请重试创建', 409);
      await execute('INSERT INTO kitchen_spaces (id, owner_id, name, phrase_hash) VALUES (?, ?, ?, ?)', [space.id, userId, space.name, space.hash]);
      await execute('INSERT INTO kitchen_records (id, version, state) VALUES (?, 1, ?)', [space.id, state]);
      await execute('INSERT INTO kitchen_members (user_id, kitchen_id, name, is_owner) VALUES (?, ?, ?, 1)', [userId, space.id, space.name]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  async touch(userId, id) { await this.execute('UPDATE kitchen_members SET last_visit = CURRENT_TIMESTAMP WHERE user_id = ? AND kitchen_id = ?', [userId, id]); }
  async requestJoin(userId, id, nickname) { await this.execute("INSERT INTO kitchen_join_requests (kitchen_id,user_id,nickname) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nickname = VALUES(nickname), status = IF(status = 'approved', status, 'pending'), created_at = CURRENT_TIMESTAMP", [id, userId, nickname]); }
  async requests(id, after) { const rows = await this.execute("SELECT user_id AS userId, nickname, created_at AS createdAt FROM kitchen_join_requests WHERE kitchen_id = ? AND status = 'pending' AND user_id > ? ORDER BY user_id LIMIT 21", [id, after]); return { items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].userId : null }; }
  // 审批与成员登记同时保存；同一申请只允许处理一次。
  async decide(id, userId, approved, name) {
    const connection = await this.kitchens.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute({ sql: "UPDATE kitchen_join_requests SET status = ? WHERE kitchen_id = ? AND user_id = ? AND status = 'pending'", timeout: 5000 }, [approved ? 'approved' : 'rejected', id, userId]);
      if (result.affectedRows !== 1) throw new KitchenError('申请已经处理，请刷新', 409);
      if (approved) await connection.execute({ sql: 'INSERT INTO kitchen_members (user_id,kitchen_id,name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE user_id = user_id', timeout: 5000 }, [userId, id, name]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  async permissions(after, search) {
    const rows = search ? await this.execute('SELECT user_id AS userId, enabled, note, version, updated_at AS updatedAt FROM kitchen_whitelist WHERE user_id = ?', [search]) : await this.execute('SELECT user_id AS userId, enabled, note, version, updated_at AS updatedAt FROM kitchen_whitelist WHERE user_id > ? ORDER BY user_id LIMIT 21', [after]);
    return { items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].userId : null };
  }
  async savePermission(actorId, input) {
    const connection = await this.kitchens.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (input.version === 0) await connection.execute({ sql: 'INSERT INTO kitchen_whitelist (user_id,enabled,note) VALUES (?,?,?)', timeout: 5000 }, [input.userId, input.enabled ? 1 : 0, input.note]);
      else {
        const [result] = await connection.execute({ sql: 'UPDATE kitchen_whitelist SET enabled = ?, note = ?, version = version + 1 WHERE user_id = ? AND version = ?', timeout: 5000 }, [input.enabled ? 1 : 0, input.note, input.userId, input.version]);
        if (result.affectedRows !== 1) throw new KitchenError('名单已经变更，请刷新后再操作', 409);
      }
      await connection.execute({ sql: 'INSERT INTO kitchen_permission_audit (actor_id,target_id,enabled,note) VALUES (?,?,?,?)', timeout: 5000 }, [actorId, input.userId, input.enabled ? 1 : 0, input.note]);
      await connection.commit();
    } catch (error) { await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') throw new KitchenError('账号已经在名单里，请刷新', 409); throw error; } finally { connection.release(); }
  }
  async audit(before) { const rows = await this.execute('SELECT CAST(id AS CHAR) AS id, actor_id AS actorId, target_id AS userId, enabled, note, created_at AS createdAt FROM kitchen_permission_audit WHERE id < ? ORDER BY id DESC LIMIT 21', [before]); return { items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null }; }
}
module.exports = { AccountRepository };
