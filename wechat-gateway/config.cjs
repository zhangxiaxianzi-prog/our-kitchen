// 缺少配置时停止启动，不能让空数据库或临时密钥冒充可用的共享厨房。
function configuration(env = process.env) {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'KITCHEN_SESSION_SECRET'];
  for (const name of required) if (!env[name]) throw new Error('缺少服务配置：' + name);
  if (env.KITCHEN_SESSION_SECRET.length < 32) throw new Error('厨房登录密钥至少需要32个字符');
  const port = Number(env.DB_PORT || 3306);
  const listenPort = Number(env.PORT || 8080);
  if (![port, listenPort].every(x => Number.isInteger(x) && x > 0 && x <= 65535)) throw new Error('服务端口配置不正确');
  const origins = (env.WEB_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('允许的请求来源必须填写完整的HTTPS域名');
  }
  return { port: listenPort, secret: env.KITCHEN_SESSION_SECRET, origins,
    database: { host: env.DB_HOST, port, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
      charset: 'utf8mb4', connectionLimit: 5, maxIdle: 5, idleTimeout: 60000,
      waitForConnections: true, queueLimit: 20, connectTimeout: 5000,
      multipleStatements: false, maxPreparedStatements: 32 } };
}
module.exports = { configuration };
