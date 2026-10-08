import { env } from 'cloudflare:workers';
import { readSession } from '../../../lib/session';
import { limitedJson } from '../../../lib/request';
import { applyAction, newKitchen, type Action, type Kitchen } from '../../../lib/kitchen';
export const dynamic = 'force-dynamic';
const responseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
function reply(value: unknown, status = 200) { return Response.json(value, { status, headers: responseHeaders }); }
// 按登录票据中的厨房编号读取数据，不接受客户端指定别人的厨房。
async function readKitchen(kitchenId: string) {
  if (!env.DB) throw new Error('共享数据库暂时不可用');
  const db = env.DB;
  let row = await db.prepare('SELECT version, state FROM kitchens WHERE id = ?').bind(kitchenId).first<{ version: number; state: string }>();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO kitchens (id, version, state) VALUES (?, ?, ?)').bind(kitchenId, 1, JSON.stringify(newKitchen())).run();
    row = await db.prepare('SELECT version, state FROM kitchens WHERE id = ?').bind(kitchenId).first<{ version: number; state: string }>();
  }
  if (!row) throw new Error('厨房初始化失败，请稍后重试');
  return row;
}
export async function GET(request: Request) {
  const session = await readSession(request);
  if (!session) return reply({ error: '请重新输入共同口令登录' }, 401);
  try { const row = await readKitchen(session.kitchenId); return reply({ role: session.role, version: row.version, kitchen: JSON.parse(row.state) }); }
  catch { return reply({ error: '共享数据暂时无法读取，请稍后重试' }, 503); }
}
export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) return reply({ error: '登录已失效，请重新输入共同口令' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: '请在厨房页面内操作' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({ error: '请求格式不正确' }, 400);
  let input: Action;
  try { input = await limitedJson(request, 8000) as Action; if (!input || typeof input.action !== 'string') throw new Error(); }
  catch { return reply({ error: '请求内容不正确或过长' }, 400); }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const row = await readKitchen(session.kitchenId);
      let state: Kitchen;
      try { state = applyAction(JSON.parse(row.state), input, session.role); }
      catch (error) { return reply({ error: error instanceof Error ? error.message : '操作内容不正确' }, 400); }
      // 保存时要求版本仍然相同；另一人先保存了，就重新读他的改动，再合并本次操作。
      const result = await env.DB!.prepare('UPDATE kitchens SET state = ?, version = version + 1 WHERE id = ? AND version = ?').bind(JSON.stringify(state), session.kitchenId, row.version).run();
      if (result.meta.changes === 1) return reply({ role: session.role, version: row.version + 1, kitchen: state });
    } catch { return reply({ error: '共享数据暂时无法保存，请稍后重试' }, 503); }
  }
  return reply({ error: '两个人正在同时操作，请稍后再试' }, 409);
}
