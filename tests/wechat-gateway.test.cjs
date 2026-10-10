const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { newKitchen } = require('../wechat-gateway/dist/domain.cjs');
const { KitchenService } = require('../wechat-gateway/service.cjs');
const { sessions } = require('../wechat-gateway/session.cjs');
const { configuration } = require('../wechat-gateway/config.cjs');
const { createServer } = require('../wechat-gateway/server.cjs');
const { validateBackup } = require('../wechat-gateway/backup.cjs');
const { calendarEntries, calendarDate } = require('../wechat-gateway/calendar.cjs');
const { MysqlKitchenRepository } = require('../wechat-gateway/repository.cjs');
const secret = '仅用于离线检查的密钥不用于线上厨房123456789012345678901234567890';
// 用可同时读写的测试仓库检查业务冲突；这不代表真实MySQL已经联通。
class MemoryRepository {
  rows = new Map(); rates = new Map(); history = new Map(); seeded = new Set(); sequence = 0;
  async ready() {}
  async ensure(id, state) { if (!this.rows.has(id)) this.rows.set(id, { version: 1, state, restore_hash: null }); }
  async read(id) { return structuredClone(this.rows.get(id)); }
  async seedHistory(id) { if (this.seeded.has(id)) return; this.append(id, calendarEntries(JSON.parse(this.rows.get(id).state)), null); this.seeded.add(id); }
  append(id, entries, rank) {
    if (!this.history.has(id)) this.history.set(id, new Map()); const saved = this.history.get(id);
    const nextRank = rank === null ? null : Math.max(rank, ...[...saved.values()].map(e => e.rank + 1));
    for (const e of [...entries].sort((a, b) => a.rank - b.rank)) if (!saved.has(e.key)) {
      const same = [...saved.values()].find(x => x.mealId === e.mealId);
      saved.set(e.key, { ...structuredClone(e), id: String(++this.sequence), rank: same ? same.rank : nextRank === null ? e.rank : nextRank });
    }
  }
  async calendarMonth(id, query) { const days = new Map(); let unknownCount = 0; for (const e of (this.history.get(id) || new Map()).values()) { if (e.date === 'unknown') unknownCount++; else if (e.date >= query.start && e.date < query.end) days.set(e.date, (days.get(e.date) || 0) + 1); } return { days: [...days].map(([date, count]) => ({ date, count })), unknownCount }; }
  async calendarDay(id, query) { const rows = [...(this.history.get(id) || new Map()).values()].filter(e => e.date === query.date && (!query.cursor || e.rank < query.cursor.rank || e.rank === query.cursor.rank && Number(e.id) < Number(query.cursor.id))).sort((a, b) => b.rank - a.rank || Number(b.id) - Number(a.id)); const entries = rows.slice(0, 40); const last = entries.at(-1); return { entries, next: rows.length > 40 ? { rank: last.rank, id: last.id } : null }; }
  async calendarExport(id, after, maximum) { const rows = [...(this.history.get(id) || new Map()).values()]; maximum ||= String(Math.max(0, ...rows.map(x => Number(x.id)))); const selected = rows.filter(e => Number(e.id) > Number(after) && Number(e.id) <= Number(maximum)).sort((a, b) => Number(a.id) - Number(b.id)); return { maximum, entries: selected.slice(0, 100), next: selected.length > 100 ? selected[99].id : null }; }
  async save(id, version, state, entries = []) {
    const row = this.rows.get(id); if (row.version !== version) return false;
    this.append(id, entries, version + 1); row.state = state; row.version++; return true;
  }
  async restore(id, version, state, hash) {
    const row = this.rows.get(id); if (row.version !== version || row.restore_hash) return false;
    this.append(id, calendarEntries(JSON.parse(state)), null); row.state = state; row.version++; row.restore_hash = hash; return true;
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
  const connection = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async execute(options, values) { calls.push({ sql: options.sql, values }); return [{ affectedRows: 1 }]; } };
  repo.pool = { getConnection: async () => connection, execute: connection.execute };
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
test('HTTP完整流程、来源限制、请求体上限、数据库就绪检查和保密日志', async t => {
  const { service, auth, repo } = setup(); const logs = [];
  const origin = 'https://example.com';
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
// 一个批次只保存一次；校验不通过时不能写入前面的食材。
test('冰箱批量添加归一别名、共享分类、失败不保存部分食材', async () => {
  const { service, auth } = setup(); const [boy, girl] = await couple(service, auth);
  const result = await service.change(boy, { action: 'pantryAddMany', items: [{ name: '西红柿' }, { name: '番茄' }, { name: '秋葵', category: 'vegetables' }] });
  assert.deepEqual(result.kitchen.pantry, ['番茄', '秋葵']);
  assert.deepEqual((await service.read(girl)).kitchen.pantryCategories, [{ name: '秋葵', category: 'vegetables' }]);
  const before = await service.read(boy);
  await assert.rejects(service.change(boy, { action: 'pantryAddMany', items: [{ name: '排骨' }, { name: '萝卜', category: 'invalid' }] }), /有效的食材分类/);
  assert.deepEqual(await service.read(boy), before);
  await assert.rejects(service.change(boy, { action: 'pantryAddMany', items: Array(21).fill({ name: '萝卜' }) }), /20种/);
  await service.change(girl, { action: 'pantryCategorize', items: [{ name: '秋葵', category: 'other' }] });
  assert.equal((await service.read(boy)).kitchen.pantryCategories[0].category, 'other');
  const backup = validateBackup({ format: 'two-person-kitchen-v1', kitchen: (await service.read(boy)).kitchen });
  assert.equal(backup.kitchen.pantryCategories[0].name, '秋葵');
  await service.change(boy, { action: 'pantryRemoveMany', items: [{ name: '秋葵' }] });
  assert.deepEqual((await service.read(girl)).kitchen.pantryCategories, []);
  await assert.rejects(service.change(boy, { action: 'pantryCategorize', items: [{ name: '秋葵', category: 'vegetables' }] }), /食材已变更/);
});
test('两个实例同时批量操作库存保留对方新增，分类备份拒绝无对应食材', async () => {
  const { service, repo, auth } = setup(); const [boy, girl] = await couple(service, auth);
  const second = new KitchenService(repo, auth);
  await service.change(boy, { action: 'pantryAdd', name: '萝卜' });
  await Promise.all([
    service.change(boy, { action: 'pantryRemoveMany', items: [{ name: '萝卜' }] }),
    second.change(girl, { action: 'pantryAddMany', items: [{ name: '排骨', category: 'meat' }, { name: '青菜' }] })
  ]);
  const state = (await service.read(boy)).kitchen;
  assert.deepEqual(state.pantry.sort(), ['排骨', '青菜']);
  assert.equal(state.pantryCategories[0].category, 'meat');
  const invalid = structuredClone(state); invalid.pantryCategories.push({ name: '不存在的食材', category: 'other' });
  assert.throws(() => validateBackup({ format: 'two-person-kitchen-v1', kitchen: invalid }), /对应食材不存在/);
  const full = newKitchen(); full.pantry = Array.from({ length: 200 }, (_, i) => '食材' + i);
  const { applyAction } = require('../wechat-gateway/dist/domain.cjs');
  const original = structuredClone(full);
  assert.throws(() => applyAction(full, { action: 'pantryAddMany', items: [{ name: '排骨' }] }, 0), /超过200种/);
  assert.deepEqual(full, original);
});
// 查询和任意写入响应都隐藏对方未公开分数，实际保存不能把被隐藏的分数写成空值。
test('两人的评分独立隐藏，完成后公开且锁定，历史未完成评分仍隐藏', async () => {
  const { service, auth, repo } = setup(); const [boy, girl] = await couple(service, auth);
  const meal = (await service.change(boy, { action: 'mealCreate' })).kitchen.meals[0];
  const input = { action: 'score', mealId: meal.id, candidateId: meal.candidates[0].id };
  const first = await service.change(girl, { ...input, score: 5 });
  assert.deepEqual(first.kitchen.meals[0].candidates[0].scores, [null, 5]);
  const hidden = (await service.read(boy)).kitchen.meals[0].candidates[0];
  assert.deepEqual(hidden.scores, [null, null]); assert.equal(hidden.partnerRated, true);
  const unrelated = await service.change(boy, { action: 'pantryAdd', name: '萝卜' });
  assert.deepEqual(unrelated.kitchen.meals[0].candidates[0].scores, [null, null]);
  const raw = JSON.parse((await repo.read(boy.kitchenId)).state);
  assert.deepEqual(raw.meals[0].candidates[0].scores, [null, 5]); assert.equal(raw.meals[0].candidates[0].partnerRated, undefined);
  await service.change(boy, { ...input, score: 2 });
  assert.deepEqual((await service.read(girl)).kitchen.meals[0].candidates[0].scores, [2, 5]);
  await assert.rejects(service.change(boy, { ...input, score: 1 }), /已出结果/);
  await service.change(boy, { ...input, score: 2 });
  const other = { ...input, candidateId: meal.candidates[1].id };
  await service.change(boy, { ...other, score: 4 });
  await service.change(girl, { action: 'mealCreate' });
  const past = (await service.read(girl)).kitchen.meals[1].candidates[1];
  assert.deepEqual(past.scores, [null, null]); assert.equal(past.partnerRated, true);
});
// 两个实例同时给低分，只换一次；新候选换编号，淘汰菜和已有候选都不能再次抽到。
test('并发低分自动换同类，保留公开结果，旧评分拒绝，本轮淘汰菜不再推荐', async () => {
  const { service, auth, repo } = setup(); const [boy, girl] = await couple(service, auth);
  const second = new KitchenService(repo, auth);
  const meal = (await service.change(boy, { action: 'mealCreate', meatCount: 2, vegCount: 2 })).kitchen.meals[0];
  const old = meal.candidates[0];
  const input = { action: 'score', mealId: meal.id, candidateId: old.id };
  await Promise.all([service.change(boy, { ...input, score: 2 }), second.change(girl, { ...input, score: 3 })]);
  let current = (await service.read(boy)).kitchen.meals[0];
  assert.equal(current.rejected.length, 1); assert.deepEqual(current.rejected[0].scores, [2, 3]);
  assert.equal(current.rejected[0].name, old.dish.name);
  const next = current.candidates[0]; assert.notEqual(next.id, old.id); assert.notEqual(next.dish.id, old.dish.id);
  assert.equal(next.dish.kind, 'meat'); assert.deepEqual(next.scores, [null, null]);
  assert.equal(new Set(current.candidates.map(x => x.dish.id)).size, 4);
  await assert.rejects(service.change(girl, { ...input, score: 5 }), /候选菜已变更/);
  await assert.rejects(service.change(boy, { action: 'pick', mealId: meal.id, candidateId: next.id, dishId: old.dish.id }), /本轮淘汰/);
  await service.change(boy, { action: 'score', mealId: meal.id, candidateId: next.id, score: 0 });
  await second.change(girl, { action: 'score', mealId: meal.id, candidateId: next.id, score: 0 });
  current = (await service.read(girl)).kitchen.meals[0];
  assert.equal(current.rejected.length, 2);
  assert(current.candidates.every(x => !current.rejected.some(old => old.dishId === x.dish.id)));
});
// 候选耗尽时保存低分和原因，不因换菜失败吞掉另一人的评分。
test('冰箱限制随本轮固定，候选耗尽保留低分，补菜后可继续换菜', async () => {
  const { service, auth, repo } = setup(); const [boy, girl] = await couple(service, auth);
  const k = newKitchen();
  k.dishes = k.dishes.filter(d => d.kind === 'meat').slice(0, 2);
  k.pantry = [...k.dishes[0].ingredients];
  k.dishes[1].ingredients = ['当前冰箱没有的食材'];
  const row = await repo.read(boy.kitchenId); await repo.save(boy.kitchenId, row.version, JSON.stringify(k));
  const meal = (await service.change(boy, { action: 'mealCreate', meatCount: 1, vegCount: 0, fridge: true })).kitchen.meals[0];
  const input = { action: 'score', mealId: meal.id, candidateId: meal.candidates[0].id };
  await service.change(boy, { ...input, score: 1 });
  const final = (await service.change(girl, { ...input, score: 5, fridge: false })).kitchen.meals[0];
  assert.equal(final.candidates[0].id, input.candidateId); assert.deepEqual(final.candidates[0].scores, [1, 5]);
  assert.match(final.candidates[0].blocked, /暂无同类/); assert.equal(final.rejected.length, 1);
  await service.change(girl, { ...input, score: 5 }); assert.equal((await service.read(boy)).kitchen.meals[0].rejected.length, 1);
  await service.change(boy, { action: 'pantryAdd', name: '当前冰箱没有的食材' });
  const changed = await service.change(girl, { action: 'replace', mealId: meal.id, candidateId: input.candidateId });
  assert.equal(changed.kitchen.meals[0].candidates[0].dish.id, k.dishes[1].id);
  assert.equal(changed.kitchen.meals[0].candidates[0].blocked, undefined);
});
test('荤素数量分别设置并共享，下次沿用，非法数量或菜单不足不改动原晚餐', async () => {
  const { service, auth, repo } = setup(); const [boy, girl] = await couple(service, auth);
  const first = await service.change(boy, { action: 'mealCreate', meatCount: 0, vegCount: 1 });
  assert.deepEqual(first.kitchen.meals[0].candidates.map(x => x.dish.kind), ['veg']);
  assert.deepEqual((await service.read(girl)).kitchen.mealPreferences, { meatCount: 0, vegCount: 1 });
  await service.change(girl, { action: 'mealCreate' }); assert.equal((await service.read(boy)).kitchen.meals[0].candidates.length, 1);
  await service.change(boy, { action: 'mealCreate', meatCount: 3, vegCount: 3 });
  const before = await service.readState(boy);
  for (const counts of [{ meatCount: 0, vegCount: 0 }, { meatCount: 5, vegCount: 2 }, { meatCount: -1, vegCount: 2 }, { meatCount: '1', vegCount: 2 }, { meatCount: 1.5, vegCount: 1 }]) {
    await assert.rejects(service.change(boy, { action: 'mealCreate', ...counts }), /合计1到6道/);
    assert.deepEqual(await service.readState(boy), before);
  }
  await assert.rejects(service.change(boy, { action: 'mealCreate', meatCount: 1, vegCount: 2, fridge: true }), /候选不足/);
  assert.deepEqual(await service.readState(boy), before);
  const raw = JSON.parse((await repo.read(boy.kitchenId)).state);
  assert.doesNotThrow(() => validateBackup({ format: 'two-person-kitchen-v1', kitchen: raw }));
});
test('备份用两个人的同一版本合并真实分数，导入返回仍隐藏对方未公开分数', async () => {
  const { mergeBackupViews } = require('../wechat-gateway/tools/厨房备份迁移.cjs');
  const { service, auth } = setup(); const [boy, girl] = await couple(service, auth);
  const meal = (await service.change(boy, { action: 'mealCreate', meatCount: 1, vegCount: 0 })).kitchen.meals[0];
  await service.change(girl, { action: 'score', mealId: meal.id, candidateId: meal.candidates[0].id, score: 4 });
  const views = await Promise.all([service.read(boy), service.read(girl)]);
  const merged = mergeBackupViews(...views); assert.deepEqual(merged.kitchen.meals[0].candidates[0].scores, [null, 4]);
  assert.equal(merged.kitchen.meals[0].candidates[0].partnerRated, undefined);
  assert.throws(() => mergeBackupViews(views[0], { ...views[1], version: views[1].version + 1 }), /发生变化/);
  const [other] = await couple(service, auth, '接收新评分格式的备份厨房');
  const restored = await service.restore(other, { format: 'two-person-kitchen-v1', kitchen: merged.kitchen });
  assert.deepEqual(restored.kitchen.meals[0].candidates[0].scores, [null, null]);
  assert.deepEqual((await service.readState(other)).kitchen, merged.kitchen);
});
// 反复增删菜单也不能让本轮记录无上限增长；到上限仍保存最后一道低分结果。
test('本轮淘汰记录到400道停止换菜，保留评分并允许开始新一轮', () => {
  const { applyAction, maxRejectedDishes } = require('../wechat-gateway/dist/domain.cjs');
  const k = newKitchen(); applyAction(k, { action: 'mealCreate', meatCount: 1, vegCount: 0 }, 0);
  const meal = k.meals[0]; const candidate = meal.candidates[0];
  meal.rejected = Array.from({ length: maxRejectedDishes - 1 }, (_, i) => ({ id: '淘汰候选' + i, dishId: '已移除菜单' + i, name: '历史菜' + i, kind: 'meat', scores: [1, 1] }));
  const input = { action: 'score', mealId: meal.id, candidateId: candidate.id };
  applyAction(k, { ...input, score: 1 }, 0); applyAction(k, { ...input, score: 1 }, 1);
  assert.equal(meal.rejected.length, 400); assert.deepEqual(candidate.scores, [1, 1]); assert.match(candidate.blocked, /400道/);
  assert.throws(() => applyAction(k, { action: 'replace', mealId: meal.id, candidateId: candidate.id }, 0), /400道/);
  assert.doesNotThrow(() => validateBackup({ format: 'two-person-kitchen-v1', kitchen: k }));
  applyAction(k, { action: 'mealCreate' }, 1); assert.equal(k.meals[0].rejected.length, 0);
});
// 再吃一顿只复用原来入选的菜，重新读取当前菜单，不沿用旧评分或改写历史。
test('历史复用接口关闭，返回提示且不改变当前选菜', async () => {
  const { service, auth } = setup(); const [boy] = await couple(service, auth);
  const before = await service.change(boy, { action: 'mealCreate' });
  await assert.rejects(service.change(boy, { action: 'mealRepeat', mealId: before.kitchen.meals[0].id }), /历史复用已取消/);
  assert.deepEqual(await service.read(boy), before);
});
test('三餐日历仅归档双人完成评分，低分换菜保留原食材且重复请求不重复', async () => {
  const { service, auth, repo } = setup(); const [boy, girl] = await couple(service, auth);
  const meal = (await service.change(boy, { action: 'mealCreate' })).kitchen.meals[0]; const candidate = meal.candidates[0];
  const query = new URLSearchParams({ date: calendarDate(meal.date) });
  await service.change(boy, { action: 'score', mealId: meal.id, candidateId: candidate.id, score: 5 });
  assert.equal((await service.calendar(girl, query)).entries.length, 0);
  await service.change(girl, { action: 'score', mealId: meal.id, candidateId: candidate.id, score: 2 });
  await service.change(girl, { action: 'score', mealId: meal.id, candidateId: candidate.id, score: 2 });
  let entries = (await service.calendar(boy, query)).entries; assert.equal(entries.length, 1); assert.deepEqual(entries[0].record.scores, [5, 2]); assert.deepEqual(entries[0].record.ingredients, candidate.dish.ingredients);
  const another = meal.candidates[1]; await service.change(boy, { action: 'score', mealId: meal.id, candidateId: another.id, score: 0 }); await service.change(girl, { action: 'score', mealId: meal.id, candidateId: another.id, score: 5 });
  entries = (await service.calendar(girl, query)).entries; assert.equal(entries.length, 2); assert.equal(entries.filter(x => !x.record.passed).length, 1); assert.deepEqual(entries.find(x => !x.record.passed).record.ingredients, another.dish.ingredients);
  const old = structuredClone(entries.find(x => x.record.passed)); await service.change(boy, { action: 'dishDelete', id: candidate.dish.id });
  for (let i = 0; i < 32; i++) await service.change(boy, { action: 'mealCreate' });
  assert.equal((await service.read(boy)).kitchen.meals.length, 30); assert.deepEqual((await service.calendar(boy, query)).entries.find(x => x.record.passed), old);
  const [other] = await couple(service, auth, '日历隔离厨房测试口令'); assert.equal((await service.calendar(other, query)).entries.length, 0);
  assert.equal(repo.history.get(boy.kitchenId).size, 2);
});
test('旧记录只补入完整评分，不猜日期和缺失食材，重复补入不增加记录', async () => {
  const { service, auth, repo } = setup(); const [boy] = await couple(service, auth); const k = newKitchen();
  const dish = k.dishes[0]; k.meals = [{ id: 'old', date: '无法确认的旧日期', candidates: [{ id: 'done', dish, scores: [4, 4] }, { id: 'pending', dish: k.dishes[1], scores: [null, 5] }], rejected: [{ id: 'no', dishId: 'deleted', name: '旧淘汰菜', kind: 'veg', scores: [1, 1] }] }];
  await service.restore(boy, { format: 'two-person-kitchen-v1', kitchen: k });
  await repo.seedHistory(boy.kitchenId); await repo.seedHistory(boy.kitchenId);
  const entries = (await service.calendar(boy, new URLSearchParams({ date: 'unknown' }))).entries;
  assert.equal(entries.length, 2); assert.equal(entries.find(x => x.record.name === '旧淘汰菜').record.ingredients, null); assert.ok(entries.every(x => x.date === 'unknown'));
  const month = await service.calendar(boy, new URLSearchParams({ month: '2026-10' })); assert.equal(month.unknownCount, 2); assert.equal(month.days.length, 0);
  await assert.rejects(service.calendar(boy, new URLSearchParams({ date: '2026-02-30' })), /有效/);
  await assert.rejects(service.calendar(boy, new URLSearchParams({ date: 'unknown', cursor: '{"rank":1,"id":"恶意内容"}' })), /位置/);
});
test('同日分页按轮次排序且没有重复遗漏，备份截止位置不随新记录增长', async () => {
  const { service, auth, repo } = setup(); const [boy] = await couple(service, auth); const dish = newKitchen().dishes[0];
  for (let i = 0; i < 110; i++) repo.append(boy.kitchenId, calendarEntries({ meals: [{ id: 'round-' + i, date: '2026/10/10', candidates: [{ id: 'c-' + i, dish, scores: [5, 5] }] }] }), i);
  const collected = []; let cursor = null;
  do { const params = new URLSearchParams({ date: '2026-10-10' }); if (cursor) params.set('cursor', JSON.stringify(cursor)); const page = await service.calendar(boy, params); assert.ok(page.entries.length <= 40); collected.push(...page.entries); cursor = page.next; } while (cursor);
  assert.equal(collected.length, 110); assert.equal(new Set(collected.map(x => x.id)).size, 110); assert.ok(collected.every((x, i) => !i || x.rank <= collected[i - 1].rank));
  const first = await service.exportCalendar(boy, new URLSearchParams()); assert.equal(first.entries.length, 100); assert.ok(first.next);
  repo.append(boy.kitchenId, calendarEntries({ meals: [{ id: 'new', date: '2026/10/10', candidates: [{ id: 'new', dish, scores: [5, 5] }] }] }), 120);
  const last = await service.exportCalendar(boy, new URLSearchParams({ after: first.next, maximum: first.maximum })); assert.equal(last.entries.length, 10); assert.equal(last.next, null);
});
test('历史写入失败则回退评分，版本冲突不写历史，连接总会释放', async () => {
  const repo = Object.create(MysqlKitchenRepository.prototype); const events = []; let affected = 1;
  const connection = { beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release'), execute: async () => [{ affectedRows: affected }] };
  repo.pool = { getConnection: async () => connection }; repo.appendHistory = async () => { events.push('archive'); throw new Error('模拟历史保存失败'); };
  await assert.rejects(repo.save('id', 1, '{}', [{ key: 'key' }]), /保存失败/); assert.deepEqual(events, ['begin', 'archive', 'rollback', 'release']);
  events.length = 0; affected = 0; assert.equal(await repo.save('id', 1, '{}', []), false); assert.deepEqual(events, ['begin', 'rollback', 'release']);
});
test('日历接口校验登录、请求方法和参数，GET不泄露未完成评分，备份恢复严格检查', async t => {
  const { service, auth } = setup(); const [boy] = await couple(service, auth); const server = createServer(service, auth, []); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port; const header = { Authorization: 'Bearer ' + auth.issue(boy.kitchenId, 0), 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/calendar?month=2026-10')).status, 401);
  assert.equal((await fetch(base + '/api/calendar?month=2026-13', { headers: header })).status, 400);
  assert.equal((await fetch(base + '/api/calendar?date=2026-02-30', { headers: header })).status, 400);
  assert.equal((await fetch(base + '/api/calendar?month=2026-10', { method: 'POST', headers: header, body: '{}' })).status, 405);
  const month = await fetch(base + '/api/calendar?month=2026-10', { headers: header }); assert.equal(month.status, 200); assert.deepEqual(await month.json(), { days: [], unknownCount: 0 });
  assert.equal((await fetch(base + '/api/calendar/restore', { method: 'POST', headers: header, body: JSON.stringify({ entries: [{ record: { scores: [null, 5] } }] }) })).status, 400);
  assert.equal((await fetch(base + '/api/calendar/export', { headers: header })).status, 200);
  assert.equal((await fetch(base + '/api/calendar/restore', { headers: header })).status, 405);
});
test('日历恢复拒绝覆盖已有评分，失败回退，成功只追加且厨房版本递增', async () => {
  const { calendarBackupEntries } = require('../wechat-gateway/calendar.cjs'); const repo = Object.create(MysqlKitchenRepository.prototype); const events = [];
  const entry = calendarBackupEntries({ entries: [{ mealId: 'old', date: '2026-10-10', dateLabel: '2026/10/10', rank: 1, record: { candidateId: 'c', dishId: 'd', name: '番茄炒蛋', kind: 'veg', ingredients: ['番茄', '鸡蛋'], scores: [4, 4], passed: true } }] })[0]; let conflict = true;
  const connection = { beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release'), execute: async ({ sql }) => { if (sql.startsWith('SELECT version')) return [[{ version: 3 }]]; if (sql.startsWith('SELECT entry_key')) return [conflict ? [{ entry_key: entry.key, meal_date: entry.date, date_label: entry.dateLabel, record: JSON.stringify({ ...entry.record, scores: [5, 5] }) }] : []]; events.push('update'); return [{ affectedRows: 1 }]; } };
  repo.pool = { getConnection: async () => connection }; repo.appendHistory = async () => events.push('append');
  await assert.rejects(repo.restoreCalendar('k', [entry]), e => e.code === 'CALENDAR_CONFLICT'); assert.deepEqual(events, ['begin', 'rollback', 'release']);
  events.length = 0; conflict = false; assert.deepEqual(await repo.restoreCalendar('k', [entry]), { imported: 1 }); assert.deepEqual(events, ['begin', 'append', 'update', 'commit', 'release']);
});
test('日历日期保留轮次日期，备份结束标记缺失或结果伪造被拒绝', async () => {
  const { calendarQuery, calendarBackupEntries } = require('../wechat-gateway/calendar.cjs'); const { inspect } = require('../wechat-gateway/tools/日历历史备份.cjs'); const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  assert.equal(calendarDate('2024年2月29日'), '2024-02-29'); assert.equal(calendarDate('2026/2/29'), 'unknown'); assert.equal(calendarQuery(new URLSearchParams({ month: '9999-12' })).end, '9999-12-32');
  const entry = { mealId: 'm', date: '2026-10-10', dateLabel: '2026/10/10', rank: 1, record: { candidateId: 'c', dishId: 'd', name: '菜', kind: 'veg', ingredients: null, scores: [1, 1], passed: false } };
  assert.throws(() => calendarBackupEntries({ entries: [{ ...entry, record: { ...entry.record, passed: true } }] }), /评分结果/);
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-test-')); const file = path.join(folder, 'backup.jsonl');
  try { const prefix = JSON.stringify({ format: 'two-person-calendar-v1' }) + '\n' + JSON.stringify(entry) + '\n'; await fs.writeFile(file, prefix); await assert.rejects(inspect(file), /未完成/); await fs.appendFile(file, JSON.stringify({ end: true, count: 1 }) + '\n'); assert.equal(await inspect(file), 1); } finally { await fs.rm(folder, { recursive: true }); }
});
