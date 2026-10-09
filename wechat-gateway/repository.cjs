const mysql = require('mysql2/promise');
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
  async save(id, version, state) {
    // 只有读到的版本仍然有效才保存，另一个实例抢先保存后返回false让上层重读。
    const result = await this.execute('UPDATE kitchen_records SET state = ?, version = version + 1 WHERE id = ? AND version = ?', [state, id, version]);
    return result.affectedRows === 1;
  }
  // 导入摘要与内容一次保存，重复导入时可以认出同一份备份。
  async restore(id, version, state, hash) {
    const result = await this.execute('UPDATE kitchen_records SET state = ?, restore_hash = ?, version = version + 1 WHERE id = ? AND version = ? AND restore_hash IS NULL', [state, hash, id, version]);
    return result.affectedRows === 1;
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
