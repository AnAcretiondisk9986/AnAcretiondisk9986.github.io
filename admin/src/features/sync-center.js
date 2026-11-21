/**
 * 发布中心：同步状态卡、推送/拉取预览、冲突展示与操作日志。
 * 通过 initSyncCenter 注入列表刷新与当前模块获取方式，避免与主模块循环依赖。
 */
import { $, esc } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';
import { formatBytes } from '../util/format.js';
import { store } from '../state/store.js';
import { openModal, closeModal, isModalOpen } from '../ui/modal.js';

// fetchHealth 由主模块注入：它持有管理口令校验逻辑（/api/health），
// 此处直接调用会因 ES Module 作用域隔离而抛 ReferenceError（发布中心总览曾因此打不开）。
let ctx = {
  getMode: () => 'posts',
  reloadPosts: () => {},
  reloadDaily: () => {},
  reloadGallery: () => {},
  reloadAbout: () => {},
  reloadFrontend: () => {},
  reloadSchedule: () => {},
  fetchHealth: async () => null,
};

const SYNC_STATE_LABELS = {
  unknown: '状态未知', clean: '工作区干净', dirty: '有未提交的修改',
  ahead: '有未推送的提交', behind: '远端有新的提交', diverged: '本地与远端已分叉',
  syncing: '同步中', 'sync-error': '同步检查失败',
};
const FILE_STATUS_LABELS = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', untracked: '未跟踪', conflicted: '冲突', 'type-changed': '类型变更' };
let syncStatusCache = null;
let syncBusy = false;
let syncStatusInFlight = null;
let lastSyncCheckAt = 0;

function reloadActiveModule() {
  const mode = ctx.getMode();
  if (mode === 'gallery') ctx.reloadGallery();
  else if (mode === 'daily') ctx.reloadDaily();
  else if (mode === 'about') ctx.reloadAbout();
  else if (mode === 'frontend') ctx.reloadFrontend();
  else if (mode === 'schedule') ctx.reloadSchedule();
  else if (mode === 'posts') ctx.reloadPosts();
}

function renderSyncCard(status) {
  if (status) { syncStatusCache = status; store.set({ syncStatus: status }); }
  const cur = syncStatusCache || { state: 'unknown' };
  const dot = $('#syncDot');
  if (!dot) return;
  dot.dataset.state = cur.state || 'unknown';
  $('#syncState').textContent = cur.stateLabel || SYNC_STATE_LABELS[cur.state] || '状态未知';
  const bits = [];
  if (cur.branch) bits.push(`分支 ${cur.branch}`);
  if (cur.hasUpstream) {
    if (cur.ahead) bits.push(`领先 ${cur.ahead}`);
    if (cur.behind) bits.push(`落后 ${cur.behind}`);
    if (!cur.ahead && !cur.behind) bits.push('与远端一致');
  } else if (cur.branch) {
    bits.push('未设置远端跟踪');
  }
  bits.push(`待提交 ${cur.dirtyCount ?? 0}`);
  if (cur.autoPull) bits.push('自动同步已开启');
  $('#syncMeta').innerHTML = bits.map(b => `<b>${esc(b)}</b>`).join(' · ');

  const pushBtn = $('#btnPush');
  if (pushBtn && !syncBusy) {
    const pending = (cur.dirtyCount || 0) + (cur.ahead || 0);
    pushBtn.innerHTML = pending > 0 ? `发布<span class="btn-badge">${pending}</span>` : '发布';
  }
}

