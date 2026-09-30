/**
 * 留言管理（Waline）：凭据存储、连接、留言加载与删除。
 * 凭据默认仅保存在本次会话（sessionStorage），可选「记住到本机」（localStorage）。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';

const WALINE_CRED_KEYS = ['waline-server', 'waline-token', 'waline-email'];

function walineRemember() { return localStorage.getItem('waline-remember') === '1'; }

function readCredential(key) {
  return (walineRemember() ? localStorage.getItem(key) : sessionStorage.getItem(key)) || '';
}

function saveCredentials(values, { remember = false } = {}) {
  localStorage.setItem('waline-remember', remember ? '1' : '0');
  for (const [key, value] of Object.entries(values)) {
    const v = value || '';
    sessionStorage.setItem(key, v);
    if (remember) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  }
}

export function clearCredentials() {
  for (const key of WALINE_CRED_KEYS) { localStorage.removeItem(key); sessionStorage.removeItem(key); }
  localStorage.removeItem('waline-remember');
  walineServer = '';
  walineToken = '';
  walineEmail = '';
}

let walineServer = readCredential('waline-server');
let walineToken = readCredential('waline-token');
let walineEmail = readCredential('waline-email');
let walineComments = [];

export function guestbookConfigured() {
  return Boolean(walineServer && walineToken);
}

/** 侧边栏：连接状态提示 */
export function renderGuestbookList() {
  const el = $('#postList');
  if (!el) return;
  if (guestbookConfigured()) {
    el.innerHTML = `
      <div style="padding:12px 14px;font-size:11px;color:#6a6a70;line-height:1.8">
        <div style="color:#80a080">● 已连接 Waline</div>
        <div>服务：${esc(walineServer)}</div>
        <div>账号：${esc(walineEmail || '-')}</div>
        <div>留言：${walineComments.length} 条</div>
        <div>凭据：${walineRemember() ? '已记住到本机' : '仅本次会话'}</div>
      </div>`;
  } else {
    el.innerHTML = `
      <div style="padding:12px 14px;font-size:11px;color:#6a6a70;line-height:1.8">
        <div style="color:#a08040">○ 未连接 Waline 服务</div>
        <div>在右侧填入服务地址与管理员账号。</div>
      </div>`;
  }
}

/** 右侧：连接表单 / 留言列表 */
export function renderGuestbookPanel() {
  if (!guestbookConfigured()) {
    $('#editorTitle').textContent = '留言管理 — 连接 Waline';
    $('#editorContainer').innerHTML = `
      <div class="editor" style="max-width:640px">
        <div class="form-group"><label>Waline 服务地址 (serverURL) *</label>
          <input id="gServer" value="${escAttr(walineServer)}" placeholder="https://your-waline.vercel.app" />
          <small style="color:#5a5a50;font-size:10px;margin-top:2px">部署见 docs/WALINE_DEPLOY.md；本地预览填 http://127.0.0.1:8765（需先运行 node scripts/mock-waline.mjs）</small>
        </div>
        <div class="form-row">
          <div class="form-group"><label>管理员邮箱 *</label><input id="gEmail" type="email" value="${escAttr(walineEmail)}" placeholder="admin@example.com" /></div>
          <div class="form-group"><label>管理员密码 *</label><input id="gPassword" type="password" placeholder="••••••••" /></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8a8a90">
          <input type="checkbox" id="gRemember"${walineRemember() ? ' checked' : ''} /> 记住到本机（否则仅在本次会话内存中保存）
        </label>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn primary" id="btnConnect">🔑 连接并加载留言</button>
          <button class="btn" id="btnForget">断开并清除凭据</button>
        </div>
        <div class="tip-bar" style="margin-top:14px;border:1px solid #2a2a20">
          <span>提示：Waline 部署后，第一个注册的账号即为管理员；此处使用该账号登录以获取管理令牌。凭据默认不写入本机存储。</span>
        </div>
      </div>`;
    $('#btnConnect').onclick = connectGuestbook;
    $('#btnForget').onclick = () => {
      clearCredentials();
      toast('已断开并清除留言凭据');
      renderGuestbookPanel();
      renderGuestbookList();
    };
    return;
  }

  $('#editorTitle').textContent = `留言管理 — ${walineComments.length} 条`;
  $('#editorContainer').innerHTML = `
    <div class="editor">
      <div class="form-group" style="flex-direction:row;align-items:center;gap:10px">
        <span style="font-size:11px;color:#80a080">● ${esc(walineServer)}</span>
        <button class="btn small" id="btnReconnect">重新连接</button>
        <button class="btn small" id="btnGRefresh">↻ 刷新</button>
      </div>
      <div id="gCommentList"></div>
    </div>`;
  $('#btnReconnect').onclick = () => {
    walineToken = '';
    sessionStorage.removeItem('waline-token');
    localStorage.removeItem('waline-token');
    renderGuestbookPanel();
    renderGuestbookList();
  };
  $('#btnGRefresh').onclick = loadGuestbookComments;
  renderGuestbookComments();
}

