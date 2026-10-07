/**
 * 访问控制：管理员级文章密码的设置与版本冲突校验。
 */
import { $ } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const PRIVATE_ACCESS_API = '/api/private-access';
let privateAccessHash = '';

export async function loadPrivateAccess() {
  try {
    const res = await apiFetch(PRIVATE_ACCESS_API);
    const data = await res.json();
    if (res.ok && !data.error) privateAccessHash = data.contentHash || '';
  } catch (e) { /* 读取失败不阻断，保存时仍会做版本校验 */ }
}

export function renderPrivateAccess() {
  const container = $('#editorContainer');
  if (!container) return;
  container.innerHTML = `<div class="editor" style="max-width:640px"><div class="form-group"><label>管理员级文章密码</label><input id="fPrivatePassword" type="password" autocomplete="new-password" placeholder="输入新密码（至少 4 个字符）" /></div><button class="btn primary" id="btnPrivatePassword">保存密码</button><p style="color:var(--text-faint);font-size:11px;line-height:1.7;margin-top:12px">密码以 SHA-256 哈希保存。修改后需要重新构建并发布博客，线上私密文章页面才会使用新密码。</p></div>`;
  $('#btnPrivatePassword').onclick = savePrivateAccess;
  loadPrivateAccess();
}

export async function savePrivateAccess() {
  const password = $('#fPrivatePassword')?.value || '';
  if (password.length < 4) { toast('密码至少需要 4 个字符'); return; }
  try {
    const body = new URLSearchParams({ password, expectedHash: privateAccessHash });
    const res = await apiFetch(PRIVATE_ACCESS_API, { method: 'PUT', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (res.status === 409) { toast('密码已在其他位置被修改，请刷新后重试'); await loadPrivateAccess(); return; }
      toast(data.error || '保存失败');
      return;
    }
    privateAccessHash = data.contentHash || privateAccessHash;
    $('#fPrivatePassword').value = '';
    toast('私密文章密码已保存');
  } catch (e) { toast('保存失败: ' + e.message); }
}
