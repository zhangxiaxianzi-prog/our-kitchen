const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { newKitchen } = require('../wechat-gateway/dist/domain.cjs');
const { KitchenService } = require('../wechat-gateway/service.cjs');
const { sessions } = require('../wechat-gateway/session.cjs');
const { configuration } = require('../wechat-gateway/config.cjs');
const { createServer } = require('../wechat-gateway/server.cjs');
const { validateBackup } = require('../wechat-gateway/backup.cjs');
const { MysqlKitchenRepository } = require('../wechat-gateway/repository.cjs');
const secret = '仅用于离线检查的密钥不用于线上厨房123456789012345678901234567890';
// 用可同时读写的测试仓库检查业务冲突；这不代表真实MySQL已经联通。
class MemoryRepository {
  rows = new Map(); rates = new Map();
  async ready() {}
  async ensure(id, state) { if (!this.rows.has(id)) this.rows.set(id, { version: 1, state, restore_hash: null }); }
  async read(id) { return structuredClone(this.rows.get(id)); }
  async save(id, version, state) {
    const row = this.rows.get(id); if (row.version !== version) return false;
    row.state = state; row.version++; return true;
  }
  async restore(id, version, state, hash) {
    const row = this.rows.get(id); if (row.version !== version || row.restore_hash) return false;
    row.state = state; row.version++; row.restore_hash = hash; return true;
  }
  async allowLogin(id, bucket, maximum = 20) { const count = (this.rates.get(id) || 0) + 1; this.rates.set(id, count); return count <= maximum; }
}
function setup() { const repo = new MemoryRepository(); const auth = sessions(secret); return { repo, auth, service: new KitchenService(repo, auth) }; }
async function couple(service, auth, phrase = '离线检查共同厨房口令') {
  const boy = await service.login({ passphrase: phrase, role: 0 }); const girl = await service.login({ passphrase: phrase, role: 1 });
  return [boy, girl].map(x => auth.read('Bearer ' + x.token));
}
test('同口令两个身份共享厨房，不同口令隔离，票据篡改被拒绝', async () => {
  const { service, auth } = setup(); const [boy, girl] = await couple(service, auth);
  assert.equal(boy.kitchenId, girl.kitchenId); assert.equal(girl.role, 1);
  const [other] = await couple(service, auth, '另外一个厨房测试口令'); assert.notEqual(other.kitchenId, boy.kitchenId);
  assert.equal(auth.read('Bearer ' + auth.issue(boy.kitchenId, 0).replace(/.$/, '！')), null);
  assert.equal(auth.read('Bearer 无效登录'), null);
});
test('两个服务实例同时评分会重读，不覆盖另一人的分数', async () => {
  const { repo, service, auth } = setup(); const [boy, girl] = await couple(service, auth);
  const second = new KitchenService(repo, sessions(secret));
  const meal = (await service.change(boy, { action: 'mealCreate' })).kitchen.meals[0];
  assert.deepEqual(meal.candidates.map(x => x.dish.kind), ['meat', 'veg', 'veg']);
  await Promise.all([service.change(boy, { action: 'score', mealId: meal.id, candidateId: meal.candidates[0].id, score: 2 }), second.change(girl, { action: 'score', mealId: meal.id, candidateId: meal.candidates[0].id, score: 5 })]);
  assert.deepEqual((await service.read(boy)).kitchen.meals[0].candidates[0].scores, [2, 5]);
  const bought = await second.change(girl, { action: 'shoppingGenerate' });
  assert.ok(bought.kitchen.shopping.length > 0);
});
test('换菜后的迟到评分被拒绝，清空两人评分', async () => {
  const { service, auth } = setup(); const [boy] = await couple(service, auth);
  const meal = (await service.change(boy, { action: 'mealCreate' })).kitchen.meals[0];
  const old = meal.candidates[0].id;
  const changed = await service.change(boy, { action: 'replace', mealId: meal.id, candidateId: old });
  assert.notEqual(changed.kitchen.meals[0].candidates[0].id, old);
  assert.deepEqual(changed.kitchen.meals[0].candidates[0].scores, [null, null]);
  await assert.rejects(service.change(boy, { action: 'score', mealId: meal.id, candidateId: old, score: 5 }), /候选菜已变更/);
});
test('旧厨房备份完整保留，重复导入不回退新评分，禁止覆盖已使用厨房', async () => {
  const { service, auth } = setup(); const [boy] = await couple(service, auth);
  const old = newKitchen(); old.pantry = ['番茄', '鸡蛋']; old.shopping = [{ name: '萝卜', checked: true }]; old.dishes[0].active = false;
  const backup = { format: 'two-person-kitchen-v1', kitchen: old };
  assert.deepEqual((await service.restore(boy, backup)).kitchen, old);
  await service.change(boy, { action: 'pantryAdd', name: '排骨' });
  assert.ok((await service.restore(boy, backup)).kitchen.pantry.includes('排骨'));
  const altered = structuredClone(backup); altered.kitchen.pantry.push('白菜');
  await assert.rejects(service.restore(boy, altered), /已经使用过/);
  const [other] = await couple(service, auth, '已经开始使用的新厨房');
  await service.change(other, { action: 'pantryAdd', name: '白菜' });
  await assert.rejects(service.restore(other, backup), /已经使用过/);
});
test('导入和新增同时发生时只允许一个先保存，不丢失任何已确认修改', async () => {
  const { service, auth } = setup(); const [boy] = await couple(service, auth);
  const old = newKitchen(); old.pantry = ['萝卜'];
  const results = await Promise.allSettled([service.restore(boy, { format: 'two-person-kitchen-v1', kitchen: old }), service.change(boy, { action: 'pantryAdd', name: '青菜' })]);
  const state = (await service.read(boy)).kitchen;
  assert.ok(state.pantry.includes('青菜'));
  if (results[0].status === 'fulfilled') assert.ok(state.pantry.includes('萝卜'));
});
test('无效备份拒绝：超大菜单、重复记录、评分超限、未知字段', () => {
  const wrap = kitchen => ({ format: 'two-person-kitchen-v1', kitchen });
  const invalid = newKitchen(); invalid.pantry = ['鸡蛋', '鸡蛋']; assert.throws(() => validateBackup(wrap(invalid)), /重复/);
  assert.throws(() => validateBackup({ ...wrap(newKitchen()), token: '不该导入票据' }), /不完整/);
  assert.throws(() => validateBackup(wrap({ ...newKitchen(), dishes: Array(401).fill(newKitchen().dishes[0]) })), /上限/);
});
test('登录限额由共享仓库控制，另一个实例不能重新获得额度', async () => {
  const { service, auth, repo } = setup(); const second = new KitchenService(repo, auth);
  for (let i = 0; i < 20; i++) await service.login({ passphrase: '重复登录检查共同口令', role: 0 });
  await assert.rejects(second.login({ passphrase: '重复登录检查共同口令', role: 1 }), error => error.status === 429);
});
test('数据库保存采用带版本号的单表更新，参数不拼接SQL，5.7登录次数原子领取', async () => {
  const repo = Object.create(MysqlKitchenRepository.prototype); const calls = [];
  repo.pool = { async execute(options, values) { calls.push({ sql: options.sql, values }); return [{ affectedRows: 1 }]; } };
  assert.equal(await repo.save('厨房编号', 9, '厨房内容'), true);
  assert.match(calls[0].sql, /WHERE id = \? AND version = \?/);
  assert.deepEqual(calls[0].values, ['厨房内容', '厨房编号', 9]);
  await repo.allowLogin('登录限制编号', 3);
  assert.match(calls[2].sql, /count < \?/); assert.deepEqual(calls[2].values, ['登录限制编号', 20]);
  assert.ok(calls.every(x => !/JOIN|RETURNING|ON CONFLICT/i.test(x.sql)));
});
test('缺少配置和过短密钥停止启动，数据库连接数及等待队列有上限', () => {
  assert.throws(() => configuration({}), /缺少/);
  const valid = { DB_HOST: '127.0.0.1', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: '仅测试', KITCHEN_SESSION_SECRET: secret };
  assert.equal(configuration(valid).database.connectionLimit, 5); assert.equal(configuration(valid).database.queueLimit, 20);
  assert.throws(() => configuration({ ...valid, KITCHEN_SESSION_SECRET: '短密钥' }), /至少/);
});
test('HTTP完整流程、网站来源限制、请求体上限、数据库就绪检查和保密日志', async t => {
  const { service, auth, repo } = setup(); const logs = [];
  const origin = 'https://our-kitchen-oct09.berryokapi.chatgpt.site';
  const server = createServer(service, auth, [origin], { error: (...args) => logs.push(args) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ passphrase: 'HTTP完整检查共同口令', role: 0 }) });
  assert.equal(login.status, 200); assert.equal(login.headers.get('access-control-allow-origin'), origin);
  const { token } = await login.json();
  const change = await fetch(url + '/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'pantryAdd', name: '西红柿' }) });
  assert.deepEqual((await change.json()).kitchen.pantry, ['番茄']);
  assert.equal((await fetch(url + '/api/kitchen')).status, 401);
  assert.equal((await fetch(url + '/health', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(2001) })).status, 413);
  assert.equal((await fetch(url + '/api/kitchen', { method: 'DELETE' })).status, 405);
  repo.ready = async () => { const error = new Error('包含密码的错误绝不能进入日志'); error.code = 'ECONNREFUSED'; throw error; };
  assert.equal((await fetch(url + '/health')).status, 200); assert.equal((await fetch(url + '/ready')).status, 503);
  assert.ok(JSON.stringify(logs).includes('ECONNREFUSED')); assert.ok(!JSON.stringify(logs).includes('包含密码'));
});
