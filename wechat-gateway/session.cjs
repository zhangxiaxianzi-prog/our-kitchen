const { createHmac, timingSafeEqual } = require('node:crypto');
// 口令原文不落库；同一把服务密钥必须用于所有实例，重启和扩容都不能换。
function sessions(secret) {
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    kitchenId: phrase => sign('kitchen:' + phrase),
    // 票据写入厨房编号和所选身份，30天后需要重新登录。
    issue(kitchenId, role) {
      const payload = Buffer.from(JSON.stringify({ kitchenId, role, expires: Math.floor(Date.now() / 1000) + 30 * 86400 })).toString('base64url');
      return payload + '.' + sign(payload);
    },
    // 签名和有效期都通过后才接受身份，票据被改过就要求重登。
    read(authorization = '') {
      try {
        if (!authorization.startsWith('Bearer ') || authorization.length > 1031) return null;
        const [payload, signature, extra] = authorization.slice(7).split('.');
        if (!payload || !signature || extra !== undefined) return null;
        const actual = Buffer.from(signature, 'base64url'); const expected = Buffer.from(sign(payload), 'base64url');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!/^[A-Za-z0-9_-]{43}$/.test(data.kitchenId) || ![0, 1].includes(data.role) || !Number.isInteger(data.expires) || data.expires <= Date.now() / 1000) return null;
        return data;
      } catch { return null; }
    }
  };
}
module.exports = { sessions };
