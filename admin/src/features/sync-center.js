/**
 * 发布中心：同步状态卡、推送/拉取预览与操作日志。
 * 通过 initSyncCenter 注入列表刷新与当前模块获取方式，避免与主模块循环依赖。
 */
import { $ , esc } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';
import { formatBytes } from '../util/format.js';
import { store } from '../state/store.js';
import { openModal, closeModal, isModalOpen } from '../ui/modal.js';

let ctx = { getMode: () => 'posts', reloadPosts: () => {}, reloadGallery: () => {} };

    const SYNC_STATE_LABELS = {
      unknown: '状态未知', clean: '工作区干净', dirty: '有未提交的修改',
      ahead: '有未推送的提交', behind: '远端有新的提交', diverged: '本地与远端已分叉',
      syncing: '同步中', 'sync-error': '同步检查失败',
    };
    const FILE_STATUS_LABELS = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', untracked: '未跟踪', conflicted: '冲突', 'type-changed': '类型变更' };
    let syncStatusCache = null;
    let syncBusy = false;

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
      if (cur.autoPull) bits.push('自动拉取已开启');
      $('#syncMeta').innerHTML = bits.map(b => `<b>${esc(b)}</b>`).join(' · ');
    }

    async function refreshSyncStatus({ fetchRemote = false, silent = false } = {}) {
      try {
        const res = await apiFetch(`/api/sync/status${fetchRemote ? '?fetch=1' : ''}`);
        const data = await res.json();
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
      }
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
        return `<div><span${cls}>[${st}]</span> ${esc(time)} ${esc(op.message || op.action)}${op.requestId ? ` <span style="color:#55555c">#${esc(op.requestId)}</span>` : ''}</div>`;
      }).join('')}</div>`;
    }

    function renderPreviewFiles(preview) {
      if (!preview || !preview.fileCount) return '<div class="sync-ok">没有需要提交的文件</div>';
      const rows = preview.files.map(f => {
        const stat = (f.additions || f.deletions) ? ` <span class="add">+${f.additions || 0}</span> <span class="del">-${f.deletions || 0}</span>` : '';
        return `<div><span class="st">[${FILE_STATUS_LABELS[f.status] || f.status}]</span> ${esc(f.path)}${stat}</div>`;
      }).join('');
      return `<div class="sync-file-list">${rows}</div><div style="color:#6a6a70;font-size:10px">共 ${preview.fileCount} 个文件，+${preview.insertions} / -${preview.deletions}${preview.binary ? `，${preview.binary} 个二进制文件` : ''}</div>`;
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

    function showSyncError(title, detail, retry) {
      $('#syncModalBody').innerHTML = `
        <div class="sync-section">
          <h4>⚠ ${esc(title)}</h4>
          <div class="sync-err">${esc(detail || '未知错误')}</div>
        </div>`;
      setSyncActions([
        { label: '返回', onClick: openSyncCenter },
        { label: '复制错误', onClick: () => copySyncText(detail || '') },
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

    async function openSyncCenter() {
      openSyncModal();
      $('#syncModalTitle').textContent = '◈ 发布中心';
      $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在读取同步状态…</h4></div>';
      setSyncActions([{ label: '关闭', onClick: closeSyncModal }]);
      const [status, ops, health] = await Promise.all([
        refreshSyncStatus({ fetchRemote: true, silent: true }),
        loadOperations(),
        fetchHealth(),
      ]);
      const st = status || syncStatusCache || { state: 'sync-error' };
      const problem = (status && status.ok === false && status.error) || st.fetchError || (!status && st.error);
      const limits = health?.limits;
      const limitsHtml = limits ? `
        <div class="sync-section">
          <h4>⚙ 运行限制</h4>
          <div style="color:#8a8a90;font-size:11px;line-height:1.9">
            本地上传 ≤ ${formatBytes(limits.uploadMaxBytes)} · 远程下载 ≤ ${formatBytes(limits.remoteMaxBytes)}
            · Git 超时 ${Math.round(limits.gitTimeoutMs / 1000)}s · 抓取超时 ${Math.round(limits.remoteFetchTimeoutMs / 1000)}s · 并发上传 ${limits.uploadConcurrency}
          </div>
        </div>` : '';
      $('#syncModalBody').innerHTML = `
        <div class="sync-section">
          <h4>◐ 工作区状态：${esc(st.stateLabel || SYNC_STATE_LABELS[st.state] || st.state || '未知')}</h4>
          <div style="color:#9a9aa0;font-size:11px;line-height:1.8">
            分支 <b style="color:#c8b080">${esc(st.branch || '未知')}</b>
            ${st.hasUpstream ? `· 远端 <b style="color:#c8b080">${esc(st.upstream || '')}</b> · 领先 ${st.ahead || 0} / 落后 ${st.behind || 0}` : '· 未设置远端跟踪分支'}
            · 待提交文件 <b style="color:#c8b080">${st.dirtyCount ?? 0}</b>
          </div>
          ${problem ? `<div class="sync-err">${esc(String(problem))}</div>` : ''}
        </div>
        <div class="sync-section">
          <h4>◈ 发布操作</h4>
          <div style="color:#8a8a90;font-size:11px;line-height:1.8">推送前会先展示将要提交的文件；拉取只会快进合并，工作区有未提交改动时会跳过。</div>
        </div>
        <div class="sync-section">
          <h4>◷ 最近操作</h4>
          ${renderOperations(ops)}
        </div>
        ${limitsHtml}`;
      setSyncActions([
        { label: '⇩ 拉取远端', onClick: previewPullAction },
        { label: '⬆ 内容推送', primary: true, onClick: () => previewPushAction('content') },
        { label: '⬆ 全量推送', onClick: () => previewPushAction('full') },
        { label: '关闭', onClick: closeSyncModal },
      ]);
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
          : (data.behind > 0 ? `<div class="sync-err">当前分支落后远端 ${data.behind} 个提交，建议先拉取再推送（否则可能被拒绝）。</div>` : '');
        $('#syncModalBody').innerHTML = `
          <div class="sync-section">
            <h4>◈ ${esc(data.kindLabel)}：将提交以下文件</h4>
            ${renderPreviewFiles(data.preview)}
            ${remoteWarn}
          </div>
          <div class="sync-section">
            <h4>◷ 最近操作</h4>
            ${renderOperations(await loadOperations())}
          </div>`;
        setSyncActions([
          { label: '取消', onClick: openSyncCenter },
          { label: '复制文件清单', onClick: () => copySyncText((data.preview.files || []).map(f => `${f.status}\t${f.path}`).join('\n')) },
          { label: data.preview.fileCount ? `确认推送（${data.preview.fileCount} 个文件）` : '确认推送', primary: true, disabled: !data.preview.fileCount, onClick: () => runSyncPush(kind) },
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
        const dirtyWarn = data.dirtyCount ? `<div class="sync-err">本地有 ${data.dirtyCount} 个未提交改动，拉取将被跳过以避免覆盖。</div>` : '';
        const divergeWarn = data.ahead > 0 && data.behind > 0 ? `<div class="sync-err">本地与远端已分叉（领先 ${data.ahead}），拉取会被跳过，请先手动处理分叉。</div>` : '';
        $('#syncModalBody').innerHTML = `
          <div class="sync-section">
            <h4>⇩ 远端待拉取：${data.behind || 0} 个提交${data.ahead ? `（本地领先 ${data.ahead}）` : ''}</h4>
            ${commits}
            ${dirtyWarn}
            ${divergeWarn}
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
      $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在提交并推送，请稍候…</h4></div>';
      setSyncActions([]);
      const btn = kind === 'full' ? $('#btnPushFull') : $('#btnPush');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ 推送中...';
      try {
        const res = await apiFetch(kind === 'full' ? '/api/push-full' : '/api/push', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.success === false || data.ok === false) throw new Error(data.error || data.detail || '推送失败');
        toast(data.message || '推送完成');
        const warn = data.imageRepoWarning ? `<div class="sync-err">图片仓库：${esc(data.imageRepoWarning)}</div>` : '';
        $('#syncModalBody').innerHTML = `
          <div class="sync-section">
            <h4>✔ ${esc(data.message || '推送完成')}</h4>
            ${data.preview ? renderPreviewFiles(data.preview) : ''}
            ${warn}
            ${data.requestId ? `<div style="color:#55555c;font-size:10px">requestId #${esc(data.requestId)}</div>` : ''}
          </div>`;
        setSyncActions([
          { label: '返回', onClick: openSyncCenter },
          { label: '关闭', primary: true, onClick: () => { syncBusy = false; closeSyncModal(); } },
        ]);
        await refreshSyncStatus({ silent: true });
      } catch (e) {
        toast('推送失败: ' + e.message);
        showSyncError('推送失败', e.message, () => { syncBusy = false; runSyncPush(kind); });
      } finally {
        btn.textContent = original;
        btn.disabled = false;
        syncBusy = false;
      }
    }

    async function runSyncPull() {
      if (syncBusy) return;
      syncBusy = true;
      $('#syncModalTitle').textContent = '◈ 拉取中…';
      $('#syncModalBody').innerHTML = '<div class="sync-section"><h4>正在从远端拉取…</h4></div>';
      setSyncActions([]);
      const btn = $('#btnPull');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ 拉取中...';
      try {
        const res = await apiFetch('/api/pull', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.success === false || data.ok === false) throw new Error(data.error || data.detail || '拉取失败');
        toast(data.message || '拉取完成');
        const cls = data.status === 'pulled' ? 'sync-ok' : 'sync-warn';
        $('#syncModalBody').innerHTML = `
          <div class="sync-section">
            <h4>⇩ 拉取结果</h4>
            <div class="${cls}">${esc(data.message || '')}</div>
            ${data.requestId ? `<div style="color:#55555c;font-size:10px">requestId #${esc(data.requestId)}</div>` : ''}
          </div>`;
        setSyncActions([
          { label: '返回', onClick: openSyncCenter },
          { label: '关闭', primary: true, onClick: () => { syncBusy = false; closeSyncModal(); } },
        ]);
        await refreshSyncStatus({ silent: true });
        if (data.status === 'pulled') {
          if (ctx.getMode() === 'gallery') ctx.reloadGallery();
          else if (ctx.getMode() === 'posts') ctx.reloadPosts();
        }
      } catch (e) {
        toast('拉取失败: ' + e.message);
        showSyncError('拉取失败', e.message, () => { syncBusy = false; runSyncPull(); });
      } finally {
        btn.textContent = original;
        btn.disabled = false;
        syncBusy = false;
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
  setInterval(() => { if (!syncBusy && $('#syncModal') && $('#syncModal').style.display === 'none') refreshSyncStatus({ silent: true }); }, 60000);
}

export function isSyncModalOpen() { return isModalOpen($('#syncModal')); }
export { closeSyncModal };
