const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { StringDecoder } = require('node:string_decoder');
const { api, phrase } = require('./厨房备份迁移.cjs');
const { calendarBackupEntries } = require('../calendar.cjs');
const ORIGIN = 'https://springboot-5wzu-325631-12-1311437624.sh.run.tcloudbase.com';
// 一行保存一道菜，只把当前20道恢复到内存，不一次读取多年的文件。
async function* records(file) {
  const stream = createReadStream(file, { highWaterMark: 16384 }); const decoder = new StringDecoder('utf8'); let pending = '';
  // 流按固定大小读取；没有换行的坏文件也只能暂存一条，不会越读越占内存。
  const parse = line => { if (line.length > 16000) throw new Error('日历备份单条内容过长'); try { return JSON.parse(line); } catch (_) { throw new Error('日历备份不是有效的逐行JSON'); } };
  try {
    for await (const chunk of stream) {
      pending += decoder.write(chunk); let position;
      while ((position = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, position); pending = pending.slice(position + 1); yield parse(line); }
      if (pending.length > 16000) throw new Error('日历备份单条内容过长');
    }
    pending += decoder.end(); if (pending) yield parse(pending);
  } finally { stream.destroy(); }
}
// 先完整检查结束标记和每道菜，再要求用户输入口令，避免拿未写完的文件开始恢复。
async function inspect(file) {
  let count = 0; let started = false; let ended = false;
  for await (const value of records(file)) {
    if (!started) { if (value.format !== 'two-person-calendar-v1') throw new Error('日历备份格式不正确'); started = true; continue; }
    if (ended) throw new Error('日历备份结束后还有额外内容');
    if (value.end === true) { if (value.count !== count) throw new Error('日历备份数量不一致'); ended = true; continue; }
    calendarBackupEntries({ entries: [value] }); count++;
  }
  if (!started || !ended) throw new Error('日历备份未完成，不能用于恢复'); return count;
}
// 导出固定截止位置；导出期间新增的评分由下一次备份包含。
async function main() {
  const [operation, file] = process.argv.slice(2);
  if (!['导出', '导入'].includes(operation) || !file) throw new Error('用法：node tools/日历历史备份.cjs 导出或导入 完整文件路径');
  if (operation === '导入') await inspect(file);
  const passphrase = await phrase(); const { token } = await api(ORIGIN, '/api/login', 'POST', { passphrase, role: 0 });
  if (operation === '导出') {
    const handle = await fs.open(file, 'wx', 0o600); let count = 0; let after = '0'; let maximum = '';
    try {
      await handle.writeFile(JSON.stringify({ format: 'two-person-calendar-v1' }) + '\n');
      do { const page = await api(ORIGIN, '/api/calendar/export?after=' + after + (maximum ? '&maximum=' + maximum : ''), 'GET', undefined, token); maximum = page.maximum; for (const entry of page.entries) { await handle.writeFile(JSON.stringify(entry) + '\n'); count++; } after = page.next; } while (after);
      await handle.writeFile(JSON.stringify({ end: true, count }) + '\n'); console.info('长期日历备份已保存，共' + count + '道；导出期间新增的记录不在本次文件中。');
    } finally { await handle.close(); }
  } else {
    let batch = []; let count = 0;
    for await (const entry of records(file)) {
      if (entry.format || entry.end) continue; batch.push(entry);
      if (batch.length === 20) { const result = await api(ORIGIN, '/api/calendar/restore', 'POST', { entries: batch }, token); count += result.imported; batch = []; }
    }
    if (batch.length) { const result = await api(ORIGIN, '/api/calendar/restore', 'POST', { entries: batch }, token); count += result.imported; }
    console.info('日历恢复完成，新增' + count + '道记录；重复记录不会新增，原冰箱和菜单保留。');
  }
}
if (require.main === module) main().catch(error => { console.error(error.message && !error.code ? error.message : '日历备份失败，请检查文件和网络；已经恢复成功的批次保留，修复后可重新运行。'); process.exitCode = 1; });
module.exports = { inspect };
