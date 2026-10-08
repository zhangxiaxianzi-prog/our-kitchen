import { env } from 'cloudflare:workers';
export type Session = { kitchenId: string; role: 0 | 1; expires: number };
// 口令只用来定位厨房，不保存原文；服务端密钥让数据库里的编号不能反推口令。
async function key() {
  const secret = (env as unknown as Record<string,string>).KITCHEN_SESSION_SECRET;
  if (!secret) throw new Error('厨房登录暂时不可用');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function decode(value: string) { const padded = value.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(padded + '='.repeat((4-padded.length%4)%4)),c=>c.charCodeAt(0)); }
export async function kitchenIdFor(passphrase: string) {
  const bytes = await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode('kitchen:'+passphrase));
  return encode(new Uint8Array(bytes));
}
// 登录票据里写明所选身份并签名；页面自己改身份字段不能改掉本次登录的评分人。
export async function issueSession(kitchenId: string, role: 0 | 1) {
  const session: Session = {kitchenId,role,expires:Math.floor(Date.now()/1000)+30*86400};
  const payload = encode(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign('HMAC',await key(),new TextEncoder().encode(payload));
  return payload+'.'+encode(new Uint8Array(signature));
}
export async function readSession(request: Request): Promise<Session | null> {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
    if (token.length > 1024) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const valid = await crypto.subtle.verify('HMAC',await key(),decode(parts[1]),new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Session;
    if ((session.role !== 0 && session.role !== 1) || !/^[A-Za-z0-9_-]{43}$/.test(session.kitchenId) || session.expires <= Math.floor(Date.now()/1000)) return null;
    return session;
  } catch { return null; }
}
