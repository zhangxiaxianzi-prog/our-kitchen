// 北京时间决定今天高亮；手机人在其他时区也不会把记录挪到另一日。
function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
// 用UTC计算月界和星期，不让夏令时把日期前后移动。
function shiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number); const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
// 一个格子就是一天；没有记录时仍可点击，并明确显示当天暂无记录。
function monthCells(month, marks, selected) {
  const [year, number] = month.split('-').map(Number); const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7; const current = today(); const counts = new Map(marks.map(d => [d.date, d.count]));
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1; const date = day > 0 && day <= count ? month + '-' + String(day).padStart(2, '0') : '';
    return { key: String(index), date, label: date ? String(day) : '', count: counts.get(date) || 0, selected: date === selected, today: date === current };
  });
}
// 分页最多40道，页面只整理这一页；旧菜缺少的食材不从当前菜单猜。
function entryGroups(entries, openRejected) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.mealId)) groups.set(entry.mealId, { id: entry.mealId, rank: entry.rank, dateLabel: entry.dateLabel, dishes: [], rejected: [], rejectedOpen: openRejected.includes(entry.mealId) });
    const c = entry.record; const row = { id: entry.id, name: c.name, kindText: c.kind === 'meat' ? '荤菜' : '素菜', ingredientsText: c.ingredients ? c.ingredients.join('、') : '旧记录未保存食材', boyText: c.scores[0] + ' 分', girlText: c.scores[1] + ' 分', total: c.scores[0] + c.scores[1], passed: c.passed };
    const group = groups.get(entry.mealId); (c.passed ? group.dishes : group.rejected).push(row);
  }
  return [...groups.values()].sort((a, b) => b.rank - a.rank);
}
module.exports = { today, shiftMonth, monthCells, entryGroups };
