import { initialMenu, ingredientName, type Dish } from './menu';
export type Candidate = { id: string; dish: Dish; scores: [number | null, number | null]; partnerRated?: boolean; blocked?: string };
export type RejectedDish = { id: string; dishId: string; name: string; kind: Dish['kind']; scores: [number, number] };
// 一轮最多保留400道淘汰结果，与菜单上限相同，避免反复增删菜单让历史无限增大。
export const maxRejectedDishes = 400;
export type MealPreferences = { meatCount: number; vegCount: number };
export type Meal = { id: string; date: string; candidates: Candidate[]; fridgeOnly?: boolean; rejected?: RejectedDish[] };
export const ingredientCategoryIds = ['vegetables', 'meat', 'poultry', 'seafood', 'eggs', 'soy', 'mushrooms', 'other'] as const;
export type IngredientCategory = typeof ingredientCategoryIds[number];
export type PantryCategory = { name: string; category: IngredientCategory };
export type Kitchen = { mealPreferences?: MealPreferences; pantryCategories?: PantryCategory[]; dishes: Dish[]; pantry: string[]; shopping: { name: string; checked: boolean }[]; meals: Meal[] };
export type Action = { action: string; [key: string]: unknown };
// 初次进入时冰箱是空的，用户例子里的食材不能当作实际库存。
export function newKitchen(): Kitchen { return { dishes: initialMenu(), pantry: [], shopping: [], meals: [] }; }
function requireText(value: unknown, limit = 40): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error('请输入有效的名称，长度不能超过' + limit + '个字');
  return value.trim();
}
function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error('请填写1到20种主要食材');
  return [...new Set(value.map(x => ingredientName(requireText(x))))];
}
// 先校验整批食材，再修改厨房；不能只加成功前半批就返回失败。
function pantryItems(value: unknown): { name: string; category?: IngredientCategory }[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('每次请选择1到20种食材');
  const result = new Map<string, { name: string; category?: IngredientCategory }>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('食材内容不正确');
    const name = ingredientName(requireText(item.name));
    const category = item.category;
    if (category !== undefined && !ingredientCategoryIds.includes(category)) throw new Error('请选择有效的食材分类');
    result.set(name, { name, category });
  }
  return [...result.values()];
}
// 分类和已有食材一起保存，另一个手机读取同一厨房就能看到自定义分类。
function saveCategories(k: Kitchen, items: { name: string; category?: IngredientCategory }[]) {
  const saved = new Map((k.pantryCategories || []).filter(x => k.pantry.includes(x.name)).map(x => [x.name, x.category]));
  for (const item of items) if (item.category !== undefined) saved.set(item.name, item.category);
  k.pantryCategories = [...saved].map(([name, category]) => ({ name, category }));
}
// 两个人都评完才公开分数；这里只改返回内容，数据库仍保存真实评分。
export function kitchenView(k: Kitchen, role: 0 | 1): Kitchen {
  const visible = structuredClone(k);
  for (const meal of visible.meals) for (const candidate of meal.candidates) {
    candidate.partnerRated = candidate.scores[1 - role] !== null;
    if (candidate.scores.some(score => score === null)) candidate.scores[1 - role] = null;
  }
  return visible;
}
// 一顿至少一道、最多六道，荤素可以有一类为零，默认仍是一荤两素。
export function mealPreferences(meatCount: unknown, vegCount: unknown): MealPreferences {
  if (!Number.isInteger(meatCount) || !Number.isInteger(vegCount) || Number(meatCount) < 0 || Number(vegCount) < 0 || Number(meatCount) + Number(vegCount) < 1 || Number(meatCount) + Number(vegCount) > 6) throw new Error('荤菜和素菜数量需为非负整数，合计1到6道');
  return { meatCount: Number(meatCount), vegCount: Number(vegCount) };
}
// 先筛掉停用菜、本轮淘汰菜和已有候选，食材限制沿用本轮开始时的选择。
function availableDishes(k: Kitchen, kind: Dish['kind'], exclude: string[], fridge: boolean): Dish[] {
  return k.dishes.filter(d => d.active && d.kind === kind && !exclude.includes(d.id) && (!fridge || d.ingredients.every(x => k.pantry.includes(x))));
}
export function chooseDish(k: Kitchen, kind: Dish['kind'], exclude: string[], fridge: boolean): Dish {
  const available = availableDishes(k, kind, exclude, fridge);
  if (!available.length) throw new Error((kind === 'meat' ? '荤菜' : '素菜') + '候选不足，请补充食材或启用更多菜品');
  return available[Math.floor(Math.random() * available.length)];
}
// 新菜换新编号，旧手机迟到的评分不能落到另一道菜上。
function replaceCandidate(c: Candidate, d: Dish) {
  c.id = crypto.randomUUID(); c.dish = structuredClone(d); c.scores = [null, null]; delete c.blocked;
}
// 开始新一轮统一保留旧记录，并把这轮实际荤素数量作为下次默认值。
function startMeal(k: Kitchen, candidates: Candidate[], fridge: boolean) {
  const date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  k.meals.unshift({ id: crypto.randomUUID(), date, candidates, fridgeOnly: fridge, rejected: [] });
  k.mealPreferences = { meatCount: candidates.filter(c => c.dish.kind === 'meat').length, vegCount: candidates.filter(c => c.dish.kind === 'veg').length };
  k.meals = k.meals.slice(0, 30);
}
// 每个请求只改自己负责的字段；外层会重新读取最新版本后重试，另一人的评分不会被覆盖。
export function applyAction(k: Kitchen, input: Action, role: 0 | 1): Kitchen {
  const a = input.action;
  if (a === 'pantryAddMany') {
    const items = pantryItems(input.items);
    const pantry = [...new Set([...k.pantry, ...items.map(x => x.name)])];
    if (pantry.length > 200) throw new Error('冰箱记录超过200种，请减少选择或先整理');
    k.pantry = pantry; saveCategories(k, items);
  } else if (a === 'pantryRemoveMany') {
    const items = pantryItems(input.items);
    const removed = new Set(items.map(x => x.name));
    k.pantry = k.pantry.filter(name => !removed.has(name));
    if (k.pantryCategories) k.pantryCategories = k.pantryCategories.filter(x => !removed.has(x.name));
  } else if (a === 'pantryCategorize') {
    const items = pantryItems(input.items);
    if (items.some(x => !k.pantry.includes(x.name) || x.category === undefined)) throw new Error('食材已变更，请重新选择已有食材和分类');
    saveCategories(k, items);
  } else if (a === 'pantryAdd') {
    const name = ingredientName(requireText(input.name));
    if (k.pantry.length >= 200 && !k.pantry.includes(name)) throw new Error('冰箱记录已到200种，请先整理');
    if (!k.pantry.includes(name)) k.pantry.push(name);
  } else if (a === 'pantryRemove') {
    const name = ingredientName(requireText(input.name));
    k.pantry = k.pantry.filter(n => n !== name);
    if (k.pantryCategories) k.pantryCategories = k.pantryCategories.filter(x => x.name !== name);
  } else if (a === 'dishSave') {
    const id = input.id ? requireText(input.id, 80) : crypto.randomUUID();
    const current = input.id ? k.dishes.find(d => d.id === id) : null;
    if (input.id && !current) throw new Error('这道菜已被删除，请刷新菜单');
    if (!current && k.dishes.length >= 400) throw new Error('菜单已到400道，请先整理');
    const name = requireText(input.name);
    if (k.dishes.some(d => d.name === name && d.id !== id)) throw new Error('菜单里已有同名菜，请编辑原来的菜');
    if (input.kind !== 'meat' && input.kind !== 'veg') throw new Error('请选择荤菜或素菜');
    const dish: Dish = { id, name, kind: input.kind, ingredients: names(input.ingredients), active: current?.active ?? true, source: '你们整理的主要食材' };
    if (current) Object.assign(current, dish); else k.dishes.unshift(dish);
  } else if (a === 'dishToggle' || a === 'dishDelete') {
    const d = k.dishes.find(d => d.id === input.id);
    if (!d) throw new Error('这道菜已被删除，请刷新菜单');
    if (a === 'dishDelete') k.dishes = k.dishes.filter(x => x.id !== d.id); else d.active = !d.active;
  } else if (a === 'mealCreate') {
    const fridge = input.fridge === true;
    const candidates: Candidate[] = [];
    const previous = k.mealPreferences || { meatCount: 1, vegCount: 2 };
    const counts = mealPreferences(input.meatCount ?? previous.meatCount, input.vegCount ?? previous.vegCount);
    const kinds: Dish['kind'][] = [...Array(counts.meatCount).fill('meat'), ...Array(counts.vegCount).fill('veg')];
    for (const kind of kinds) {
      const d = chooseDish(k, kind, candidates.map(c => c.dish.id), fridge);
      candidates.push({ id: crypto.randomUUID(), dish: structuredClone(d), scores: [null, null] });
    }
    startMeal(k, candidates, fridge);
  } else if (a === 'mealRepeat') {
    const id = requireText(input.mealId, 80);
    const source = k.meals.slice(1).find(m => m.id === id);
    if (!source) throw new Error('这份历史晚餐已不存在，请刷新后选择');
    const selected = source.candidates.filter(c => c.scores.every(x => x !== null) && Number(c.scores[0]) + Number(c.scores[1]) >= 7);
    if (!selected.length) throw new Error('这份晚餐没有入选菜，请重新搭配');
    // 先逐道核对现有菜单，任何一项不可用都不开始新一轮，也不偷偷换成别的菜。
    const candidates = selected.map(c => {
      const dish = k.dishes.find(d => d.id === c.dish.id && d.active);
      if (!dish) throw new Error('“' + c.dish.name + '”已删除或不再推荐，请重新选择');
      if (source.fridgeOnly && !dish.ingredients.every(x => k.pantry.includes(x))) throw new Error('“' + dish.name + '”现在缺少食材，请补充冰箱或重新选择');
      return { id: crypto.randomUUID(), dish: structuredClone(dish), scores: [null, null] as [null, null] };
    });
    startMeal(k, candidates, source.fridgeOnly === true);
  } else if (['score', 'replace', 'pick'].includes(a)) {
    const m = k.meals.find(x => x.id === input.mealId);
    const c = m?.candidates.find(x => x.id === input.candidateId);
    if (!m || !c) throw new Error('候选菜已变更，请刷新后再操作');
    if (m.id !== k.meals[0]?.id) throw new Error('历史晚餐不能重新评分或换菜');
    const exclude = [...m.candidates.map(x => x.dish.id), ...(m.rejected || []).map(x => x.dishId)];
    const fridge = m.fridgeOnly ?? (input.fridge === true);
    if (a === 'score') {
      if (!Number.isInteger(input.score) || Number(input.score) < 0 || Number(input.score) > 5) throw new Error('分数只能是0到5之间的整数');
      // 出结果后不允许看着对方分数再改分；同分重发只返回当前结果。
      if (c.scores.every(x => x !== null)) {
        if (c.scores[role] !== input.score) throw new Error('这道菜已出结果，请换一道后重新评分');
        return k;
      }
      if ((m.rejected || []).length >= maxRejectedDishes) throw new Error('本轮淘汰记录已到400道，请开始新一轮搭配');
      c.scores[role] = Number(input.score);
      if (c.scores.every(x => x !== null) && Number(c.scores[0]) + Number(c.scores[1]) < 7) {
        // 先留下两人的最终评分，再换菜；没有可换的菜也要保留评分结果。
        m.rejected = m.rejected || [];
        m.rejected.push({ id: c.id, dishId: c.dish.id, name: c.dish.name, kind: c.dish.kind, scores: [Number(c.scores[0]), Number(c.scores[1])] });
        const available = availableDishes(k, c.dish.kind, exclude, fridge);
        if (m.rejected.length >= maxRejectedDishes) c.blocked = '本轮淘汰记录已到400道，请开始新一轮搭配';
        else if (available.length) replaceCandidate(c, available[Math.floor(Math.random() * available.length)]);
        else c.blocked = '暂无同类候选，请补充菜单或食材后再换一道';
      }
    } else {
      if ((m.rejected || []).length >= maxRejectedDishes) throw new Error('本轮淘汰记录已到400道，请开始新一轮搭配');
      const d = a === 'pick' ? availableDishes(k, c.dish.kind, exclude, fridge).find(x => x.id === input.dishId) : chooseDish(k, c.dish.kind, exclude, fridge);
      if (!d) throw new Error('请选择另一道同类、未被本轮淘汰且符合食材条件的菜');
      replaceCandidate(c, d);
    }
  } else if (a === 'shoppingGenerate') {
    const m = k.meals[0];
    if (!m) throw new Error('请先选择今晚的菜');
    const selected = m.candidates.filter(c => c.scores.every(x => x !== null) && Number(c.scores[0]) + Number(c.scores[1]) >= 7);
    if (!selected.length) throw new Error('还没有评分通过的菜');
    const needed = [...new Set(selected.flatMap(c => c.dish.ingredients))].filter(x => !k.pantry.includes(x));
    for (const name of needed) if (!k.shopping.some(x => x.name === name)) k.shopping.push({ name, checked: false });
    if (k.shopping.length > 200) throw new Error('采购清单超过200项，请先整理');
  } else if (a === 'shoppingAdd') {
    const name = ingredientName(requireText(input.name));
    if (k.shopping.length >= 200) throw new Error('采购清单已到200项，请先整理');
    if (!k.shopping.some(x => x.name === name)) k.shopping.push({ name, checked: false });
  } else if (a === 'shoppingRemove') {
    k.shopping = k.shopping.filter(x => x.name !== input.name);
  } else if (a === 'shoppingCheck') {
    const item = k.shopping.find(x => x.name === input.name);
    if (!item) throw new Error('采购项已移除，请刷新');
    if (typeof input.checked !== 'boolean') throw new Error('采购状态不正确');
    item.checked = input.checked;
  } else if (a === 'shoppingToPantry') {
    const bought = k.shopping.filter(x => x.checked).map(x => x.name);
    const pantry = [...new Set([...k.pantry, ...bought])];
    if (pantry.length > 200) throw new Error('冰箱记录超过200种，请先整理');
    k.pantry = pantry; k.shopping = k.shopping.filter(x => !x.checked);
  } else throw new Error('不支持这个操作');
  return k;
}
