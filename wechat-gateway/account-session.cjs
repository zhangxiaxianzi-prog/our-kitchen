const { createHmac, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const randomId = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const validUser = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(value);
// 新票据带微信账号和用途，旧的纯口令票据不能用来进入新厨房。
function accountSessions(secret) {
  const sign = value => createHmac('sha256', secret).update('account-v2:' + value).digest('base64url');
  return {
    kitchenId: value => createHmac('sha256', secret).update('lookup-v2:' + value).digest('base64url'),
    issueAccount(userId, kind = 'account') { return this.issueClaims({ userId, kind }, kind === 'admin' ? 3600 : 30 * 86400); },
    issue(kitchenId, role, userId) { return this.issueClaims({ kitchenId, role, userId, kind: 'kitchen' }, 30 * 86400); },
    // 网页和小程序拿到不同用途的票据，不能互相冒用。
    issueClaims(claims, seconds) {
      const payload = Buffer.from(JSON.stringify({ ...claims, expires: Math.floor(Date.now() / 1000) + seconds })).toString('base64url');
      return payload + '.' + sign(payload);
    },
    read(authorization = '', kind = 'kitchen') {
      try {
        if (!authorization.startsWith('Bearer ') || authorization.length > 1200) return null;
        const [payload, signature, extra] = authorization.slice(7).split('.');
        if (!payload || !signature || extra !== undefined) return null;
        const actual = Buffer.from(signature, 'base64url'); const expected = Buffer.from(sign(payload), 'base64url');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (data.kind !== kind || !validUser(data.userId) || !Number.isInteger(data.expires) || data.expires <= Date.now() / 1000) return null;
        if (kind === 'kitchen' && (!/^[A-Za-z0-9_-]{43}$/.test(data.kitchenId) || ![0, 1].includes(data.role))) return null;
        return data;
      } catch { return null; }
    }
  };
}
module.exports = { accountSessions, randomId, digest, validUser };
