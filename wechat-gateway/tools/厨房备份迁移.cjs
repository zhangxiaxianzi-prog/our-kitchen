const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const fs = require('node:fs/promises');
const { validateBackup } = require('../backup.cjs');
const OLD = 'https://our-kitchen-oct09.berryokapi.chatgpt.site';
const NEW = 'https://springboot-5wzu-325631-12-1311437624.sh.run.tcloudbase.com';
// 口令在本机输入，输入时不显示，也不写到文件和日志里。
async function phrase() {
  if (!process.stdin.isTTY) throw new Error('请在自己的终端运行，不能通过命令参数传入口令');
  process.stdout.write('输入共同口令（输入过程不显示）：');
  const muted = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  try { return await reader.question(''); } finally { reader.close(); process.stdout.write('\n'); }
}
// 备份读写也限制返回大小；网页验证页不会被误当作厨房备份保存。
async function api(origin, path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('接口没有返回厨房数据，已停止迁移；请检查网站访问或服务是否发布');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('厨房返回内容过长，已停止迁移');
    chunks.push(Buffer.from(chunk));
  }
  const result = JSON.parse(Buffer.concat(chunks).toString());
  if (!response.ok) throw new Error(result.error || '厨房暂时无法访问');
  return result;
}
async function main() {
  const [operation, file] = process.argv.slice(2);
  if (!['导出', '导入'].includes(operation) || !file) throw new Error('用法：node tools/厨房备份迁移.cjs 导出或导入 完整备份路径');
  // 导入前先验证文件，不能输入口令后才发现备份格式不对。
  let backup;
  if (operation === '导入') {
    const stat = await fs.stat(file);
    if (stat.size > 4 * 1024 * 1024) throw new Error('备份文件过大');
    backup = validateBackup(JSON.parse(await fs.readFile(file, 'utf8')));
  }
  const origin = operation === '导出' ? OLD : NEW;
  const { token } = await api(origin, '/api/login', 'POST', { passphrase: await phrase(), role: 0 });
  if (operation === '导出') {
    const data = await api(origin, '/api/kitchen', 'GET', undefined, token);
    const checked = validateBackup({ format: 'two-person-kitchen-v1', kitchen: data.kitchen });
    await fs.writeFile(file, JSON.stringify({ format: 'two-person-kitchen-v1', kitchen: checked.kitchen }, null, 2), { mode: 0o600, flag: 'wx' });
    console.info('厨房备份已保存；文件已存在时不会覆盖。');
  } else {
    const data = await api(origin, '/api/kitchen/restore', 'POST', { format: 'two-person-kitchen-v1', kitchen: backup.kitchen }, token);
    const current = validateBackup({ format: 'two-person-kitchen-v1', kitchen: data.kitchen });
    if (current.hash !== backup.hash) throw new Error('当前厨房和备份内容不同，请停止切换并核对记录');
    console.info('厨房导入完成，菜单、冰箱、采购清单和晚餐历史已逐项校验一致。');
  }
}
if (require.main === module) main().catch(error => { console.error(error.message && !error.code ? error.message : '备份迁移失败，请检查文件和网络'); process.exitCode = 1; });
module.exports = { api };
