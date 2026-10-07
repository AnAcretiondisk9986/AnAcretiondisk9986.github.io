/**
 * 文章列表侧操作：批量操作、发布/撤回、归档、复制、预览与修订历史。
 * 通过 initPosts 注入文章状态与编辑器动作，避免循环依赖。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';
import { formatBytes } from '../util/format.js';
import { openModal, closeModal } from '../ui/modal.js';
import { slugifyTitle } from '../util/slug.js';

const API = '/api/posts';
let ctx = {
  getPosts: () => [], getSelection: () => new Set(), getCurrentSlug: () => null,
  isPostDirty: () => false, clearCurrentSlug: () => {}, loadPosts: async () => {},
  selectPost: async () => {}, resetEditor: () => {}, renderList: () => {},
};
const selection = () => ctx.getSelection();

export function initPosts(options = {}) { ctx = { ...ctx, ...options }; }
    function updateBatchBar() {
      const bar = $('#batchBar');
      if (!bar) return;
      bar.hidden = selection().size === 0;
      const count = $('#batchCount');
      if (count) count.textContent = `已选 ${selection().size} 项`;
    }

    async function batchAction(kind) {
      const slugs = [...selection()];
      if (!slugs.length) return;
      if (kind === 'clear') { selection().clear(); updateBatchBar(); ctx.renderList(); return; }
      const labels = { publish: '发布', unpublish: '撤回', archive: '归档', delete: '删除' };
      if (!confirm(`对选中的 ${slugs.length} 篇文章执行「${labels[kind]}」？`)) return;
      let ok = 0;
      let fail = 0;
      for (const slug of slugs) {
        try {
          if (kind === 'delete') {
            const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`, { method: 'DELETE' });
            if (res.ok) ok += 1; else fail += 1;
            continue;
          }
          const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
          const post = await res.json();
          if (!res.ok || post.error) { fail += 1; continue; }
          const overrides = kind === 'publish' ? { draft: false, archived: false, scheduledAt: '' }
            : kind === 'unpublish' ? { draft: true }
              : { archived: true };
          const done = await putPostFields(post, overrides, { silent: true });
          if (done) ok += 1; else fail += 1;
        } catch { fail += 1; }
      }
      if (kind === 'delete' && slugs.includes(ctx.getCurrentSlug())) { ctx.clearCurrentSlug(); ctx.resetEditor(); }
      selection().clear();
      await ctx.loadPosts();
      toast(`批量${labels[kind]}：成功 ${ok}${fail ? `，失败 ${fail}` : ''}`);
    }

    function setupBatchControls() {
      const bar = $('#batchBar');
      if (!bar) return;
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-batch]');
        if (btn) batchAction(btn.dataset.batch);
      });
    }

    // ── 修订历史 ──
    let historyState = null;

    async function showRevisionHistory(slug) {
      const mask = $('#historyModal');
      if (!mask) return;
      historyState = { slug, revisions: [], selected: null, current: '', currentHash: '' };
      $('#historyTitle').textContent = findPost(slug)?.title || slug;
      $('#historyList').textContent = '加载中…';
      $('#historyDiff').textContent = '选择左侧一个历史版本查看差异';
      $('#historyRestore').disabled = true;
      openModal(mask);
      try {
        const [revRes, postRes] = await Promise.all([
          apiFetch(`${API}/${encodeURIComponent(slug)}/revisions`),
          apiFetch(`${API}/${encodeURIComponent(slug)}`),
        ]);
        const revData = await revRes.json();
        const post = await postRes.json();
        if (!revRes.ok || revData.error) { $('#historyList').textContent = revData.error || '读取修订历史失败'; return; }
        historyState.revisions = revData.revisions || [];
        historyState.current = post.content || '';
        historyState.currentHash = post.contentHash || '';
        renderHistoryList();
      } catch (e) {
        $('#historyList').textContent = '读取失败：' + e.message;
      }
    }

    function renderHistoryList() {
      const el = $('#historyList');
      if (!historyState.revisions.length) { el.textContent = '暂无历史版本（首次保存后开始记录）'; return; }
      el.innerHTML = historyState.revisions.map((r) => `<div><button class="btn small" data-rev="${escAttr(r.id)}">${esc(new Date(r.savedAt).toLocaleString('zh-CN', { hour12: false }))}</button> <span style="color:var(--text-faint)">${formatBytes(r.size)}</span></div>`).join('');
      el.querySelectorAll('[data-rev]').forEach((btn) => { btn.onclick = () => loadRevisionDiff(btn.dataset.rev); });
    }

    async function loadRevisionDiff(id) {
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(historyState.slug)}/revisions/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '读取修订失败'); return; }
        historyState.selected = { id, content: data.content };
        $('#historyDiff').innerHTML = renderLineDiff(historyState.current, data.content);
        $('#historyRestore').disabled = false;
      } catch (e) { toast('读取修订失败: ' + e.message); }
    }

    /** 行级 LCS diff；行数过大时退化为「全部删除 + 全部新增」 */
    function renderLineDiff(currentText, oldText) {
      const a = String(oldText || '').split('\n');
      const b = String(currentText || '').split('\n');
      const n = a.length;
      const m = b.length;
      if (n * m > 400000) {
        return a.map((l) => `<div class="dl del">- ${esc(l)}</div>`).join('') + b.map((l) => `<div class="dl add">+ ${esc(l)}</div>`).join('');
      }
      const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      const out = [];
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { out.push(`<div class="dl same">  ${esc(a[i])}</div>`); i += 1; j += 1; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`<div class="dl del">- ${esc(a[i])}</div>`); i += 1; }
        else { out.push(`<div class="dl add">+ ${esc(b[j])}</div>`); j += 1; }
      }
      while (i < n) { out.push(`<div class="dl del">- ${esc(a[i])}</div>`); i += 1; }
      while (j < m) { out.push(`<div class="dl add">+ ${esc(b[j])}</div>`); j += 1; }
      return out.join('');
    }

    async function restoreRevision() {
      if (!historyState?.selected) return;
      if (!confirm('将该历史版本恢复为当前内容（会保存为一个新版本）？')) return;
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(historyState.slug)}`);
        const post = await res.json();
        if (!res.ok || post.error) { toast(post.error || '读取文章失败'); return; }
        const done = await putPostFields(post, { content: historyState.selected.content }, { silent: true });
        if (done) { toast('已恢复该历史版本'); closeModal($('#historyModal')); await ctx.loadPosts(); }
      } catch (e) { toast('恢复失败: ' + e.message); }
    }

    function findPost(slug) { return ctx.getPosts().find((p) => p.slug === slug); }

    function previewPostBySlug(slug) {
      const p = findPost(slug);
      if (!p) return;
      apiFetch(`${API}/${encodeURIComponent(slug)}`)
        .then((res) => res.json().then((post) => ({ res, post })))
        .then(({ res, post }) => {
          if (!res.ok || post.error) { toast(post.error || '读取文章失败'); return; }
          openPostPreview(post);
        })
        .catch((e) => toast('预览失败: ' + e.message));
    }

    // 本地预览由 Vditor.preview 渲染，无需保留实例

    function openPostPreview(post) {
      const mask = $('#previewModal');
      if (!mask) { if (post.publicUrl) window.open(post.publicUrl, '_blank'); return; }
      $('#previewTitle').textContent = post.title || post.slug;
      const meta = [post.pubDate || '', post.dayIndex ? `#${post.dayIndex}` : '', post.archived ? '已归档' : (post.draft ? '草稿' : '已发布'), post.access === 'admin' ? '管理员级' : post.access === 'authorized' ? '授权级' : '公开'].filter(Boolean);
      $('#previewMeta').textContent = meta.join(' · ');
      const link = $('#previewOpenLink');
      if (post.hasPublicPage && post.publicUrl) {
        link.style.display = '';
        link.onclick = () => window.open(post.publicUrl, '_blank');
      } else {
        link.style.display = 'none';
      }
      mask.style.display = 'flex';
      mask.setAttribute('role', 'dialog');
      mask.setAttribute('aria-modal', 'true');
      const el = $('#previewBody');
      el.innerHTML = '<div class="vditor-reset acr-site-preview"></div>';
      const target = el.firstElementChild;
      if (window.Vditor && Vditor.preview) {
        Vditor.preview(target, post.content || '', {
          cdn: '/admin/vendor/vditor',
          mode: 'dark',
          theme: { current: 'dark', path: '/admin/vendor/vditor/dist/css/content-theme' },
          hljs: { lineNumber: true, style: 'github-dark' },
          markdown: { toc: true },
        }).catch(() => { target.textContent = post.content || ''; });
      } else {
        target.textContent = post.content || '';
      }
    }

    function closePostPreview() {
      const mask = $('#previewModal');
      mask.style.display = 'none';
      mask.removeAttribute('aria-modal');
    }

    async function duplicatePost(slug) {
      const p = findPost(slug);
      if (!p) return;
      if (!confirm(`复制「${p.title || slug}」为一份新草稿？`)) return;
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
        const post = await res.json();
        if (!res.ok || post.error) { toast(post.error || '读取文章失败'); return; }
        let base = slugifyTitle(`${slug}-copy`) || 'copy';
        let newSlug = base;
        for (let i = 2; ctx.getPosts().some((x) => x.slug.toLowerCase() === newSlug.toLowerCase()); i += 1) newSlug = `${base}-${i}`;
        const fd = new URLSearchParams();
        fd.set('slug', newSlug);
        fd.set('title', `${post.title || slug}（副本）`);
        fd.set('description', post.description || '');
        fd.set('cover', post.cover || '');
        fd.set('pubDate', new Date().toISOString().split('T')[0]);
        fd.set('dayIndex', '');
        fd.set('tags', (post.tags || []).join(','));
        fd.set('draft', 'true');
        fd.set('archived', 'false');
        fd.set('scheduledAt', '');
        fd.set('access', post.access || 'public');
        fd.set('content', post.content || '');
        const put = await apiFetch(API, { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const data = await put.json();
        if (!put.ok || data.error) { toast(data.error || '复制失败'); return; }
        toast('已复制为新草稿：' + data.slug);
        await ctx.loadPosts();
        await ctx.selectPost(data.slug, { skipLeaveGuard: true });
      } catch (e) { toast('复制失败: ' + e.message); }
    }

    async function toggleArchive(slug) {
      const p = findPost(slug);
      if (!p) return;
      if (slug === ctx.getCurrentSlug() && ctx.isPostDirty()) { toast('该文章正在编辑且有未保存修改，请先保存后再归档'); return; }
      const nextArchived = !p.archived;
      if (!confirm(nextArchived ? `归档「${p.title || slug}」？归档后不再出现在公开列表，推送后线上生效。` : `取消归档「${p.title || slug}」？取消后重新公开，推送后线上生效。`)) return;
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
        const post = await res.json();
        if (!res.ok || post.error) { toast(post.error || '读取文章失败'); return; }
        const fd = new URLSearchParams();
        fd.set('title', post.title || '');
        fd.set('description', post.description || '');
        fd.set('cover', post.cover || '');
        fd.set('pubDate', post.pubDate || '');
        fd.set('dayIndex', post.dayIndex || '');
        fd.set('tags', (post.tags || []).join(','));
        fd.set('draft', post.draft ? 'true' : 'false');
        fd.set('archived', nextArchived ? 'true' : 'false');
        fd.set('access', post.access || 'public');
        fd.set('content', post.content || '');
        fd.set('expectedHash', post.contentHash);
        const put = await apiFetch(`${API}/${encodeURIComponent(slug)}`, { method: 'PUT', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const data = await put.json();
        if (!put.ok || data.error) { toast(data.error || '归档操作失败'); return; }
        toast(nextArchived ? '已归档（推送后线上生效）' : '已取消归档（推送后线上生效）');
        await ctx.loadPosts();
        if (slug === ctx.getCurrentSlug()) await ctx.selectPost(data.slug || slug, { skipLeaveGuard: true });
      } catch (e) { toast('归档操作失败: ' + e.message); }
    }

    async function copyPostLink(slug, kind) {
      const p = findPost(slug);
      if (!p) return;
      const url = kind === 'short' ? p.shortUrl : p.publicUrl;
      if (!url) { toast('该文章没有公开链接（草稿或管理员级）'); return; }
      try {
        await navigator.clipboard.writeText(url);
        toast(kind === 'short' ? `已复制短链：${url}` : `已复制公开链接：${url}`);
      } catch {
        toast(`复制失败，请手动复制：${url}`);
      }
    }

    async function quickToggleDraft(slug) {
      const p = findPost(slug);
      if (!p) return;
      if (slug === ctx.getCurrentSlug() && ctx.isPostDirty()) { toast('该文章正在编辑且有未保存修改，请先保存后再切换发布状态'); return; }
      const nextDraft = !p.draft;
      const label = p.title || slug;
      if (!confirm(nextDraft ? `将「${label}」转为草稿？线上页面会在推送后下架。` : `将「${label}」发布？推送后线上才会生效。`)) return;
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
        const post = await res.json();
        if (!res.ok || post.error) { toast(post.error || '读取文章失败'); return; }
        const fd = new URLSearchParams();
        fd.set('title', post.title || '');
        fd.set('description', post.description || '');
        fd.set('cover', post.cover || '');
        fd.set('pubDate', post.pubDate || '');
        fd.set('dayIndex', post.dayIndex || '');
        fd.set('tags', (post.tags || []).join(','));
        fd.set('draft', String(nextDraft));
        fd.set('archived', post.archived ? 'true' : 'false');
        fd.set('scheduledAt', nextDraft ? (post.scheduledAt || '') : '');
        fd.set('access', post.access || 'public');
        fd.set('content', post.content || '');
        fd.set('expectedHash', post.contentHash);
        const put = await apiFetch(`${API}/${encodeURIComponent(slug)}`, { method: 'PUT', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const data = await put.json();
        if (!put.ok || data.error) { toast(data.error || '切换发布状态失败'); return; }
        toast(nextDraft ? '已转为草稿（推送后线上生效）' : '已发布（推送后线上生效）');
        await ctx.loadPosts();
        if (slug === ctx.getCurrentSlug()) await ctx.selectPost(data.slug || slug, { skipLeaveGuard: true });
      } catch (e) {
        toast('切换发布状态失败: ' + e.message);
      }
    }


    async function putPostFields(post, overrides, { silent = false } = {}) {
      const merged = { ...post, ...overrides };
      const fd = new URLSearchParams();
      fd.set('title', merged.title || '');
      fd.set('description', merged.description || '');
      fd.set('cover', merged.cover || '');
      fd.set('pubDate', merged.pubDate || '');
      fd.set('dayIndex', merged.dayIndex || '');
      fd.set('tags', (merged.tags || []).join(','));
      fd.set('draft', merged.draft ? 'true' : 'false');
      fd.set('archived', merged.archived ? 'true' : 'false');
      fd.set('scheduledAt', merged.scheduledAt || '');
      fd.set('access', merged.access || 'public');
      fd.set('content', merged.content || '');
      fd.set('expectedHash', post.contentHash);
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(post.slug)}`, { method: 'PUT', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '更新文章失败'); return false; }
        if (!silent) toast(`已更新「${post.title || post.slug}」`);
        await ctx.loadPosts();
        return true;
      } catch (e) { toast('更新文章失败: ' + e.message); return false; }
    }
export {
  updateBatchBar, setupBatchControls, showRevisionHistory, previewPostBySlug,
  copyPostLink, duplicatePost, quickToggleDraft, toggleArchive, closePostPreview, putPostFields,
  restoreRevision,
};
