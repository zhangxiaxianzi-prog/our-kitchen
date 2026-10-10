const { newKitchen, applyAction, kitchenView } = require('./dist/domain.cjs');
const { calendarEntries, calendarQuery, calendarBackupEntries } = require('./calendar.cjs');
const { validateBackup } = require('./backup.cjs');
class KitchenError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
// 这里负责厨房的读写顺序，小程序不自己拼接保存后的厨房数据。
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
    await this.repository.seedHistory(id);
    return { token: this.sessions.issue(id, input.role) };
  }
  // 登录票据指向哪个厨房就读取哪个厨房，页面不能另传厨房编号。
  async readState(session) {
    const row = await this.repository.read(session.kitchenId);
    if (!row) throw new KitchenError('厨房记录不存在，请重新登录', 401);
    return { role: session.role, version: row.version, kitchen: JSON.parse(row.state) };
  }
  // 查询、写入和导入的返回都按当前身份隐藏尚未公开的评分。
  async read(session) { return this.visible(await this.readState(session)); }
  visible(payload) { return { ...payload, kitchen: kitchenView(payload.kitchen, payload.role) }; }
  // 保存冲突时重新读取刚保存的评分，再执行本次操作。
  async change(session, input) {
    if (!input || typeof input.action !== 'string') throw new KitchenError('操作内容不正确');
    await this.repository.seedHistory(session.kitchenId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.readState(session);
      const previous = new Set(calendarEntries({ meals: current.kitchen.meals.slice(0, 1) }).map(e => e.key));
      let next;
      try { next = applyAction(current.kitchen, input, session.role); }
      catch (error) { throw new KitchenError(error.message); }
      const state = JSON.stringify(next);
      if (Buffer.byteLength(state) > 2 * 1024 * 1024) throw new KitchenError('厨房记录超过2MB，请先整理菜单和历史');
      if (await this.repository.save(session.kitchenId, current.version, state, calendarEntries({ meals: next.meals.slice(0, 1) }).filter(e => !previous.has(e.key)))) return this.visible({ ...current, version: current.version + 1, kitchen: next });
    }
    throw new KitchenError('两个人正在同时操作，请稍后再试', 409);
  }
  // 月份和日期都由后台验证，页面无法通过参数访问另一个厨房。
  async calendar(session, params) {
    let query; try { query = calendarQuery(params); } catch (error) { throw new KitchenError(error.message); }
    await this.repository.seedHistory(session.kitchenId);
    return query.month ? this.repository.calendarMonth(session.kitchenId, query) : this.repository.calendarDay(session.kitchenId, query);
  }
  // 备份接口只允许逐页读自己的历史，不返回口令或数据库配置。
  async exportCalendar(session, params) {
    const after = params.get('after') || '0'; const maximum = params.get('maximum') || '';
    if (!/^\d{1,20}$/.test(after) || maximum && !/^\d{1,20}$/.test(maximum)) throw new KitchenError('日历备份位置不正确');
    await this.repository.seedHistory(session.kitchenId);
    return this.repository.calendarExport(session.kitchenId, after, maximum);
  }
  // 分批恢复独立日历，不要求覆盖现在已经用过的冰箱和菜单。
  async restoreCalendar(session, input) {
    let entries; try { entries = calendarBackupEntries(input); } catch (error) { throw new KitchenError(error.message); }
    if (new Set(entries.map(e => e.key)).size !== entries.length) throw new KitchenError('日历备份包含重复的菜品记录');
    await this.repository.seedHistory(session.kitchenId);
    try { return await this.repository.restoreCalendar(session.kitchenId, entries); }
    catch (error) { if (error.code === 'CALENDAR_CONFLICT') throw new KitchenError(error.message, 409); throw error; }
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
