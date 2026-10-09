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
