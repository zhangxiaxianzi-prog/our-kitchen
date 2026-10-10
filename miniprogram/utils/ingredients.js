// 分类只帮助找食材，不参与菜品的荤素判定；未知名称留在“其他”。
const categories = [
  { id: 'all', label: '全部' }, { id: 'vegetables', label: '蔬菜' },
  { id: 'meat', label: '肉类' }, { id: 'poultry', label: '禽类' },
  { id: 'seafood', label: '水产' }, { id: 'eggs', label: '蛋类' },
  { id: 'soy', label: '豆制品' }, { id: 'mushrooms', label: '菌菇' }, { id: 'other', label: '其他' }
];
const foods = {
  vegetables: '胡萝卜 青椒 芹菜 蒜苔 土豆 韭黄 杭椒 莲藕 玉米 萝卜 黄瓜 冬瓜 洋葱 番茄 豆芽 尖椒 豆角 油麦菜 生菜 上海青 空心菜 菠菜 茼蒿 西兰花 花菜 娃娃菜 小白菜 四季豆 荷兰豆 茄子 包菜 白菜 青菜 山药 韭菜 西葫芦 蒜苗 苦瓜 丝瓜 南瓜 生姜 葱 蒜 香菜 九层塔 酸萝卜 梅干菜',
  meat: '猪肉 五花肉 排骨 猪蹄 猪肘 猪肚 猪里脊 猪排 牛肉 牛腩 肥牛 牛排 羊肉',
  poultry: '鸡肉 鸡翅 鸡杂 鸡腿 鸭肉 鸭翅 鸭掌 鸭血',
  seafood: '鱼 虾 海带 紫菜 鲫鱼 鲈鱼 带鱼 蛤蜊 鱿鱼',
  eggs: '鸡蛋 鸭蛋 鹌鹑蛋 皮蛋 咸鸭蛋',
  soy: '豆腐 油豆腐 千张 香干 豆干 豆腐泡 腐竹',
  mushrooms: '木耳 香菇 金针菇 虫草花 平菇 杏鲍菇 银耳',
  other: '花生 板栗 面粉 粉丝 年糕 魔芋 蒸肉米粉 薄饼'
};
// 与共享厨房保持相同的常见别名，搜索西红柿时也能找到番茄。
function normalizeName(value) {
  const name = value.trim();
  const aliases = { 西红柿: '番茄', 马铃薯: '土豆', 洋芋: '土豆', 大白菜: '白菜', 卷心菜: '包菜', 圆白菜: '包菜', 豆腐干: '豆干', 千张结: '千张', 莲藕段: '莲藕' };
  return Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
}
const defaults = new Map();
Object.keys(foods).forEach(category => foods[category].split(' ').forEach(name => defaults.set(name, category)));
// 用户自己选的分类优先，已有食材没有分类记录时按常见名称显示。
function categoryOf(name, overrides) {
  const normalized = normalizeName(name);
  const saved = (overrides || []).find(item => item.name === normalized);
  return saved ? saved.category : defaults.get(normalized) || 'other';
}
// 已有库存和待添加清单共用这套筛选，切分类不会丢失用户之前勾选的食材。
function rows(names, overrides, category, search, selected) {
  const keyword = normalizeName(search || '');
  return names.filter(name => (category === 'all' || categoryOf(name, overrides) === category) && name.includes(keyword))
    .map(name => ({ name, selected: selected.includes(name), category: categoryOf(name, overrides) }));
}
module.exports = { catalog: [...defaults.keys()], categories, normalizeName, categoryOf, rows };
