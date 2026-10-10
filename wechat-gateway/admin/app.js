// 页面只显示后台已经核实的权限，不用本地存储保存管理员登录票据。
const element = id => document.getElementById(id);
let timer; let loginId; let next; let auditNext; let saving = false;
function message(text) { element('message').textContent = text; }
async function api(path, data) {
  const response = await fetch('/api/admin/' + path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(result.error || '请求失败，请重试'); }
  return result;
}
function showLogin() { clearTimeout(timer); loginId = null; element('workspace').hidden = true; element('login').hidden = false; element('logout').hidden = true; }
async function showWorkspace() { clearTimeout(timer); loginId = null; element('login').hidden = true; element('workspace').hidden = false; element('logout').hidden = false; await load(''); await loadAudit(); }
// 只通过文字节点显示账号和备注，用户填写的内容不能变成网页代码。
function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; }
async function load(after = '') {
  const search = element('search').value.trim();
  const result = await api('whitelist?' + new URLSearchParams({ after, search })); next = result.next; element('next').hidden = !next;
  element('rows').replaceChildren();
  for (const item of result.items) {
    const row = document.createElement('tr'); const identity = cell(row, item.userId); const note = document.createElement('small'); note.textContent = item.note || '无备注'; identity.append(note);
    cell(row, item.enabled ? '已启用' : '已停用'); cell(row, new Date(item.updatedAt).toLocaleString('zh-CN'));
    const action = cell(row, ''); const button = document.createElement('button'); button.textContent = item.enabled ? '停用' : '启用'; action.append(button);
    button.onclick = () => run(async () => {
      if (saving || !confirm((item.enabled ? '停用' : '启用') + '这个账号的白名单权限？')) return;
      saving = true; button.disabled = true;
      try { await api('save', { userId: item.userId, enabled: !item.enabled, note: item.note, version: item.version }); message('已保存，最多60秒生效。'); await load(''); await loadAudit(); } finally { saving = false; button.disabled = false; }
    }); element('rows').append(row);
  }
  if (!result.items.length) { const row = document.createElement('tr'); const td = cell(row, '没有符合条件的账号。'); td.colSpan = 4; element('rows').append(row); }
}
async function loadAudit(before) {
  const result = await api('audit' + (before ? '?before=' + encodeURIComponent(before) : '')); auditNext = result.next; element('next-audit').hidden = !auditNext; element('audit').replaceChildren();
  for (const item of result.items) { const li = document.createElement('li'); li.textContent = `${new Date(item.createdAt).toLocaleString('zh-CN')}：${item.actorId} ${item.enabled ? '启用' : '停用'} ${item.userId}${item.note ? '，备注：' + item.note : ''}`; element('audit').append(li); }
  if (!result.items.length) { const li = document.createElement('li'); li.textContent = '暂无修改记录。'; element('audit').append(li); }
}
async function poll(id) {
  if (loginId !== id || document.hidden) return;
  try {
    const result = await api('poll?id=' + encodeURIComponent(id)); if (loginId !== id) return;
    if (result.status === 'approved') { message(''); await showWorkspace(); return; }
    if (['expired', 'used'].includes(result.status)) { element('login-status').textContent = '二维码已失效，请重新生成。'; return; }
    timer = setTimeout(() => poll(id), 2500);
  } catch (error) { message(error.message); element('login-status').textContent = '请重新生成二维码。'; }
}
async function run(action) { try { await action(); } catch (error) { message(error.message); } }
element('new-login').onclick = () => run(async () => {
  clearTimeout(timer); element('new-login').disabled = true;
  try { const result = await api('login', {}); loginId = result.id; element('qr').src = result.qr; element('qr').hidden = false; element('login-status').textContent = '二维码两分钟内有效，请在小程序里扫码并确认。'; message(''); poll(loginId); } finally { element('new-login').disabled = false; }
});
element('find').onclick = () => run(() => load(''));
element('all').onclick = () => { element('search').value = ''; run(() => load('')); };
element('next').onclick = () => run(() => load(next));
element('load-audit').onclick = () => run(() => loadAudit());
element('next-audit').onclick = () => run(() => loadAudit(auditNext));
element('logout').onclick = () => run(async () => { await api('logout', {}); showLogin(); element('qr').hidden = true; });
element('add-form').onsubmit = event => { event.preventDefault(); run(async () => {
  if (saving) return; saving = true; const button = event.target.querySelector('button'); button.disabled = true;
  try { await api('save', { userId: element('user').value.trim(), enabled: true, note: element('note').value.trim(), version: 0 }); element('user').value = ''; element('note').value = ''; element('search').value = ''; message('已加入白名单，最多60秒生效。'); await load(''); await loadAudit(); } finally { saving = false; button.disabled = false; }
}); };
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && loginId) poll(loginId); });
run(async () => { try { await api('session'); await showWorkspace(); } catch (error) { if (!element('workspace').hidden) message(error.message); } });
