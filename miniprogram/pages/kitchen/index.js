const api = require('../../utils/api');
const { candidateView, dishView } = require('../../utils/view');
// 当前页面统一管理四个入口，实际修改都发给同一个厨房接口。
Page({
  data: {
    loggedIn: false, loginRole: 0, role: 0, roleName: '男生', passphrase: '', busy: false, error: '', synced: false,
    tab: 'dinner', tabs: [{ id: 'dinner', label: '今晚吃什么' }, { id: 'fridge', label: '冰箱' }, { id: 'shopping', label: '采购清单' }, { id: 'menu', label: '菜单' }],
    scores: [0, 1, 2, 3, 4, 5], pantry: [], shopping: [], boughtCount: 0, dishes: [], visibleDishes: [], suggestions: [],
    meal: null, candidates: [], passedCount: 0, history: [], showHistory: false, fridgeOnly: false,
    ingredient: '', search: '', filter: 'active', filters: [{ id: 'active', label: '全部推荐' }, { id: 'meat', label: '荤菜' }, { id: 'veg', label: '素菜' }, { id: 'ready', label: '食材已齐' }, { id: 'hidden', label: '不再推荐' }],
    editorOpen: false, draftId: '', draftName: '', draftIngredients: '', draftKind: 'veg',
    pickOpen: false, pickItems: [], pickCandidateId: '', pickMealId: '', pickKind: '', pickSearch: ''
  },
  onLoad() { this._version = 0; this._sessionEpoch = 0; this._visible = false; this._unloaded = false; },
  onShow() {
    this._visible = true;
    if (api.token()) { this.setData({ loggedIn: true }); this.refresh(); }
    this.scheduleRefresh();
  },
  onHide() { this._visible = false; clearTimeout(this._timer); },
  onUnload() { this._visible = false; this._unloaded = true; clearTimeout(this._timer); },
  async onPullDownRefresh() { try { if (api.token()) await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
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
    const history = kitchen.meals.slice(1).map(m => ({ id: m.id, date: m.date, rows: m.candidates.map(c => ({ id: c.id, name: c.dish.name, result: candidateView(c, payload.role, kitchen.pantry).verdict, total: candidateView(c, payload.role, kitchen.pantry).totalText })) }));
    this.setData({ loggedIn: true, role: payload.role, roleName: payload.role === 0 ? '男生' : '女生', pantry: kitchen.pantry, shopping: kitchen.shopping, boughtCount: kitchen.shopping.filter(x => x.checked).length,
      meal, candidates, passedCount: candidates.filter(c => c.passed).length, history, dishes: kitchen.dishes.map(d => dishView(d, kitchen.pantry)), error: '', synced: true });
    this.filterDishes();
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
    api.clearToken(); this._sessionEpoch++; this._version = 0; this._kitchen = null;
    this.setData({ loggedIn: false, synced: false, meal: null, candidates: [], pantry: [], shopping: [], dishes: [], visibleDishes: [], history: [], editorOpen: false, pickOpen: false, passphrase: '' });
  },
  logout() { if (!this.data.busy) { this.clearSession(); this.setData({ error: '' }); } },
  selectTab(e) { this.setData({ tab: e.currentTarget.dataset.tab, ingredient: '' }); },
  setFridgeOnly(e) { this.setData({ fridgeOnly: e.detail.value }); },
  confirm(content) { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })); },
  async createMeal() {
    if (this.data.meal && !await this.confirm('开始新一轮选菜？当前晚餐会保留在历史里。')) return;
    await this.mutate({ action: 'mealCreate', fridge: this.data.fridgeOnly }, '新的候选菜已准备好');
  },
  async score(e) {
    if (!this.data.meal) return;
    await this.mutate({ action: 'score', mealId: this.data.meal.id, candidateId: e.currentTarget.dataset.id, score: Number(e.currentTarget.dataset.score) });
  },
  async replace(e) { if (this.data.meal) await this.mutate({ action: 'replace', mealId: this.data.meal.id, candidateId: e.currentTarget.dataset.id, fridge: this.data.fridgeOnly }, '已换菜，请重新评分'); },
  async shoppingGenerate() { if (await this.mutate({ action: 'shoppingGenerate' }, '采购清单已更新')) this.setData({ tab: 'shopping' }); },
  toggleHistory() { this.setData({ showHistory: !this.data.showHistory }); },
  onIngredient(e) { this.setData({ ingredient: e.detail.value }); },
  async addIngredient() {
    const name = this.data.ingredient.trim(); if (!name) return;
    if (await this.mutate({ action: this.data.tab === 'fridge' ? 'pantryAdd' : 'shoppingAdd', name }, '食材已添加')) this.setData({ ingredient: '' });
  },
  addSuggestion(e) { this.mutate({ action: 'pantryAdd', name: e.currentTarget.dataset.name }, '已加入冰箱'); },
  removeIngredient(e) { this.mutate({ action: this.data.tab === 'fridge' ? 'pantryRemove' : 'shoppingRemove', name: e.currentTarget.dataset.name }); },
  checkShopping(e) { this.mutate({ action: 'shoppingCheck', name: e.currentTarget.dataset.name, checked: e.detail.value }); },
  toPantry() { this.mutate({ action: 'shoppingToPantry' }, '买到的食材已加入冰箱'); },
  onSearch(e) { this.setData({ search: e.detail.value }); this.filterDishes(); },
  selectFilter(e) { this.setData({ filter: e.currentTarget.dataset.filter }); this.filterDishes(); },
  // 只筛选当前已读菜单，不另写一套随机推荐和评分规则。
  filterDishes() {
    const filter = this.data.filter; const search = this.data.search;
    const visible = this.data.dishes.filter(d => (filter === 'hidden' ? !d.active : d.active) && (filter !== 'meat' || d.kind === 'meat') && (filter !== 'veg' || d.kind === 'veg') && (filter !== 'ready' || d.ready) && (d.name.includes(search) || d.ingredients.some(x => x.includes(search))));
    const suggestions = [...new Set(this.data.dishes.reduce((all, d) => all.concat(d.ingredients), []))].filter(x => !this.data.pantry.includes(x));
    this.setData({ visibleDishes: visible, suggestions });
    if (this.data.pickOpen) this.filterPick();
  },
  openEditor(e) {
    const id = e.currentTarget.dataset.id; const dish = id ? this.data.dishes.find(d => d.id === id) : null;
    if (id && !dish) return this.notice('这道菜已变更，请刷新');
    this.setData({ editorOpen: true, draftId: dish ? dish.id : '', draftName: dish ? dish.name : '', draftIngredients: dish ? dish.ingredients.join('、') : '', draftKind: dish ? dish.kind : 'veg' });
  },
  closeEditor() { if (!this.data.busy) this.setData({ editorOpen: false }); },
  onDraftName(e) { this.setData({ draftName: e.detail.value }); },
  onDraftIngredients(e) { this.setData({ draftIngredients: e.detail.value }); },
  onDraftKind(e) { this.setData({ draftKind: e.currentTarget.dataset.kind }); },
  async saveDish() {
    const input = { action: 'dishSave', name: this.data.draftName, kind: this.data.draftKind, ingredients: this.data.draftIngredients.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean) };
    if (this.data.draftId) input.id = this.data.draftId;
    if (await this.mutate(input, '菜单已保存')) this.setData({ editorOpen: false });
  },
  toggleDish(e) { this.mutate({ action: 'dishToggle', id: e.currentTarget.dataset.id }, '推荐状态已更新'); },
  async deleteDish(e) { if (await this.confirm('永久删除“' + e.currentTarget.dataset.name + '”？菜单中无法恢复，历史晚餐仍保留当时记录。')) await this.mutate({ action: 'dishDelete', id: e.currentTarget.dataset.id }, '菜品已删除'); },
  openPick(e) {
    const c = this.data.candidates.find(c => c.id === e.currentTarget.dataset.id); if (!c) return;
    this.setData({ pickOpen: true, pickCandidateId: c.id, pickMealId: this.data.meal.id, pickKind: c.dish.kind, pickSearch: '' }); this.filterPick();
  },
  closePick() { if (!this.data.busy) this.setData({ pickOpen: false }); },
  onPickSearch(e) { this.setData({ pickSearch: e.detail.value }); this.filterPick(); },
  filterPick() {
    const excluded = this.data.candidates.map(c => c.dish.id); const search = this.data.pickSearch;
    this.setData({ pickItems: this.data.dishes.filter(d => d.active && d.kind === this.data.pickKind && !excluded.includes(d.id) && (!this.data.fridgeOnly || d.ready) && (d.name.includes(search) || d.ingredients.some(x => x.includes(search)))) });
  },
  async pickDish(e) {
    if (await this.mutate({ action: 'pick', mealId: this.data.pickMealId, candidateId: this.data.pickCandidateId, dishId: e.currentTarget.dataset.id }, '已选菜，请重新评分')) this.setData({ pickOpen: false });
  },
  swallowTap() {}
});
