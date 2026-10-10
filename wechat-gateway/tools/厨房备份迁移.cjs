const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const fs = require('node:fs/promises');
const { validateBackup } = require('../backup.cjs');
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
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('接口没有返回厨房数据，已停止迁移；请检查微信后台是否发布');
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
// 普通接口隐藏未公开分数；备份用共同口令分别读取两人的自己的分数，再合并。
function mergeBackupViews(boy, girl) {
  if (boy.role !== 0 || girl.role !== 1 || boy.version !== girl.version) throw new Error('厨房在备份期间发生变化，请停止操作后重试');
  const kitchen = structuredClone(boy.kitchen);
  for (const meal of kitchen.meals) for (const candidate of meal.candidates) {
    const other = girl.kitchen.meals.find(x => x.id === meal.id)?.candidates.find(x => x.id === candidate.id);
    if (!other) throw new Error('两次读取的候选菜不同，已停止备份');
    candidate.scores[1] = other.scores[1]; delete candidate.partnerRated;
  }
  return validateBackup({ format: 'two-person-kitchen-v1', kitchen });
}
// 最多重新读取三次，不在两个人持续操作时无限等待一份稳定记录。
async function readBackup(origin, boyToken, girlToken) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const views = await Promise.all([api(origin, '/api/kitchen', 'GET', undefined, boyToken), api(origin, '/api/kitchen', 'GET', undefined, girlToken)]);
    if (views[0].version === views[1].version) return mergeBackupViews(...views);
  }
  throw new Error('厨房在备份期间持续变化，请停止操作后重试');
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
  const origin = NEW;
  const passphrase = await phrase();
  const { token } = await api(origin, '/api/login', 'POST', { passphrase, role: 0 });
  const { token: girlToken } = await api(origin, '/api/login', 'POST', { passphrase, role: 1 });
  if (operation === '导出') {
    const checked = await readBackup(origin, token, girlToken);
    await fs.writeFile(file, JSON.stringify({ format: 'two-person-kitchen-v1', kitchen: checked.kitchen }, null, 2), { mode: 0o600, flag: 'wx' });
    console.info('厨房备份已保存；文件已存在时不会覆盖。');
  } else {
    await api(origin, '/api/kitchen/restore', 'POST', { format: 'two-person-kitchen-v1', kitchen: backup.kitchen }, token);
    const current = await readBackup(origin, token, girlToken);
    if (current.hash !== backup.hash) throw new Error('当前厨房和备份内容不同，请停止切换并核对记录');
    console.info('厨房导入完成，菜单、冰箱、采购清单和最近选菜记录已核对；长期日历需单独备份。');
  }
}
if (require.main === module) main().catch(error => { console.error(error.message && !error.code ? error.message : '备份迁移失败，请检查文件和网络'); process.exitCode = 1; });
module.exports = { api, phrase, mergeBackupViews };
