const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { candidateView } = require('../miniprogram/utils/view');
test('小程序评分显示与网站一致：未评分等待，7分入选，6分不入选', () => {
  const candidate = { id: 'c', dish: { ingredients: ['番茄', '鸡蛋'] }, scores: [2, null] };
  assert.equal(candidateView(candidate, 0, []).verdict, '等待评分');
  candidate.scores = [2, 5]; assert.equal(candidateView(candidate, 1, ['番茄', '鸡蛋']).verdict, '已入选');
  assert.equal(candidateView(candidate, 1, ['番茄', '鸡蛋']).availability, '主要食材已齐');
  assert.equal(candidateView(candidate, 0, ['鸡蛋']).availability, '还缺：番茄');
  candidate.scores = [1, 5]; assert.equal(candidateView(candidate, 0, []).verdict, '未入选');
});
test('请求使用已确认云托管环境；票据过期有明确结果，共同口令不缓存', async () => {
  const storage = new Map(); const calls = [];
  global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), cloud: { callContainer: async input => { calls.push(input); return { statusCode: calls.length === 1 ? 200 : 401, data: calls.length === 1 ? { token: 'signed.token' } : { error: '登录已失效' } }; } } };
  const api = require('../miniprogram/utils/api');
  api.saveToken('old.token');
  await api.login('共同测试口令123', 1);
  assert.equal(calls[0].config.env, 'prod-d0g3sabmk422d992f'); assert.equal(calls[0].header['X-WX-SERVICE'], 'springboot-5wzu'); assert.equal(calls[0].data.role, 1);
  assert.deepEqual([...storage.values()], ['old.token']);
  await assert.rejects(api.read(), error => error.status === 401);
  api.clearToken(); assert.equal(storage.size, 0);
});
test('旧响应不覆盖新数据，退出后旧响应不能重新登录，后台停止刷新', () => {
  let definition;
  const mock = { getStorageSync: () => '', removeStorageSync() {}, showToast() {} };
  const code = fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8');
  const timeout = () => 100; const cleared = [];
  vm.runInNewContext(code, { Page: page => { definition = page; }, require: path => path.includes('/api') ? { clearToken() {} } : require('../miniprogram/utils/view'), wx: mock, setTimeout: timeout, clearTimeout: timer => cleared.push(timer), console });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } });
  page.onLoad();
  const kitchen = { dishes: [], pantry: ['排骨'], shopping: [], meals: [] };
  page.accept({ version: 3, role: 0, kitchen }, 0); assert.equal(page._version, 3);
  page.accept({ version: 2, role: 0, kitchen: { ...kitchen, pantry: [] } }, 0); assert.deepEqual(Array.from(page.data.pantry), ['排骨']);
  page.clearSession(); page.accept({ version: 9, role: 0, kitchen }, 0); assert.equal(page.data.loggedIn, false);
  page._visible = true; page.scheduleRefresh(); page.onHide(); assert.equal(page._visible, false); assert(cleared.includes(100));
});
