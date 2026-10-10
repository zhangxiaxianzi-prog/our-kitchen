const { KitchenError } = require('./service.cjs');
const { newKitchen } = require('./dist/domain.cjs');
const { randomId, digest, validUser } = require('./account-session.cjs');
const { PermissionCache } = require('./permission-cache.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
// 只请求微信固定接口，不接收客户端传来的微信身份或接口地址。
class WechatIdentity {
  constructor(appId, secret, request = fetch, logError = (...args) => console.error(...args)) { this.appId = appId; this.secret = secret; this.request = request; this.logError = logError; }
  async exchange(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{5,256}$/.test(code)) throw new KitchenError('微信登录凭证不正确');
    if (!this.secret) throw new KitchenError('后台尚未配置微信登录，请联系管理员', 503);
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: this.appId, secret: this.secret, js_code: code, grant_type: 'authorization_code' }).toString();
    const started = Date.now(); let phase = '请求微信接口'; let status = null; let contentType = ''; let wechatCode = null;
    try {
      const response = await this.request(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      status = response.status; phase = '解析微信响应';
      const type = response.headers && response.headers.get('content-type');
      contentType = typeof type === 'string' && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;.*)?$/.test(type) ? type.split(';')[0].slice(0, 80) : '';
      const result = await response.json(); phase = '核实微信身份';
      wechatCode = result && Number.isSafeInteger(result.errcode) ? result.errcode : null;
      if (!response.ok || !result || result.errcode || !validUser(result.openid)) throw new KitchenError('微信登录未成功，请重新登录', 401);
      return result.openid;
    } catch (error) {
      // 只打印固定分类和状态，不打印请求地址、微信凭证、密钥、身份或响应正文。
      const knownCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
      const rawCode = error && (error.cause && error.cause.code || error.code);
      const reason = knownCodes.has(rawCode) ? rawCode : error && error.name === 'TimeoutError' ? 'WECHAT_TIMEOUT' : phase === '解析微信响应' ? 'WECHAT_INVALID_JSON' : error instanceof KitchenError ? 'WECHAT_REJECTED' : 'WECHAT_REQUEST_FAILED';
      this.logError('核实微信身份失败', { 阶段: phase, 错误编号: reason, 微信状态: Number.isInteger(status) ? status : null, 内容类型: contentType, 微信错误编号: wechatCode, 耗时毫秒: Date.now() - started });
      if (error instanceof KitchenError) throw error;
      throw new KitchenError('暂时无法核实微信身份，请稍后重试', 503);
    }
  }
}
class AccountService {
  constructor(repository, sessions, identity, admins = []) {
    this.repository = repository; this.sessions = sessions; this.identity = identity; this.admins = new Set(admins);
    this.permissions = new PermissionCache(userId => repository.whitelist(userId));
  }
  isAdmin(userId) { return this.admins.has(userId); }
  requireAccount(header) { const account = this.sessions.read(header, 'account'); if (!account) throw new KitchenError('请先微信登录', 401); return account.userId; }
  requireAdmin(header) { const account = this.sessions.read(header, 'admin'); if (!account || !this.isAdmin(account.userId)) throw new KitchenError('没有管理员权限，请重新扫码登录', 401); return account.userId; }
  async limit(userId, operation, maximum) {
    const bucket = Math.floor(Date.now() / 900000);
    if (!await this.repository.kitchens.allowLogin(this.sessions.kitchenId(operation + ':' + userId + ':' + bucket), bucket, maximum)) throw new KitchenError('操作过于频繁，请15分钟后再试', 429);
  }
  async login(input) {
    await this.limit('all', 'wechat-login', 1000);
    const userId = await this.identity.exchange(input.code); await this.repository.ensureUser(userId);
    return { token: this.sessions.issueAccount(userId), userId, administrator: this.isAdmin(userId) };
  }
  async profile(userId) { return { userId, administrator: this.isAdmin(userId), unlimited: await this.permissions.enabled(userId) }; }
  async create(userId, input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40 || ![0, 1].includes(input.role)) throw new KitchenError('请填写1到40个字符的厨房名称并选择身份');
    // 白名单免除每日配额，但仍防止短时间大量创建请求。
    await this.limit(userId, 'create', 20);
    const phrase = randomId(); const id = randomId();
    const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    await this.repository.create(userId, { id, name: input.name.trim(), hash: this.sessions.kitchenId(phrase) }, JSON.stringify(newKitchen()), await this.permissions.enabled(userId), day);
    return { token: this.sessions.issue(id, input.role, userId), id, name: input.name.trim(), invitation: phrase };
  }
  async enter(userId, input) {
    if (!validId(input.id) || ![0, 1].includes(input.role)) throw new KitchenError('厨房或评分身份不正确');
    if (!await this.repository.member(userId, input.id)) throw new KitchenError('你还不是这个厨房的成员', 403);
    await this.repository.touch(userId, input.id);
    return { token: this.sessions.issue(input.id, input.role, userId) };
  }
  async requireMembership(session) { if (!session || !await this.repository.member(session.userId, session.kitchenId)) throw new KitchenError('你还不是这个厨房的成员', 403); }
  async join(userId, input) {
    await this.limit(userId, 'join', 20); await this.limit('all', 'join', 1000);
    // 无效口令不创建厨房，也不公开厨房名称或内容。
    if (!validId(input.passphrase)) throw new KitchenError('口令不正确或暂时无法申请加入');
    const space = await this.repository.findPhrase(this.sessions.kitchenId(input.passphrase));
    if (!space) throw new KitchenError('口令不正确或暂时无法申请加入');
    if (await this.repository.member(userId, space.id)) return { joined: true };
    await this.repository.requestJoin(userId, space.id); return { pending: true };
  }
  async owner(userId, id) {
    if (!validId(id)) throw new KitchenError('厨房编号不正确');
    const space = await this.repository.space(id);
    if (!space || space.owner_id !== userId) throw new KitchenError('只有厨房创建者能处理申请', 403);
    return space;
  }
  async decide(userId, input) {
    const space = await this.owner(userId, input.id);
    if (!validUser(input.userId) || typeof input.approved !== 'boolean') throw new KitchenError('申请内容不正确');
    await this.repository.decide(input.id, input.userId, input.approved, space.name); return { ok: true };
  }
  async invitation(userId, id) {
    await this.owner(userId, id); await this.limit(userId, 'invitation', 20);
    const phrase = randomId(); await this.repository.execute('UPDATE kitchen_spaces SET phrase_hash = ? WHERE id = ? AND owner_id = ?', [this.sessions.kitchenId(phrase), id, userId]);
    return { invitation: phrase };
  }
  async savePermission(actorId, input) {
    if (!validUser(input.userId) || typeof input.enabled !== 'boolean' || typeof input.note !== 'string' || input.note.length > 80 || !Number.isInteger(input.version) || input.version < 0 || input.version > 2147483646) throw new KitchenError('名单内容不正确');
    await this.repository.savePermission(actorId, input); this.permissions.invalidate(input.userId); return { ok: true };
  }
  async startAdminLogin() {
    await this.limit('all', 'admin-login', 200);
    const id = randomId(); const browser = randomId(); const scan = randomId(); const expires = Date.now() + 120000;
    await this.repository.execute('DELETE FROM kitchen_admin_logins WHERE expires < ? LIMIT 100', [Date.now()]);
    await this.repository.execute('INSERT INTO kitchen_admin_logins (id,browser_hash,scan_hash,expires) VALUES (?,?,?,?)', [id, digest(browser), digest(scan), expires]);
    return { id, browser, scan, expires };
  }
  async approveAdmin(userId, input) {
    if (!this.isAdmin(userId)) throw new KitchenError('你的账号没有管理员权限', 403);
    if (!validId(input.id) || !validId(input.scan)) throw new KitchenError('登录二维码不正确');
    const result = await this.repository.execute("UPDATE kitchen_admin_logins SET status = 'approved', user_id = ? WHERE id = ? AND scan_hash = ? AND status = 'pending' AND expires > ?", [userId, input.id, digest(input.scan), Date.now()]);
    if (result.affectedRows !== 1) throw new KitchenError('二维码已失效或已处理，请在网页重新生成');
    return { ok: true };
  }
  async pollAdmin(id, browser) {
    if (!validId(id) || !validId(browser)) throw new KitchenError('网页登录已失效，请重新生成二维码', 401);
    const rows = await this.repository.execute('SELECT status,user_id,expires FROM kitchen_admin_logins WHERE id = ? AND browser_hash = ?', [id, digest(browser)]);
    const row = rows[0]; if (!row || row.expires <= Date.now()) return { status: 'expired' };
    if (row.status !== 'approved') return { status: row.status };
    if (!this.isAdmin(row.user_id)) throw new KitchenError('没有管理员权限', 403);
    const changed = await this.repository.execute("UPDATE kitchen_admin_logins SET status = 'used' WHERE id = ? AND browser_hash = ? AND status = 'approved' AND expires > ?", [id, digest(browser), Date.now()]);
    return changed.affectedRows === 1 ? { status: 'approved', token: this.sessions.issueAccount(row.user_id, 'admin') } : { status: 'used' };
  }
}
module.exports = { AccountService, WechatIdentity, validId };
