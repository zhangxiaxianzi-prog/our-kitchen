const config = require('../config');
const TOKEN_KEY = 'kitchen-session';
function token() { return wx.getStorageSync(TOKEN_KEY) || ''; }
function saveToken(value) { wx.setStorageSync(TOKEN_KEY, value); }
function clearToken() { wx.removeStorageSync(TOKEN_KEY); }
// 请求交给微信云托管，接口地址固定；不把共同口令写到手机缓存或日志里。
async function request(path, method, data) {
  if (!wx.cloud || !wx.cloud.callContainer) throw new Error('当前微信版本不支持云托管，请升级微信后再试');
  const header = { 'X-WX-SERVICE': config.service, 'content-type': 'application/json' };
  if (token()) header.Authorization = 'Bearer ' + token();
  let response;
  try {
    response = await wx.cloud.callContainer({ config: { env: config.environment }, path, method, header, data, timeout: 20000 });
  } catch (_) {
    throw new Error('暂时连接不上厨房，请检查网络和云托管服务后重试');
  }
  const body = response.data;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(body && body.error || '厨房请求失败，请重试');
    error.status = response.statusCode;
    throw error;
  }
  if (!body || typeof body !== 'object') throw new Error('厨房返回内容不正确，请检查云托管服务是否已更新');
  return body;
}
module.exports = {
  token, saveToken, clearToken,
  login: (passphrase, role) => request('/api/login', 'POST', { passphrase, role }),
  read: () => request('/api/kitchen', 'GET'),
  change: input => request('/api/kitchen', 'POST', input)
};
