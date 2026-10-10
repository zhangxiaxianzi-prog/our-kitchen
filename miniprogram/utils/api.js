const config = require('../config');
const TOKEN_KEY = 'kitchen-session';
const ACCOUNT_KEY = 'kitchen-wechat-account';
function accountToken() { return wx.getStorageSync(ACCOUNT_KEY) || ''; }
function clearAccount() { wx.removeStorageSync(ACCOUNT_KEY); clearToken(); }
function token() { return wx.getStorageSync(TOKEN_KEY) || ''; }
function saveToken(value) { wx.setStorageSync(TOKEN_KEY, value); }
function clearToken() { wx.removeStorageSync(TOKEN_KEY); }
// 请求交给微信云托管，接口地址固定；不把共同口令写到手机缓存或日志里。
async function request(path, method, data, account = false) {
  if (!wx.cloud || !wx.cloud.callContainer) throw new Error('当前微信版本不支持云托管，请升级微信后再试');
  const header = { 'X-WX-SERVICE': config.service, 'content-type': 'application/json' };
  const credential = account ? accountToken() : token();
  if (credential) header.Authorization = 'Bearer ' + credential;
  let response;
  try {
    response = await wx.cloud.callContainer({ config: { env: config.environment }, path, method, header, data, timeout: 20000 });
  } catch (_) {
    throw new Error('暂时连接不上厨房，请检查网络和云托管服务后重试');
  }
  const body = response.data;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(body && body.error || '厨房请求失败，请重试');
    error.status = response.statusCode; error.account = account;
    if (account && error.status === 401) clearAccount();
    throw error;
  }
  if (!body || typeof body !== 'object') throw new Error('厨房返回内容不正确，请检查云托管服务是否已更新');
  return body;
}
module.exports = {
  token, saveToken, clearToken, accountToken, clearAccount,
  // 微信只提供短期登录凭证；账号身份由后台向微信核实，页面不能自行指定。
  wechatLogin: async () => {
    const code = await new Promise((resolve, reject) => wx.login({ timeout: 10000, success: result => result.code ? resolve(result.code) : reject(new Error('微信登录未成功，请重试')), fail: () => reject(new Error('微信登录未成功，请重试')) }));
    const result = await request('/api/account/login', 'POST', { code }, true);
    if (typeof result.token !== 'string' || !result.token) throw new Error('微信登录结果不完整');
    wx.setStorageSync(ACCOUNT_KEY, result.token); return result;
  },
  profile: () => request('/api/account/profile', 'GET', undefined, true),
  kitchens: after => request('/api/account/kitchens?after=' + encodeURIComponent(after || ''), 'GET', undefined, true),
  createKitchen: input => request('/api/account/create', 'POST', input, true),
  enterKitchen: (id, role) => request('/api/account/enter', 'POST', { id, role }, true),
  joinKitchen: passphrase => request('/api/account/join', 'POST', { passphrase }, true),
  requests: (id, after) => request('/api/account/requests?id=' + encodeURIComponent(id) + '&after=' + encodeURIComponent(after || ''), 'GET', undefined, true),
  decide: input => request('/api/account/decide', 'POST', input, true),
  invitation: id => request('/api/account/invitation', 'POST', { id }, true),
  approveAdmin: input => request('/api/account/admin-approve', 'POST', input, true),
  login: (passphrase, role) => request('/api/login', 'POST', { passphrase, role }),
  // 日历单独查询月份和日期，不把长期历史混进冰箱同步。
  calendar: query => request('/api/calendar?' + Object.keys(query).filter(key => query[key] !== undefined).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(typeof query[key] === 'object' ? JSON.stringify(query[key]) : query[key])).join('&'), 'GET'),
  read: () => request('/api/kitchen', 'GET'),
  change: input => request('/api/kitchen', 'POST', input)
};
