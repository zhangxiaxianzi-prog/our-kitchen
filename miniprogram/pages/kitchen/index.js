const api = require('../../utils/api');
const { candidateView, dishView, historyViews } = require('../../utils/view');
const ingredients = require('../../utils/ingredients');
const { swipeDirection } = require('../../utils/swipe');
// 当前页面统一管理四个入口，实际修改都发给同一个厨房接口。
Page({
  data: {
    loggedIn: false, loginRole: 0, role: 0, roleName: '男生', passphrase: '', busy: false, error: '', synced: false,
    tab: 'dinner', tabs: [{ id: 'dinner', label: '今晚吃什么' }, { id: 'fridge', label: '冰箱' }, { id: 'shopping', label: '采购清单' }, { id: 'menu', label: '菜单' }],
    scores: [0, 1, 2, 3, 4, 5], pantry: [], shopping: [], boughtCount: 0, dishes: [], visibleDishes: [], suggestions: [],
    meal: null, candidates: [], rejectedRows: [], passedCount: 0, countOptions: [0, 1, 2, 3, 4, 5, 6], meatCount: 1, vegCount: 2, mealCount: 3, history: [], historyCount: 0, historySearch: '', historyExpandedId: '', historyRejectedId: '', historyRejectedLimit: 10, showHistory: false, fridgeOnly: false,
    ingredient: '', search: '', filter: 'active', filters: [{ id: 'active', label: '全部推荐' }, { id: 'meat', label: '荤菜' }, { id: 'veg', label: '素菜' }, { id: 'ready', label: '食材已齐' }, { id: 'hidden', label: '不再推荐' }],
    editorOpen: false, draftId: '', draftName: '', draftIngredients: '', draftKind: 'veg',
    ingredientCategories: ingredients.categories, customCategories: ingredients.categories.slice(1),
    pantryCategory: 'all', pantrySearch: '', pantrySwipeName: '', pantryRows: [], stockCategories: [], pantryManaging: false, pantrySelected: [],
    pantryOpen: false, pantryFocus: 'search', addCategory: 'all', addSearch: '', addSelected: [], addChoices: [], choiceCategories: [],
    customName: '', customCategoryIndex: 7, classifyIndex: 0,
    keyboardHeight: 0, sheetHeight: 500, sheetBottom: 0, sheetTarget: '',
    pickOpen: false, pickItems: [], pickCandidateId: '', pickMealId: '', pickKind: '', pickSearch: ''
  },
  onLoad() { this._version = 0; this._sessionEpoch = 0; this._visible = false; this._unloaded = false; this.updateSheetSize(0); },
  onShow() {
    this._visible = true;
    this.updateSheetSize(0);
    if (api.token()) { this.setData({ loggedIn: true }); this.refresh(); }
    this.scheduleRefresh();
  },
  onHide() { this._visible = false; clearTimeout(this._timer); },
  onUnload() { this._visible = false; this._unloaded = true; clearTimeout(this._timer); },
  async onPullDownRefresh() { try { if (api.token()) await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  // 微信输入组件提供键盘高度；不再让系统抬页面和自定义弹窗同时抬两次。
  onKeyboardChange(e) { this.updateSheetSize(Number(e.detail.height) || 0); },
  // iOS窗口可能保持原高度，安卓可能已经缩小；只补上还被键盘覆盖的那一段。
  updateSheetSize(keyboardHeight, refreshBase = true) {
    if (this._unloaded) return;
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : { windowHeight: 600 };
    const height = info.windowHeight;
    if (!keyboardHeight && refreshBase) this._baseHeight = height;
    this._windowWidth = info.windowWidth || this._windowWidth;
    const visible = Math.max(0, Math.min(height, (this._baseHeight || height) - keyboardHeight));
    this.setData({ keyboardHeight, sheetHeight: Math.max(0, Math.floor(Math.min((this._baseHeight || height) * .88, visible - 12))), sheetBottom: Math.max(0, height - visible), sheetTarget: '' }, () => {
      // 键盘把中间区域缩小以后，再滚到正在填写的字段，保存按钮留在下面。
      if (!this._unloaded && this.data.editorOpen && this._focusedField) this.setData({ sheetTarget: this._focusedField });
    });
  },
  // 旋转或改变模拟器尺寸后，重新按当前可见高度摆放弹窗。
  onResize(e) {
    const size = e && e.size;
    const refreshBase = !this.data.keyboardHeight && size && (size.windowHeight >= this._baseHeight || size.windowWidth !== this._windowWidth);
    this.updateSheetSize(this.data.keyboardHeight, !!refreshBase);
  },
  onSheetFocus(e) { this._focusedField = e.currentTarget.dataset.field; this.setData({ sheetTarget: this._focusedField }); },
  // 关闭弹窗时一起收起键盘，下一次打开不沿用上一次的遮挡高度。
  resetSheet() { this._focusedField = ''; if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard(); this.updateSheetSize(0); },
  // 小程序进入后台后停止轮询，不让关闭的页面持续请求；前台8秒刷新一次。
  scheduleRefresh() {
    clearTimeout(this._timer);
    if (!this._visible) return;
    this._timer = setTimeout(async () => {
      if (api.token()) await this.refresh();
      this.scheduleRefresh();
    }, 8000);
  },
  notice(message) { if (!this._unloaded) wx.showToast({ title: message, icon: 'none', duration: 3000 }); },
  handleError(error) {
    if (this._unloaded) return;
    if (error.status === 401) this.clearSession();
    this.setData({ error: error.message, synced: false });
  },
  // 旧请求晚到时不能盖掉较新的数据，退出后的响应也不能重新登录。
  accept(payload, epoch) {
    if (this._unloaded || epoch !== this._sessionEpoch || payload.version < this._version) return;
    if (!payload.kitchen || ![0, 1].includes(payload.role) || !Number.isInteger(payload.version)) throw new Error('厨房数据不完整，请刷新');
    this._version = payload.version;
    this._kitchen = payload.kitchen;
    const kitchen = payload.kitchen;
    const meal = kitchen.meals[0] || null;
    const candidates = meal ? meal.candidates.map(c => candidateView(c, payload.role, kitchen.pantry)) : [];
    const rejectedRows = (meal && meal.rejected || []).map(c => ({ id: c.id, name: c.name, boyScore: c.scores[0], girlScore: c.scores[1], total: c.scores[0] + c.scores[1] }));
    if (!this._mealDraftDirty) { const counts = kitchen.mealPreferences || { meatCount: 1, vegCount: 2 }; this.setData({ meatCount: counts.meatCount, vegCount: counts.vegCount }); }
    this.setData({ loggedIn: true, role: payload.role, roleName: payload.role === 0 ? '男生' : '女生', pantry: kitchen.pantry, shopping: kitchen.shopping, boughtCount: kitchen.shopping.filter(x => x.checked).length,
      meal, candidates, rejectedRows, mealCount: meal ? meal.candidates.length : this.data.meatCount + this.data.vegCount, passedCount: candidates.filter(c => c.passed).length, historyCount: kitchen.meals.length - (meal ? 1 : 0), dishes: kitchen.dishes.map(d => dishView(d, kitchen.pantry)), error: '', synced: true });
    this.filterDishes(); this.filterHistory();
  },
  async refresh() {
    if (this._reading || !api.token()) return;
    const epoch = this._sessionEpoch; this._reading = true;
    try { this.accept(await api.read(), epoch); }
    catch (error) { if (epoch === this._sessionEpoch) this.handleError(error); }
    finally { this._reading = false; }
  },
  async mutate(input, message) {
    if (this.data.busy) return false;
    this.setData({ busy: true });
    const epoch = this._sessionEpoch;
    try { const payload = await api.change(input); if (epoch !== this._sessionEpoch) return false; this.accept(payload, epoch); if (message) this.notice(message); return true; }
    catch (error) { if (epoch === this._sessionEpoch) { this.handleError(error); this.notice(error.message); } return false; }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  onPassphrase(e) { this.setData({ passphrase: e.detail.value }); },
  chooseRole(e) { this.setData({ loginRole: Number(e.currentTarget.dataset.role) }); },
  async login() {
    if (this.data.busy) return;
    const passphrase = this.data.passphrase.trim();
    if (passphrase.length < 8 || passphrase.length > 64) return this.notice('共同口令需要8到64个字符');
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.login(passphrase, this.data.loginRole);
      if (typeof result.token !== 'string' || !result.token) throw new Error('登录结果不完整，请检查服务');
      api.saveToken(result.token); this._version = 0; this._sessionEpoch++;
      this.setData({ passphrase: '', loggedIn: true }); await this.refresh();
    } catch (error) { this.handleError(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  clearSession() {
    this._mealDraftDirty = false; this._pantryGesture = null;
    api.clearToken(); this._sessionEpoch++; this._version = 0; this._kitchen = null;
    this.setData({ loggedIn: false, synced: false, pantryOpen: false, pantryManaging: false, pantrySelected: [], addSelected: [], customName: '', pantrySearch: '', pantrySwipeName: '', meatCount: 1, vegCount: 2, mealCount: 3, rejectedRows: [], meal: null, candidates: [], pantry: [], shopping: [], dishes: [], visibleDishes: [], history: [], historyCount: 0, historySearch: '', historyExpandedId: '', historyRejectedId: '', historyRejectedLimit: 10, showHistory: false, editorOpen: false, pickOpen: false, passphrase: '' });
  },
  logout() { if (!this.data.busy) { this.clearSession(); this.setData({ error: '' }); } },
  selectTab(e) { this.setData({ tab: e.currentTarget.dataset.tab, ingredient: '', pantrySwipeName: '' }); },
  // 数量是下一轮的选择，刷新和本轮评分不会清掉用户正在调整的数字。
  onMealCount(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (!['meatCount', 'vegCount'].includes(field)) return;
    this._mealDraftDirty = true; this.setData({ [field]: Number(e.detail.value) });
  },
  setFridgeOnly(e) { this.setData({ fridgeOnly: e.detail.value }); },
  confirm(content) { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })); },
  async createMeal() {
    if (this.data.busy) return;
    const total = this.data.meatCount + this.data.vegCount;
    if (total < 1 || total > 6) return this.notice('每顿请选择1到6道菜');
    if (this.data.meal && !await this.confirm('开始新一轮选菜？当前晚餐会保留在历史里。')) return;
    if (await this.mutate({ action: 'mealCreate', fridge: this.data.fridgeOnly, meatCount: this.data.meatCount, vegCount: this.data.vegCount }, '新的候选菜已准备好')) this._mealDraftDirty = false;
  },
  async score(e) {
    if (!this.data.meal) return;
    const candidate = this.data.candidates.find(c => c.id === e.currentTarget.dataset.id);
    if (!candidate || candidate.complete) return;
    await this.mutate({ action: 'score', mealId: this.data.meal.id, candidateId: e.currentTarget.dataset.id, score: Number(e.currentTarget.dataset.score) });
  },
  async replace(e) { if (this.data.meal) await this.mutate({ action: 'replace', mealId: this.data.meal.id, candidateId: e.currentTarget.dataset.id, fridge: this.data.fridgeOnly }, '已换菜，请重新评分'); },
  async shoppingGenerate() { if (await this.mutate({ action: 'shoppingGenerate' }, '采购清单已更新')) this.setData({ tab: 'shopping' }); },
  toggleHistory() { this.setData({ showHistory: !this.data.showHistory }); },
  // 搜索和展开只影响历史显示，不会修改旧晚餐的候选、评分或淘汰记录。
  filterHistory() {
    if (!this._kitchen) return;
    this.setData({ history: historyViews(this._kitchen.meals.slice(1), this.data.role, this._kitchen.dishes, this.data.historySearch, this.data.historyExpandedId, this.data.historyRejectedId, this.data.historyRejectedLimit, this._kitchen.pantry) });
  },
  // 按旧记录中的菜名找晚餐，淘汰菜也一起查。
  onHistorySearch(e) { this.setData({ historySearch: e.detail.value }); this.filterHistory(); },
  // 清空搜索后恢复全部历史，已展开的卡片仍保留。
  clearHistorySearch() { this.setData({ historySearch: '' }); this.filterHistory(); },
  // 一次只展开一轮，切换晚餐时先收起淘汰列表。
  toggleHistoryDetail(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ historyExpandedId: this.data.historyExpandedId === id ? '' : id, historyRejectedId: '', historyRejectedLimit: 10 }); this.filterHistory();
  },
  // 淘汰记录单独展开，先显示十条，避免页面过长。
  toggleHistoryRejected(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ historyRejectedId: this.data.historyRejectedId === id ? '' : id, historyRejectedLimit: 10 }); this.filterHistory();
  },
  // 一次只展开十条淘汰结果，不让历史详情一打开就铺满几百行。
  moreHistoryRejected() { this.setData({ historyRejectedLimit: Math.min(400, this.data.historyRejectedLimit + 10) }); this.filterHistory(); },
  // 复用前让用户确认；只有保存成功才回到新晚餐，失败保留原页面。
  async repeatHistory(e) {
    if (this.data.busy || !this.data.synced) return;
    const past = this.data.history.find(m => m.id === e.currentTarget.dataset.id);
    if (!past) return;
    if (!past.canRepeat) return this.notice(past.repeatReason);
    if (!await this.confirm('用这轮入选菜开始新一轮：' + past.repeatNames + '？会按当前菜单重新评分，当前晚餐保留在历史里。')) return;
    if (await this.mutate({ action: 'mealRepeat', mealId: past.id }, '已重新搭配，请重新评分')) {
      this._mealDraftDirty = false;
      this.setData({ meatCount: this._kitchen.mealPreferences.meatCount, vegCount: this._kitchen.mealPreferences.vegCount, fridgeOnly: this.data.meal.fridgeOnly === true, showHistory: false });
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    }
  },
  onIngredient(e) { this.setData({ ingredient: e.detail.value }); },
  async addIngredient() {
    const name = this.data.ingredient.trim(); if (!name) return;
    if (await this.mutate({ action: this.data.tab === 'fridge' ? 'pantryAdd' : 'shoppingAdd', name }, '食材已添加')) this.setData({ ingredient: '' });
  },
  removeIngredient(e) { this.mutate({ action: this.data.tab === 'fridge' ? 'pantryRemove' : 'shoppingRemove', name: e.currentTarget.dataset.name }); },
  checkShopping(e) { this.mutate({ action: 'shoppingCheck', name: e.currentTarget.dataset.name, checked: e.detail.value }); },
  toPantry() { this.mutate({ action: 'shoppingToPantry' }, '买到的食材已加入冰箱'); },
  // 左侧分类和搜索只改变显示范围，库存仍来自共享厨房。
  filterFridge() {
    const overrides = this._kitchen ? this._kitchen.pantryCategories || [] : [];
    const pantrySelected = this.data.pantrySelected.filter(name => this.data.pantry.includes(name));
    const addSelected = this.data.addSelected.filter(item => !this.data.pantry.includes(item.name));
    const available = [...new Set([...ingredients.catalog, ...this.data.dishes.reduce((all, d) => all.concat(d.ingredients), [])])].filter(name => !this.data.pantry.includes(name));
    const countCategories = names => {
      const counts = new Map();
      names.forEach(name => { const id = ingredients.categoryOf(name, overrides); counts.set(id, (counts.get(id) || 0) + 1); });
      return ingredients.categories.map(item => Object.assign({}, item, { count: item.id === 'all' ? names.length : counts.get(item.id) || 0 }));
    };
    this.setData({ pantrySelected, addSelected, pantrySwipeName: this.data.pantry.includes(this.data.pantrySwipeName) ? this.data.pantrySwipeName : '',
      pantryRows: ingredients.rows(this.data.pantry, overrides, this.data.pantryCategory, this.data.pantrySearch, pantrySelected),
      stockCategories: countCategories(this.data.pantry), choiceCategories: countCategories(available),
      addChoices: ingredients.rows(available, overrides, this.data.addCategory, this.data.addSearch, addSelected.map(x => x.name)) });
  },
  selectPantryCategory(e) { this.setData({ pantryCategory: e.currentTarget.dataset.category, pantrySwipeName: '' }); this.filterFridge(); },
  onPantrySearch(e) { this.setData({ pantrySearch: e.detail.value, pantrySwipeName: '' }); this.filterFridge(); },
  // 平时只看库存，进入管理后才显示勾选和批量移除，减少误触。
  togglePantryManage() { if (!this.data.busy) { this.setData({ pantryManaging: !this.data.pantryManaging, pantrySelected: [], pantrySwipeName: '' }); this.filterFridge(); } },
  togglePantryItem(e) {
    if (this.data.busy || Date.now() < (this._pantryTapUntil || 0)) return;
    if (!this.data.pantryManaging) { this.setData({ pantrySwipeName: '' }); return; }
    const name = e.currentTarget.dataset.name;
    const selected = this.data.pantrySelected;
    if (!selected.includes(name) && selected.length >= 20) return this.notice('每次最多选择20种食材');
    this.setData({ pantrySelected: selected.includes(name) ? selected.filter(x => x !== name) : selected.concat(name) }); this.filterFridge();
  },
  // 手指先上下移动就交给列表滚动，不把滚动的最后一小段认成左滑。
  onPantryTouchStart(e) {
    this._pantryGesture = null;
    if (this.data.busy || this.data.pantryManaging || !e.touches || e.touches.length !== 1) return;
    const point = e.touches[0];
    this._pantryGesture = { name: e.currentTarget.dataset.name, x: point.clientX, y: point.clientY, vertical: false };
  },
  onPantryTouchMove(e) {
    const start = this._pantryGesture;
    if (!start || !e.touches || e.touches.length !== 1) { this._pantryGesture = null; return; }
    const point = e.touches[0];
    if (Math.abs(point.clientY - start.y) > 12 && Math.abs(point.clientY - start.y) > Math.abs(point.clientX - start.x)) start.vertical = true;
  },
  onPantryTouchEnd(e) {
    const start = this._pantryGesture; this._pantryGesture = null;
    if (!start || start.vertical || this.data.busy || this.data.pantryManaging) return;
    const direction = swipeDirection(start, e.changedTouches && e.changedTouches[0]);
    if (!direction) return;
    // 有些手机滑动结束还会发一次点击，这次点击不能立刻收起刚露出的按钮。
    this._pantryTapUntil = Date.now() + 300;
    this.setData({ pantrySwipeName: direction === 'left' ? start.name : '' });
  },
  onPantryTouchCancel() { this._pantryGesture = null; },
  // 左滑只是露出按钮；点击后确认，再让后台移除，失败时保留食材。
  async removeSwipedIngredient(e) {
    const name = e.currentTarget.dataset.name;
    if (this.data.busy || !this.data.pantry.includes(name)) return;
    if (!await this.confirm('从共享冰箱移除“' + name + '”？另一人也会看到这次移除。')) return;
    if (await this.mutate({ action: 'pantryRemove', name }, '食材已移除')) this.setData({ pantrySwipeName: '' });
  },
  // 只发送勾选的名字，不拿整份旧冰箱覆盖对方刚添加的内容。
  async removePantrySelected() {
    const selected = this.data.pantrySelected.slice();
    if (!selected.length || this.data.busy) return;
    if (!await this.confirm('移除这些已用完或不再保留的食材？\n' + selected.join('、'))) return;
    if (await this.mutate({ action: 'pantryRemoveMany', items: selected.map(name => ({ name })) }, '所选食材已移除')) { this.setData({ pantrySelected: [] }); this.filterFridge(); }
  },
  // 不认识的自定义食材可以重新归类；分类改变不会把已经移除的食材加回来。
  async changePantryCategory(e) {
    if (!this.data.pantrySelected.length || this.data.busy) return;
    const index = Number(e.detail.value);
    const category = this.data.customCategories[index].id;
    if (await this.mutate({ action: 'pantryCategorize', items: this.data.pantrySelected.map(name => ({ name, category })) }, '食材分类已更新')) { this.setData({ pantrySelected: [], classifyIndex: index }); this.filterFridge(); }
  },
  openPantryAdd() {
    if (this.data.busy || !this.data.synced) return;
    this.resetSheet();
    this.setData({ pantryOpen: true, pantrySwipeName: '', pantryFocus: 'search', addCategory: 'all', addSearch: '', addSelected: [], customName: '', customCategoryIndex: 7 }); this.filterFridge();
  },
  // 草稿只在本次面板中保留，关闭不会把未确认的食材写入两人的冰箱。
  closePantryAdd() { if (!this.data.busy) { this.setData({ pantryOpen: false, addSelected: [], customName: '' }); this.resetSheet(); } },
  selectAddCategory(e) { this.setData({ addCategory: e.currentTarget.dataset.category }); this.filterFridge(); },
  onAddSearch(e) { this.setData({ addSearch: e.detail.value }); this.filterFridge(); },
  toggleAddItem(e) {
    if (this.data.busy) return;
    const name = e.currentTarget.dataset.name;
    if (this.data.pantry.includes(name)) return this.notice('冰箱里已经有这项食材');
    const selected = this.data.addSelected;
    if (!selected.some(x => x.name === name) && selected.length >= 20) return this.notice('每次最多选择20种食材');
    this.setData({ addSelected: selected.some(x => x.name === name) ? selected.filter(x => x.name !== name) : selected.concat({ name }) }); this.filterFridge();
  },
  clearAddSelected() { if (!this.data.busy) { this.setData({ addSelected: [] }); this.filterFridge(); } },
  // 键盘出现时只留下正在输入的区域，避免搜索框和自定义输入一起挤占空间。
  onPantryFocus(e) { this.setData({ pantryFocus: e.currentTarget.dataset.field }); },
  onCustomName(e) { this.setData({ customName: e.detail.value }); },
  onCustomCategory(e) { this.setData({ customCategoryIndex: Number(e.detail.value) }); },
  // 输入框一次填写一种食材，先加入待选区，最后统一确认保存。
  addCustomIngredient() {
    if (this.data.busy) return;
    const name = ingredients.normalizeName(this.data.customName);
    if (!name || name.length > 40) return this.notice('请输入1到40个字的食材名称');
    if (/[、,，\n]/.test(name)) return this.notice('一次填写一种食材，请分开添加');
    if (this.data.pantry.includes(name)) return this.notice('冰箱里已经有这项食材');
    if (this.data.addSelected.some(x => x.name === name)) return this.notice('这项食材已经选好了');
    if (this.data.addSelected.length >= 20) return this.notice('每次最多选择20种食材');
    const category = this.data.customCategories[this.data.customCategoryIndex].id;
    this.setData({ addSelected: this.data.addSelected.concat({ name, category }), customName: '' }); this.filterFridge();
  },
  async savePantryAdd() {
    if (this.data.busy || !this.data.addSelected.length) return;
    if (this.data.customName.trim()) return this.notice('请先把输入的食材加入待选区，或清空输入');
    const items = this.data.addSelected.map(item => Object.assign({}, item));
    if (await this.mutate({ action: 'pantryAddMany', items }, '食材已加入共享冰箱')) this.closePantryAdd();
  },
  onSearch(e) { this.setData({ search: e.detail.value }); this.filterDishes(); },
  selectFilter(e) { this.setData({ filter: e.currentTarget.dataset.filter }); this.filterDishes(); },
  // 只筛选当前已读菜单，不另写一套随机推荐和评分规则。
  filterDishes() {
    const filter = this.data.filter; const search = this.data.search;
    const visible = this.data.dishes.filter(d => (filter === 'hidden' ? !d.active : d.active) && (filter !== 'meat' || d.kind === 'meat') && (filter !== 'veg' || d.kind === 'veg') && (filter !== 'ready' || d.ready) && (d.name.includes(search) || d.ingredients.some(x => x.includes(search))));
    const suggestions = [...new Set(this.data.dishes.reduce((all, d) => all.concat(d.ingredients), []))].filter(x => !this.data.pantry.includes(x));
    this.setData({ visibleDishes: visible, suggestions });
    if (this.data.pickOpen) this.filterPick();
    this.filterFridge();
  },
  openEditor(e) {
    const id = e.currentTarget.dataset.id; const dish = id ? this.data.dishes.find(d => d.id === id) : null;
    if (id && !dish) return this.notice('这道菜已变更，请刷新');
    this.resetSheet();
    this.setData({ editorOpen: true, draftId: dish ? dish.id : '', draftName: dish ? dish.name : '', draftIngredients: dish ? dish.ingredients.join('、') : '', draftKind: dish ? dish.kind : 'veg' });
  },
  closeEditor() { if (!this.data.busy) { this.setData({ editorOpen: false }); this.resetSheet(); } },
  onDraftName(e) { this.setData({ draftName: e.detail.value }); },
  onDraftIngredients(e) { this.setData({ draftIngredients: e.detail.value }); },
  onDraftKind(e) { this.setData({ draftKind: e.currentTarget.dataset.kind }); },
  async saveDish() {
    const input = { action: 'dishSave', name: this.data.draftName, kind: this.data.draftKind, ingredients: this.data.draftIngredients.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean) };
    if (this.data.draftId) input.id = this.data.draftId;
    if (await this.mutate(input, '菜单已保存')) this.closeEditor();
  },
  toggleDish(e) { this.mutate({ action: 'dishToggle', id: e.currentTarget.dataset.id }, '推荐状态已更新'); },
  async deleteDish(e) { if (await this.confirm('永久删除“' + e.currentTarget.dataset.name + '”？菜单中无法恢复，历史晚餐仍保留当时记录。')) await this.mutate({ action: 'dishDelete', id: e.currentTarget.dataset.id }, '菜品已删除'); },
  openPick(e) {
    const c = this.data.candidates.find(c => c.id === e.currentTarget.dataset.id); if (!c) return;
    this.resetSheet();
    this.setData({ pickOpen: true, pickCandidateId: c.id, pickMealId: this.data.meal.id, pickKind: c.dish.kind, pickSearch: '' }); this.filterPick();
  },
  closePick() { if (!this.data.busy) { this.setData({ pickOpen: false }); this.resetSheet(); } },
  onPickSearch(e) { this.setData({ pickSearch: e.detail.value }); this.filterPick(); },
  filterPick() {
    const excluded = this.data.candidates.map(c => c.dish.id).concat((this.data.meal && this.data.meal.rejected || []).map(c => c.dishId)); const search = this.data.pickSearch;
    this.setData({ pickItems: this.data.dishes.filter(d => d.active && d.kind === this.data.pickKind && !excluded.includes(d.id) && (!(this.data.meal && this.data.meal.fridgeOnly) || d.ready) && (d.name.includes(search) || d.ingredients.some(x => x.includes(search)))) });
  },
  async pickDish(e) {
    if (await this.mutate({ action: 'pick', mealId: this.data.pickMealId, candidateId: this.data.pickCandidateId, dishId: e.currentTarget.dataset.id }, '已选菜，请重新评分')) this.closePick();
  },
  swallowTap() {}
});
