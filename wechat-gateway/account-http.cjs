const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { KitchenError } = require('./service.cjs');
const { validUser } = require('./account-session.cjs');
const { validId } = require('./account-service.cjs');
const cookie = (request, name) => (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
const setCookie = (response, name, value, seconds) => response.setHeader('Set-Cookie', `${name}=${value}; Path=/api/admin; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Strict`);
// 页面是固定文件；不能通过网址读取后台配置或任意磁盘文件。
function accountHttp(accounts, origin, readBody) {
  const files = new Map([
    ['/admin', ['index.html', 'text/html; charset=utf-8']],
    ['/admin/app.js', ['app.js', 'application/javascript; charset=utf-8']],
    ['/admin/style.css', ['style.css', 'text/css; charset=utf-8']]
  ].map(([url, [name, type]]) => [url, { body: fs.readFileSync(path.join(__dirname, 'admin', name)), type }]));
  return async (request, response, url, reply) => {
    const route = url.pathname;
    if (route.startsWith('/admin')) {
      if (request.method !== 'GET' || !files.has(route)) throw new KitchenError('没有这个管理页面', 404);
      response.setHeader('Content-Type', files.get(route).type); response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      response.end(files.get(route).body); return true;
    }
    if (!route.startsWith('/api/account/') && !route.startsWith('/api/admin/')) return false;
    const methods = {
      '/api/account/login': 'POST', '/api/account/profile': 'GET', '/api/account/kitchens': 'GET', '/api/account/create': 'POST', '/api/account/enter': 'POST', '/api/account/join': 'POST', '/api/account/requests': 'GET', '/api/account/decide': 'POST', '/api/account/invitation': 'POST', '/api/account/admin-approve': 'POST',
      '/api/admin/login': 'POST', '/api/admin/poll': 'GET', '/api/admin/session': 'GET', '/api/admin/logout': 'POST', '/api/admin/whitelist': 'GET', '/api/admin/save': 'POST', '/api/admin/audit': 'GET'
    };
    if (!methods[route]) throw new KitchenError('没有这个账号接口', 404);
    if (request.method !== methods[route]) throw new KitchenError('这个接口不支持该操作方式', 405);
    // 网页修改必须来自已配置的管理网页，防止别的网站借用浏览器登录态发请求。
    if (route.startsWith('/api/admin/') && request.method === 'POST' && (!origin || request.headers.origin !== origin)) throw new KitchenError('请从管理员网页进行操作', 403);
    let input = {};
    if (request.method === 'POST') {
      if (!request.headers['content-type']?.includes('application/json')) throw new KitchenError('请求格式需要使用JSON');
      if (Number(request.headers['content-length']) > 8000) throw new KitchenError('请求内容过长', 413);
      input = await readBody(request, 8000);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KitchenError('请求内容不正确');
    }
    const params = url.searchParams;
    const after = params.get('after') || '';
    if (after && !validId(after) && !validUser(after)) throw new KitchenError('列表位置不正确');
    if (route === '/api/account/login') { reply(await accounts.login(input)); return true; }
    if (route.startsWith('/api/account/')) {
      const userId = accounts.requireAccount(request.headers.authorization);
      switch (route) {
        case '/api/account/profile': reply(await accounts.profile(userId)); break;
        case '/api/account/kitchens': reply(await accounts.repository.list(userId, after)); break;
        case '/api/account/create': reply(await accounts.create(userId, input)); break;
        case '/api/account/enter': reply(await accounts.enter(userId, input)); break;
        case '/api/account/join': reply(await accounts.join(userId, input)); break;
        case '/api/account/requests': { const id = params.get('id'); await accounts.owner(userId, id); reply(await accounts.repository.requests(id, after)); break; }
        case '/api/account/decide': reply(await accounts.decide(userId, input)); break;
        case '/api/account/invitation': reply(await accounts.invitation(userId, input.id)); break;
        case '/api/account/admin-approve': reply(await accounts.approveAdmin(userId, input)); break;
      }
      return true;
    }
    if (route === '/api/admin/login') {
      const login = await accounts.startAdminLogin(); setCookie(response, 'kitchen_browser', login.browser, 120);
      const qr = await QRCode.toDataURL(JSON.stringify({ type: 'kitchen-admin-login', id: login.id, scan: login.scan }), { width: 280, margin: 2, errorCorrectionLevel: 'M' });
      reply({ id: login.id, qr, expires: login.expires }); return true;
    }
    if (route === '/api/admin/poll') {
      const result = await accounts.pollAdmin(params.get('id'), cookie(request, 'kitchen_browser'));
      if (result.token) { setCookie(response, 'kitchen_admin', result.token, 3600); delete result.token; }
      reply(result); return true;
    }
    const userId = accounts.requireAdmin('Bearer ' + cookie(request, 'kitchen_admin'));
    if (route === '/api/admin/session') reply({ userId });
    if (route === '/api/admin/logout') { setCookie(response, 'kitchen_admin', '', 0); reply({ ok: true }); }
    if (route === '/api/admin/whitelist') {
      const search = params.get('search') || ''; if (search && !validUser(search)) throw new KitchenError('请填写完整账号标识');
      reply(await accounts.repository.permissions(after, search));
    }
    if (route === '/api/admin/save') reply(await accounts.savePermission(userId, input));
    if (route === '/api/admin/audit') { const before = params.get('before') || '18446744073709551615'; if (!/^\d{1,20}$/.test(before) || BigInt(before) > 18446744073709551615n) throw new KitchenError('记录位置不正确'); reply(await accounts.repository.audit(before)); }
    return true;
  };
}
module.exports = { accountHttp };
