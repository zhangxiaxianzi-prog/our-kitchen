const { newKitchen, applyAction } = require('./dist/domain.cjs');
const { validateBackup } = require('./backup.cjs');
class KitchenError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
// 这里负责厨房的读写顺序，网页和微信入口都不自己拼接保存后的厨房数据。
class KitchenService {
  constructor(repository, sessions) { this.repository = repository; this.sessions = sessions; }
  // 两人输入同一口令进入同一厨房，身份仍由用户自己选择。
  async login(input) {
    if (typeof input?.passphrase !== 'string' || ![0, 1].includes(input.role)) throw new KitchenError('登录内容不正确');
    const phrase = input.passphrase.trim();
    if (phrase.length < 8 || phrase.length > 64) throw new KitchenError('共同口令需要8到64个字符');
    const bucket = Math.floor(Date.now() / 900000);
    // 按共同口令限制猜测次数，不信任客户端可自己填写的网络地址头。
    const globalId = this.sessions.kitchenId('login-total:' + bucket);
    if (!await this.repository.allowLogin(globalId, bucket, 200)) throw new KitchenError('厨房登录请求过多，请稍后再试', 429);
    const rateId = this.sessions.kitchenId('login-rate:' + phrase + ':' + bucket);
    if (!await this.repository.allowLogin(rateId, bucket)) throw new KitchenError('这个口令尝试过于频繁，请15分钟后再试', 429);
    const id = this.sessions.kitchenId(phrase);
    await this.repository.ensure(id, JSON.stringify(newKitchen()));
    return { token: this.sessions.issue(id, input.role) };
  }
  // 登录票据指向哪个厨房就读取哪个厨房，页面不能另传厨房编号。
  async read(session) {
    const row = await this.repository.read(session.kitchenId);
    if (!row) throw new KitchenError('厨房记录不存在，请重新登录', 401);
    return { role: session.role, version: row.version, kitchen: JSON.parse(row.state) };
  }
  // 保存冲突时重新读取刚保存的评分，再执行本次操作。
  async change(session, input) {
    if (!input || typeof input.action !== 'string') throw new KitchenError('操作内容不正确');
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.read(session);
      let next;
      try { next = applyAction(current.kitchen, input, session.role); }
      catch (error) { throw new KitchenError(error.message); }
      const state = JSON.stringify(next);
      if (Buffer.byteLength(state) > 2 * 1024 * 1024) throw new KitchenError('厨房记录超过2MB，请先整理菜单和历史');
      if (await this.repository.save(session.kitchenId, current.version, state)) return { ...current, version: current.version + 1, kitchen: next };
    }
    throw new KitchenError('两个人正在同时操作，请稍后再试', 409);
  }
  // 迁移时只填充尚未使用的新厨房，保留备份里的菜和晚餐历史。
  async restore(session, input) {
    let backup;
    try { backup = validateBackup(input); } catch (error) { throw new KitchenError(error.message); }
    const row = await this.repository.read(session.kitchenId);
    if (!row) throw new KitchenError('请先登录创建厨房', 401);
    // 只允许向刚创建的空厨房导入；重复发送同一备份不会覆盖后来新增的评分。
    if (row.restore_hash === backup.hash) return this.read(session);
    if (row.version !== 1 || row.restore_hash) throw new KitchenError('这个厨房已经使用过，请勿用旧备份覆盖现有记录', 409);
    if (!await this.repository.restore(session.kitchenId, row.version, backup.state, backup.hash)) throw new KitchenError('厨房刚被修改，导入已停止，请先核对数据', 409);
    return this.read(session);
  }
}
module.exports = { KitchenService, KitchenError };
