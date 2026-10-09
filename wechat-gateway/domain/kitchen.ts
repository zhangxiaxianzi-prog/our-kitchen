import { initialMenu, ingredientName, type Dish } from './menu';
export type Candidate = { id: string; dish: Dish; scores: [number | null, number | null] };
export type Meal = { id: string; date: string; candidates: Candidate[] };
export type Kitchen = { dishes: Dish[]; pantry: string[]; shopping: { name: string; checked: boolean }[]; meals: Meal[] };
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
// 先筛掉停用菜和已有候选，再按荤素选菜；菜不够时直接说明，不重复凑数。
export function chooseDish(k: Kitchen, kind: Dish['kind'], exclude: string[], fridge: boolean): Dish {
  const available = k.dishes.filter(d => d.active && d.kind === kind && !exclude.includes(d.id) && (!fridge || d.ingredients.every(x => k.pantry.includes(x))));
  if (!available.length) throw new Error((kind === 'meat' ? '荤菜' : '素菜') + '候选不足，请补充食材或启用更多菜品');
  return available[Math.floor(Math.random() * available.length)];
}
// 每个请求只改自己负责的字段；外层会重新读取最新版本后重试，另一人的评分不会被覆盖。
export function applyAction(k: Kitchen, input: Action, role: 0 | 1): Kitchen {
  const a = input.action;
  if (a === 'pantryAdd') {
    const name = ingredientName(requireText(input.name));
    if (k.pantry.length >= 200 && !k.pantry.includes(name)) throw new Error('冰箱记录已到200种，请先整理');
    if (!k.pantry.includes(name)) k.pantry.push(name);
  } else if (a === 'pantryRemove') {
    k.pantry = k.pantry.filter(n => n !== ingredientName(requireText(input.name)));
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
    for (const kind of ['meat', 'veg', 'veg'] as const) {
      const d = chooseDish(k, kind, candidates.map(c => c.dish.id), fridge);
      candidates.push({ id: crypto.randomUUID(), dish: structuredClone(d), scores: [null, null] });
    }
    // 手动开始新一轮时保留此前晚餐，历史最多30轮，避免数据无限增长。
    const date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    k.meals.unshift({ id: crypto.randomUUID(), date, candidates });
    k.meals = k.meals.slice(0, 30);
  } else if (['score', 'replace', 'pick'].includes(a)) {
    const m = k.meals.find(x => x.id === input.mealId);
    const c = m?.candidates.find(x => x.id === input.candidateId);
    if (!m || !c) throw new Error('候选菜已变更，请刷新后再操作');
    if (m.id !== k.meals[0]?.id) throw new Error('历史晚餐不能重新评分或换菜');
    if (a === 'score') {
      if (!Number.isInteger(input.score) || Number(input.score) < 0 || Number(input.score) > 5) throw new Error('分数只能是0到5之间的整数');
      c.scores[role] = Number(input.score);
    } else {
      const exclude = m.candidates.map(x => x.dish.id);
      const d = a === 'pick' ? k.dishes.find(x => x.id === input.dishId && x.active && x.kind === c.dish.kind && !exclude.includes(x.id)) : chooseDish(k, c.dish.kind, exclude, input.fridge === true);
      if (!d) throw new Error('请选择另一道同类且正在推荐的菜');
      // 更换候选的编号也要换，旧页面发来的评分不能打到新菜上。
      c.id = crypto.randomUUID(); c.dish = structuredClone(d); c.scores = [null, null];
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
