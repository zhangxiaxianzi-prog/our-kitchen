const { createHash } = require('node:crypto');
// 旧记录允许斜杠和中文日期；无法识别时单独保留，不拿今天冒充旧日期。
function calendarDate(value) {
  const match = /^(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})日?$/.exec(value || '');
  if (!match) return 'unknown';
  const [, y, m, d] = match; const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number(y) < 1000 || Number(y) > 9999 || date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) return 'unknown';
  return y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
}
// 每道菜两人都打完分才生成历史，换菜后仍使用原候选编号去重。
function calendarEntries(kitchen) {
  const entries = [];
  kitchen.meals.forEach((meal, index) => {
    const saved = new Map();
    for (const c of meal.candidates) if (c.scores.every(x => x !== null)) saved.set(c.id, { id: c.id, dishId: c.dish.id, name: c.dish.name, kind: c.dish.kind, ingredients: c.dish.ingredients, scores: c.scores });
    for (const c of meal.rejected || []) if (!saved.has(c.id)) saved.set(c.id, { ...c, ingredients: c.ingredients || null });
    for (const c of saved.values()) entries.push({ key: createHash('sha256').update(JSON.stringify([meal.id, c.id])).digest('hex'), mealId: meal.id, date: calendarDate(meal.date), dateLabel: meal.date, rank: -index, record: { candidateId: c.id, dishId: c.dishId, name: c.name, kind: c.kind, ingredients: c.ingredients, scores: [...c.scores], passed: c.scores[0] + c.scores[1] >= 7 } });
  });
  return entries;
}
// 日历只接受真实月份或日期，页码改用上一页的最后一条位置，避免翻页越来越慢。
function calendarQuery(params) {
  const month = params.get('month'); const date = params.get('date');
  if (month && !date && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 1000) {
    const [y, m] = month.split('-').map(Number); const end = y === 9999 && m === 12 ? '9999-12-32' : m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    return { month, start: month + '-01', end };
  }
  if (!month && (date === 'unknown' || date && calendarDate(date) === date)) {
    let cursor = null;
    if (params.has('cursor')) {
      try { cursor = JSON.parse(params.get('cursor')); } catch (_) { throw new Error('日历翻页位置不正确'); }
      if (!cursor || !Number.isSafeInteger(cursor.rank) || !/^[1-9]\d{0,19}$/.test(String(cursor.id))) throw new Error('日历翻页位置不正确');
    }
    return { date, cursor };
  }
  throw new Error('请选择有效的日历月份或日期');
}
// 日历备份每批最多20道，校验完成再写；旧厨房备份仍由原来的校验处理。
function calendarBackupEntries(value) {
  const { z } = require('zod'); const text = z.string().min(1).max(40); const identifier = z.string().min(1).max(80); const score = z.number().int().min(0).max(5);
  const record = z.object({ candidateId: identifier, dishId: identifier, name: text, kind: z.enum(['meat', 'veg']), ingredients: z.array(text).min(1).max(20).nullable(), scores: z.tuple([score, score]), passed: z.boolean() }).strict();
  const schema = z.object({ entries: z.array(z.object({ mealId: identifier, date: z.string(), dateLabel: text, rank: z.number().int().min(-30).max(4294967295), record }).strict()).min(1).max(20) }).strict();
  const parsed = schema.safeParse(value); if (!parsed.success) throw new Error('日历备份内容不完整或每批超过20道');
  return parsed.data.entries.map(e => {
    if (calendarDate(e.dateLabel) !== e.date || e.record.passed !== (e.record.scores[0] + e.record.scores[1] >= 7)) throw new Error('日历备份的日期或评分结果不正确');
    return { ...e, key: createHash('sha256').update(JSON.stringify([e.mealId, e.record.candidateId])).digest('hex') };
  });
}
module.exports = { calendarDate, calendarEntries, calendarQuery, calendarBackupEntries };
