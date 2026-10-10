const api = require('../../utils/api');
const { candidateView, dishView } = require('../../utils/view');
const calendar = require('../../utils/calendar');
const ingredients = require('../../utils/ingredients');
const { swipeDirection } = require('../../utils/swipe');
// 当前页面统一管理五个入口，实际修改都发给同一个厨房接口。
Page({
  data: {
    accountReady: false, userId: '', administrator: false, unlimited: false, kitchenName: '', newKitchenName: '', kitchens: [], kitchensNext: null, kitchensAfter: '', requestKitchen: '', requests: [], requestsNext: null, invitation: '',
    loggedIn: false, loginRole: 0, role: 0, roleName: '男生', passphrase: '', busy: false, error: '', synced: false,
    tab: 'dinner', tabs: [{ id: 'dinner', label: '今晚吃什么' }, { id: 'fridge', label: '冰箱' }, { id: 'shopping', label: '采购清单' }, { id: 'menu', label: '菜单' }, { id: 'calendar', label: '三餐日历' }],
    scores: [0, 1, 2, 3, 4, 5], pantry: [], shopping: [], boughtCount: 0, dishes: [], visibleDishes: [], suggestions: [],
    meal: null, candidates: [], rejectedRows: [], passedCount: 0, countOptions: [0, 1, 2, 3, 4, 5, 6], meatCount: 1, vegCount: 2, mealCount: 3,  fridgeOnly: false,
    calendarMonth: '', calendarDate: '', calendarCells: [], calendarMarks: [], calendarGroups: [], calendarEntries: [], calendarNext: null, calendarPages: [], calendarPage: 1, calendarLoading: false, calendarError: '', unknownCount: 0, calendarRejected: [], weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    ingredient: '', search: '', filter: 'active', filters: [{ id: 'active', label: '全部推荐' }, { id: 'meat', label: '荤菜' }, { id: 'veg', label: '素菜' }, { id: 'ready', label: '食材已齐' }, { id: 'hidden', label: '不再推荐' }],
    editorOpen: false, draftId: '', draftName: '', draftIngredients: '', draftKind: 'veg',
    ingredientCategories: ingredients.categories, customCategories: ingredients.categories.slice(1),
    pantryCategory: 'all', pantrySearch: '', pantrySwipeName: '', pantryRows: [], stockCategories: [], pantryManaging: false, pantrySelected: [],
    pantryOpen: false, pantryFocus: 'search', addCategory: 'all', addSearch: '', addSelected: [], addChoices: [], choiceCategories: [],
    customName: '', customCategoryIndex: 7, classifyIndex: 0,
    keyboardHeight: 0, visibleHeight: 600, sheetHeight: 500, sheetBottom: 0, sheetTarget: '',
    pickOpen: false, pickItems: [], pickCandidateId: '', pickMealId: '', pickKind: '', pickSearch: ''
  },
  onLoad() { this._version = 0; this._sessionEpoch = 0; this._visible = false; this._unloaded = false; this._calendarRequest = 0; this.setData({ calendarMonth: calendar.today().slice(0, 7), calendarDate: calendar.today() }); this.paintCalendar(); this.updateSheetSize(0); },
  onShow() {
    this._visible = true; if (this.data.tab === 'calendar') { this.setData({ calendarLoading: false }); this.loadCalendar(this._calendarCursor || null, this.data.calendarPage, this.data.calendarPages); }
    this.updateSheetSize(0);
    if (api.token() && !api.accountToken()) this.clearSession();
    this.loadAccount();
    if (api.token()) { this.setData({ loggedIn: true }); this.refresh(); }
    this.scheduleRefresh();
  },
  onHide() { this._calendarRequest++; this._visible = false; clearTimeout(this._timer); },
  onUnload() { this._calendarRequest++; this._visible = false; this._unloaded = true; clearTimeout(this._timer); },
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
    // 冰箱和弹窗共用实际可见高度，安卓已经缩小窗口时不重复扣键盘。
    this.setData({ keyboardHeight, visibleHeight: visible, sheetHeight: Math.max(0, Math.floor(Math.min((this._baseHeight || height) * .88, visible - 12))), sheetBottom: Math.max(0, height - visible), sheetTarget: '' }, () => {
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
      else if (api.accountToken()) { if (!this.data.accountReady) await this.loadAccount(); else await this.loadKitchens(this.data.kitchensAfter); }
      this.scheduleRefresh();
    }, 8000);
  },
  notice(message) { if (!this._unloaded) wx.showToast({ title: message, icon: 'none', duration: 3000 }); },
  handleError(error) {
    if (this._unloaded) return;
    if (error.status === 401 || error.status === 410) this.clearSession();
    if (error.account && error.status === 401) this.setData({ accountReady: false, userId: '', administrator: false, kitchens: [], requests: [] });
    this.setData({ error: error.message, synced: false });
  },
  // 旧请求晚到时不能盖掉较新的数据，退出后的响应也不能重新登录。
  accept(payload, epoch) {
    if (this._unloaded || epoch !== this._sessionEpoch || payload.version < this._version) return;
    if (!payload.kitchen || ![0, 1].includes(payload.role) || !Number.isInteger(payload.version)) throw new Error('厨房数据不完整，请刷新');
    const changed = payload.version !== this._version;
    this._version = payload.version;
    this._kitchen = payload.kitchen;
    const kitchen = payload.kitchen;
    const meal = kitchen.meals[0] || null;
    const candidates = meal ? meal.candidates.map(c => candidateView(c, payload.role, kitchen.pantry)) : [];
    const rejectedRows = (meal && meal.rejected || []).map(c => ({ id: c.id, name: c.name, boyScore: c.scores[0], girlScore: c.scores[1], total: c.scores[0] + c.scores[1] }));
    if (!this._mealDraftDirty) { const counts = kitchen.mealPreferences || { meatCount: 1, vegCount: 2 }; this.setData({ meatCount: counts.meatCount, vegCount: counts.vegCount }); }
    this.setData({ loggedIn: true, role: payload.role, roleName: payload.role === 0 ? '男生' : '女生', pantry: kitchen.pantry, shopping: kitchen.shopping, boughtCount: kitchen.shopping.filter(x => x.checked).length,
      meal, candidates, rejectedRows, mealCount: meal ? meal.candidates.length : this.data.meatCount + this.data.vegCount, passedCount: candidates.filter(c => c.passed).length, dishes: kitchen.dishes.map(d => dishView(d, kitchen.pantry)), error: '', synced: true });
    this.filterDishes(); if (changed && this.data.tab === 'calendar') this.loadCalendar(this._calendarCursor || null, this.data.calendarPage, this.data.calendarPages);
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
  // 进入过的厨房关系保存在后台，换手机后仍按同一微信账号查自己的列表。
  async loadAccount() {
    if (this._accountReading || !api.accountToken()) return;
    this._accountReading = true; const epoch = this._sessionEpoch;
    try {
      const profile = await api.profile();
      if (this._unloaded || epoch !== this._sessionEpoch) return;
      this.setData({ accountReady: true, userId: profile.userId, administrator: profile.administrator, unlimited: profile.unlimited });
      if (!this.data.loggedIn) await this.loadKitchens('');
    } catch (error) { if (epoch === this._sessionEpoch) this.handleError(error); }
    finally { this._accountReading = false; }
  },
  async loadKitchens(after = '') {
    if (this._kitchensReading || !api.accountToken()) return;
    this._kitchensReading = true; const epoch = this._sessionEpoch;
    try { const result = await api.kitchens(after); if (!this._unloaded && epoch === this._sessionEpoch) this.setData({ kitchens: result.items.map(item => Object.assign({}, item, { lastVisitText: item.lastVisit ? new Date(Date.parse(item.lastVisit) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '' })), kitchensNext: result.next, kitchensAfter: after }); }
    catch (error) { if (epoch === this._sessionEpoch) this.handleError(error); }
    finally { this._kitchensReading = false; }
  },
  // 用同一处等待和错误处理保护账号操作，避免连续点击重复发起创建或审批。
  async accountAction(action) {
    if (this.data.busy) return;
    const epoch = this._sessionEpoch; this.setData({ busy: true, error: '' });
    try { await action(() => !this._unloaded && epoch === this._sessionEpoch); }
    catch (error) { if (!this._unloaded && epoch === this._sessionEpoch) this.handleError(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  async wechatLogin() {
    await this.accountAction(async valid => { const profile = await api.wechatLogin(); if (!valid()) return; this.setData({ accountReady: true, userId: profile.userId, administrator: profile.administrator }); await this.loadAccount(); });
  },
  onKitchenName(e) { this.setData({ newKitchenName: e.detail.value }); },
  async createKitchen() {
    await this.accountAction(async valid => {
      const result = await api.createKitchen({ name: this.data.newKitchenName.trim(), role: this.data.loginRole }); if (!valid()) return;
      this.openKitchen(result.token, result.name); this.setData({ invitation: result.invitation, newKitchenName: '' }); await this.refresh();
    });
  },
  openKitchen(token, name) { api.saveToken(token); this._version = 0; this._sessionEpoch++; this.setData({ loggedIn: true, kitchenName: name || '两人厨房', invitation: '', requests: [], requestKitchen: '' }); },
  async enterKitchen(e) {
    const id = e.currentTarget.dataset.id; const item = this.data.kitchens.find(x => x.id === id);
    await this.accountAction(async valid => { const result = await api.enterKitchen(id, this.data.loginRole); if (!valid()) return; this.openKitchen(result.token, item && item.name); await this.refresh(); });
  },
  async login() {
    await this.accountAction(async valid => { const result = await api.joinKitchen(this.data.passphrase.trim()); if (!valid()) return; this.setData({ passphrase: '' }); this.notice(result.joined ? '已经加入，请从我的厨房进入' : '申请已发送，等待创建者同意'); await this.loadKitchens(''); });
  },
  async refreshKitchens() { await this.loadAccount(); await this.loadKitchens(''); },
  async nextKitchens() { if (this.data.kitchensNext) await this.loadKitchens(this.data.kitchensNext); },
  copyUserId() { wx.setClipboardData({ data: this.data.userId }); },
  copyInvitation() { if (this.data.invitation) wx.setClipboardData({ data: this.data.invitation }); },
  async resetInvitation(e) {
    const id = e.currentTarget.dataset.id;
    if (!await this.confirm('生成新的加入口令？原口令会失效，已经加入的成员不受影响。')) return;
    await this.accountAction(async valid => { const result = await api.invitation(id); if (valid()) { this.setData({ invitation: result.invitation }); wx.setClipboardData({ data: result.invitation }); this.notice('新口令已复制'); } });
  },
  async showRequests(e) { await this.loadRequests(e.currentTarget.dataset.id, ''); },
  async loadRequests(id, after) {
    await this.accountAction(async valid => { const result = await api.requests(id, after); if (valid()) this.setData({ requestKitchen: id, requests: result.items, requestsNext: result.next }); });
  },
  async nextRequests() { if (this.data.requestsNext) await this.loadRequests(this.data.requestKitchen, this.data.requestsNext); },
  closeRequests() { this.setData({ requestKitchen: '', requests: [] }); },
  async decideRequest(e) {
    const approved = e.currentTarget.dataset.approved === 'yes'; const userId = e.currentTarget.dataset.user;
    if (!await this.confirm((approved ? '同意' : '拒绝') + '这个账号加入厨房？')) return;
    await this.accountAction(async valid => { await api.decide({ id: this.data.requestKitchen, userId, approved }); if (!valid()) return; const result = await api.requests(this.data.requestKitchen, ''); if (valid()) this.setData({ requests: result.items, requestsNext: result.next }); });
  },
  // 扫码只批准对应网页的短期登录，不把管理员票据发给小程序。
  async scanAdminLogin() {
    await this.accountAction(async valid => {
      const scan = await new Promise((resolve, reject) => wx.scanCode({ scanType: ['qrCode'], success: resolve, fail: () => reject(new Error('扫码未完成')) }));
      let input; try { input = JSON.parse(scan.result); } catch (_) { throw new Error('这不是管理网页登录二维码'); }
      if (input.type !== 'kitchen-admin-login') throw new Error('这不是管理网页登录二维码');
      if (!valid() || !await this.confirm('允许电脑或浏览器登录白名单管理网页？只确认你自己刚打开的网页。')) return;
      await api.approveAdmin({ id: input.id, scan: input.scan }); if (valid()) this.notice('已确认，请返回管理网页');
    });
  },
  accountLogout() { if (!this.data.busy) { api.clearAccount(); this.clearSession(); this.setData({ accountReady: false, userId: '', administrator: false, unlimited: false, kitchens: [], requests: [], invitation: '' }); } },
  clearSession() {
    this._calendarRequest++; this._mealDraftDirty = false; this._pantryGesture = null;
    api.clearToken(); this._sessionEpoch++; this._version = 0; this._kitchen = null;
    this.setData({ loggedIn: false, synced: false, pantryOpen: false, pantryManaging: false, pantrySelected: [], addSelected: [], customName: '', pantrySearch: '', pantrySwipeName: '', meatCount: 1, vegCount: 2, mealCount: 3, rejectedRows: [], meal: null, candidates: [], pantry: [], shopping: [], dishes: [], visibleDishes: [],  calendarEntries: [], calendarGroups: [], calendarMarks: [], calendarError: '', calendarLoading: false, calendarNext: null, calendarPages: [], calendarPage: 1, calendarRejected: [], unknownCount: 0, calendarDate: calendar.today(), calendarMonth: calendar.today().slice(0, 7), editorOpen: false, pickOpen: false, passphrase: '' }); this.paintCalendar();
  },
  logout() { if (!this.data.busy) { this.clearSession(); this.setData({ error: '', invitation: '', requestKitchen: '' }); this.loadAccount(); } },
  selectTab(e) { this._calendarRequest++; this.setData({ tab: e.currentTarget.dataset.tab, ingredient: '', pantrySwipeName: '', calendarLoading: false }); if (this.data.tab === 'calendar') this.loadCalendar(); },
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
  // 月份标记和选中日期都只影响日历，不修改评分或菜单。
  paintCalendar() { this.setData({ calendarCells: calendar.monthCells(this.data.calendarMonth, this.data.calendarMarks, this.data.calendarDate), calendarGroups: calendar.entryGroups(this.data.calendarEntries, this.data.calendarRejected) }); },
  // 请求带本次页面编号；切月份、切日期或退出后，迟到的响应直接丢弃。
  async loadCalendar(cursor = null, page = 1, pages = []) {
    if (this._unloaded || this.data.tab !== 'calendar' || !api.token()) return;
    this._calendarCursor = cursor;
    const request = ++this._calendarRequest; const epoch = this._sessionEpoch;
    const month = this.data.calendarMonth; const date = this.data.calendarDate;
    this.setData({ calendarLoading: true, calendarError: '', calendarRejected: [] });
    const valid = () => !this._unloaded && request === this._calendarRequest && epoch === this._sessionEpoch && this.data.tab === 'calendar';
    try {
      const marks = await api.calendar({ month }); if (!valid()) return;
      this.setData({ calendarMarks: marks.days, unknownCount: marks.unknownCount }); this.paintCalendar();
      const result = await api.calendar({ date, cursor: cursor || undefined }); if (!valid()) return;
      this.setData({ calendarEntries: result.entries, calendarNext: result.next, calendarPage: page, calendarPages: pages }); this.paintCalendar();
    } catch (error) { if (valid()) { if (error.status === 401) this.clearSession(); else this.setData({ calendarError: error.status === 404 ? '请先更新微信后台，当前版本尚未支持三餐日历。' : error.message }); } }
    finally { if (valid()) this.setData({ calendarLoading: false }); }
  },
  // 切月份时先清空旧日期详情，不能把上个月的菜显示在新日期下面。
  changeCalendarMonth(e) {
    const offset = Number(e.currentTarget.dataset.offset); const month = calendar.shiftMonth(this.data.calendarMonth, offset);
    if (month < '1000-01' || month > '9999-12') return;
    this.setData({ calendarMonth: month, calendarDate: month + '-01', calendarMarks: [], calendarEntries: [], calendarGroups: [], calendarNext: null }); this.paintCalendar(); this.loadCalendar();
  },
  // 今天按北京时间定位，跨月时也一起切回对应月份。
  calendarToday() { const date = calendar.today(); this.setData({ calendarMonth: date.slice(0, 7), calendarDate: date, calendarEntries: [], calendarGroups: [], calendarNext: null }); this.paintCalendar(); this.loadCalendar(); },
  // 空日期格不响应；真实日期即使没有记录，也能显示明确的空状态。
  chooseCalendarDate(e) { const date = e.currentTarget.dataset.date; if (!date) return; this.setData({ calendarDate: date, calendarEntries: [], calendarGroups: [], calendarNext: null }); this.paintCalendar(); this.loadCalendar(); },
  // 下一页替换当前40道，记录再多也不会无限堆在手机内存里。
  calendarNextPage() { if (this.data.calendarLoading || !this.data.calendarNext) return; this.loadCalendar(this.data.calendarNext, this.data.calendarPage + 1, this.data.calendarPages.concat(this._calendarCursor || null)); },
  // 上一页使用之前保存的读取位置，不从后台一次取出全部历史。
  calendarPreviousPage() { if (this.data.calendarLoading || !this.data.calendarPages.length) return; const pages = this.data.calendarPages.slice(); const cursor = pages.pop(); this._calendarCursor = cursor; this.loadCalendar(cursor, this.data.calendarPage - 1, pages); },
  // 淘汰菜单独展开，默认只看达到7分的菜。
  toggleCalendarRejected(e) { const id = e.currentTarget.dataset.id; this.setData({ calendarRejected: this.data.calendarRejected.includes(id) ? this.data.calendarRejected.filter(x => x !== id) : this.data.calendarRejected.concat(id) }); this.paintCalendar(); },
  // 日历故障可以单独重试，不清空已经同步好的冰箱。
  retryCalendar() { this.loadCalendar(); },
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