async function refreshSyncStatus({ fetchRemote = false, silent = false } = {}) {
  if (syncStatusInFlight && !fetchRemote) return syncStatusInFlight;
  const run = (async () => {
    const refreshBtn = $('#btnSyncRefresh');
    if (fetchRemote && refreshBtn) refreshBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/sync/status${fetchRemote ? '?fetch=1' : ''}`);
      const data = await res.json();
      lastSyncCheckAt = Date.now();
      renderSyncCard(data);
      if (!res.ok) {
        if (!silent) toast(data.error || '同步状态检查失败');
        return data;
      }
      if (data.fetchError && !silent) toast('远端检查失败：' + data.fetchError);
      return data;
    } catch (e) {
      renderSyncCard({ state: 'sync-error', stateLabel: '同步检查失败', error: e.message });
      if (!silent) toast('同步状态检查失败: ' + e.message);
      return null;
    } finally {
      if (fetchRemote && refreshBtn) refreshBtn.disabled = false;
    }
  })();
  if (!fetchRemote) {
    syncStatusInFlight = run.finally(() => { syncStatusInFlight = null; });
    return syncStatusInFlight;
  }
  return run;
}

async function loadOperations(limit = 12) {
  try {
    const res = await apiFetch(`/api/operations?limit=${limit}`);
    const data = await res.json();
    return data.operations || [];
  } catch { return []; }
}

function renderOperations(ops) {
  if (!ops || !ops.length) return '<div class="sync-ops">暂无操作记录</div>';
  return `<div class="sync-ops">${ops.map(op => {
    const time = new Date(op.time).toLocaleString('zh-CN', { hour12: false });
    const cls = op.status === 'error' ? ' class="bad"' : '';
    const st = op.status === 'error' ? '失败' : op.status === 'skipped' ? '跳过' : '成功';
    return `<div><span${cls}>[${st}]</span> ${esc(time)} ${esc(op.message || op.action)}${op.requestId ? ` <span style="color:var(--text-faint)">#${esc(op.requestId)}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

function renderPreviewFiles(preview, { ahead = 0 } = {}) {
  if (!preview || !preview.fileCount) {
    if (ahead > 0) {
      return `<div class="sync-ok">工作区无新增待提交文件，本地已有 ${ahead} 个待推送提交可直接推送到远端。</div>`;
    }
    return '<div class="sync-ok">没有需要提交的文件</div>';
  }
  const rows = preview.files.map(f => {
    const stat = (f.additions || f.deletions) ? ` <span class="add">+${f.additions || 0}</span> <span class="del">-${f.deletions || 0}</span>` : '';
    return `<div><span class="st">[${FILE_STATUS_LABELS[f.status] || f.status}]</span> ${esc(f.path)}${stat}</div>`;
  }).join('');
  return `<div class="sync-file-list">${rows}</div><div style="color:var(--text-faint);font-size:10px">共 ${preview.fileCount} 个文件，+${preview.insertions} / -${preview.deletions}${preview.binary ? `，${preview.binary} 个二进制文件` : ''}</div>`;
}

function renderConflictList(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return '';
  return `
    <div style="margin-top:8px">
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:4px">冲突文件清单（本地改动已安全保留，未被覆盖）：</div>
      <div class="sync-file-list">${conflicts.map(f => `<div><span class="st">[冲突]</span> ${esc(f)}</div>`).join('')}</div>
    </div>`;
}

function openSyncModal() {
  openModal($('#syncModal'));
}
function closeSyncModal() {
  if (syncBusy) return;
  closeModal($('#syncModal'));
}

function setSyncActions(buttons) {
  const wrap = $('#syncModalActions');
  wrap.innerHTML = '';
  buttons.forEach(cfg => {
    const el = document.createElement('button');
    el.className = 'btn' + (cfg.primary ? ' primary' : '') + (cfg.danger ? ' danger' : '');
    el.textContent = cfg.label;
    el.disabled = Boolean(cfg.disabled);
    el.onclick = cfg.onClick;
    wrap.appendChild(el);
  });
}

function showSyncError(title, detail, retry, { conflicts = [], requestId = '' } = {}) {
  const conflictHtml = renderConflictList(conflicts);
  const copyPayload = conflicts.length ? `${detail || ''}\n冲突文件：\n${conflicts.join('\n')}` : (detail || '');
  $('#syncModalBody').innerHTML = `
    <div class="sync-section">
      <h4>⚠ ${esc(title)}</h4>
      <div class="sync-err">${esc(detail || '未知错误')}</div>
      ${conflictHtml}
      ${requestId ? `<div style="color:var(--text-faint);font-size:10px;margin-top:6px">requestId #${esc(requestId)}</div>` : ''}
    </div>`;
  setSyncActions([
    { label: '返回', onClick: openSyncCenter },
    { label: conflicts.length ? '复制冲突清单' : '复制错误', onClick: () => copySyncText(copyPayload) },
    ...(retry ? [{ label: '重试', primary: true, onClick: retry }] : []),
  ]);
}

async function copySyncText(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''));
    toast('已复制');
  } catch {
    toast('复制失败，请手动选择文本');
  }
}

/** 渲染发布中心总览。st 可先用缓存状态，remotePending 表示远端仍在后台核对 */
function renderSyncCenterBody(st, ops, health, { remotePending = false } = {}) {
  st = st || { state: 'sync-error' };
  const problem = st.fetchError || (st.ok === false ? st.error : '') || st.error || '';
  const limits = health?.limits;
  const limitsHtml = limits ? `
    <div class="sync-section">
      <h4>⚙ 运行限制</h4>
      <div style="color:var(--text-dim);font-size:11px;line-height:1.9">
        本地上传 ≤ ${formatBytes(limits.uploadMaxBytes)} · 远程下载 ≤ ${formatBytes(limits.remoteMaxBytes)}
        · Git 超时 ${Math.round(limits.gitTimeoutMs / 1000)}s · 抓取超时 ${Math.round(limits.remoteFetchTimeoutMs / 1000)}s · 并发上传 ${limits.uploadConcurrency}
      </div>
    </div>` : '';
  $('#syncModalBody').innerHTML = `
    <div class="sync-section">
      <h4>◐ 工作区状态：${esc(st.stateLabel || SYNC_STATE_LABELS[st.state] || st.state || '未知')}${remotePending ? ' <span style="color:var(--text-faint);font-weight:400">· 正在核对远端…</span>' : ''}</h4>
      <div style="color:var(--text-dim);font-size:11px;line-height:1.8">
        分支 <b style="color:var(--accent)">${esc(st.branch || '未知')}</b>
        ${st.hasUpstream ? `· 远端 <b style="color:var(--accent)">${esc(st.upstream || '')}</b> · 领先 ${st.ahead || 0} / 落后 ${st.behind || 0}` : '· 未设置远端跟踪分支'}
        · 待提交文件 <b style="color:var(--accent)">${st.dirtyCount ?? 0}</b>
      </div>
      ${problem ? `<div class="sync-err">${esc(String(problem))}</div>` : ''}
    </div>
    <div class="sync-section">
      <h4>◈ 发布操作</h4>
      <div style="color:var(--text-dim);font-size:11px;line-height:1.8">拉取与推送均支持多设备智能同步：自动保护本地未提交改动、自动变基并对 daily.json / gallery.json 按条目 ID 无损合并；遇真实冲突会自动回滚保护本地文件。</div>
    </div>
    <div class="sync-section">
      <h4>◷ 最近操作</h4>
      ${renderOperations(ops)}
    </div>
    ${limitsHtml}`;
}

async function openSyncCenter() {
  openSyncModal();
  $('#syncModalTitle').textContent = '◈ 发布中心';
  setSyncActions([
    { label: '⇩ 拉取远端', onClick: previewPullAction },
    { label: '⬆ 内容推送', primary: true, onClick: () => previewPushAction('content') },
    { label: '⬆ 全量推送', onClick: () => previewPushAction('full') },
    { label: '关闭', onClick: closeSyncModal },
  ]);

  // 先用已有缓存 / 本地状态立刻渲染：核对远端要跑 git fetch，实测约 4.6s，
  // 不该让「打开发布中心」卡在网络上（本地状态与操作日志本就够用）。
  const [ops, health] = await Promise.all([loadOperations(), ctx.fetchHealth()]);
  if (!isModalOpen($('#syncModal'))) return;
  renderSyncCenterBody(syncStatusCache, ops, health, { remotePending: true });

  // 远端结果回来后原地更新，不打断阅读
  const status = await refreshSyncStatus({ fetchRemote: true, silent: true });
  if (isModalOpen($('#syncModal'))) {
    renderSyncCenterBody(status || syncStatusCache, ops, health, { remotePending: false });
  }
}

async function previewPushAction(kind) {
  if (syncBusy) return;
  openSyncModal();
  $('#syncModalTitle').textContent = kind === 'full' ? '◈ 全量推送预览' : '◈ 内容推送预览';
  $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在统计待提交文件…</h4></div>';
  setSyncActions([{ label: '返回', onClick: openSyncCenter }]);
  try {
    // 先刷新远端引用，预览中才能准确提示「是否落后远端」
    await refreshSyncStatus({ fetchRemote: true, silent: true });
    const res = await apiFetch(`/api/sync/preview?kind=${kind}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '读取推送预览失败');
    const remoteWarn = !data.hasUpstream
      ? '<div class="sync-warn">当前分支还没有远端跟踪分支，推送时会自动创建并推送。</div>'
      : (data.behind > 0 ? `<div class="sync-warn">远端有 ${data.behind} 个新提交，确认推送时将自动同步变基（保护其余本地改动，并对 daily / gallery 自动按 ID 合并）后再推送。</div>` : '');
    const canPush = Boolean(data.preview.fileCount) || (data.ahead || 0) > 0;
    const confirmLabel = data.preview.fileCount
      ? `确认推送（${data.preview.fileCount} 个文件）`
      : (data.ahead > 0 ? `确认推送（${data.ahead} 个待推提交）` : '确认推送');
    $('#syncModalBody').innerHTML = `
      <div class="sync-section">
        <h4>◈ ${esc(data.kindLabel)}：将提交以下文件</h4>
        ${renderPreviewFiles(data.preview, { ahead: data.ahead || 0 })}
        ${remoteWarn}
      </div>
      <div class="sync-section">
        <h4>◷ 最近操作</h4>
        ${renderOperations(await loadOperations())}
      </div>`;
    setSyncActions([
      { label: '取消', onClick: openSyncCenter },
      { label: '复制文件清单', onClick: () => copySyncText((data.preview.files || []).map(f => `${f.status}\t${f.path}`).join('\n')) },
      { label: confirmLabel, primary: true, disabled: !canPush, onClick: () => runSyncPush(kind) },
    ]);
  } catch (e) {
    showSyncError('推送预览失败', e.message, () => previewPushAction(kind));
  }
}

async function previewPullAction() {
  if (syncBusy) return;
  openSyncModal();
  $('#syncModalTitle').textContent = '◈ 拉取预览';
  $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在统计远端提交…</h4></div>';
  setSyncActions([{ label: '返回', onClick: openSyncCenter }]);
  try {
    // 先刷新远端引用，保证预览到的是最新提交（只读，不合并）
    await refreshSyncStatus({ fetchRemote: true, silent: true });
    const res = await apiFetch('/api/sync/pull-preview');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '读取拉取预览失败');
    const commits = data.commits && data.commits.length
      ? `<div class="sync-file-list">${data.commits.map(c => `<div>${esc(c)}</div>`).join('')}</div>`
      : '<div class="sync-ok">本地已是远端最新版本</div>';

    const riskyOverlaps = Array.isArray(data.riskyOverlapFiles) ? data.riskyOverlapFiles : [];
    const autoMergeOverlaps = Array.isArray(data.autoMergeableFiles) ? data.autoMergeableFiles : [];

    let dirtyHint = '';
    if (data.behind > 0 && data.dirtyCount > 0) {
      if (riskyOverlaps.length > 0) {
        dirtyHint = `<div class="sync-err">注意：以下文件本地与远端均有修改（${esc(riskyOverlaps.join('、'))}），若存在同位置冲突，拉取会自动回滚以保护你的本地改动。</div>`;
      } else if (autoMergeOverlaps.length > 0) {
        dirtyHint = `<div class="sync-ok">本地有 ${data.dirtyCount} 个未提交改动；两端均改动的 ${esc(autoMergeOverlaps.join('、'))} 将按条目 ID 自动合并，其余改动自动暂存并在拉取后还原。</div>`;
      } else {
        dirtyHint = `<div class="sync-ok">本地有 ${data.dirtyCount} 个未提交改动，与远端无文件重叠，拉取时将自动暂存并在同步后完整还原。</div>`;
      }
    }
    const divergeHint = data.ahead > 0 && data.behind > 0
      ? `<div class="sync-warn">本地领先 ${data.ahead} 个提交、远端领先 ${data.behind} 个提交，拉取时将自动变基整合（遇真实冲突会自动回滚保护本地提交）。</div>`
      : '';

    $('#syncModalBody').innerHTML = `
      <div class="sync-section">
        <h4>⇩ 远端待拉取：${data.behind || 0} 个提交${data.ahead ? `（本地领先 ${data.ahead}）` : ''}</h4>
        ${commits}
        ${dirtyHint}
        ${divergeHint}
      </div>`;
    setSyncActions([
      { label: '取消', onClick: openSyncCenter },
      { label: '复制提交清单', onClick: () => copySyncText((data.commits || []).join('\n')) },
      { label: '确认拉取', primary: true, onClick: runSyncPull },
    ]);
  } catch (e) {
    showSyncError('拉取预览失败', e.message, previewPullAction);
  }
}

async function runSyncPush(kind) {
  if (syncBusy) return;
  syncBusy = true;
  $('#syncModalTitle').textContent = kind === 'full' ? '◈ 全量推送中…' : '◈ 内容推送中…';
  $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在提交并同步推送，请稍候…</h4></div>';
  setSyncActions([]);
  const btn = kind === 'full' ? $('#btnPushFull') : $('#btnPush');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 推送中...';
  try {
    const res = await apiFetch(kind === 'full' ? '/api/push-full' : '/api/push', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.success === false || data.ok === false) {
      const err = new Error(data.error || data.detail || '推送失败');
      err.conflicts = data.conflicts || [];
      err.requestId = data.requestId || '';
      throw err;
    }
    toast(data.message || '推送完成');
    const warn = data.imageRepoWarning ? `<div class="sync-err">图片仓库：${esc(data.imageRepoWarning)}</div>` : '';
    const autoMergedHtml = Array.isArray(data.autoMergedFiles) && data.autoMergedFiles.length
      ? `<div class="sync-ok">已按条目 ID 自动合并：${esc(data.autoMergedFiles.join('、'))}</div>`
      : '';
    $('#syncModalBody').innerHTML = `
      <div class="sync-section">
        <h4>✔ ${esc(data.message || '推送完成')}</h4>
        ${data.preview ? renderPreviewFiles(data.preview) : ''}
        ${autoMergedHtml}
        ${warn}
        ${data.requestId ? `<div style="color:var(--text-faint);font-size:10px">requestId #${esc(data.requestId)}</div>` : ''}
      </div>`;
    setSyncActions([
      { label: '返回', onClick: openSyncCenter },
      { label: '关闭', primary: true, onClick: () => { syncBusy = false; closeSyncModal(); } },
    ]);
    await refreshSyncStatus({ silent: true });
    if (data.syncedRemote) reloadActiveModule();
  } catch (e) {
    toast('推送失败: ' + e.message);
    showSyncError(
      e.conflicts?.length ? '推送前自动同步遇冲突（已安全回滚）' : '推送失败',
      e.message,
      () => { syncBusy = false; runSyncPush(kind); },
      { conflicts: e.conflicts || [], requestId: e.requestId || '' },
    );
  } finally {
    btn.textContent = original;
    btn.disabled = false;
    syncBusy = false;
    renderSyncCard();
  }
}

async function runSyncPull() {
  if (syncBusy) return;
  syncBusy = true;
  $('#syncModalTitle').textContent = '◈ 拉取中…';
  $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在从远端智能同步…</h4></div>';
  setSyncActions([]);
  const btn = $('#btnPull');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 拉取中...';
  try {
    const res = await apiFetch('/api/pull', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.success === false || data.ok === false) {
      const err = new Error(data.error || data.message || data.detail || '拉取失败');
      err.conflicts = data.conflicts || [];
      err.requestId = data.requestId || '';
      throw err;
    }
    toast(data.message || '拉取完成');
    const cls = data.status === 'pulled' || data.status === 'up-to-date' ? 'sync-ok' : 'sync-warn';
    const autoMergedHtml = Array.isArray(data.autoMergedFiles) && data.autoMergedFiles.length
      ? `<div class="sync-ok" style="margin-top:6px">已按条目 ID 自动合并：${esc(data.autoMergedFiles.join('、'))}</div>`
      : '';
    $('#syncModalBody').innerHTML = `
      <div class="sync-section">
        <h4>⇩ 拉取结果</h4>
        <div class="${cls}">${esc(data.message || '')}</div>
        ${autoMergedHtml}
        ${data.requestId ? `<div style="color:var(--text-faint);font-size:10px">requestId #${esc(data.requestId)}</div>` : ''}
      </div>`;
    setSyncActions([
      { label: '返回', onClick: openSyncCenter },
      { label: '关闭', primary: true, onClick: () => { syncBusy = false; closeSyncModal(); } },
    ]);
    await refreshSyncStatus({ silent: true });
    if (data.status === 'pulled') {
      reloadActiveModule();
    }
  } catch (e) {
    toast('拉取失败: ' + e.message);
    showSyncError(
      e.conflicts?.length ? '拉取遇文件冲突（已自动回滚）' : '拉取失败',
      e.message,
      () => { syncBusy = false; runSyncPull(); },
      { conflicts: e.conflicts || [], requestId: e.requestId || '' },
    );
  } finally {
    btn.textContent = original;
    btn.disabled = false;
    syncBusy = false;
    renderSyncCard();
  }
}

// ═══════════════════════════════════════

/** 初始化发布中心：绑定按钮、首次状态检查与定时刷新 */
export function initSyncCenter(options = {}) {
  ctx = { ...ctx, ...options };
  const bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  bind('#btnPull', previewPullAction);
  bind('#btnPush', () => previewPushAction('content'));
  bind('#btnPushFull', () => previewPushAction('full'));
  bind('#syncState', openSyncCenter);
  bind('#btnSyncRefresh', (e) => { e.stopPropagation(); refreshSyncStatus({ fetchRemote: true }); });
  bind('#syncCard', (e) => { if (!e.target.closest('button')) openSyncCenter(); });
  const modal = $('#syncModal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeSyncModal(); });
  refreshSyncStatus({ silent: true });
  setInterval(() => {
    if (!document.hidden && !syncBusy && $('#syncModal') && $('#syncModal').style.display === 'none') {
      refreshSyncStatus({ silent: true });
    }
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !syncBusy && Date.now() - lastSyncCheckAt > 45000) {
      refreshSyncStatus({ silent: true });
    }
  });
}

export function isSyncModalOpen() { return isModalOpen($('#syncModal')); }
export { closeSyncModal, refreshSyncStatus };
