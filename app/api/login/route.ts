import { env } from 'cloudflare:workers';
import { issueSession, kitchenIdFor } from '../../../lib/session';
import { newKitchen } from '../../../lib/kitchen';
import { limitedJson } from '../../../lib/request';
export const dynamic = 'force-dynamic';
// 同口令进入同厨房；身份允许用户自选，这不是对现实情侣关系的验证。
export async function POST(request: Request) {
  const reply = (value: unknown, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({error:'请在厨房页面登录'},403);
  let passphrase: string; let role: 0 | 1;
  try {
    const input = await limitedJson(request, 2000) as {passphrase?:unknown;role?:unknown};
    if(typeof input.passphrase !== 'string' || (input.role !== 0 && input.role !== 1)) throw new Error();
    passphrase = input.passphrase.trim(); role = input.role;
    if(passphrase.length<8 || passphrase.length>64) return reply({error:'共同口令需要8到64个字符，建议选一句只有你们知道的话'},400);
  } catch { return reply({error:'登录内容不正确'},400); }
  try {
    if(!env.DB) return reply({error:'共享数据库暂时不可用'},503);
    // 每个网络地址每15分钟最多尝试20次，旧计数及时清理，避免记录无限增长。
    const bucket=Math.floor(Date.now()/900000);
    const ip=request.headers.get('cf-connecting-ip') || 'local';
    const throttleId=await kitchenIdFor('login-rate:'+ip+':'+bucket);
    const attempts=await env.DB.prepare('INSERT INTO login_attempts (id, bucket, count) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < 20 RETURNING count').bind(throttleId,bucket).first();
    if(!attempts) return reply({error:'登录尝试过于频繁，请15分钟后再试'},429);
    await env.DB.prepare('DELETE FROM login_attempts WHERE bucket < ?').bind(bucket-1).run();
    const kitchenId=await kitchenIdFor(passphrase);
    await env.DB.prepare('INSERT OR IGNORE INTO kitchens (id, version, state) VALUES (?, 1, ?)').bind(kitchenId,JSON.stringify(newKitchen())).run();
    return reply({token:await issueSession(kitchenId,role)});
  } catch { return reply({error:'暂时无法进入厨房，请稍后重试'},503); }
}
