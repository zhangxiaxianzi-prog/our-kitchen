const { z } = require('zod');
const { createHash } = require('node:crypto');
const text = z.string().min(1).max(40);
const dish = z.object({ id: z.string().min(1).max(80), name: text, ingredients: z.array(text).min(1).max(20), kind: z.enum(['meat', 'veg']), active: z.boolean(), source: z.string().max(200) }).strict();
const kitchen = z.object({ dishes: z.array(dish).max(400), pantry: z.array(text).max(200), shopping: z.array(z.object({ name: text, checked: z.boolean() }).strict()).max(200), meals: z.array(z.object({ id: z.string().min(1).max(80), date: z.string().min(1).max(40), candidates: z.array(z.object({ id: z.string().min(1).max(80), dish, scores: z.tuple([z.number().int().min(0).max(5).nullable(), z.number().int().min(0).max(5).nullable()]) }).strict()).length(3) }).strict()).max(30) }).strict();
// 导入只收厨房内容，不带原来的口令、厨房编号或登录票据。
function validateBackup(value) {
  const parsed = z.object({ format: z.literal('two-person-kitchen-v1'), kitchen }).strict().safeParse(value);
  if (!parsed.success) throw new Error('备份内容不完整或超出厨房记录上限');
  const k = parsed.data.kitchen;
  const unique = items => new Set(items).size === items.length;
  if (!unique(k.dishes.map(x => x.id)) || !unique(k.dishes.map(x => x.name)) || !unique(k.pantry) || !unique(k.shopping.map(x => x.name)) || !unique(k.meals.map(x => x.id))) throw new Error('备份包含重复的厨房记录');
  for (const meal of k.meals) {
    if (!unique(meal.candidates.map(x => x.id)) || !unique(meal.candidates.map(x => x.dish.id)) || meal.candidates.filter(x => x.dish.kind === 'meat').length !== 1) throw new Error('备份中的晚餐必须是一荤两素且不能重复');
  }
  const state = JSON.stringify(k);
  if (Buffer.byteLength(state) > 2 * 1024 * 1024) throw new Error('备份中的厨房内容超过2MB，请先整理记录');
  return { kitchen: k, state, hash: createHash('sha256').update(state).digest('hex') };
}
module.exports = { validateBackup };
