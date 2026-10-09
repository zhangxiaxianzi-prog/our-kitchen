const http = require('node:http');
const https = require('node:https');
const SITE_ORIGIN = 'https://our-kitchen-oct09.berryokapi.chatgpt.site';
const ALLOWED = new Set(['POST /api/login', 'GET /api/kitchen', 'POST /api/kitchen']);
// 本服务只连接已发布厨房，不接受页面传入其他网址，也不复制评分和库存规则。
async function readBody(request) {
  const limit = request.url === '/api/login' ? 2000 : 8000;
  if (Number(request.headers['content-length']) > limit) throw Object.assign(new Error('请求内容过长'), { status: 413 });
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('请求内容过长'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { JSON.parse(text); } catch (_) { throw Object.assign(new Error('请求内容不正确'), { status: 400 }); }
  return text;
}
// 口令和票据只经HTTPS发给当前厨房；不转发微信身份头、MySQL密码或任意自定义头。
function forward(request, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SITE_ORIGIN };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    if (request.headers.authorization) headers.Authorization = request.headers.authorization;
    const upstream = https.request(SITE_ORIGIN + request.url, { method: request.method, headers, timeout: 12000 }, response => {
      let length = 0; const chunks = [];
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { response.destroy(); reject(new Error('厨房返回内容过大')); return; }
        chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('读取厨房响应失败')));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { JSON.parse(text); } catch (_) { reject(new Error('厨房返回内容不正确')); return; }
        resolve({ status: response.statusCode, body: text });
      });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('连接厨房超时')));
    upstream.on('error', () => reject(new Error('暂时连接不上厨房')));
    upstream.end(body || undefined);
  });
}
// 无本机共享状态，每次保存由Sites接口合并，多个容器实例也不会各存一份数据。
function createServer(send = forward) {
  return http.createServer(async (request, response) => {
    const reply = (status, body) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(typeof body === 'string' ? body : JSON.stringify(body)); } };
    if (request.method === 'GET' && request.url === '/health') return reply(200, { status: 'ok', service: '两人厨房小程序接入服务' });
    if (!ALLOWED.has(request.method + ' ' + request.url)) return reply(404, { error: '不支持这个接口' });
    if (request.url === '/api/kitchen' && (!request.headers.authorization || request.headers.authorization.length > 1100 || !/^Bearer [A-Za-z0-9_.-]+$/.test(request.headers.authorization))) return reply(401, { error: '请先输入共同口令登录' });
    if (request.method === 'POST' && !String(request.headers['content-type']).includes('application/json')) return reply(400, { error: '请使用正确的请求格式' });
    try {
      const body = request.method === 'POST' ? await readBody(request) : '';
      const result = await send(request, body);
      reply(result.status, result.body);
    } catch (error) {
      if (!error.status) console.error('连接厨房接口失败，请检查服务网络');
      reply(error.status || 502, { error: error.status ? error.message : '暂时连接不上厨房，请稍后重试' });
    }
  });
}
if (require.main === module) {
  const server = createServer();
  server.requestTimeout = 20000; server.headersTimeout = 15000; server.maxRequestsPerSocket = 100;
  server.listen(Number(process.env.PORT) || 8080, '0.0.0.0', () => console.info('两人厨房小程序接入服务已启动'));
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 15000).unref(); });
}
module.exports = { createServer, forward };
