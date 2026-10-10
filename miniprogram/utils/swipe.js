// 只有明显横向滑动才露出移除；短触碰、斜滑和上下滚动都不算。
function swipeDirection(start, end) {
  if (!start || !end || !Number.isFinite(end.clientX) || !Number.isFinite(end.clientY)) return '';
  const dx = end.clientX - start.x; const dy = end.clientY - start.y;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return '';
  return dx < 0 ? 'left' : 'right';
}
module.exports = { swipeDirection };
