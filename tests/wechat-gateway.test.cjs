const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../wechat-gateway/server.cjs');
// 检查服务只开放厨房接口，恶意地址或过大内容不会送到网站。
test('云托管只转发规定接口并保留登录失败状态', async () => {
  const sent = [];
  const server = createServer(async (request, body) => {
    sent.push({ path: request.url, method: request.method, body, authorization: request.headers.authorization });
    return { status: request.url === '/api/login' ? 200 : 401, body: JSON.stringify(request.url === '/api/login' ? { token: 'sample.token' } : { error: '登录已失效' }) };
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/api/kitchen')).status, 401);
    assert.equal((await fetch(base + '/api/kitchen?url=https://example.com')).status, 404);
    assert.equal((await fetch(base + '/anything', { method: 'POST' })).status, 404);
    const headers = { 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ passphrase: '共同测试口令123', role: 0 }) })).status, 200);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers, body: 'invalid' })).status, 400);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers, body: 'a'.repeat(2001) })).status, 413);
    assert.equal((await fetch(base + '/api/kitchen', { headers: { Authorization: 'Bearer sample.token' } })).status, 401);
    assert.deepEqual(sent.map(x => x.path), ['/api/login', '/api/kitchen']);
    assert.equal(sent[1].authorization, 'Bearer sample.token');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('上游故障返回中文提示而非假装保存成功', async () => {
  const server = createServer(async () => { throw new Error('网络检查故障'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/kitchen', { headers: { Authorization: 'Bearer sample.token' } });
    assert.equal(response.status, 502); assert.match((await response.json()).error, /连接不上厨房/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

// 模拟Node网络请求，验证真实错误编号不会再被统一文案吞掉。
const { EventEmitter } = require('node:events');
const { forward } = require('../wechat-gateway/server.cjs');
function simulatedRequest(run) {
  return (_url, _options, callback) => {
    const upstream = new EventEmitter();
    upstream.end = () => queueMicrotask(() => run(upstream, callback));
    upstream.destroy = error => { if (error) queueMicrotask(() => upstream.emit('error', error)); };
    return upstream;
  };
}
for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'CERT_HAS_EXPIRED', 'ETIMEDOUT']) {
  test('记录连接错误编号：' + code, async () => {
    const send = simulatedRequest(upstream => upstream.emit('error', Object.assign(new Error('原错误含敏感内容，不应出现在日志'), { code })));
    await assert.rejects(forward({ url: '/api/login', method: 'POST', headers: {} }, '{}', send), error => {
      assert.equal(error.diagnostic.错误编号, code);
      assert.equal(error.diagnostic.阶段, '连接网站');
      assert.equal(error.diagnostic.网站状态, null);
      assert(error.diagnostic.耗时毫秒 >= 0);
      assert(!JSON.stringify(error.diagnostic).includes('敏感内容'));
      return true;
    });
  });
}
test('请求超时会保留ETIMEDOUT编号', async () => {
  await assert.rejects(forward({ url: '/api/login', method: 'POST', headers: {} }, '{}', simulatedRequest(upstream => upstream.emit('timeout'))), error => error.diagnostic.错误编号 === 'ETIMEDOUT');
});
test('网站返回HTML时保留状态与类型，但不记录网页正文', async () => {
  const response = new EventEmitter(); response.statusCode = 403; response.headers = { 'content-type': 'text/html; charset=utf-8' };
  const send = simulatedRequest((_upstream, callback) => { callback(response); response.emit('data', Buffer.from('<html>网页正文包含敏感票据</html>')); response.emit('end'); });
  await assert.rejects(forward({ url: '/api/kitchen', method: 'GET', headers: {} }, '', send), error => {
    assert.equal(error.diagnostic.错误编号, 'UPSTREAM_INVALID_JSON');
    assert.equal(error.diagnostic.网站状态, 403); assert.equal(error.diagnostic.内容类型, 'text/html');
    assert(!JSON.stringify(error.diagnostic).includes('敏感票据')); return true;
  });
});
test('网站响应中断时保留读取错误，不暴露登录票据', async () => {
  const response = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-type': 'application/json' };
  const send = simulatedRequest((_upstream, callback) => { callback(response); response.emit('error', Object.assign(new Error('包含响应正文'), { code: 'ECONNRESET' })); });
  await assert.rejects(forward({ url: '/api/kitchen', method: 'GET', headers: {} }, '', send), error => error.diagnostic.阶段 === '读取网站响应' && error.diagnostic.错误编号 === 'ECONNRESET');
});
test('容器日志能定位错误，且不打印口令、票据或任意异常文字', async () => {
  const logs = [];
  const server = createServer(async (request, body) => {
    throw Object.assign(new Error('不要记录这段口令：' + body + request.headers.authorization), { diagnostic: { 阶段: '连接网站', 原因: '连接厨房失败', 错误编号: 'ENOTFOUND', 耗时毫秒: 12, 网站状态: null, 内容类型: '未收到响应' } });
  }, { error: (...args) => logs.push(args) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await fetch('http://127.0.0.1:' + server.address().port + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-test-token' }, body: JSON.stringify({ passphrase: 'private-test-passphrase', role: 0 }) });
    assert.equal(result.status, 502); assert.equal(logs.length, 1);
    const fields = JSON.parse(logs[0][1]); assert.equal(fields.错误编号, 'ENOTFOUND'); assert.equal(fields.接口, '/api/login');
    assert(!JSON.stringify(logs).includes('private-test'));
    assert(!JSON.stringify(await result.json()).includes('ENOTFOUND'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
