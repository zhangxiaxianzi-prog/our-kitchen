const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { accountSessions, randomId, digest } = require('../wechat-gateway/account-session.cjs');
const { PermissionCache } = require('../wechat-gateway/permission-cache.cjs');
const { AccountService, WechatIdentity } = require('../wechat-gateway/account-service.cjs');
const { AccountRepository } = require('../wechat-gateway/account-repository.cjs');
const { KitchenService } = require('../wechat-gateway/service.cjs');
const { createServer } = require('../wechat-gateway/server.cjs');
const { sessions } = require('../wechat-gateway/session.cjs');
const secret = '账号权限离线测试密钥123456789012345678901234567890';
const owner = 'openid_owner_for_test'; const guest = 'openid_guest_for_test'; const stranger = 'openid_stranger_for_test';
// 假仓库只供离线验证，不连接生产数据库；模拟多个服务共用同一份账号和厨房关系。
class Accounts {
  users = new Map(); spaces = new Map(); members = new Map(); phrases = new Map(); permissions = new Map(); pending = new Map(); logins = new Map(); states = new Map(); rates = new Map();
  kitchens = { allowLogin: async (id, bucket, max) => { const n = (this.rates.get(id) || 0) + 1; this.rates.set(id, n); return n <= max; }, ready: async () => {}, read: async id => this.states.get(id) };
  async ensureUser(user) { if (!this.users.has(user)) this.users.set(user, { count: 0, daily: 0, day: '' }); }
  async whitelist(user) { return !!this.permissions.get(user); }
  async member(user, id) { return this.members.get(user + ':' + id); }
  async space(id) { return this.spaces.get(id); }
  async findPhrase(hash) { return this.spaces.get(this.phrases.get(hash)); }
  async create(user, space, state, unlimited, day) { const row = this.users.get(user); if (!unlimited && (row.count >= 3 || row.day === day && row.daily >= 1)) { const error = new Error('厨房数量或每天创建上限'); error.status = 429; throw error; } row.count++; row.daily = row.day === day ? row.daily + 1 : 1; row.day = day; this.spaces.set(space.id, { ...space, owner_id: user }); this.phrases.set(space.hash, space.id); this.members.set(user + ':' + space.id, { name: space.name, is_owner: 1 }); this.states.set(space.id, { version: 1, state }); }
  async touch() {}
  async list(user) { return { items: [...this.spaces.values()].filter(x => this.members.has(user + ':' + x.id)).map(x => ({ id: x.id, name: x.name, owner: x.owner_id === user })), next: null }; }
  async requestJoin(user, id) { this.pending.set(user + ':' + id, true); }
  async decide(id, user, approved, name) { assert(this.pending.get(user + ':' + id)); this.pending.delete(user + ':' + id); if (approved) this.members.set(user + ':' + id, { name, is_owner: 0 }); }
  async requests() { return { items: [], next: null }; }
  async savePermission(actor, input) { this.permissions.set(input.userId, input.enabled); }
  async permissionsList() { return { items: [], next: null }; }
  async execute(sql, values) {
    if (sql.startsWith('DELETE FROM kitchen_admin_logins')) return { affectedRows: 0 };
    if (sql.startsWith('INSERT INTO kitchen_admin_logins')) { const [id, browser, scan, expires] = values; this.logins.set(id, { browser, scan, expires, status: 'pending' }); return { affectedRows: 1 }; }
    if (sql.startsWith('SELECT status')) { const row = this.logins.get(values[0]); return row && row.browser === values[1] ? [row] : []; }
    if (sql.includes("SET status = 'approved'")) { const [user, id, scan, now] = values; const row = this.logins.get(id); if (!row || row.scan !== scan || row.expires <= now || row.status !== 'pending') return { affectedRows: 0 }; row.status = 'approved'; row.user_id = user; return { affectedRows: 1 }; }
    if (sql.includes("SET status = 'used'")) { const [id, browser, now] = values; const row = this.logins.get(id); if (!row || row.browser !== browser || row.expires <= now || row.status !== 'approved') return { affectedRows: 0 }; row.status = 'used'; return { affectedRows: 1 }; }
    throw new Error('离线仓库不支持该查询');
  }
}
function setup() { const repo = new Accounts(); const auth = accountSessions(secret); const service = new AccountService(repo, auth, { exchange: async code => code === 'guest-code' ? guest : owner }, [owner]); return { repo, auth, service }; }
test('新票据区分微信、厨房和管理员用途，旧口令票据无法进入新厨房', () => {
  const auth = accountSessions(secret); const id = randomId(); const token = auth.issue(id, 1, owner);
  assert.equal(auth.read('Bearer ' + token).userId, owner); assert.equal(auth.read('Bearer ' + token, 'account'), null);
  assert.equal(auth.read('Bearer ' + sessions(secret).issue(id, 0)), null);
  assert.equal(auth.read('Bearer ' + token.replace(/.$/, '!')), null);
  assert.equal(auth.read('Bearer ' + auth.issueClaims({ userId: owner, kind: 'account' }, -1), 'account'), null);
});
test('微信身份只采用微信接口返回，缺少密钥、微信拒绝、网络失败均不给账号票据', async () => {
  let url;
  const identity = new WechatIdentity('test-app', 'test-secret', async input => { url = input; return { ok: true, json: async () => ({ openid: owner, session_key: '不得返回' }) }; });
  assert.equal(await identity.exchange('login-code'), owner); assert.equal(url.hostname, 'api.weixin.qq.com'); assert.equal(url.searchParams.get('appid'), 'test-app');
  await assert.rejects(new WechatIdentity('test-app', '').exchange('login-code'), /尚未配置/);
  await assert.rejects(new WechatIdentity('test-app', 'secret', async () => ({ ok: true, json: async () => ({ errcode: 40029 }) })).exchange('login-code'), /未成功/);
  await assert.rejects(new WechatIdentity('test-app', 'secret', async () => { throw new Error('网络失败'); }).exchange('login-code'), /核实微信身份/);
});
test('输入无效口令不创建厨房；成员审批之前不能进入，非创建者不能审批', async () => {
  const { service, repo, auth } = setup(); await service.login({ code: 'owner-code', openid: stranger }); await service.login({ code: 'guest-code' });
  assert.equal(auth.read('Bearer ' + (await service.login({ code: 'owner-code', openid: stranger })).token, 'account').userId, owner);
  const created = await service.create(owner, { name: '我们的厨房', role: 0 });
  await assert.rejects(service.join(guest, { passphrase: randomId() }), /口令不正确/); assert.equal(repo.spaces.size, 1);
  await service.join(guest, { passphrase: created.invitation });
  await assert.rejects(service.enter(guest, { id: created.id, role: 1 }), e => e.status === 403);
  await assert.rejects(service.decide(guest, { id: created.id, userId: guest, approved: true }), e => e.status === 403);
  await service.decide(owner, { id: created.id, userId: guest, approved: true });
  const entered = await service.enter(guest, { id: created.id, role: 1 }); assert.equal(auth.read('Bearer ' + entered.token).userId, guest);
  assert.equal((await repo.list(guest)).items.length, 1); assert.equal(repo.users.get(guest).count, 0);
  // 本次明确保留身份切换，同一成员可以选择另一评分身份。
  assert.equal(auth.read('Bearer ' + (await service.enter(guest, { id: created.id, role: 0 })).token).role, 0);
});
test('普通账号受每日和总数量限制，白名单同时豁免两项，但保留防止连续创建的限制', async () => {
  const { repo, service } = setup(); await service.login({ code: 'owner-code' });
  await service.create(owner, { name: '第一间', role: 0 }); await assert.rejects(service.create(owner, { name: '第二间', role: 0 }), e => e.status === 429);
  repo.permissions.set(owner, true); service.permissions.invalidate(owner);
  for (let i = 0; i < 5; i++) await service.create(owner, { name: '白名单厨房' + i, role: 0 });
  assert.equal(repo.spaces.size, 6);
  repo.permissions.set(owner, false); service.permissions.invalidate(owner);
  await assert.rejects(service.create(owner, { name: '再次创建', role: 0 }), e => e.status === 429);
  assert.equal(repo.spaces.size, 6);
});
test('两个实例共用名额，加入他人的厨房不占自己创建的名额', async () => {
  const { repo, service, auth } = setup(); await service.login({ code: 'owner-code' });
  const other = new AccountService(repo, auth, service.identity, [owner]);
  const results = await Promise.allSettled([service.create(owner, { name: '并发甲', role: 0 }), other.create(owner, { name: '并发乙', role: 0 })]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(repo.users.get(owner).count, 1);
});
test('60秒缓存跨实例有明确延迟，过期读取失败不会继续使用旧权限', async () => {
  let now = 0; let enabled = true; let fail = false; let reads = 0;
  const read = async () => { reads++; if (fail) throw new Error('数据库暂不可用'); return enabled; };
  const a = new PermissionCache(read, () => now); const b = new PermissionCache(read, () => now);
  assert.deepEqual(await Promise.all([a.enabled(owner), a.enabled(owner)]), [true, true]); assert.equal(reads, 1);
  await b.enabled(owner); enabled = false; a.invalidate(owner); assert.equal(await a.enabled(owner), false); assert.equal(await b.enabled(owner), true);
  now = 60000; fail = true; await assert.rejects(b.enabled(owner), /不可用/); fail = false; assert.equal(await b.enabled(owner), false);
});
test('名单修改期间的旧查询不会重新写入缓存，缓存数量有上限', async () => {
  let release; const cache = new PermissionCache(() => new Promise(resolve => { release = resolve; }));
  const pending = cache.enabled(owner); await Promise.resolve(); cache.invalidate(owner); release(true); await pending; assert.equal(cache.items.has(owner), false);
  const bounded = new PermissionCache(async () => false); for (let i = 0; i < 1100; i++) await bounded.enabled('openid_' + i); assert.equal(bounded.items.size, 1000); assert.equal(bounded.pending.size, 0); assert.equal(bounded.generations.size, 0);
});
test('管理员二维码需管理员批准及原浏览器凭证，跨实例只消费一次并拒绝过期', async () => {
  const { service, repo, auth } = setup(); repo.permissions.set(guest, true);
  const login = await service.startAdminLogin(); const other = new AccountService(repo, auth, service.identity, [owner]);
  await assert.rejects(service.approveAdmin(guest, login), e => e.status === 403);
  await service.approveAdmin(owner, login); assert.equal((await other.pollAdmin(login.id, randomId())).status, 'expired');
  const results = await Promise.all([service.pollAdmin(login.id, login.browser), other.pollAdmin(login.id, login.browser)]);
  assert.equal(results.filter(x => x.token).length, 1); assert.equal(auth.read('Bearer ' + results.find(x => x.token).token, 'admin').userId, owner);
  assert.equal((await service.pollAdmin(login.id, login.browser)).status, 'used');
  const expired = await service.startAdminLogin(); repo.logins.get(expired.id).expires = 0; await assert.rejects(service.approveAdmin(owner, expired), /失效/);
});
test('新建表与名额更新不使用连表或显式行锁，冲突会回退并释放连接', async () => {
  const calls = []; let rolledBack = 0; let released = 0;
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => rolledBack++, release: () => released++, execute: async ({ sql }, values) => { calls.push(sql); return [{ affectedRows: 0 }]; } };
  const kitchens = { pool: { getConnection: async () => connection }, execute: async sql => { calls.push(sql); return sql.startsWith('SELECT owned') ? [{ owned: 0, create_day: '', daily_count: 0, version: 1 }] : []; } };
  const repo = new AccountRepository(kitchens); await repo.initialize();
  await assert.rejects(repo.create(owner, { id: randomId(), name: '测试', hash: randomId() }, '{}', false, '2026-10-10'), e => e.status === 409);
  assert.equal(rolledBack, 1); assert.equal(released, 1); assert(calls.every(sql => !/\bJOIN\b|FOR UPDATE|LOCK IN SHARE MODE/i.test(sql)));
});
test('生产路由关闭旧登录；厨房读取检查成员；管理修改校验来源，不信任伪造微信请求头', async t => {
  const { repo, service: accounts, auth } = setup(); const origin = 'https://admin.example.com';
  const server = createServer(new KitchenService(repo.kitchens, auth), auth, [origin], console, accounts, origin);
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, data, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  assert.equal((await post('/api/login', { passphrase: '旧口令12345678', role: 0 })).status, 410);
  assert.equal((await fetch(base + '/api/account/profile', { headers: { 'X-WX-OPENID': owner } })).status, 401);
  assert.equal((await post('/api/admin/login', {})).status, 403);
  const account = await (await post('/api/account/login', { code: 'owner-code' })).json();
  const created = await (await post('/api/account/create', { name: 'HTTP厨房', role: 0 }, { Authorization: 'Bearer ' + account.token })).json();
  assert.equal((await fetch(base + '/api/kitchen', { headers: { Authorization: 'Bearer ' + auth.issue(created.id, 0, stranger) } })).status, 403);
  const qrResponse = await post('/api/admin/login', {}, { Origin: origin }); assert.equal(qrResponse.status, 200);
  const browser = qrResponse.headers.get('set-cookie').split(';')[0].split('=')[1]; const qr = await qrResponse.json(); assert(qr.qr.startsWith('data:image/png;base64,'));
  const row = repo.logins.get(qr.id); row.status = 'approved'; row.user_id = owner;
  const logged = await fetch(base + '/api/admin/poll?id=' + qr.id, { headers: { Cookie: 'kitchen_browser=' + browser } }); assert.equal(logged.status, 200); assert.match(logged.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/); assert.equal((await logged.json()).token, undefined);
  const adminCookie = logged.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/api/admin/save', { userId: guest, enabled: true, note: '', version: 0 }, { Cookie: adminCookie })).status, 403);
  assert.equal((await post('/api/admin/save', { userId: guest, enabled: true, note: '', version: 0 }, { Cookie: adminCookie, Origin: origin })).status, 200);
  const page = await fetch(base + '/admin'); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert((await page.text()).includes('白名单管理'));
});
