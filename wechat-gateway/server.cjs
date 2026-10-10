const http = require('node:http');
const { KitchenError, KitchenService } = require('./service.cjs');
const { configuration } = require('./config.cjs');
const { MysqlKitchenRepository } = require('./repository.cjs');
// 请求超过长度限制就停止接收，备份导入也不能无限占用服务内存。
function readBody(request, maximum) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let rejected = false;
    request.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > maximum) { rejected = true; chunks.length = 0; reject(new KitchenError('请求内容过长', 413)); }
      else chunks.push(chunk);
    });
    request.once('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new KitchenError('请求内容不是正确的JSON')); }
    });
    request.once('aborted', () => reject(new KitchenError('请求已经中断')));
    request.once('error', () => reject(new KitchenError('请求接收失败')));
  });
}
// 身份只从签名票据读取，不能靠提交role字段替另一人评分。
function createServer(service, auth, origins, logger = console, accounts = null, adminOrigin = '') {
  const accountRoutes = accounts ? require('./account-http.cjs').accountHttp(accounts, adminOrigin, readBody) : null;
  let active = 0; let restoring = false;
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (value, status = 200) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) return reply({ error: '这个请求来源不允许访问厨房' }, 403);
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') { response.statusCode = 204; return response.end(); }
    if (active >= 10) return reply({ error: '厨房正在忙，请稍后再试' }, 503);
    const isRestore = path === '/api/kitchen/restore' && request.method === 'POST';
    if (isRestore && restoring) return reply({ error: '厨房备份正在导入，请稍后重试' }, 409);
    if (isRestore) restoring = true;
    active++;
    try {
      if (path === '/health' && request.method === 'GET') return reply({ ok: true });
      if (path === '/ready' && request.method === 'GET') { await service.repository.ready(); return reply({ ok: true }); }
      if (accounts && path === '/api/login') return reply({ error: '旧口令入口已经关闭，请更新小程序并微信登录' }, 410);
      if (accountRoutes && await accountRoutes(request, response, url, reply)) return;
      if (!['/api/login', '/api/kitchen', '/api/kitchen/restore', '/api/calendar', '/api/calendar/export', '/api/calendar/restore'].includes(path)) return reply({ error: '没有这个厨房接口' }, 404);
      if (!['GET', 'POST'].includes(request.method) || (path === '/api/login' || path === '/api/kitchen/restore' || path === '/api/calendar/restore') && request.method !== 'POST' || (path === '/api/calendar' || path === '/api/calendar/export') && request.method !== 'GET') return reply({ error: '这个接口不支持该操作方式' }, 405);
      const session = path === '/api/login' ? null : auth.read(request.headers.authorization);
      if (path !== '/api/login' && !session) return reply({ error: accounts ? '请微信登录并重新进入厨房' : '请重新输入共同口令登录' }, 401);
      if (accounts) await accounts.requireMembership(session);
      if (path === '/api/calendar') return reply(await service.calendar(session, url.searchParams));
      if (path === '/api/calendar/export') return reply(await service.exportCalendar(session, url.searchParams));
      if (request.method === 'GET') return reply(await service.read(session));
      if (!request.headers['content-type']?.includes('application/json')) throw new KitchenError('请求格式需要使用JSON');
      const limit = path === '/api/login' ? 2000 : path === '/api/calendar/restore' ? 128 * 1024 : path === '/api/kitchen/restore' ? 4 * 1024 * 1024 : 8000;
      if (Number(request.headers['content-length']) > limit) throw new KitchenError('请求内容过长', 413);
      const input = await readBody(request, limit);
      const result = path === '/api/login' ? await service.login(input) : path === '/api/kitchen/restore' ? await service.restore(session, input) : path === '/api/calendar/restore' ? await service.restoreCalendar(session, input) : await service.change(session, input);
      reply(result);
    } catch (error) {
      if (error instanceof KitchenError) reply({ error: error.message }, error.status);
      else {
        // 数据库错误只记录固定错误编号，连接配置、口令和厨房内容都不进日志。
        const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(error.code) ? error.code : 'DATABASE_UNAVAILABLE';
        logger.error('厨房接口暂时不可用', { 接口: path, 错误编号: code });
        reply({ error: '共享数据暂时不可用，请稍后重试' }, 503);
      }
    } finally { active--; if (isRestore) restoring = false; }
  });
}
async function start() {
  const config = configuration(); const repository = new MysqlKitchenRepository(config.database);
  try {
    await repository.initialize();
    const { accountSessions } = require('./account-session.cjs');
    const { AccountRepository } = require('./account-repository.cjs');
    const { AccountService, WechatIdentity } = require('./account-service.cjs');
    const auth = accountSessions(config.secret); const accountRepository = new AccountRepository(repository);
    await accountRepository.initialize();
    // 第一次配置管理员时为本人加入白名单；已经停用的名单不因重启而恢复。
    for (const userId of config.administrators) await accountRepository.execute('INSERT INTO kitchen_whitelist (user_id,enabled,note) VALUES (?,1,?) ON DUPLICATE KEY UPDATE user_id = user_id', [userId, '首次配置的管理员账号']);
    const accounts = new AccountService(accountRepository, auth, new WechatIdentity(config.appId, config.appSecret), config.administrators);
    const server = createServer(new KitchenService(repository, auth), auth, config.origins, console, accounts, config.adminOrigin);
    server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100;
    server.listen(config.port, '0.0.0.0', () => console.info('两人厨房共享服务已启动'));
    // 先停止接新请求，再释放数据库连接，扩容和发布时不保留失效连接。
    process.once('SIGTERM', () => {
      const timer = setTimeout(() => process.exit(1), 15000); timer.unref();
      server.close(async () => { await repository.close(); clearTimeout(timer); process.exit(0); });
    });
  } catch (error) { await repository.close(); throw error; }
}
if (require.main === module) start().catch(error => {
  console.error('厨房服务启动失败，请检查数据库配置和登录密钥', { 错误编号: /^[A-Z0-9_]{1,60}$/.test(error.code || '') ? error.code : 'CONFIGURATION_ERROR' });
  process.exitCode = 1;
});
module.exports = { createServer, readBody };