async function connectGuestbook() {
  const server = $('#gServer')?.value?.trim().replace(/\/+$/, '') || '';
  const email = $('#gEmail')?.value?.trim() || '';
  const password = $('#gPassword')?.value || '';
  if (!server || !email || !password) { toast('请填写服务地址、邮箱与密码'); return; }
  const btn = $('#btnConnect');
  btn.textContent = '⏳ 连接中...';
  btn.disabled = true;
  try {
    const res = await fetch(`${server}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok || json.errno) throw new Error(json.errmsg || `HTTP ${res.status}`);
    walineServer = server;
    walineToken = json.data.token;
    walineEmail = email;
    const remember = Boolean($('#gRemember')?.checked);
    saveCredentials({ 'waline-server': server, 'waline-token': walineToken, 'waline-email': email }, { remember });
    toast(remember ? '已连接 Waline（凭据已记住到本机）' : '已连接 Waline（凭据仅保存在本次会话）');
    await loadGuestbookComments();
    renderGuestbookPanel();
  } catch (e) {
    toast('连接失败: ' + e.message);
    btn.textContent = '🔑 连接并加载留言';
    btn.disabled = false;
  }
}

export async function loadGuestbookComments() {
  if (!guestbookConfigured()) { renderGuestbookPanel(); return; }
  try {
    const res = await fetch(`${walineServer}/api/comment?type=list&pageSize=100&page=1`, {
      headers: { 'Authorization': `Bearer ${walineToken}` },
    });
    const json = await res.json();
    if (!res.ok || json.errno) {
      if (res.status === 401) {
        walineToken = '';
        localStorage.removeItem('waline-token');
        renderGuestbookPanel();
        toast('令牌已失效，请重新连接');
      }
      throw new Error(json.errmsg || `HTTP ${res.status}`);
    }
    walineComments = json.data?.data || [];
    renderGuestbookList();
    renderGuestbookPanel();
  } catch (e) {
    toast('加载留言失败: ' + e.message);
  }
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  div.querySelectorAll('img, svg, script, iframe').forEach((el) => el.remove());
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

function renderGuestbookComments() {
  const el = $('#gCommentList');
  if (!el) return;
  if (!walineComments.length) {
    el.innerHTML = '<div class="empty-state" style="padding:40px">暂无留言</div>';
    return;
  }
  el.innerHTML = walineComments.map((c) => {
    const time = c.time ? new Date(c.time).toLocaleString('zh-CN', { hour12: false }) : (c.insertedAt || '');
    const status = c.status === 'approved' ? '' : ` <span style="color:#a08040">[${esc(c.status || '?')}]</span>`;
    const text = stripHtml(c.comment).slice(0, 120) + (stripHtml(c.comment).length > 120 ? '…' : '');
    return `
      <div style="padding:12px 14px;border-bottom:1px solid #222228;background:#16161a;margin-bottom:8px;border-radius:2px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px">
          <b style="color:#c8b080">${esc(c.nick || '匿名')}</b>
          <span style="color:#6a6a70">IP属地：${esc(c.addr || '未知')}</span>
          <span style="color:#4a4a50" title="原始 IP">(${esc(c.ip || '')})</span>
          <span style="color:#6a6a70">${esc(c.mail || '')}</span>
          <span style="color:#4a4a50;margin-left:auto">${esc(time)}</span>${status}
        </div>
        <div style="font-size:12px;color:#d4d0c8;margin-top:6px;line-height:1.7">${esc(text || '(空)')}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn small danger" data-gb-delete="${escAttr(c.objectId)}">🗑 删除</button>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-gb-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteGuestbookComment(btn.getAttribute('data-gb-delete') || ''));
  });
}

async function deleteGuestbookComment(objectId) {
  if (!confirm('确定删除这条留言？此操作不可撤销。')) return;
  try {
    const res = await fetch(`${walineServer}/api/comment/${objectId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${walineToken}` },
    });
    const json = await res.json();
    if (!res.ok || json.errno) throw new Error(json.errmsg || `HTTP ${res.status}`);
    toast('已删除留言');
    await loadGuestbookComments();
  } catch (e) {
    toast('删除失败: ' + e.message);
  }
}
