// 页面只整理显示文字；是否入选和如何保存，仍由微信后台决定。
/** @param {import('../../wechat-gateway/domain/kitchen').Candidate} candidate
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
module.exports = { candidateView, dishView };
