// 数据库保存正式权限，内存只保留60秒的结果；新账号不能让缓存无限变大。
class PermissionCache {
  constructor(read, now = Date.now) { this.read = read; this.now = now; this.items = new Map(); this.pending = new Map(); this.generations = new Map(); }
  async enabled(userId) {
    const item = this.items.get(userId);
    if (item && item.expires > this.now()) return item.enabled;
    if (this.pending.has(userId)) return this.pending.get(userId);
    const marker = {}; this.generations.set(userId, marker);
    const task = Promise.resolve().then(() => this.read(userId)).then(enabled => {
      // 管理员刚改过名单时，较早发出的查询不能重新塞回旧缓存。
      if (this.generations.get(userId) === marker) {
        if (this.items.size >= 1000) this.items.delete(this.items.keys().next().value);
        this.items.set(userId, { enabled: !!enabled, expires: this.now() + 60000 });
      }
      return !!enabled;
    }).finally(() => { if (this.pending.get(userId) === task) this.pending.delete(userId); if (this.generations.get(userId) === marker) this.generations.delete(userId); });
    this.pending.set(userId, task); return task;
  }
  invalidate(userId) { this.items.delete(userId); this.generations.delete(userId); this.pending.delete(userId); }
}
module.exports = { PermissionCache };
