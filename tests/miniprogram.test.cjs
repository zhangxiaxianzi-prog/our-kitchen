const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { candidateView } = require('../miniprogram/utils/view');
test('小程序评分显示：未评分等待，7分入选，6分不入选', () => {
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
  vm.runInNewContext(code, { Page: page => { definition = page; }, require: path => path.includes('/api') ? { clearToken() {} } : require('../miniprogram/utils/' + (path.includes('ingredients') ? 'ingredients' : path.includes('swipe') ? 'swipe' : path.includes('calendar') ? 'calendar' : 'view')), wx: mock, setTimeout: timeout, clearTimeout: timer => cleared.push(timer), console });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } });
  page.onLoad();
  const kitchen = { dishes: [], pantry: ['排骨'], shopping: [], meals: [] };
  page.accept({ version: 3, role: 0, kitchen }, 0); assert.equal(page._version, 3);
  page.accept({ version: 2, role: 0, kitchen: { ...kitchen, pantry: [] } }, 0); assert.deepEqual(Array.from(page.data.pantry), ['排骨']);
  page.clearSession(); page.accept({ version: 9, role: 0, kitchen }, 0); assert.equal(page.data.loggedIn, false);
  page._visible = true; page.scheduleRefresh(); page.onHide(); assert.equal(page._visible, false); assert(cleared.includes(100));
});
// 键盘事件和窗口缩小可能先后到达，检查两种顺序都不会把弹窗高度减两次。
test('手机键盘不重复抬弹窗，收起后恢复高度，卸载后不更新页面', () => {
  let definition; let height = 600; const hidden = [];
  const wx = { getWindowInfo: () => ({ windowHeight: height, windowWidth: 375 }), hideKeyboard: () => hidden.push(true) };
  const code = fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8');
  vm.runInNewContext(code, { Page: page => { definition = page; }, require: path => path.includes('/api') ? {} : require('../miniprogram/utils/' + (path.includes('ingredients') ? 'ingredients' : path.includes('swipe') ? 'swipe' : path.includes('calendar') ? 'calendar' : 'view')), wx, setTimeout, clearTimeout, console });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } });
  page.onLoad(); page.data.editorOpen = true; page._focusedField = 'draft-ingredients-field';
  page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.sheetBottom, 300); assert.equal(page.data.sheetHeight, 288);
  assert.equal(page.data.visibleHeight, 300);
  assert.equal(page.data.sheetTarget, 'draft-ingredients-field');
  height = 300; page.onResize({ size: { windowHeight: 300, windowWidth: 375 } });
  assert.equal(page.data.sheetBottom, 0); assert.equal(page.data.sheetHeight, 288);
  assert.equal(page.data.visibleHeight, 300);
  // 再检查窗口先变小、键盘高度后到达的顺序。
  height = 600; page.onKeyboardChange({ detail: { height: 0 } });
  height = 300; page.onResize({ size: { windowHeight: 300, windowWidth: 375 } });
  page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.sheetHeight, 288); assert.equal(page.data.sheetBottom, 0);
  // 收起事件先到达、窗口随后恢复时，弹窗也恢复正常高度。
  page.onKeyboardChange({ detail: { height: 0 } });
  height = 600; page.onResize({ size: { windowHeight: 600, windowWidth: 375 } });
  assert.equal(page.data.sheetHeight, 528);
  assert.equal(page.data.visibleHeight, 600);
  // 同宽度手机窗口变短后，冰箱使用新高度，不继续占原来的长屏空间。
  height = 480; page.onResize({ size: { windowHeight: 480, windowWidth: 375 } });
  assert.equal(page.data.visibleHeight, 480);
  height = 600; page.onResize({ size: { windowHeight: 600, windowWidth: 375 } });
  assert.equal(page.data.visibleHeight, 600);
  page.closeEditor(); assert.equal(page.data.editorOpen, false); assert.equal(hidden.length, 1);
  page.onUnload(); page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.keyboardHeight, 0);
});
// 选择在分类和搜索之外保留，后台刷新只去掉已经加入冰箱的选择。
test('冰箱分类搜索、跨类多选、共享刷新和失败后草稿保留', async () => {
  const ingredients = require('../miniprogram/utils/ingredients');
  assert.equal(ingredients.categoryOf('西红柿'), 'vegetables');
  assert.equal(ingredients.categoryOf('秋葵', [{ name: '秋葵', category: 'vegetables' }]), 'vegetables');
  assert.equal(ingredients.categoryOf('未知食材'), 'other');
  let definition; let failed = false; const calls = [];
  const api = { change: async input => { calls.push(input); if (failed) throw new Error('厨房请求失败'); return { version: 2, role: 0, kitchen: { dishes: [], pantry: ['番茄', '鸡蛋', '秋葵'], pantryCategories: [{ name: '秋葵', category: 'vegetables' }], shopping: [], meals: [] } }; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8'), { Page: page => { definition = page; }, require: path => path.includes('/api') ? api : require('../miniprogram/utils/' + (path.includes('ingredients') ? 'ingredients' : path.includes('swipe') ? 'swipe' : path.includes('calendar') ? 'calendar' : 'view')), wx: { hideKeyboard() {}, showToast() {} }, setTimeout, clearTimeout });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); } });
  page.onLoad(); page.accept({ version: 1, role: 0, kitchen: { dishes: [], pantry: [], shopping: [], meals: [] } }, 0);
  page.openPantryAdd(); page.toggleAddItem({ currentTarget: { dataset: { name: '番茄' } } });
  page.selectAddCategory({ currentTarget: { dataset: { category: 'eggs' } } });
  page.toggleAddItem({ currentTarget: { dataset: { name: '鸡蛋' } } });
  assert.equal(page.data.addSelected.length, 2); assert(page.data.addChoices.every(x => x.category === 'eggs'));
  page.data.customName = '秋葵'; page.data.customCategoryIndex = 0; page.addCustomIngredient();
  failed = true; await page.savePantryAdd(); assert.equal(page.data.pantryOpen, true); assert.equal(page.data.addSelected.length, 3);
  failed = false; await page.savePantryAdd(); assert.equal(page.data.pantryOpen, false); assert.equal(calls[1].action, 'pantryAddMany');
  page.data.pantrySearch = '西红柿'; page.filterFridge(); assert.equal(page.data.pantryRows[0].name, '番茄');
  page.togglePantryManage(); page.togglePantryItem({ currentTarget: { dataset: { name: '鸡蛋' } } });
  page.selectPantryCategory({ currentTarget: { dataset: { category: 'vegetables' } } }); assert.equal(page.data.pantrySelected[0], '鸡蛋');
  page.accept({ version: 3, role: 0, kitchen: { dishes: [], pantry: ['番茄'], shopping: [], meals: [] } }, 0); assert.equal(page.data.pantrySelected.length, 0);
});
test('评分未公开时只显示本人分数和对方状态，完成后才显示对方数字', () => {
  const candidate = { id: 'c', dish: { ingredients: [] }, scores: [null, 4] };
  assert.equal(candidateView(candidate, 0, []).partnerText, '已评分，暂不公开');
  candidate.scores = [null, null]; candidate.partnerRated = true;
  assert.equal(candidateView(candidate, 0, []).partnerText, '已评分，暂不公开');
  assert.equal(candidateView(candidate, 0, []).complete, false);
  candidate.scores = [3, 4]; assert.equal(candidateView(candidate, 0, []).partnerText, '4 分');
  assert.equal(candidateView(candidate, 0, []).complete, true);
});
// 用页面实际的触摸处理验证左滑、右滑、竖向滚动、确认取消和保存失败。
test('冰箱左滑只露出对应行，竖向滚动不触发，确认和保存成功后才移除', async () => {
  const { swipeDirection } = require('../miniprogram/utils/swipe');
  assert.equal(swipeDirection({ x: 100, y: 20 }, { clientX: 50, clientY: 25 }), 'left');
  assert.equal(swipeDirection({ x: 100, y: 20 }, { clientX: 110, clientY: 120 }), '');
  let definition; let confirmed = false; let fail = false; const calls = [];
  const api = { change: async input => { calls.push(input); if (fail) throw new Error('保存失败'); return { version: 2, role: 0, kitchen: { pantry: ['鸡蛋'], shopping: [], dishes: [], meals: [] } }; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8'), { Page: p => { definition = p; }, require: path => path.includes('/api') ? api : require('../miniprogram/utils/' + path.split('/').pop()), wx: { showToast() {} }, setTimeout, clearTimeout });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); }, confirm: async () => confirmed });
  page.onLoad(); page.accept({ version: 1, role: 0, kitchen: { pantry: ['番茄', '鸡蛋'], shopping: [], dishes: [], meals: [] } }, 0);
  const start = name => page.onPantryTouchStart({ currentTarget: { dataset: { name } }, touches: [{ clientX: 200, clientY: 40 }] });
  const end = (x, y = 40) => page.onPantryTouchEnd({ changedTouches: [{ clientX: x, clientY: y }] });
  start('番茄'); end(130); assert.equal(page.data.pantrySwipeName, '番茄');
  start('鸡蛋'); end(130); assert.equal(page.data.pantrySwipeName, '鸡蛋');
  start('鸡蛋'); end(250); assert.equal(page.data.pantrySwipeName, '');
  start('番茄'); page.onPantryTouchMove({ touches: [{ clientX: 195, clientY: 100 }] }); end(120, 100); assert.equal(page.data.pantrySwipeName, '');
  start('番茄'); end(190); assert.equal(page.data.pantrySwipeName, '');
  page.data.pantryManaging = true; start('番茄'); end(130); assert.equal(page.data.pantrySwipeName, ''); page.data.pantryManaging = false;
  const input = { currentTarget: { dataset: { name: '番茄' } } };
  await page.removeSwipedIngredient(input); assert.equal(calls.length, 0);
  confirmed = true; fail = true; await page.removeSwipedIngredient(input); assert(page.data.pantry.includes('番茄'));
  fail = false; await page.removeSwipedIngredient(input); assert(!page.data.pantry.includes('番茄')); assert.equal(calls[1].action, 'pantryRemove');
});
test('数量草稿不改本轮，刷新不覆盖草稿，下次创建使用新数量', async () => {
  let definition; const calls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8'), { Page: p => { definition = p; }, require: path => path.includes('/api') ? {} : require('../miniprogram/utils/' + path.split('/').pop()), wx: {}, setTimeout, clearTimeout });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); }, confirm: async () => true, mutate: async input => { calls.push(input); return true; }, notice() {} });
  page.onLoad(); const kitchen = { pantry: [], shopping: [], dishes: [], meals: [{ id: 'm', date: '测试日期', candidates: [], rejected: [] }], mealPreferences: { meatCount: 1, vegCount: 2 } };
  page.accept({ version: 1, role: 0, kitchen }, 0);
  page.onMealCount({ currentTarget: { dataset: { field: 'meatCount' } }, detail: { value: '2' } });
  page.onMealCount({ currentTarget: { dataset: { field: 'vegCount' } }, detail: { value: '2' } });
  page.accept({ version: 2, role: 0, kitchen }, 0); assert.equal(page.data.meatCount, 2); assert.equal(kitchen.meals[0].candidates.length, 0);
  await page.createMeal(); assert.equal(calls[0].meatCount, 2); assert.equal(calls[0].vegCount, 2);
  page.data.meatCount = 0; page.data.vegCount = 0; await page.createMeal(); assert.equal(calls.length, 1);
});

// 日历使用真实日期边界，闰年、跨年和空日期不靠手机所在时区猜。
test('月历七列、闰年和跨年正确，旧食材缺失明确显示，淘汰菜分开展示', () => {
  const calendar = require('../miniprogram/utils/calendar');
  const cells = calendar.monthCells('2024-02', [{ date: '2024-02-29', count: 2 }], '2024-02-29');
  assert.equal(cells.filter(x => x.date).length, 29); assert.equal(cells.length % 7, 0); assert.equal(cells.find(x => x.selected).count, 2);
  assert.equal(calendar.shiftMonth('2026-12', 1), '2027-01'); assert.equal(calendar.shiftMonth('2026-01', -1), '2025-12');
  const groups = calendar.entryGroups([{ id: '1', mealId: 'm', rank: 1, dateLabel: '2026/10/10', record: { name: '旧菜', kind: 'veg', ingredients: null, scores: [1, 2], passed: false } }], ['m']);
  assert.equal(groups[0].dishes.length, 0); assert.equal(groups[0].rejectedOpen, true); assert.equal(groups[0].rejected[0].ingredientsText, '旧记录未保存食材');
});
test('日历切月份、退出和请求失败不会覆盖新日期或冰箱，分页只保留当前页', async () => {
  let definition; const pending = []; let fail = false;
  const api = { token: () => 'test-token', clearToken() {}, calendar: query => fail ? Promise.reject(new Error('模拟日历故障')) : new Promise(resolve => pending.push({ query, resolve })) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8'), { Page: p => { definition = p; }, require: path => path.includes('/api') ? api : require('../miniprogram/utils/' + path.split('/').pop()), wx: { showToast() {} }, setTimeout, clearTimeout });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } }); page.onLoad(); page.data.tab = 'calendar'; page.data.pantry = ['鸡蛋'];
  const first = page.loadCalendar(); page.changeCalendarMonth({ currentTarget: { dataset: { offset: 1 } } }); const month = page.data.calendarMonth;
  pending[0].resolve({ days: [{ date: '1900-01-01', count: 2 }], unknownCount: 9 }); await first; assert.equal(page.data.unknownCount, 0);
  pending[1].resolve({ days: [{ date: month + '-01', count: 2 }], unknownCount: 0 }); await new Promise(resolve => setImmediate(resolve));
  const entry = { id: '1', mealId: 'm', rank: 1, dateLabel: month + '-01', record: { name: '菜', kind: 'veg', ingredients: ['鸡蛋'], scores: [4, 4], passed: true } };
  pending[2].resolve({ entries: [entry], next: { rank: 1, id: '1' } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(page.data.calendarEntries.length, 1);
  page.calendarNextPage(); pending[3].resolve({ days: [], unknownCount: 0 }); await new Promise(resolve => setImmediate(resolve)); pending[4].resolve({ entries: [{ ...entry, id: '2' }], next: null }); await new Promise(resolve => setImmediate(resolve)); assert.equal(page.data.calendarPage, 2); assert.equal(page.data.calendarEntries.length, 1); assert.equal(page.data.calendarEntries[0].id, '2');
  page.calendarPreviousPage(); assert.equal(pending[5].query.month, month); pending[5].resolve({ days: [], unknownCount: 0 }); await new Promise(resolve => setImmediate(resolve)); assert.equal(pending[6].query.cursor, undefined); pending[6].resolve({ entries: [entry], next: null }); await new Promise(resolve => setImmediate(resolve)); assert.equal(page.data.calendarPage, 1);
  fail = true; await page.loadCalendar(); assert.match(page.data.calendarError, /日历故障/); assert.equal(page.data.pantry[0], '鸡蛋');
  fail = false; const late = page.loadCalendar(); page.clearSession(); pending[7].resolve({ days: [], unknownCount: 99 }); await late; assert.equal(page.data.unknownCount, 0); assert.equal(page.data.loggedIn, false);
});

// 账号票据与厨房票据分开，回到厨房列表不会丢掉微信登录。
test('微信登录只提交临时凭证，账号和厨房票据分别保存，账号过期会一起退出', async () => {
  const storage = new Map(); const calls = [];
  global.wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    login: input => input.success({ code: 'wechat-temporary-code' }),
    cloud: { callContainer: async input => { calls.push(input); return calls.length === 1 ? { statusCode: 200, data: { token: 'account-token', userId: 'openid_test_user', administrator: false } } : calls.length === 4 ? { statusCode: 401, data: { error: '请重新微信登录' } } : { statusCode: 200, data: {} }; } }
  };
  const api = require('../miniprogram/utils/api');
  await api.wechatLogin(); api.saveToken('kitchen-token');
  await api.profile(); await api.read();
  assert.deepEqual(calls[0].data, { code: 'wechat-temporary-code' });
  assert.equal(calls[1].header.Authorization, 'Bearer account-token');
  assert.equal(calls[2].header.Authorization, 'Bearer kitchen-token');
  api.clearToken(); assert.equal(api.accountToken(), 'account-token');
  await assert.rejects(api.profile(), error => error.account && error.status === 401);
  assert.equal(storage.size, 0);
});
