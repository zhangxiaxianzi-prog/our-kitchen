const { z } = require('zod');
const { createHash } = require('node:crypto');
const { ingredientCategoryIds, maxRejectedDishes } = require('./dist/domain.cjs');
const text = z.string().min(1).max(40);
const dish = z.object({ id: z.string().min(1).max(80), name: text, ingredients: z.array(text).min(1).max(20), kind: z.enum(['meat', 'veg']), active: z.boolean(), source: z.string().max(200) }).strict();
const score = z.number().int().min(0).max(5);
const candidate = z.object({ id: z.string().min(1).max(80), dish, scores: z.tuple([score.nullable(), score.nullable()]), blocked: z.string().max(100).optional() }).strict();
const preferences = z.object({ meatCount: z.number().int().min(0).max(6), vegCount: z.number().int().min(0).max(6) }).strict().refine(x => x.meatCount + x.vegCount >= 1 && x.meatCount + x.vegCount <= 6);
const rejected = z.object({ id: z.string().min(1).max(80), dishId: z.string().min(1).max(80), name: text, kind: z.enum(['meat', 'veg']), scores: z.tuple([score, score]) }).strict();
const kitchen = z.object({ mealPreferences: preferences.optional(), pantryCategories: z.array(z.object({ name: text, category: z.enum(ingredientCategoryIds) }).strict()).max(200).optional(), dishes: z.array(dish).max(400), pantry: z.array(text).max(200), shopping: z.array(z.object({ name: text, checked: z.boolean() }).strict()).max(200), meals: z.array(z.object({ id: z.string().min(1).max(80), date: z.string().min(1).max(40), candidates: z.array(candidate).min(1).max(6), fridgeOnly: z.boolean().optional(), rejected: z.array(rejected).max(maxRejectedDishes).optional() }).strict()).max(30) }).strict();
// 导入只收厨房内容，不带原来的口令、厨房编号或登录票据。
function validateBackup(value) {
  const parsed = z.object({ format: z.literal('two-person-kitchen-v1'), kitchen }).strict().safeParse(value);
  if (!parsed.success) throw new Error('备份内容不完整或超出厨房记录上限');
  const k = parsed.data.kitchen;
  const unique = items => new Set(items).size === items.length;
  if (!unique(k.dishes.map(x => x.id)) || !unique(k.dishes.map(x => x.name)) || !unique(k.pantry) || !unique(k.shopping.map(x => x.name)) || !unique(k.meals.map(x => x.id))) throw new Error('备份包含重复的厨房记录');
  // 旧备份没有分类也能导入；新分类必须对应真实库存且每种食材只出现一次。
  if (k.pantryCategories && (!unique(k.pantryCategories.map(x => x.name)) || k.pantryCategories.some(x => !k.pantry.includes(x.name)))) throw new Error('备份的食材分类重复或对应食材不存在');
  for (const meal of k.meals) {
    if (!unique(meal.candidates.map(x => x.id)) || !unique(meal.candidates.map(x => x.dish.id))) throw new Error('备份中的晚餐候选不能重复');
    if (meal.rejected && (!unique(meal.rejected.map(x => x.id)) || !unique(meal.rejected.map(x => x.dishId)) || meal.rejected.some(x => x.scores[0] + x.scores[1] >= 7))) throw new Error('备份中的淘汰记录重复或分数不符合规则');
  }
  const state = JSON.stringify(k);
  if (Buffer.byteLength(state) > 2 * 1024 * 1024) throw new Error('备份中的厨房内容超过2MB，请先整理记录');
  return { kitchen: k, state, hash: createHash('sha256').update(state).digest('hex') };
}
module.exports = { validateBackup };
