// 页面只整理显示文字；是否入选和如何保存，仍由网站接口决定。
/** @param {import('../../lib/kitchen').Candidate} candidate
 * @param {number} role
 * @param {string[]} pantry */
function candidateView(candidate, role, pantry) {
  const both = candidate.scores.every(score => score !== null);
  const total = both ? candidate.scores[0] + candidate.scores[1] : null;
  const missing = candidate.dish.ingredients.filter(name => !pantry.includes(name));
  return Object.assign({}, candidate, {
    ownScore: candidate.scores[role],
    ownText: candidate.scores[role] === null ? '未评分' : candidate.scores[role] + ' 分',
    partnerText: both ? candidate.scores[1 - role] + ' 分' : candidate.partnerRated || candidate.scores[1 - role] !== null ? '已评分，暂不公开' : '未评分',
    complete: both,
    totalText: both ? total + ' / 10' : '等待两人评分',
    verdict: !both ? '等待评分' : total >= 7 ? '已入选' : '未入选',
    passed: both && total >= 7,
    ingredientsText: candidate.dish.ingredients.join('、'),
    availability: missing.length ? '还缺：' + missing.join('、') : '主要食材已齐'
  });
}
function dishView(dish, pantry) {
  const missing = dish.ingredients.filter(name => !pantry.includes(name));
  return Object.assign({}, dish, { kindText: dish.kind === 'meat' ? '荤菜' : '素菜', ingredientsText: dish.ingredients.join('、'), ready: missing.length === 0, availability: missing.length ? '还缺：' + missing.join('、') : '主要食材已齐' });
}
// 网站和小程序共用历史显示；它只整理记录，不把历史当成已经实际做过的晚餐。
/** @param {import('../../lib/kitchen').Meal[]} meals
 * @param {number} role
 * @param {import('../../lib/menu').Dish[]} menu
 * @param {string} search
 * @param {string} expandedId
 * @param {string} rejectedId
 * @param {number} rejectedLimit
 * @param {string[]} pantry */
function historyViews(meals, role, menu, search = '', expandedId = '', rejectedId = '', rejectedLimit = 10, pantry = []) {
  const currentMenu = new Map(menu.map(d => [d.id, d]));
  const query = search.trim();
  return meals.filter(m => !query || m.candidates.some(c => c.dish.name.includes(query)) || (m.rejected || []).some(c => c.name.includes(query))).map(m => {
    const rows = m.candidates.map(c => {
      const view = candidateView(c, role, []);
      return { id: c.id, name: c.dish.name, kindText: c.dish.kind === 'meat' ? '荤菜' : '素菜', ingredientsText: view.ingredientsText, passed: view.passed, complete: view.complete, verdict: view.verdict, totalText: view.totalText, boyText: role === 0 ? view.ownText : view.partnerText, girlText: role === 1 ? view.ownText : view.partnerText };
    });
    const selected = m.candidates.filter((c, i) => rows[i].passed);
    const pendingCount = rows.filter(x => !x.complete).length;
    const unavailable = selected.filter(c => !currentMenu.has(c.dish.id) || !currentMenu.get(c.dish.id).active);
    const missing = selected.filter(c => { const d = currentMenu.get(c.dish.id); return m.fridgeOnly && d && !d.ingredients.every(name => pantry.includes(name)); });
    const repeatReason = !selected.length ? '这轮没有入选菜，可以重新搭配。' : unavailable.length ? '已删除或不再推荐：' + unavailable.map(c => c.dish.name).join('、') : missing.length ? '现在缺少食材：' + missing.map(c => c.dish.name).join('、') : '';
    const rejected = m.rejected || [];
    const expanded = m.id === expandedId;
    const rejectedOpen = expanded && m.id === rejectedId;
    return { id: m.id, date: m.date, totalCount: rows.length, meatCount: m.candidates.filter(c => c.dish.kind === 'meat').length, vegCount: m.candidates.filter(c => c.dish.kind === 'veg').length, passedCount: selected.length, pendingCount,
      status: rows.length > 0 && selected.length === rows.length ? '全部入选' : selected.length ? '部分入选' : pendingCount ? '未完成评分' : '未入选',
      preview: rows.map(c => c.name).join('、'), rows: expanded ? rows : [], expanded, repeatReason, canRepeat: !repeatReason,
      repeatNames: selected.map(c => currentMenu.get(c.dish.id)?.name || c.dish.name).join('、'),
      rejectedCount: rejected.length, rejectedOpen, rejected: rejectedOpen ? rejected.slice(0, rejectedLimit).map(c => ({ id: c.id, name: c.name, boyText: c.scores[0] + ' 分', girlText: c.scores[1] + ' 分', totalText: c.scores[0] + c.scores[1] + ' / 10' })) : [],
      hasMoreRejected: rejectedOpen && rejected.length > rejectedLimit, fridgeText: m.fridgeOnly === true ? '只用冰箱食材' : m.fridgeOnly === false ? '不限冰箱食材' : '旧记录未保存食材限制'
    };
  });
}
module.exports = { candidateView, dishView, historyViews };
