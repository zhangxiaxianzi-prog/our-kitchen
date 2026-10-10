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
  vm.runInNewContext(code, { Page: page => { definition = page; }, require: path => path.includes('/api') ? { clearToken() {} } : require('../miniprogram/utils/' + (path.includes('ingredients') ? 'ingredients' : path.includes('swipe') ? 'swipe' : 'view')), wx: mock, setTimeout: timeout, clearTimeout: timer => cleared.push(timer), console });
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
  vm.runInNewContext(code, { Page: page => { definition = page; }, require: path => path.includes('/api') ? {} : require('../miniprogram/utils/' + (path.includes('ingredients') ? 'ingredients' : path.includes('swipe') ? 'swipe' : 'view')), wx, setTimeout, clearTimeout, console });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } });
  page.onLoad(); page.data.editorOpen = true; page._focusedField = 'draft-ingredients-field';
  page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.sheetBottom, 300); assert.equal(page.data.sheetHeight, 288);
  assert.equal(page.data.sheetTarget, 'draft-ingredients-field');
  height = 300; page.onResize({ size: { windowHeight: 300, windowWidth: 375 } });
  assert.equal(page.data.sheetBottom, 0); assert.equal(page.data.sheetHeight, 288);
  // 再检查窗口先变小、键盘高度后到达的顺序。
  height = 600; page.onKeyboardChange({ detail: { height: 0 } });
  height = 300; page.onResize({ size: { windowHeight: 300, windowWidth: 375 } });
  page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.sheetHeight, 288); assert.equal(page.data.sheetBottom, 0);
  // 收起事件先到达、窗口随后恢复时，弹窗也恢复正常高度。
  page.onKeyboardChange({ detail: { height: 0 } });
  height = 600; page.onResize({ size: { windowHeight: 600, windowWidth: 375 } });
  assert.equal(page.data.sheetHeight, 528);
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
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8'), { Page: page => { definition = page; }, require: path => path.includes('/api') ? api : require('../miniprogram/utils/' + (path.includes('ingredients') ? 'ingredients' : path.includes('swipe') ? 'swipe' : 'view')), wx: { hideKeyboard() {}, showToast() {} }, setTimeout, clearTimeout });
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
// 同一份纯显示规则用于网站和小程序；不能凭历史记录推断实际已经吃过。
test('历史卡片状态、菜名搜索、独立评分、失效提示和淘汰分批展示', () => {
  const { historyViews } = require('../miniprogram/utils/view');
  const dish = { id: 'd', name: '历史菜名', kind: 'meat', ingredients: ['历史食材'], active: true };
  const meal = { id: 'past', date: '旧日期', candidates: [{ id: 'c', dish, scores: [2, 5] }], rejected: Array.from({ length: 21 }, (_, i) => ({ id: 'r' + i, name: '淘汰菜' + i, scores: [1, 2] })) };
  const menu = [{ ...dish, name: '当前菜名', ingredients: ['当前食材'] }];
  let view = historyViews([meal], 0, menu)[0];
  assert.equal(view.status, '全部入选'); assert.equal(view.preview, '历史菜名'); assert.equal(view.rows.length, 0); assert.equal(view.rejected.length, 0); assert.equal(view.repeatNames, '当前菜名');
  view = historyViews([meal], 0, menu, '淘汰菜20', 'past', 'past')[0];
  assert.equal(view.rows[0].ingredientsText, '历史食材'); assert.equal(view.rows[0].boyText, '2 分'); assert.equal(view.rows[0].girlText, '5 分');
  assert.equal(view.rejected.length, 10); assert.equal(view.rejectedCount, 21); assert.equal(view.hasMoreRejected, true);
  assert.equal(historyViews([meal], 0, menu, '', 'past', 'past', 30)[0].hasMoreRejected, false);
  assert.equal(historyViews([meal], 0, menu, '不存在').length, 0);
  assert.match(historyViews([meal], 0, [], '', 'past')[0].repeatReason, /已删除/);
  const pending = { ...meal, id: 'pending', candidates: [{ id: 'c2', dish, scores: [null, null], partnerRated: true }] };
  view = historyViews([pending], 0, menu, '', 'pending')[0];
  assert.equal(view.status, '未完成评分'); assert.equal(view.rows[0].girlText, '已评分，暂不公开'); assert.equal(view.canRepeat, false);
  view = historyViews([{ ...meal, candidates: [...meal.candidates, pending.candidates[0]] }], 0, menu)[0];
  assert.equal(view.status, '部分入选'); assert.equal(view.pendingCount, 1);
  view = historyViews([{ ...meal, fridgeOnly: true }], 0, menu)[0]; assert.match(view.repeatReason, /缺少食材/);
  assert.equal(historyViews([{ ...meal, fridgeOnly: true }], 0, menu, '', '', '', 10, ['当前食材'])[0].canRepeat, true);
});
test('历史搜索展开保留在刷新后，取消和保存失败不开始新轮，成功复用后返回当前晚餐', async () => {
  let definition; let confirm = false; let fail = false; const calls = []; const scrolls = [];
  const dish = { id: 'd', name: '入选菜', kind: 'meat', ingredients: ['排骨'], active: true };
  const past = { id: 'past', date: '旧日期', candidates: [{ id: 'c', dish, scores: [5, 5] }] };
  const current = { id: 'now', date: '当前日期', candidates: [{ id: 'n', dish, scores: [null, null] }] };
  const kitchen = { dishes: [dish], pantry: [], shopping: [], meals: [current, past] };
  const newKitchen = { ...kitchen, mealPreferences: { meatCount: 1, vegCount: 0 }, meals: [{ ...current, id: 'repeat', candidates: [{ id: 'new', dish, scores: [null, null] }] }, ...kitchen.meals] };
  const api = { change: async input => { calls.push(input); if (fail) throw new Error('厨房保存失败'); return { version: 3, role: 0, kitchen: newKitchen }; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/kitchen/index.js'), 'utf8'), { Page: p => { definition = p; }, require: path => path.includes('/api') ? api : require('../miniprogram/utils/' + path.split('/').pop()), wx: { showToast() {}, pageScrollTo: options => scrolls.push(options) }, setTimeout, clearTimeout });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); }, confirm: async () => confirm });
  page.onLoad(); page.accept({ version: 1, role: 0, kitchen }, 0); page.toggleHistory();
  const event = { currentTarget: { dataset: { id: 'past' } } };
  page.toggleHistoryDetail(event); page.onHistorySearch({ detail: { value: '入选菜' } });
  page.accept({ version: 2, role: 0, kitchen }, 0); assert.equal(page.data.history[0].expanded, true); assert.equal(page.data.historySearch, '入选菜');
  await page.repeatHistory(event); assert.equal(calls.length, 0);
  confirm = true; fail = true; await page.repeatHistory(event); assert.equal(page.data.showHistory, true); assert.equal(page.data.meal.id, 'now');
  // 保存失败后先同步厨房，确认当前记录再允许重试。
  page.accept({ version: 2, role: 0, kitchen }, 0);
  fail = false; await page.repeatHistory(event); assert.equal(calls[1].action, 'mealRepeat'); assert.equal(calls[1].mealId, 'past');
  assert.equal(page.data.showHistory, false); assert.equal(page.data.meal.id, 'repeat'); assert.equal(page.data.meatCount, 1); assert.equal(page.data.vegCount, 0); assert.equal(scrolls.length, 1);
});
