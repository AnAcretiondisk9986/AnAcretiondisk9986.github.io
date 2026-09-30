
    import { $, esc, escAttr } from './ui/dom.js';
    import { toast } from './ui/app-toast.js';
    import { apiFetch, apiJson, getToken, setToken } from './api/app-client.js';
    import { formatBytes } from './util/format.js';
    import { store } from './state/store.js';
    import { openModal, closeModal, isModalOpen, installFocusTrap } from './ui/modal.js';
    import { runPreflight } from './features/preflight.js';
    import { renderPrivateAccess, savePrivateAccess } from './features/access.js';
    import { renderGuestbookList, loadGuestbookComments, clearCredentials } from './features/guestbook.js';
    import { initSyncCenter, closeSyncModal, isSyncModalOpen, refreshSyncStatus } from './features/sync-center.js';
    import { initAbout, renderAboutList, loadAbout, saveAbout, refreshAvatarPreview } from './features/about.js';
    import { initFrontend, renderFrontendList, loadFrontend, saveFrontend, syncFrontendPreview } from './features/frontend.js';
    import { initGallery, loadGallery, newGalleryItem, saveGalleryItem, deleteGalleryItem, getCurrentGalleryId, resetGallerySelection } from './features/gallery.js';
    import { initMedia, loadMedia, renderMediaSidebar, triggerMediaUpload, openMediaPicker, closeMediaPicker, setupMediaPicker, setupCoverMediaButton, setupMediaInsertButton, setupGalleryMediaButton } from './features/media.js';

    const API = '/api/posts';
    let currentSlug = null, posts = [];
    let currentMode = 'posts';
    let currentPostHash = '';
    // 文章列表：搜索 / 筛选 / 排序 / 视图偏好（本地持久化）
    const LIST_PREFS_KEY = 'admin-list-prefs';
    const LIST_PREF_DEFAULTS = { q: '', status: '', access: '', tag: '', from: '', to: '', sort: 'date-desc', view: 'compact', filtersOpen: false };
    let listPrefs = { ...LIST_PREF_DEFAULTS };
    try { Object.assign(listPrefs, JSON.parse(localStorage.getItem(LIST_PREFS_KEY) || '{}')); } catch { /* 忽略损坏的本地偏好 */ }
    function saveListPrefs() { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)); } catch { /* 忽略写入失败 */ } }
    // 批量操作选中的文章 slug
    const selectedSlugs = new Set();
    let postDraftKey = null;
    let postBaselineSnapshot = '';
    let postDirty = false;
    let postHydrating = false;
    let postDraftTimer = null;
    let postDraftStorageWarned = false;
    let postSaving = false;
    const POST_DRAFT_PREFIX = 'admin-post-draft:';
    let frontendUploadField = 'fStillHeroImage';
    let postUploadTarget = 'content';

    async function loadPosts() {
      try {
        const res = await apiFetch(API);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          renderListError(data.error || `加载失败（HTTP ${res.status}）`);
          return;
        }
        posts = await res.json();
        if (!Array.isArray(posts)) { renderListError('返回数据格式不正确'); return; }
        refreshTagOptions();
        renderList();
      } catch(e) { renderListError(e.message); }
    }

    /** 列表加载失败：统一的 error + retry 视图 */
    function renderListError(message) {
      const el = $('#postList');
      if (!el) return;
      el.innerHTML = `<div class="empty-state" style="padding:24px;text-align:center;color:#c06050">加载失败<br/><span style="font-size:10px;color:#8a5a50">${esc(message || '未知错误')}</span></div>`;
      const box = el.querySelector('.empty-state');
      const btn = document.createElement('button');
      btn.className = 'btn small primary';
      btn.style.marginTop = '10px';
      btn.textContent = '重试';
      btn.onclick = () => loadPosts();
      box.appendChild(document.createElement('br'));
      box.appendChild(btn);
    }

    function postBadges(p) {
      const scheduled = p.scheduledAt && new Date(p.scheduledAt).getTime() > Date.now()
        ? `<span class="badge scheduled">定时 ${new Date(p.scheduledAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>` : '';
      return `${scheduled}${p.archived ? '<span class="badge archived">已归档</span>' : ''}${p.draft ? '<span class="badge draft">草稿</span>' : ''}${p.access && p.access !== 'public' ? `<span class="badge ${p.access}">${p.access === 'admin' ? '管理员' : '授权'}</span>` : ''}`;
    }

    function postActionButtons(p, { labels = false } = {}) {
      const btn = (action, text, title, cls = '') => `<button class="btn small ${cls}" data-action="${action}" data-slug="${escAttr(p.slug)}" title="${escAttr(title)}">${text}</button>`;
      const bits = [
        btn('edit', labels ? '编辑' : '✎', '继续编辑'),
        btn('preview', labels ? '预览' : '👁', '在管理面板内预览正文'),
        p.publicUrl ? btn('copy-url', labels ? '公开链接' : '🔗', '复制公开链接') : '',
        p.shortUrl ? btn('copy-short', labels ? '短链' : '⚡', '复制分享短链') : '',
        btn('duplicate', labels ? '复制' : '⧉', '复制为新草稿'),
        btn('history', labels ? '历史' : '🕘', '查看修订历史'),
        btn('toggle-draft', labels ? (p.draft ? '发布' : '撤回') : (p.draft ? '⇧' : '⇩'), p.draft ? '发布到线上（需推送后生效）' : '转为草稿（撤下线上，需推送后生效）'),
        btn('toggle-archive', labels ? (p.archived ? '取消归档' : '归档') : '🗄', p.archived ? '取消归档' : '归档（从公开列表下架）'),
        btn('delete', labels ? '删除' : '🗑', '删除文章', 'danger'),
      ];
      return bits.filter(Boolean).join('');
    }

    function renderPostRow(p) {
      return `<div class="post-item${p.slug === currentSlug ? ' active' : ''}" data-slug="${escAttr(p.slug)}">
          <input type="checkbox" class="post-select" data-slug="${escAttr(p.slug)}" title="选择此文章"${selectedSlugs.has(p.slug) ? ' checked' : ''} />
          <div class="info" data-action="edit" data-slug="${escAttr(p.slug)}">
            <div class="title">${esc(p.title || p.slug)}</div>
            <div class="meta">${p.pubDate || ''}${p.dayIndex ? ` · #${p.dayIndex}` : ''}${postBadges(p)}</div>
          </div>
          <div class="actions">${postActionButtons(p)}</div>
        </div>`;
    }

    function renderPostCard(p) {
      const excerpt = (p.excerpt || p.description || '').trim();
      return `<div class="post-card${p.slug === currentSlug ? ' active' : ''}" data-slug="${escAttr(p.slug)}">
          <div data-action="edit" data-slug="${escAttr(p.slug)}">
            <div class="title"><input type="checkbox" class="post-select" data-slug="${escAttr(p.slug)}" title="选择此文章"${selectedSlugs.has(p.slug) ? ' checked' : ''} /> ${esc(p.title || p.slug)}</div>
            <div class="meta">${p.pubDate || ''}${p.dayIndex ? ` · #${p.dayIndex}` : ''}${postBadges(p)}</div>
          </div>
          ${excerpt ? `<div class="post-card-excerpt">${esc(excerpt.slice(0, 130))}</div>` : ''}
          <div class="post-card-actions">${postActionButtons(p, { labels: true })}</div>
        </div>`;
    }

    function getFilteredPosts() {
      const prefs = listPrefs;
      const q = prefs.q.trim().toLowerCase();
      const list = posts.filter((p) => {
        if (prefs.status === 'draft' && !(p.draft && !p.archived)) return false;
        if (prefs.status === 'published' && (p.draft || p.archived)) return false;
        if (prefs.status === 'archived' && !p.archived) return false;
        if (prefs.access && p.access !== prefs.access) return false;
        if (prefs.tag && !(p.tags || []).includes(prefs.tag)) return false;
        if (prefs.from && (p.pubDate || '') < prefs.from) return false;
        if (prefs.to && (p.pubDate || '') > prefs.to) return false;
        if (q) {
          const hay = `${p.title || ''}\n${p.description || ''}\n${p.slug || ''}\n${p.excerpt || ''}\n${(p.tags || []).join(',')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const comparators = {
        'date-desc': (a, b) => (b.pubDate || '').localeCompare(a.pubDate || '') || (b.dayIndex || 0) - (a.dayIndex || 0),
        'date-asc': (a, b) => (a.pubDate || '').localeCompare(b.pubDate || '') || (a.dayIndex || 0) - (b.dayIndex || 0),
        'updated-desc': (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
        'updated-asc': (a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''),
        'title-asc': (a, b) => (a.title || a.slug).localeCompare(b.title || b.slug, 'zh-Hans-CN'),
        'title-desc': (a, b) => (b.title || b.slug).localeCompare(a.title || a.slug, 'zh-Hans-CN'),
        'dayIndex-desc': (a, b) => (b.dayIndex || 0) - (a.dayIndex || 0) || (b.pubDate || '').localeCompare(a.pubDate || ''),
      };
      const compare = comparators[prefs.sort] || comparators['date-desc'];
      return list.sort(compare);
    }

    function renderList() {
      const el = $('#postList');
      if (!posts.length) {
        el.innerHTML = '<div class="empty-state" style="padding:30px">暂无文章</div>';
        $('#postCountHint').textContent = '';
        return;
      }
      const list = getFilteredPosts();
      $('#postCountHint').textContent = `${list.length} / ${posts.length} 篇`;
      if (!list.length) {
        el.innerHTML = '<div class="empty-state" style="padding:30px">没有匹配的文章<br/><span style="font-size:10px;color:#55555c">试试减少筛选条件</span></div>';
        updateBatchBar();
        return;
      }
      el.innerHTML = list.map((p) => (listPrefs.view === 'card' ? renderPostCard(p) : renderPostRow(p))).join('');
      updateBatchBar();
    }

    function refreshTagOptions() {
      const select = $('#fPostTag');
      if (!select) return;
      const tags = [...new Set(posts.flatMap((p) => p.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      select.innerHTML = '<option value="">全部标签</option>' + tags.map((t) => `<option value="${escAttr(t)}">${esc(t)}</option>`).join('');
      if (listPrefs.tag && !tags.includes(listPrefs.tag)) listPrefs.tag = '';
      select.value = listPrefs.tag;
    }

    function initListControls() {
      const search = $('#fPostSearch');
      if (!search) return;
      search.value = listPrefs.q;
      $('#fPostStatus').value = listPrefs.status;
      $('#fPostAccess').value = listPrefs.access;
      $('#fPostFrom').value = listPrefs.from;
      $('#fPostTo').value = listPrefs.to;
      $('#fPostSort').value = listPrefs.sort;
      $('#fPostView').value = listPrefs.view;
      $('#listFilters').hidden = !listPrefs.filtersOpen;
      $('#btnToggleFilters').classList.toggle('primary', listPrefs.filtersOpen);

      search.addEventListener('input', () => { listPrefs.q = search.value; saveListPrefs(); renderList(); });
      $('#fPostStatus').addEventListener('change', (e) => { listPrefs.status = e.target.value; saveListPrefs(); renderList(); });
      $('#fPostAccess').addEventListener('change', (e) => { listPrefs.access = e.target.value; saveListPrefs(); renderList(); });
      $('#fPostTag').addEventListener('change', (e) => { listPrefs.tag = e.target.value; saveListPrefs(); renderList(); });
      $('#fPostFrom').addEventListener('change', (e) => { listPrefs.from = e.target.value; saveListPrefs(); renderList(); });
      $('#fPostTo').addEventListener('change', (e) => { listPrefs.to = e.target.value; saveListPrefs(); renderList(); });
      $('#fPostSort').addEventListener('change', (e) => { listPrefs.sort = e.target.value; saveListPrefs(); renderList(); });
      $('#fPostView').addEventListener('change', (e) => { listPrefs.view = e.target.value; saveListPrefs(); renderList(); });
      $('#btnToggleFilters').addEventListener('click', () => {
        listPrefs.filtersOpen = !listPrefs.filtersOpen;
        saveListPrefs();
        $('#listFilters').hidden = !listPrefs.filtersOpen;
        $('#btnToggleFilters').classList.toggle('primary', listPrefs.filtersOpen);
      });
      $('#btnClearFilters').addEventListener('click', () => {
        listPrefs = { ...LIST_PREF_DEFAULTS, view: listPrefs.view, filtersOpen: listPrefs.filtersOpen };
        saveListPrefs();
        search.value = '';
        $('#fPostStatus').value = '';
        $('#fPostAccess').value = '';
        $('#fPostTag').value = '';
        $('#fPostFrom').value = '';
        $('#fPostTo').value = '';
        $('#fPostSort').value = listPrefs.sort;
        renderList();
      });
      $('#postList').addEventListener('click', (e) => {
        if (e.target.closest('.post-select')) return;
        const target = e.target.closest('[data-action]');
        if (!target) return;
        e.stopPropagation();
        const { action, slug } = target.dataset;
        if (action === 'edit') selectPost(slug);
        else if (action === 'preview') previewPostBySlug(slug);
        else if (action === 'copy-url') copyPostLink(slug, 'url');
        else if (action === 'copy-short') copyPostLink(slug, 'short');
        else if (action === 'duplicate') duplicatePost(slug);
        else if (action === 'history') showRevisionHistory(slug);
        else if (action === 'toggle-draft') quickToggleDraft(slug);
        else if (action === 'toggle-archive') toggleArchive(slug);
        else if (action === 'delete') deletePost(slug);
      });
      $('#postList').addEventListener('change', (e) => {
        const cb = e.target.closest('.post-select');
        if (!cb) return;
        if (cb.checked) selectedSlugs.add(cb.dataset.slug);
        else selectedSlugs.delete(cb.dataset.slug);
        updateBatchBar();
      });
    }

    function updateBatchBar() {
      const bar = $('#batchBar');
      if (!bar) return;
      bar.hidden = selectedSlugs.size === 0;
      const count = $('#batchCount');
      if (count) count.textContent = `已选 ${selectedSlugs.size} 项`;
    }

    async function batchAction(kind) {
      const slugs = [...selectedSlugs];
      if (!slugs.length) return;
      if (kind === 'clear') { selectedSlugs.clear(); updateBatchBar(); renderList(); return; }
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
      if (kind === 'delete' && slugs.includes(currentSlug)) { currentSlug = null; resetPostEditorTracking(); }
      selectedSlugs.clear();
      await loadPosts();
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
      el.innerHTML = historyState.revisions.map((r) => `<div><button class="btn small" data-rev="${escAttr(r.id)}">${esc(new Date(r.savedAt).toLocaleString('zh-CN', { hour12: false }))}</button> <span style="color:#55555c">${formatBytes(r.size)}</span></div>`).join('');
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
        if (done) { toast('已恢复该历史版本'); closeModal($('#historyModal')); await loadPosts(); }
      } catch (e) { toast('恢复失败: ' + e.message); }
    }

    function findPost(slug) { return posts.find((p) => p.slug === slug); }

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
        for (let i = 2; posts.some((x) => x.slug.toLowerCase() === newSlug.toLowerCase()); i += 1) newSlug = `${base}-${i}`;
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
        await loadPosts();
        await selectPost(data.slug, { skipLeaveGuard: true });
      } catch (e) { toast('复制失败: ' + e.message); }
    }

    async function toggleArchive(slug) {
      const p = findPost(slug);
      if (!p) return;
      if (slug === currentSlug && postDirty) { toast('该文章正在编辑且有未保存修改，请先保存后再归档'); return; }
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
        await loadPosts();
        if (slug === currentSlug) await selectPost(data.slug || slug, { skipLeaveGuard: true });
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
      if (slug === currentSlug && postDirty) { toast('该文章正在编辑且有未保存修改，请先保存后再切换发布状态'); return; }
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
        await loadPosts();
        if (slug === currentSlug) await selectPost(data.slug || slug, { skipLeaveGuard: true });
      } catch (e) {
        toast('切换发布状态失败: ' + e.message);
      }
    }

    async function selectPost(slug, { skipLeaveGuard = false } = {}) {
      if (!skipLeaveGuard && !canLeavePostEditor()) return;
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
        const post = await res.json();
        if (!res.ok || post.error) { toast(post.error || `加载失败（HTTP ${res.status}）`); return; }
        renderEditor(post); renderList();
      } catch(e) { toast('加载失败: ' + e.message) }
    }

    function postCoverEditor(cover = '') {
      return `
        <div class="post-cover-editor">
          <button type="button" class="post-cover-preview" id="btnCoverUpload" aria-label="上传文章封面（可截选）">
            <img id="coverPreviewImage" alt="" hidden />
            <span class="post-cover-empty" id="coverPreviewEmpty">上传封面（可截选）</span>
            <span class="post-cover-source" id="coverPreviewSource">无封面</span>
          </button>
          <div class="post-cover-fields">
            <div class="form-group">
              <label>文章封面</label>
              <input id="fCover" value="${escAttr(cover)}" placeholder="图片地址；留空使用正文首图" />
            </div>
            <div class="post-cover-actions">
              <button type="button" class="btn small" id="btnCoverFromMedia">媒体库</button>
              <button type="button" class="btn small" id="btnCoverClear">清除自定义</button>
            </div>
          </div>
        </div>`;
    }

    function readPostFormState() {
      return {
        title: $('#fTitle')?.value || '',
        slug: $('#fSlug')?.value || '',
        description: $('#fDesc')?.value || '',
        cover: $('#fCover')?.value || '',
        pubDate: $('#fPubDate')?.value || '',
        dayIndex: $('#fDayIndex')?.value || '',
        tags: $('#fTags')?.value || '',
        content: getEditorMarkdown(),
        draft: !$('#fDraftToggle')?.classList.contains('on'),
        archived: $('#fArchived')?.value === 'true',
        scheduledAt: $('#fScheduledAt')?.value ? new Date($('#fScheduledAt').value).toISOString() : '',
        access: $('#fAccess')?.value || 'public',
      };
    }

    function serializePostForm(state) {
      return JSON.stringify(state);
    }

    function postDraftStorageKey(key = postDraftKey) {
      return key ? `${POST_DRAFT_PREFIX}${encodeURIComponent(key)}` : null;
    }

    function clearPostDraft(key = postDraftKey) {
      const storageKey = postDraftStorageKey(key);
      if (!storageKey) return;
      try { localStorage.removeItem(storageKey); } catch (e) { /* storage unavailable */ }
      setPostDraftStatus('');
    }

    function setPostDraftStatus(text) {
      const el = $('#postDraftStatus');
      if (el) el.textContent = text || '';
    }

    function setPostEditorStatus(text, tone = '') {
      const el = $('#postEditorStatus');
      if (!el) return;
      el.textContent = text;
      el.className = `editor-save-status${tone ? ` ${tone}` : ''}`;
    }

    function updatePostEditorStatus() {
      const btn = $('#btnSave');
      if (!btn || currentMode !== 'posts' || !$('#fTitle')) {
        setPostEditorStatus('');
        return;
      }
      if (postSaving) {
        btn.disabled = true;
        btn.textContent = '⏳ 保存中…';
        setPostEditorStatus('正在保存', 'saving');
      } else if (postDirty) {
        btn.disabled = false;
        btn.textContent = '💾 保存 (Ctrl+S)';
        setPostEditorStatus('有未保存修改', 'dirty');
      } else {
        btn.disabled = true;
        btn.textContent = '✓ 已保存';
        setPostEditorStatus('已保存');
      }
    }

    function savePostDraftNow() {
      if (currentMode !== 'posts' || !postDirty || !postDraftKey || postHydrating) return;
      const storageKey = postDraftStorageKey();
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          version: 1,
          baseHash: currentPostHash || '',
          updatedAt: Date.now(),
          form: readPostFormState(),
        }));
        setPostDraftStatus('本地草稿已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      } catch (e) {
        if (!postDraftStorageWarned) {
          postDraftStorageWarned = true;
          toast('本地草稿保存失败，可能是浏览器存储空间不足');
        }
      }
    }

    function schedulePostDraftSave() {
      clearTimeout(postDraftTimer);
      postDraftTimer = setTimeout(() => {
        postDraftTimer = null;
        savePostDraftNow();
      }, 350);
    }

    function markPostDirty() {
      if (postHydrating || !postBaselineSnapshot || currentMode !== 'posts') return;
      const snapshot = serializePostForm(readPostFormState());
      postDirty = snapshot !== postBaselineSnapshot;
      if (postDirty) schedulePostDraftSave();
      else clearPostDraft();
      updatePostEditorStatus();
    }

    function setupPostDirtyTracking() {
      const root = $('#editorContainer');
      if (!root) return;
      ['#fTitle', '#fSlug', '#fDesc', '#fCover', '#fPubDate', '#fDayIndex', '#fTags', '#fAccess']
        .map(selector => root.querySelector(selector))
        .filter(Boolean)
        .forEach(input => {
          input.addEventListener('input', () => { markPostDirty(); updatePostValidation(); });
          input.addEventListener('change', () => { markPostDirty(); updatePostValidation(); });
        });
    }

    function applyPostFormState(state) {
      postHydrating = true;
      try {
        const setValue = (selector, value) => {
          const el = $(selector);
          if (el) el.value = value ?? '';
        };
        setValue('#fTitle', state.title);
        setValue('#fSlug', state.slug);
        setValue('#fDesc', state.description);
        setValue('#fCover', state.cover);
        setValue('#fPubDate', state.pubDate);
        setValue('#fDayIndex', state.dayIndex);
        setValue('#fTags', state.tags);
        setValue('#fAccess', state.access || 'public');
        const archivedEl = $('#fArchived');
        if (archivedEl) archivedEl.value = state.archived ? 'true' : 'false';
        const scheduledEl = $('#fScheduledAt');
        if (scheduledEl) scheduledEl.value = toLocalInput(state.scheduledAt);
        const toggle = $('#fDraftToggle');
        if (toggle) {
          toggle.classList.toggle('on', !state.draft);
          const status = $('#draftStatus');
          if (status) status.textContent = state.draft ? '当前为草稿' : '已发布';
        }
        if (vditor && typeof vditor.setValue === 'function') vditor.setValue(state.content || '');
        syncPostCoverPreview();
      } finally {
        postHydrating = false;
      }
    }

    function restorePostDraftIfAvailable() {
      const storageKey = postDraftStorageKey();
      if (!storageKey) return;
      let draft;
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        draft = JSON.parse(raw);
      } catch (e) {
        clearPostDraft();
        return;
      }
      if (!draft?.form) { clearPostDraft(); return; }
      const draftSnapshot = serializePostForm(draft.form);
      if (draftSnapshot === postBaselineSnapshot) { clearPostDraft(); return; }
      const stale = currentSlug && draft.baseHash && draft.baseHash !== currentPostHash;
      const age = draft.updatedAt ? new Date(draft.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间';
      const message = stale
        ? `发现一份基于旧版本的本地草稿（${age}）。恢复后保存时仍会进行版本冲突检查，是否恢复？`
        : `发现一份本地恢复草稿（${age}），是否恢复？`;
      if (!confirm(message)) {
        clearPostDraft();
        return;
      }
      applyPostFormState(draft.form);
      postDirty = true;
      schedulePostDraftSave();
      updatePostEditorStatus();
      toast('已恢复本地草稿，保存前请确认文章内容');
    }

    function resetPostEditorTracking() {
      clearTimeout(postDraftTimer);
      postDraftTimer = null;
      postDirty = false;
      postHydrating = false;
      postBaselineSnapshot = '';
      currentPostHash = '';
      postDraftKey = null;
      postSaving = false;
      setPostEditorStatus('');
      setPostDraftStatus('');
      const pfBtn = $('#btnPreflight');
      if (pfBtn) { pfBtn.style.display = 'none'; pfBtn.disabled = true; }
    }

    function canLeavePostEditor() {
      if (currentMode !== 'posts' || !postDirty) return true;
      if (postSaving) { toast('正在保存文章，请稍候'); return false; }
      savePostDraftNow();
      return confirm('当前文章有未保存修改。\n\n点击“确定”离开并保留本地恢复草稿；点击“取消”返回继续编辑。');
    }

    // ── 文章表单：分组折叠 / 模板 / 即时校验 / 内容统计 ──
    const EDITOR_SECTION_KEY = 'admin-editor-sections';
    let editorSectionPrefs = {};
    try { editorSectionPrefs = JSON.parse(localStorage.getItem(EDITOR_SECTION_KEY) || '{}') || {}; } catch { editorSectionPrefs = {}; }
    function saveEditorSectionPrefs() { try { localStorage.setItem(EDITOR_SECTION_KEY, JSON.stringify(editorSectionPrefs)); } catch { /* 忽略写入失败 */ } }

    const POST_TEMPLATES = {
      daily: { label: '日常', tags: '日常, 记录', description: '记录今天的所见所想。', content: '## 今天的记录\n\n\n\n## 一点想法\n\n' },
      tech: { label: '技术', tags: '技术, 复盘', description: '一次技术实践与复盘。', content: '## 背景\n\n\n\n## 实现\n\n\n\n## 复盘\n\n' },
      paper: { label: '论文 / 调研', tags: '论文, 调研', description: '一次调研 / 论文生产过程记录。', content: '## 问题\n\n\n\n## 方法\n\n\n\n## 结果\n\n' },
      blank: { label: '空白', tags: '', description: '', content: '' },
    };

    function toLocalInput(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function slugifyTitle(title) {
      return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    }

    function countPostStats(md) {
      const text = String(md || '');
      const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
      const latinWords = (text.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) || []).length;
      const mdImgs = [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)];
      const htmlImgs = [...text.matchAll(/<img\b[^>]*>/gi)];
      const missingAlt = mdImgs.filter((m) => !String(m[1] || '').trim()).length
        + htmlImgs.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;
      const mdLinks = (text.match(/\]\(\s*https?:\/\//g) || []).length;
      const htmlLinks = (text.match(/<a\b[^>]*href\s*=\s*["']https?:\/\//gi) || []).length;
      return { chars: cjk + latinWords, images: mdImgs.length + htmlImgs.length, missingAlt, links: mdLinks + htmlLinks };
    }

    function validatePostForm(state) {
      const errors = {};
      if (!state.title.trim()) errors.title = '标题不能为空';
      const slug = state.slug.trim();
      if (!slug) errors.slug = 'Slug 不能为空';
      else if (!/^[a-z0-9\u4e00-\u9fff]([a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/i.test(slug)) errors.slug = 'Slug 只能包含中英文、数字与连字符，且不能以连字符开头/结尾';
      else {
        const clash = posts.find((p) => p.slug.toLowerCase() === slug.toLowerCase() && p.slug !== currentSlug);
        if (clash) errors.slug = `Slug 已被「${clash.title || clash.slug}」占用`;
      }
      if (!state.pubDate) errors.pubDate = '请选择发布日期';
      else if (Number.isNaN(new Date(state.pubDate).getTime())) errors.pubDate = '日期格式不正确';
      if (state.dayIndex) {
        const di = parseInt(state.dayIndex, 10);
        if (!Number.isInteger(di) || di < 1) errors.dayIndex = '同日序号需为 ≥1 的整数';
      }
      const tagCount = String(state.tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean).length;
      if (tagCount > 20) errors.tags = '标签最多 20 个';
      return errors;
    }

    function applyFieldError(inputSelector, errorSelector, message) {
      const input = $(inputSelector);
      if (input) input.classList.toggle('invalid', Boolean(message));
      const el = $(errorSelector);
      if (el) el.textContent = message || '';
    }

    function updatePostValidation() {
      if (currentMode !== 'posts' || !$('#fTitle')) return {};
      const state = readPostFormState();
      const errors = validatePostForm(state);
      applyFieldError('#fTitle', '#errTitle', errors.title);
      applyFieldError('#fSlug', '#errSlug', errors.slug);
      applyFieldError('#fPubDate', '#errPubDate', errors.pubDate);
      applyFieldError('#fDayIndex', '#errDayIndex', errors.dayIndex);
      applyFieldError('#fTags', '#errTags', errors.tags);
      const summary = $('#postValidation');
      if (summary) {
        const list = Object.values(errors);
        summary.hidden = list.length === 0;
        summary.textContent = list.length ? `⚠ ${list.join('；')}` : '';
      }
      const stats = countPostStats(state.content);
      const statsEl = $('#postStats');
      if (statsEl) {
        const minutes = Math.max(1, Math.round(stats.chars / 300));
        statsEl.innerHTML = `正文 <b>${stats.chars}</b> 字（约 <b>${minutes}</b> 分钟） · 图片 <b>${stats.images}</b>${stats.missingAlt ? `（缺 alt <b>${stats.missingAlt}</b>）` : ''} · 外链 <b>${stats.links}</b>`;
      }
      updateRichStatus();
      return errors;
    }

    function updateRichStatus() {
      const el = $('#richStatus');
      if (!el) return;
      const md = getEditorMarkdown() || '';
      const unsupported = /<(?:div|mark|center|u|iframe|song-player)\b/i.test(md);
      if (!unsupported) { el.hidden = true; el.textContent = ''; return; }
      el.hidden = false;
      el.className = 'rich-status warn';
      el.textContent = isWysiwygView()
        ? '⚠ 当前为「所见即所得」：正文含原始 HTML（对齐 / 高亮 / 下划线 / 视频 / 播放条），部分结构可能不渲染；建议切到「分屏」看实时渲染，或用「即时渲染」编辑。'
        : '◐ 正文含原始 HTML（对齐 / 高亮 / 下划线 / 视频 / 播放条）：即时渲染下以源码块展示、不会丢失；切到「分屏」右侧可看到与线上一致的实时渲染。';
    }

    function applyPostTemplate(key) {
      const tpl = POST_TEMPLATES[key];
      if (!tpl || currentSlug) return;
      if (tpl.tags) $('#fTags').value = tpl.tags;
      if (tpl.description) $('#fDesc').value = tpl.description;
      if (!getEditorMarkdown().trim() && tpl.content && vditor) vditor.setValue(tpl.content);
      const title = $('#fTitle')?.value || '';
      if (!($('#fSlug')?.value || '').trim() && title) $('#fSlug').value = slugifyTitle(title);
      updatePostValidation();
      markPostDirty();
      toast(`已应用「${tpl.label}」模板`);
    }

    function setupFormSections() {
      const root = $('#editorContainer');
      if (!root) return;
      root.querySelectorAll('.form-section').forEach((sec) => {
        const key = sec.dataset.section;
        const collapsed = editorSectionPrefs[key] === false;
        sec.classList.toggle('collapsed', collapsed);
        const head = sec.querySelector('.form-section-head');
        if (head) head.onclick = () => {
          const next = !sec.classList.contains('collapsed');
          sec.classList.toggle('collapsed', next);
          editorSectionPrefs[key] = !next;
          saveEditorSectionPrefs();
        };
      });
    }

    function setupShareInfo(post) {
      const el = $('#shareInfo');
      if (!el) return;
      if (post && post.hasPublicPage) {
        el.innerHTML = `
          <div class="share-row">公开链接 <code>${esc(post.publicUrl)}</code> <button class="btn small" data-share="url">复制</button> <button class="btn small" data-share="open">打开</button></div>
          <div class="share-row">分享短链 <code>${esc(post.shortUrl)}</code> <button class="btn small" data-share="short">复制</button></div>`;
        el.querySelectorAll('[data-share]').forEach((btn) => {
          btn.onclick = async () => {
            const kind = btn.dataset.share;
            if (kind === 'open') { window.open(post.publicUrl, '_blank'); return; }
            const url = kind === 'short' ? post.shortUrl : post.publicUrl;
            try { await navigator.clipboard.writeText(url); toast('已复制：' + url); } catch { toast('复制失败：' + url); }
          };
        });
      } else {
        el.innerHTML = '<div style="color:#6a6a70">该文章为草稿或管理员级，没有线上公开链接；推送并公开后才可分享。</div>';
      }
    }

    function setupSlugAutogen() {
      const title = $('#fTitle');
      const slug = $('#fSlug');
      if (!title || !slug) return;
      let userEdited = Boolean(slug.value.trim());
      slug.addEventListener('input', () => { userEdited = Boolean(slug.value.trim()); });
      title.addEventListener('input', () => {
        if (!currentSlug && !userEdited) slug.value = slugifyTitle(title.value);
      });
    }

    function setupTemplateChips() {
      const wrap = $('#templateChips');
      if (!wrap) return;
      wrap.querySelectorAll('[data-template]').forEach((btn) => { btn.onclick = () => applyPostTemplate(btn.dataset.template); });
    }

    /** 编辑器就绪后：锁定基线、计算状态、尝试恢复本地草稿 */
    function finalizePostEditorInit() {
      postBaselineSnapshot = serializePostForm(readPostFormState());
      postDirty = false;
      postHydrating = false;
      updatePostEditorStatus();
      updatePostValidation();
      restorePostDraftIfAvailable();
    }

    function renderPostEditor(post, { isNew = false } = {}) {
      const value = {
        slug: '', title: '', description: '', cover: '', pubDate: new Date().toISOString().split('T')[0],
        dayIndex: '', tags: [], draft: false, access: 'public', content: '', contentHash: '', ...post,
      };
      currentSlug = isNew ? null : (value.slug || null);
      currentPostHash = isNew ? '' : (value.contentHash || '');
      postDraftKey = isNew ? '__new__' : (value.slug || '__new__');
      postHydrating = true;
      $('#editorTitle').textContent = isNew ? '新建文章' : '编辑：' + (value.title || value.slug);
      $('#btnDelete').style.display = isNew ? 'none' : '';
      $('#btnSave').style.display = '';
      $('#editorContainer').innerHTML = `
        <div class="editor">
          <div class="upload-area" id="uploadArea">📎 拖放或点击上传图片 / 音频 → 自动插入（音频解析歌名·歌手·封面）</div>
          <div class="url-import-bar">
            <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
            <button class="btn small" id="btnImportUrl">导入</button>
            <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
          </div>
          ${isNew ? `<div class="template-chips" id="templateChips"><span class="template-label">模板</span>${Object.entries(POST_TEMPLATES).map(([key, t]) => `<button class="btn small" type="button" data-template="${key}">${esc(t.label)}</button>`).join('')}</div>` : ''}
          <div class="post-validation" id="postValidation" hidden></div>

          <section class="form-section" data-section="basic">
            <button class="form-section-head" type="button" data-collapse="basic"><span class="caret">▾</span>基本信息</button>
            <div class="form-section-body">
              <div class="form-row">
                <div class="form-group" style="flex:2"><label>标题</label><input id="fTitle" value="${escAttr(value.title||'')}" placeholder="文章标题"${isNew?' autofocus':''}/><span class="field-error" id="errTitle"></span></div>
                <div class="form-group" style="flex:1"><label>Slug / URL</label><input id="fSlug" value="${escAttr(value.slug||'')}" placeholder="url-name"/><span class="field-hint" id="fSlugHint">文件名与 URL 标识</span><span class="field-error" id="errSlug"></span></div>
              </div>
              <div class="form-group"><label>描述</label><input id="fDesc" value="${escAttr(value.description||'')}" placeholder="一句完整的文章简介"/><span class="field-error" id="errDesc"></span></div>
            </div>
          </section>

          <section class="form-section" data-section="publish">
            <button class="form-section-head" type="button" data-collapse="publish"><span class="caret">▾</span>发布设置</button>
            <div class="form-section-body">
              <div class="form-row">
                <div class="form-group"><label>发布日期</label><input id="fPubDate" type="date" value="${value.pubDate||''}"/><span class="field-error" id="errPubDate"></span></div>
                <div class="form-group"><label>同日序号</label><input id="fDayIndex" type="number" min="1" value="${value.dayIndex||''}" placeholder="自动" title="同一天内的发表顺序，1 = 当天第一篇；留空自动推导"/><span class="field-error" id="errDayIndex"></span></div>
                <div class="form-group"><label>标签 (逗号分隔)</label><input id="fTags" value="${escAttr((value.tags||[]).join(', '))}" placeholder="博客, Astro"/><span class="field-error" id="errTags"></span></div>
              </div>
              <div class="form-row" style="align-items:flex-start">
                <div class="toggle-row" style="flex:1">
                  <div class="toggle${value.draft?'':' on'}" id="fDraftToggle" onclick="toggleDraft()"></div>
                  <span>发布</span><span style="font-size:10px;color:#6a6a70" id="draftStatus">${value.draft?'当前为草稿':'已发布'}</span>
                </div>
                <div class="form-group" style="flex:1"><label>访问权限</label><select id="fAccess"><option value="public" ${value.access==='public'?'selected':''}>访客级 · 公开查看</option><option value="authorized" ${value.access==='authorized'?'selected':''}>授权级 · 验证站长网名</option><option value="admin" ${value.access==='admin'?'selected':''}>管理员级 · 私密文章密码</option></select></div>
              </div>
              <input type="hidden" id="fArchived" value="${value.archived ? 'true' : 'false'}" />
              <div class="form-group"><label>定时发布（可留空）</label><input id="fScheduledAt" type="datetime-local" value="${toLocalInput(value.scheduledAt)}" /><span class="field-hint">到时间后需一次构建/推送才会出现在线上；未到时间不会加入公开列表。</span></div>
            </div>
          </section>

          <section class="form-section" data-section="cover">
            <button class="form-section-head" type="button" data-collapse="cover"><span class="caret">▾</span>封面与分享</button>
            <div class="form-section-body">
              ${postCoverEditor(value.cover || '')}
              <div class="share-info" id="shareInfo"></div>
            </div>
          </section>

          <section class="form-section form-section-grow" data-section="body">
            <button class="form-section-head" type="button" data-collapse="body"><span class="caret">▾</span>正文</button>
            <div class="form-section-body">
              <div class="editor-toolbar">
                <button class="btn small" id="btnInsertVideo" title="插入 B站 / YouTube 等流媒体视频">▶ 视频</button>
                <button class="btn small" id="btnInsertMusic" title="插入音乐播放条（自托管音频直链）">♪ 音乐</button>
                <button class="btn small" id="btnInsertMedia" title="从媒体库插入图片 / 音频">▤ 媒体库</button>
                <button class="btn small" id="btnInsertImgSize" title="设置图片宽度">⛶ 图宽</button>
                <span class="fmt-sep"></span>
                <button class="btn small" data-align="left" title="将选中段落设为居左">⇤</button>
                <button class="btn small" data-align="center" title="将选中段落设为居中">⇔</button>
                <button class="btn small" data-align="right" title="将选中段落设为居右">⇥</button>
                <span class="fmt-sep"></span>
                <button class="btn small" id="btnOutline" title="显示 / 隐藏大纲">☰ 大纲</button>
                <button class="btn small" id="btnTypewriter" title="打字机模式：光标始终居中">⌨ 打字机</button>
                <button class="btn small" id="btnFocusMode" title="专注模式：隐藏侧栏">⤢ 专注</button>
                <div class="view-switch" id="viewSwitch">
                  <button data-view="ir" class="active" title="即时渲染：直接编辑排版结果，原始 HTML 保持不变">即时渲染</button>
                  <button data-view="sv" title="左侧 Markdown 源码 + 右侧实时预览">分屏</button>
                  <button data-view="wysiwyg" title="所见即所得">所见即所得</button>
                  <button data-view="source" title="仅 Markdown 源码">源码</button>
                </div>
              </div>
              <div class="post-stats" id="postStats"></div>
              <div class="field-hint" id="postDraftStatus"></div>
              <div class="rich-status" id="richStatus" hidden></div>
              <div class="editor-body" id="editorBody">
                <div id="vditorEditor"></div>
              </div>
            </div>
          </section>
        </div>`;
      setupUpload();
      initVditorEditor(value.content || '');
      setupPostCover();
      setupVideoInsert();
      setupMusicInsert();
      setupFmtToolbar();
      setupImgSize();
      setupViewSwitch();
      setupPostDirtyTracking();
      setupFormSections();
      setupSlugAutogen();
      setupTemplateChips();
      setupShareInfo(isNew ? null : value);
      setupCoverMediaButton();
      setupMediaInsertButton();
      setupEditorTools();
      const pfBtn = $('#btnPreflight');
      if (pfBtn) { pfBtn.style.display = ''; pfBtn.disabled = false; }
      if (!initVditorEditor(value.content || '')) finalizePostEditorInit();
      renderList();
      if (isNew) $('#fTitle')?.focus();
    }

    function renderEditor(post) {
      renderPostEditor(post, { isNew: false });
    }

    function newPost() {
      if (!canLeavePostEditor()) return;
      renderPostEditor({}, { isNew: true });
    }

    async function savePost() {
      if (postSaving) return;
      const state = readPostFormState();
      const errors = updatePostValidation();
      const errorList = Object.values(errors);
      if (errorList.length) { toast('请先修正：' + errorList.join('；')); return; }
      if (!postDirty) { toast('没有未保存修改'); return; }
      if (currentSlug && !/^[a-f0-9]{64}$/.test(currentPostHash)) {
        toast('当前文章版本未知，请重新加载后再保存');
        return;
      }

      const formData = new URLSearchParams();
      Object.entries(state).forEach(([key, value]) => {
        formData.set(key, key === 'draft' ? String(value) : String(value ?? ''));
      });
      if (currentSlug) formData.set('expectedHash', currentPostHash);

      const isExistingPost = Boolean(currentSlug);
      postSaving = true;
      updatePostEditorStatus();
      try {
        const url = isExistingPost ? `${API}/${encodeURIComponent(currentSlug)}` : API;
        const method = isExistingPost ? 'PUT' : 'POST';
        const res = await apiFetch(url, { method, body: formData, headers:{'Content-Type':'application/x-www-form-urlencoded'} });
        const data = await res.json();
        if (!res.ok || data.error) {
          if (res.status === 409) {
            setPostEditorStatus('版本冲突', 'error');
            toast(data.error || '文章版本冲突：当前内容已保留，请先重新加载并确认差异');
            return;
          }
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        clearPostDraft();
        postDirty = false;
        postBaselineSnapshot = '';
        currentSlug = data.slug;
        toast(isExistingPost ? '已保存' : '已创建');
        await loadPosts();
        await selectPost(data.slug, { skipLeaveGuard: true });
      } catch(e) {
        setPostEditorStatus('保存失败', 'error');
        toast('保存失败: ' + e.message);
      } finally {
        postSaving = false;
        updatePostEditorStatus();
      }
    }

    async function deletePost(slug) {
      if(!confirm(`确定删除「${slug}」？此操作不可撤销。`)) return;
      try {
        const res = await apiFetch(`${API}/${slug}`, { method:'DELETE' });
        const data = await res.json();
        if(data.error){toast(data.error);return}
        toast('已删除');
        if(currentSlug===slug){clearPostDraft();currentSlug=null;resetPostEditorTracking();$('#editorContainer').innerHTML='<div class="empty-state">← 从左侧列表选择文章，或点击「新建」</div>';$('#btnDelete').style.display='none';$('#btnSave').disabled=true;$('#editorTitle').textContent='选择或创建一篇文章'}
        await loadPosts();
      } catch(e) { toast('删除失败') }
    }

    function toggleDraft() {
      const t = $('#fDraftToggle'); if(!t) return;
      t.classList.toggle('on');
      const s = $('#draftStatus'); if(s) s.textContent = t.classList.contains('on')?'已发布':'当前为草稿';
      markPostDirty();
    }

    function maskPostCode(source) {
      let fence = '';
      return String(source || '').split(/(?<=\n)/).map(line => {
        const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1] || '';
        if (marker && !fence) { fence = marker[0]; return line.replace(/[^\n]/g, ' '); }
        if (fence && marker.startsWith(fence)) { fence = ''; return line.replace(/[^\n]/g, ' '); }
        if (fence || /^(?: {4}|\t)/.test(line)) return line.replace(/[^\n]/g, ' ');
        return line.replace(/(`+)(?:[^`]|`(?!\1))*?\1/g, match => ' '.repeat(match.length));
      }).join('');
    }

    function firstPostImage(body) {
      const source = maskPostCode(body);
      const candidates = [];
      const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
      const htmlImage = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/gi;
      for (const match of source.matchAll(markdownImage)) candidates.push({ index: match.index, src: match[1] || match[2] || '' });
      for (const match of source.matchAll(htmlImage)) candidates.push({ index: match.index, src: match[1] || match[2] || match[3] || '' });
      candidates.sort((a, b) => a.index - b.index);
      return (candidates.find(item => item.src && !/^(?:javascript|vbscript):/i.test(item.src))?.src || '').trim();
    }

    function syncPostCoverPreview() {
      const input = $('#fCover');
      const image = $('#coverPreviewImage');
      const empty = $('#coverPreviewEmpty');
      const source = $('#coverPreviewSource');
      if (!input || !image || !empty || !source) return;

      const customCover = input.value.trim();
      const bodyCover = firstPostImage(getEditorMarkdown() || '');
      const url = customCover || bodyCover;
      source.textContent = customCover ? '自定义封面' : bodyCover ? '正文首图' : '无封面';
      empty.hidden = Boolean(url);
      image.hidden = !url;
      if (!url) {
        image.removeAttribute('src');
        return;
      }
      image.onload = () => { image.hidden = false; empty.hidden = true; };
      image.onerror = () => { image.hidden = true; empty.hidden = false; empty.textContent = '图片不可用'; source.textContent = '检查地址'; };
      image.src = url;
    }

    function setupPostCover() {
      const input = $('#fCover');
      if (!input) return;
      input.addEventListener('input', syncPostCoverPreview);
      const clear = $('#btnCoverClear');
      if (clear) clear.onclick = () => { input.value = ''; syncPostCoverPreview(); input.focus(); };
      syncPostCoverPreview();
    }

    function setupUpload() {
      const area = $('#uploadArea'); if(!area) return;
      const fileInput = $('#fileInput');
      area.onclick = ()=>{postUploadTarget='content';fileInput.click()};
      area.ondragover = e=>{e.preventDefault();area.classList.add('dragover')};
      area.ondragleave = ()=>area.classList.remove('dragover');
      area.ondrop = async e=>{e.preventDefault();area.classList.remove('dragover');const f=e.dataTransfer.files[0];if(!f)return;if(f.type.startsWith('audio/')){await uploadAudioTrack(f)}else{await uploadImage(f,'content')}};

      // 编辑器区拖放：图片由 Vditor 的 upload 处理（光标处插入）；音频由我们处理
      const editorBox = $('#vditorEditor');
      if(editorBox){
        editorBox.ondragover = e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'};
        editorBox.ondrop = async e=>{
          const f=e.dataTransfer.files && e.dataTransfer.files[0];
          if(!f) return;
          if(f.type.startsWith('audio/')){
            e.preventDefault();
            await uploadAudioTrack(f);
          }
          // 图片不拦截：TOAST UI 原生拖放会走 addImageBlobHook 上传并在光标处插入
        };
      }

      const coverArea = $('#btnCoverUpload');
      if (coverArea) {
        coverArea.onclick = ()=>{postUploadTarget='cover';fileInput.click()};
        coverArea.ondragover = e=>{e.preventDefault();coverArea.classList.add('dragover')};
        coverArea.ondragleave = ()=>coverArea.classList.remove('dragover');
        coverArea.ondrop = async e=>{e.preventDefault();e.stopPropagation();coverArea.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f)await uploadImage(f,'cover')};
      }

      fileInput.onchange = async ()=>{
        const f=fileInput.files[0];
        const target=postUploadTarget;
        if(f){if(f.type.startsWith('audio/')){await uploadAudioTrack(f)}else{await uploadImage(f,target)}fileInput.value=''}
        postUploadTarget='content';
      };

      // URL import button
      const btnImport = $('#btnImportUrl');
      if (btnImport) btnImport.onclick = async () => {
        const url = $('#fImportUrl')?.value?.trim();
        if (!url) { toast('请粘贴图片 URL'); return; }
        btnImport.textContent = '⏳'; btnImport.disabled = true;
        try {
          const fd = new URLSearchParams();
          fd.set('url', url);
          fd.set('referer', $('#fImportReferer')?.value?.trim() || '');
          const res = await apiFetch('/api/import-url', { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          const data = await res.json();
          if (data.error) { toast(data.error); btnImport.textContent = '导入'; btnImport.disabled = false; return; }
          if (currentMode === 'frontend') {
            const imageInput = $('#' + frontendUploadField);
            if (imageInput) { imageInput.value = data.url; imageInput.focus(); syncFrontendPreview(); }
          } else if (currentMode === 'gallery') {
            const srcInput = $('#fSrc');
            if (srcInput) { srcInput.value = data.url; srcInput.focus(); }
            const originalInput = $('#fOriginal');
            if (originalInput && !originalInput.value.trim() && data.originalUrl) {
              originalInput.value = data.originalUrl;
            }
          } else if (currentMode === 'about') {
            const avatarInput = $('#fAvatar');
            if (avatarInput) { avatarInput.value = data.url; avatarInput.focus(); refreshAvatarPreview(); }
          } else {
            insertImageIntoEditor(data.url, '');
          }
          toast('已导入: ' + data.url);
        } catch (e) { toast('导入失败: ' + e.message); }
        btnImport.textContent = '导入'; btnImport.disabled = false;
      };

      // Paste image / audio support
      document.onpaste = async e => {
        // TOAST UI 在两种模式下都已内置粘贴图片处理（addImageBlobHook）且先于 document 触发；
        // 事件冒泡到这里时若已 preventDefault 说明编辑器已接管，跳过以免同一张图上传两次、插入两张
        if (e.defaultPrevented) return;
        const items = e.clipboardData?.items ? [...e.clipboardData.items] : [];
        const audioItem = items.find(i=>i.type.startsWith('audio/'));
        const imgItem = items.find(i=>i.type.startsWith('image/'));
        const item = audioItem || imgItem;
        if(item) {
          e.preventDefault();
          if(audioItem){ await uploadAudioTrack(audioItem.getAsFile()); }
          else { await uploadImage(imgItem.getAsFile(),'content'); }
        }
      };
    }

    /* ── 插入视频（B站 / YouTube / 通用 iframe 嵌入） ── */
    // 把用户输入转换为标准 iframe 嵌入代码；无法识别时返回 {error}
    function buildVideoEmbed(input){
      const s=(input||'').trim();
      if(!s) return {error:'请粘贴视频链接或嵌入代码'};
      // 1) 直接粘贴 iframe 嵌入代码：提取 src 重建（丢弃原始样式与事件属性）；src 必须是 http(s)
      if(/<iframe/i.test(s)){
        const m=s.match(/<iframe[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
        if(!m) return {error:'iframe 代码中未找到 src 属性'};
        const src=m[1];
        if(!/^(https?:)?\/\//i.test(src)) return {error:'iframe 的 src 必须是 http(s) 地址'};
        return {html:'<div class="video-embed"><iframe src="'+src+'" title="嵌入式视频播放器" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></div>'};
      }
      // 2) B站：完整链接或 BV 号（可选 ?p=N 分P）
      let m=s.match(/(?:bilibili\.com\/video\/)?(BV[0-9A-Za-z]{10})(?:[?#/]|$)/i);
      if(m){
        const page=(s.match(/[?&]p=(\d+)/i)||[])[1]||'1';
        return {html:'<div class="video-embed"><iframe src="https://player.bilibili.com/player.html?bvid='+m[1]+'&page='+page+'&high_quality=1&danmaku=1&autoplay=0" title="哔哩哔哩视频" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" loading="lazy"></iframe></div>'};
      }
      if(/b23\.tv/i.test(s)) return {error:'检测到 b23.tv 短链接：请先打开该链接，复制跳转后的完整视频地址再粘贴'};
      // 3) YouTube：watch / embed / shorts / live / youtu.be
      m=s.match(/(?:youtube\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
      if(m){
        return {html:'<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/'+m[1]+'" title="YouTube 视频播放器" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></div>'};
      }
      return {error:'无法识别：请粘贴 B站 / YouTube 视频链接，或视频网站提供的 iframe 嵌入代码'};
    }

    // 文章编辑器的「▶ 视频」按钮 → 打开对话框
    function setupVideoInsert(){
      const btn=$('#btnInsertVideo'); if(!btn) return;
      btn.onclick=()=>{
        const modal=$('#videoModal'); if(!modal) return;
        const input=$('#fVideoInput');
        if(input) input.value='';
        modal.style.display='flex';
        input?.focus();
      };
    }
    // 对话框事件（静态 HTML，初始化时绑定一次）
    function bindVideoModal(){
      const modal=$('#videoModal'); if(!modal) return;
      $('#btnVideoCancel').onclick=()=>{modal.style.display='none'};
      modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
      $('#btnVideoInsert').onclick=()=>{
        const r=buildVideoEmbed($('#fVideoInput')?.value);
        if(r.error){toast(r.error);return}
        insertMarkdownBlock(r.html);
        modal.style.display='none';
        toast('已插入视频');
      };
      $('#fVideoInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#btnVideoInsert').click()}});
    }

    /* ── 插入音乐播放条（自托管音频直链，如 jsDelivr 上的 mp3 / flac） ── */
    // 从 song-player 占位代码中提取 data-* 字段
    function musicAttr(s,name){
      const m=s.match(new RegExp('data-'+name+'\\s*=\\s*["\']([^"\']+)["\']','i'));
      return m?m[1]:'';
    }
    // 预览侧解码一次实体（生成器写入的 &lt; &amp; 等），避免标题/歌手双重转义显示为字面实体
    function musicDecode(s){
      return String(s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
    }
    // 生成标准占位代码；无 JS 时占位内的链接作为降级入口
    function musicEmbedHtml(src,title,artist,cover){
      if(!src||!/^(https?:)?\/\//i.test(src)) return {error:'音频地址必须是 http(s) 链接'};
      let attrs='data-src="'+mdAttr(src)+'"';
      if(title) attrs+=' data-title="'+mdAttr(title)+'"';
      if(artist) attrs+=' data-artist="'+mdAttr(artist)+'"';
      if(cover) attrs+=' data-cover="'+mdAttr(cover)+'"';
      return {html:'<div class="song-player" '+attrs+'><a href="'+mdAttr(src)+'">♪ 播放音频</a></div>'};
    }
    // 把用户输入转换为 song-player 占位代码；无法识别时返回 {error}
    function buildMusicEmbed(input,title,artist,cover){
      const s=(input||'').trim();
      if(!s) return {error:'请粘贴音频直链或 song-player 占位代码'};
      // 1) 直接粘贴 song-player 占位代码：提取字段重建（丢弃其他属性）
      if(/<div[^>]*song-player/i.test(s)){
        const src=musicAttr(s,'src');
        if(!src||!/^(https?:)?\/\//i.test(src)) return {error:'song-player 代码中缺少有效 src（须为 http(s)）'};
        return musicEmbedHtml(src,musicAttr(s,'title')||title,musicAttr(s,'artist')||artist,musicAttr(s,'cover')||cover);
      }
      // 2) 音频直链 / 网易云歌曲页链接
      if(/^(https?:)?\/\//i.test(s)){
        if(/music\.163\.com/i.test(s) && !/music\.163\.com\/song[?/]id=/i.test(s)){
          return {error:'无法识别该网易云链接：请粘贴歌曲页链接（music.163.com/song?id=…）自动适配，或使用「▶ 视频」插入官方外链播放器'};
        }
        return musicEmbedHtml(s,title,artist,cover);
      }
      return {error:'无法识别：请粘贴音频直链（http(s)）或网易云歌曲页链接'};
    }
    // 文章编辑器的「♪ 音乐」按钮 → 打开对话框
    function setupMusicInsert(){
      const btn=$('#btnInsertMusic'); if(!btn) return;
      btn.onclick=()=>{
        const modal=$('#musicModal'); if(!modal) return;
        ['fMusicSrc','fMusicTitle','fMusicArtist','fMusicCover'].forEach(id=>{const el=$('#'+id);if(el) el.value=''});
        const st=$('#musicProbe'); if(st) st.hidden=true;
        modal.style.display='flex';
        $('#fMusicSrc')?.focus();
      };
    }
    // 外链可播性探测：输入防抖后调 /api/audio-probe，结果展示在对话框内
    let musicProbeTimer=null;
    function probeAudioLink(){
      const srcEl=$('#fMusicSrc'), st=$('#musicProbe');
      if(!srcEl||!st) return;
      const v=srcEl.value.trim();
      if(!v){st.hidden=true;return}
      if(!/^(https?:)?\/\//i.test(v)){st.hidden=false;st.className='music-probe bad';st.textContent='⚠ 请输入 http(s) 链接';return}
      st.hidden=false;st.className='music-probe idle';st.textContent='⏳ 探测中…';
      apiFetch('/api/audio-probe?url='+encodeURIComponent(v))
        .then(r=>r.json())
        .then(d=>{
          if(d.ok){
            st.className='music-probe ok';
            st.textContent='✓ 可播放'+(d.note?'（'+d.note+'）':'')+(d.contentType?' · '+d.contentType:'')+(d.size?' · '+Math.round(d.size/1024)+'KB':'');
          }else{
            st.className='music-probe bad';
            st.textContent='⚠ 探测失败：该链接可能不是可播放的音频直链'+(d.error?'（'+d.error+'）':'');
          }
        })
        .catch(()=>{st.className='music-probe bad';st.textContent='⚠ 探测失败：网络错误'});
    }
    // 对话框事件（静态 HTML，初始化时绑定一次）
    function bindMusicModal(){      const modal=$('#musicModal'); if(!modal) return;
      $('#btnMusicCancel').onclick=()=>{modal.style.display='none'};
      modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
      $('#btnMusicInsert').onclick=()=>{
        const r=buildMusicEmbed($('#fMusicSrc')?.value,$('#fMusicTitle')?.value,$('#fMusicArtist')?.value,$('#fMusicCover')?.value);
        if(r.error){toast(r.error);return}
        insertMarkdownBlock(r.html);
        modal.style.display='none';
        toast('已插入音乐播放条');
      };
      $('#fMusicSrc').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#btnMusicInsert').click()}});
      $('#fMusicSrc').addEventListener('input',()=>{clearTimeout(musicProbeTimer);musicProbeTimer=setTimeout(probeAudioLink,400)});
      // 音频上传：选择文件后经 /api/upload 落库并解析元数据，回填直链与歌名/歌手/封面
      const musicFile=$('#fMusicFile'), musicUploadBtn=$('#btnMusicUpload');
      if(musicFile&&musicUploadBtn){
        musicUploadBtn.onclick=()=>musicFile.click();
        musicFile.addEventListener('change',async()=>{
          const f=musicFile.files?musicFile.files[0]:null;
          musicFile.value='';
          if(!f) return;
          if(!f.type.startsWith('audio/')){toast('仅支持音频文件');return}
          toast('上传并解析中…');
          const fd=new FormData(); fd.set('file',f);
          try{
            const res=await apiFetch('/api/upload',{method:'POST',body:fd});
            const data=await res.json();
            if(!res.ok){toast(data.error||'上传失败');return}
            const srcEl=$('#fMusicSrc');
            if(srcEl) srcEl.value=data.url;
            const tEl=$('#fMusicTitle'), aEl=$('#fMusicArtist'), cEl=$('#fMusicCover');
            if(data.title){ if(tEl) tEl.value=data.title; if(aEl) aEl.value=data.artist||''; if(cEl) cEl.value=data.coverUrl||''; }
            else { if(tEl) tEl.value=''; if(aEl) aEl.value=''; if(cEl) cEl.value=data.coverUrl||''; }
            toast(data.title?'已上传并解析歌曲信息':'已上传，未能解析歌曲信息，请手动填写');
            probeAudioLink();
          }catch(e){toast('上传失败：'+e.message)}
        });
      }
    }

    // 音频上传（拖拽 / 粘贴 / 文件选择）：上传 + 解析元数据；解析成功直接插入播放条，失败弹窗补全
    async function uploadAudioTrack(file){
      if(!file) return;
      if(!file.type.startsWith('audio/')){toast('仅支持音频文件');return}
      toast('上传并解析中…');
      const fd=new FormData(); fd.set('file',file);
      try{
        const res=await apiFetch('/api/upload',{method:'POST',body:fd});
        const data=await res.json();
        if(data.error){toast(data.error);return}
        if(data.title){
          const r=musicEmbedHtml(data.url,data.title,data.artist||'',data.coverUrl||'');
          if(!r.error){
            insertMarkdownBlock(r.html);
            toast('已插入播放条（'+data.title+'）');
            return;
          }
        }
        // 未能解析元数据：打开对话框预填直链，让用户补全歌名等信息
        const modal=$('#musicModal');
        if(modal){
          const srcEl=$('#fMusicSrc'); if(srcEl) srcEl.value=data.url;
          const tEl=$('#fMusicTitle'); if(tEl) tEl.value=data.title||'';
          const aEl=$('#fMusicArtist'); if(aEl) aEl.value=data.artist||'';
          const cEl=$('#fMusicCover'); if(cEl) cEl.value=data.coverUrl||'';
          const st=$('#musicProbe'); if(st) st.hidden=true;
          modal.style.display='flex';
          $('#fMusicTitle')?.focus();
          toast('未能解析歌曲信息，请手动填写');
        }else{
          toast('上传失败：编辑器未就绪');
        }
      }catch(e){toast('上传失败：'+e.message)}
    }

    /* ── Vditor（开源 Markdown 编辑器）：即时渲染 IR / 分屏 SV / 所见即所得 / 源码 ── */
    let vditor = null;
    let editorView = 'ir';

    const VDITOR_CDN = '/admin/vendor/vditor';
    const EDITOR_VIEWS = new Set(['ir', 'sv', 'wysiwyg', 'source']);

    function normalizeEditorView(view) {
      // 兼容旧版本的视图取值
      if (view === 'split') return 'ir';
      if (view === 'edit') return 'source';
      return EDITOR_VIEWS.has(view) ? view : 'ir';
    }

    // 创建/重建编辑器（每次渲染编辑器区域时调用；value 为 Markdown 源码，
    // 兼容纯 Markdown / Markdown+HTML 混合内容）
    function initVditorEditor(content) {
      const el = $('#vditorEditor');
      if (!el) return null;
      if (vditor) { try { vditor.destroy(); } catch (e) { /* ignore */ } vditor = null; window.editor = null; }
      if (!window.Vditor) { toast('编辑器组件加载失败，请检查 /admin/vendor/vditor/'); return null; }
      try {
        vditor = new Vditor(el, {
          cdn: VDITOR_CDN,
          lang: 'zh_CN',
          theme: 'dark',
          mode: 'ir',
          height: '100%',
          minHeight: 380,
          value: String(content || ''),
          placeholder: '开始写作… 支持 Markdown 与原始 HTML',
          cache: { enable: false },
          counter: { enable: false },
          outline: { enable: false },
          resize: { enable: true },
          typewriterMode: localStorage.getItem('admin-typewriter') === '1',
          toolbarConfig: { pin: true },
          toolbar: [
            'headings', 'bold', 'italic', 'strike', '|',
            'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
            'quote', 'line', 'code', 'inline-code', 'link', 'table', '|',
            'upload', 'forecolor', 'backcolor', '|',
            'undo', 'redo', '|',
            'fullscreen', 'outline', 'edit-mode', 'both', 'preview', 'help',
          ],
          preview: {
            markdown: {
              toc: true,
              markdown: {},
              hljs: { lineNumber: true, style: 'github-dark' },
              theme: { current: 'dark', path: `${VDITOR_CDN}/dist/css/content-theme` },
            },
          },
          upload: {
            accept: 'image/*',
            multiple: false,
            handler: async (files) => {
              const succMap = {};
              const errFiles = [];
              for (const file of files) {
                try {
                  const fd = new FormData();
                  fd.append('file', file, file.name);
                  const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
                  const data = await res.json();
                  if (!res.ok || data.error) { errFiles.push(file.name); toast(`${data.error || '上传失败'}：${file.name}`); continue; }
                  succMap[file.name] = data.url;
                } catch (e) {
                  errFiles.push(file.name);
                }
              }
              return JSON.stringify({ msg: '', code: 0, data: { errFiles, succMap } });
            },
            error: (msg) => toast('上传失败：' + msg),
          },
          input: () => { syncPostCoverPreview(); markPostDirty(); updatePostValidation(); },
          after: () => { setupEditorImgRetry(el); setupEditorInputTracking(el); scheduleEditorReady(); },
        });
        window.editor = createEditorShim();
        window.vditor = vditor;
      } catch (e) {
        console.error('Vditor 初始化失败:', e);
        toast('编辑器初始化失败: ' + e.message);
        vditor = null;
        return null;
      }
      return vditor;
    }

    /** Vditor 首屏渲染后 Lute 仍在异步加载：等待就绪再应用视图与基线 */
    function scheduleEditorReady() {
      let attempts = 0;
      const run = () => {
        if (!vditor) return;
        const luteReady = Boolean(vditor.vditor && vditor.vditor.lute);
        if (!luteReady && attempts < 40) { attempts += 1; setTimeout(run, 100); return; }
        applyEditorInitialView();
        finalizePostEditorInit();
      };
      run();
    }

    /** 首次渲染完成后应用上次使用的视图；未设置时，含块级 HTML 的文章默认分屏（可实时预览） */
    function applyEditorInitialView() {
      const saved = localStorage.getItem('admin-editor-view');
      const md = getEditorMarkdown() || '';
      const hasBlockHtml = /(^|\n)\s*<(div|iframe|video|audio|section|figure|table|center|details)\b/i.test(md);
      const savedView = normalizeEditorView(saved || (hasBlockHtml ? 'sv' : 'ir'));
      applyView(savedView, true);
      const vs = $('#viewSwitch');
      if (vs) vs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === savedView));
      updateRichStatus();
    }

    /** 兼容层：测试与旧代码通过 editor.getMarkdown() / setMarkdown() 读写正文 */
    function createEditorShim() {
      return {
        getMarkdown: () => getEditorMarkdown(),
        setMarkdown: (v) => { if (vditor) { vditor.setValue(String(v || '')); syncPostCoverPreview(); markPostDirty(); updatePostValidation(); } },
        getValue: () => getEditorMarkdown(),
        setValue: (v) => { if (vditor) vditor.setValue(String(v || '')); },
        getHTML: () => (vditor ? vditor.getHTML() : ''),
        insertValue: (v, render = true) => { if (vditor) vditor.insertValue(v, render); },
        focus: () => { if (vditor) vditor.focus(); },
      };
    }

    // 保存 / 封面提取等统一取 Markdown 源码（Vditor 始终以 Markdown 为事实来源）
    function getEditorMarkdown() {
      try { return vditor ? vditor.getValue() : ''; } catch (e) { return ''; }
    }

    // 是否「所见即所得」（Vditor 的即时渲染 ir 同样保留原始 HTML，可安全编辑）
    function isWysiwygView() {
      return editorView === 'wysiwyg';
    }

    // 在光标处插入 Markdown / HTML 片段（视频 / 音乐 / 图宽 / 图片）
    function insertMarkdownBlock(md) {
      if (!vditor) { toast('编辑器未就绪'); return; }
      const text = (md.startsWith('\n') ? '' : '\n') + md + '\n';
      vditor.focus();
      vditor.insertValue(text, true);
    }

    function insertImageIntoEditor(url, alt) {
      insertMarkdownBlock(`![${alt || '图片'}](${url})`);
    }

    // 视频 / 音乐 / 图宽等标记以 HTML 形态存在：Vditor 的即时渲染 / 分屏会原样保留
    function ensureMarkdownMode() {
      if (!vditor) return;
      if (editorView === 'wysiwyg') applyView('ir', true);
    }

    // Vditor 4 未提供公开的 setMode；通过内置 edit-mode 工具栏按钮切换（固定版本 4.0.0）
    function switchVditorMode(mode) {
      if (!vditor) return false;
      const target = mode === 'source' ? 'sv' : mode;
      const toolbar = vditor.vditor && vditor.vditor.toolbar;
      const item = toolbar && toolbar.elements ? toolbar.elements['edit-mode'] : null;
      const btn = item ? item.querySelector(`button[data-mode="${target}"]`) : null;
      if (!btn) return false;
      btn.click();
      return true;
    }

    // 视图切换：即时渲染 ir / 分屏 sv / 所见即所得 wysiwyg / 源码 source；成功返回 true
    function applyView(view, silent) {
      if (!vditor) return false;
      const wasDirty = postDirty;
      const next = normalizeEditorView(view);
      try {
        const currentMode = vditor.getCurrentMode();
        const targetMode = next === 'source' ? 'sv' : next;
        if (currentMode !== targetMode) {
          if (!switchVditorMode(next)) return false;
        }
        if (next === 'sv' || next === 'source') {
          vditor.setPreviewMode(next === 'source' ? 'editor' : 'both');
        } else {
          try { vditor.setPreviewMode('both'); } catch (e) { /* ir/wysiwyg 下可能不适用 */ }
        }
      } catch (e) { return false; }
      editorView = next;
      const container = $('#editorBody');
      if (container) {
        container.classList.toggle('acr-source-only', next === 'source');
        container.classList.toggle('acr-mode-ir', next === 'ir');
        container.classList.toggle('acr-mode-wysiwyg', next === 'wysiwyg');
      }
      if (!silent && next === 'wysiwyg') {
        const md = getEditorMarkdown() || '';
        if (/<(?:div|mark|center|u|iframe|song-player)\b/i.test(md)) {
          toast('正文含原始 HTML（对齐 / 高亮 / 视频 / 播放条等）：所见即所得下部分结构可能不渲染，建议用「即时渲染」编辑');
        }
      }
      if (typeof updateRichStatus === 'function') updateRichStatus();
      // 模式切换时 Vditor 可能会对 Markdown 做等价的空白/结构归一化：若切换前没有未保存修改，
      // 则重新锁定基线，避免把「只是换了视图」误报为未保存修改。
      if (!silent && !wasDirty && postBaselineSnapshot) {
        postBaselineSnapshot = serializePostForm(readPostFormState());
        postDirty = false;
        updatePostEditorStatus();
      }
      return true;
    }

    function setupViewSwitch() {
      const vs = $('#viewSwitch');
      if (!vs) return;
      vs.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => {
          const v = btn.dataset.view;
          if (!applyView(v)) return; // 切换失败时保持原状态
          vs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
          try { localStorage.setItem('admin-editor-view', v); } catch(e) {}
        };
      });
    }

    // 原生输入监听兜底：确保任何输入路径（键盘 / 粘贴 / 拖放）都能触发脏状态与统计更新
    function setupEditorInputTracking(root) {
      if (!root || root.dataset.acrInputTracked) return;
      root.dataset.acrInputTracked = '1';
      let timer = null;
      const onChange = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { syncPostCoverPreview(); markPostDirty(); updatePostValidation(); }, 250);
      };
      root.addEventListener('input', onChange, true);
      root.addEventListener('keyup', onChange, true);
      root.addEventListener('paste', onChange, true);
      root.addEventListener('drop', onChange, true);
    }

    // 预览图片加载失败自动重试：jsDelivr CDN 首次访问可能未生效（上传后立即预览）
    function setupEditorImgRetry(root) {
      if (!root || root.dataset.acrImgRetry) return;
      root.dataset.acrImgRetry = '1';      root.addEventListener('error', e => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !img.src || img.dataset.retryDone) return;
        const n = parseInt(img.dataset.retryCount || '0', 10);
        if (n >= 7) { img.dataset.retryDone = '1'; return; }
        img.dataset.retryCount = String(n + 1);
        const orig = img.dataset.origSrc || img.src;
        img.dataset.origSrc = orig;
        setTimeout(() => {
          if (!img.isConnected) return; // 已被重新渲染移除，交由新一轮重试
          const mirrors = [null, null, null, null, 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'];
          const host = mirrors[Math.min(n, mirrors.length - 1)];
          img.src = host && orig.includes('cdn.jsdelivr.net') ? orig.replace('cdn.jsdelivr.net', host) : orig;
        }, 1500 * (n + 1));
      }, true);
    }

    // ── 段落对齐：把选中段落包成 <div style="text-align:…">（Vditor 保留原始 HTML）──
    function applyAlignToMarkdown(align) {
      if (!vditor) { toast('编辑器未就绪'); return; }
      const selected = vditor.getSelection();
      if (!selected || !selected.trim()) {
        toast('请先选中要设置对齐的段落，再点击对齐按钮');
        return;
      }
      const m = selected.match(/^<div[^>]*>([\s\S]*)<\/div>$/);
      const inner = m ? m[1] : selected;
      vditor.updateValue(`<div style="text-align: ${align}">\n\n${inner}\n\n</div>`);
      vditor.focus();
      toast('已设为' + (align === 'left' ? '居左' : align === 'center' ? '居中' : '居右'));
    }

    

    /* ── 格式工具栏（加粗/标题/列表/颜色等已由 Vditor 内置工具栏提供；此处只保留对齐） ── */
    function setupFmtToolbar(){
      document.querySelectorAll('[data-align]').forEach(btn=>{
        btn.onclick=()=>applyAlignToMarkdown(btn.dataset.align);
      });
    }

    /* ── 编辑器辅助：大纲开关 / 专注模式 ── */
    function setupEditorTools() {
      const outline = $('#btnOutline');
      if (outline) outline.onclick = () => {
        const item = vditor && vditor.vditor && vditor.vditor.toolbar ? vditor.vditor.toolbar.elements['outline'] : null;
        const btn = item ? (item.querySelector('button') || item) : null;
        if (btn && typeof btn.click === 'function') btn.click();
        else toast('大纲面板不可用');
      };
      const focus = $('#btnFocusMode');
      if (focus) {
        focus.classList.toggle('primary', document.body.classList.contains('focus-mode'));
        focus.onclick = () => {
          const on = document.body.classList.toggle('focus-mode');
          focus.classList.toggle('primary', on);
          try { localStorage.setItem('admin-focus-mode', on ? '1' : '0'); } catch (e) { /* ignore */ }
          window.dispatchEvent(new Event('resize'));
        };
      }
      const typewriter = $('#btnTypewriter');
      if (typewriter) {
        typewriter.classList.toggle('primary', localStorage.getItem('admin-typewriter') === '1');
        typewriter.onclick = () => {
          const on = !(vditor && vditor.vditor && vditor.vditor.options && vditor.vditor.options.typewriterMode);
          typewriter.classList.toggle('primary', on);
          if (vditor && vditor.vditor && vditor.vditor.options) vditor.vditor.options.typewriterMode = on;
          try { localStorage.setItem('admin-typewriter', on ? '1' : '0'); } catch (e) { /* ignore */ }
          try { if (vditor) vditor.focus(); } catch (e) { /* ignore */ }
        };
      }
    }

    function applySavedFocusMode() {
      try { if (localStorage.getItem('admin-focus-mode') === '1') document.body.classList.add('focus-mode'); } catch (e) { /* ignore */ }
    }

    /* ── 发布前检查（preflight）── */
    function showPreflight() {
      if (!document.querySelector('#fTitle')) { toast('请先打开一篇文章'); return; }
      const mask = $('#preflightModal');
      if (!mask) return;
      const form = readPostFormState();
      const content = getEditorMarkdown();
      const { results, errors, warns, blocked } = runPreflight({ form, content, posts, currentSlug });
      const icons = { error: '✕', warn: '!', ok: '✓', info: 'i' };
      const summary = $('#preflightSummary');
      if (summary) {
        summary.innerHTML = blocked
          ? `<span class="sync-err">存在 ${errors} 个必须修复的问题</span>`
          : (warns ? `<span class="sync-warn">可以发布，但有 ${warns} 条建议</span>` : '<span class="sync-ok">检查通过，可以发布</span>');
      }
      const list = $('#preflightList');
      if (list) {
        list.innerHTML = results.map((r) => `<div class="preflight-item ${r.level}"><span class="pf-icon">${icons[r.level] || '·'}</span><b>${esc(r.label)}</b><span>${esc(r.message)}</span></div>`).join('');
      }
      openModal(mask);
    }

    /* ── 图片尺寸：生成带宽度样式的 <img> 插入（TOAST UI 无法读取光标处图片，预填正文第一张图） ── */
    function setupImgSize(){
      const btn=$('#btnInsertImgSize'); if(!btn) return;
      btn.onclick=()=>{
        const modal=$('#imgSizeModal'); if(!modal) return;
        const md=getEditorMarkdown()||'';
        const m=md.match(/!\[[^\]]*\]\(\s*([^\s)\r\n]+)/);
        const sEl=$('#fImgSizeSrc'); if(sEl) sEl.value=m?m[1]:'';
        const vEl=$('#fImgSizeVal'); if(vEl) vEl.value=60;
        const uEl=$('#fImgSizeUnit'); if(uEl) uEl.value='%';
        modal.style.display='flex';
        (m?$('#fImgSizeVal'):sEl)?.focus();
      };
    }
    function bindImgSizeModal(){
      const modal=$('#imgSizeModal'); if(!modal) return;
      $('#btnImgSizeCancel').onclick=()=>{modal.style.display='none'};
      modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
      $('#btnImgSizeClear').onclick=()=>{const v=$('#fImgSizeVal');if(v)v.value=''};
      $('#btnImgSizeInsert').onclick=()=>{
        const src=($('#fImgSizeSrc')?.value||'').trim();
        const val=($('#fImgSizeVal')?.value||'').trim();
        const unit=$('#fImgSizeUnit')?.value==='px'?'px':'%';
        if(!src){toast('请输入图片 URL');return}
        if(!/^(https?:)?\/\//i.test(src)){toast('图片 URL 必须是 http(s) 链接');return}
        let img='<img src="'+mdAttr(src)+'" alt="图片"';
        if(val){
          const n=parseFloat(val);
          if(Number.isFinite(n)&&n>0) img+=' style="width:'+n+unit+'"';
        }
        img+=' />';
        insertMarkdownBlock(img);
        modal.style.display='none';
        toast('已设置图片尺寸');
      };
      $('#fImgSizeSrc').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#btnImgSizeInsert').click()}});
    }

    // Chrome/Edge 等浏览器不识别 HEIC，file.type 为空字符串：用扩展名白名单兜底，交给后端自动转 WebP
    function isImageFile(f){
      return !!f && (f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic|heif)$/i.test(f.name||''));
    }

    /* ── 封面裁剪：上传后截选 16:10 区域 ── */
    const COVER_RATIO = 16 / 10;
    const COVER_OUT_W = 1600;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    let crop = null; // { img, imgW, imgH, scale, ox, oy, minScale, sel, uploadedUrl, onDone, sourceIsLocal }

    // 封面上传流程：先上传原图 → 打开裁剪对话框 → 用户确认后按所选区域生成封面图再上传
    async function uploadCover(file) {
      if(!isImageFile(file)){toast('仅支持图片');return}
      toast('上传中…');
      const fd = new FormData(); fd.set('file', file);
      let data;
      try {
        const res = await apiFetch('/api/upload', { method:'POST', body:fd });
        data = await res.json();
      } catch(e) { toast('上传失败'); return; }
      if(data.error){toast(data.error);return}
      openCoverCrop(file, data.url, url => {
        const coverInput = $('#fCover');
        if (coverInput) { coverInput.value = url; coverInput.focus(); syncPostCoverPreview(); }
        toast('封面已设置: ' + url);
      });
    }

    function openCoverCrop(file, uploadedUrl, onDone) {
      const modal = $('#coverCropModal');
      if (!modal) return;
      crop = { img: null, imgW: 0, imgH: 0, scale: 1, ox: 0, oy: 0, minScale: 1,
               sel: { x:0, y:0, w:0, h:0 }, uploadedUrl, onDone, sourceIsLocal: true };
      const img = $('#cropImg');
      const btn = $('#btnCropConfirm');
      if (btn) { btn.disabled = false; btn.textContent = '确认裁剪'; }
      $('#cropLoading').hidden = false;
      img.removeAttribute('src');
      img.onload = () => {
        if (!crop || !img.naturalWidth) return;
        crop.img = img;
        crop.imgW = img.naturalWidth;
        crop.imgH = img.naturalHeight;
        initCropLayout();
      };
      img.onerror = () => {
        if (!crop) return;
        if (crop.sourceIsLocal) {
          // 本地无法解码（如 HEIC）：改用服务器已转码的图片（jsDelivr WebP，CORS 允许）
          crop.sourceIsLocal = false;
          img.src = crop.uploadedUrl;
        } else {
          // 服务器图片也加载失败：放弃裁剪，直接落地上传结果
          toast('无法显示该图片，已直接使用上传结果');
          const done = crop.onDone, url = crop.uploadedUrl;
          closeCoverCrop();
          done && done(url);
        }
      };
      modal.style.display = 'flex';
      img.crossOrigin = 'anonymous'; // 回退到服务器图（jsDelivr 等带 CORS）时 canvas 才可读
      try {
        crop.sourceIsLocal = true;
        crop.blobUrl = URL.createObjectURL(file);
        img.src = crop.blobUrl;
      } catch(e) {
        crop.sourceIsLocal = false;
        img.src = uploadedUrl;
      }
    }

    function closeCoverCrop() {
      const modal = $('#coverCropModal');
      if (modal) modal.style.display = 'none';
      if (crop) {
        if (crop.blobUrl) { URL.revokeObjectURL(crop.blobUrl); crop.blobUrl = null; }
        const img = $('#cropImg');
        if (img) img.removeAttribute('src');
      }
      crop = null;
      const btn = $('#btnCropConfirm');
      if (btn) { btn.disabled = false; btn.textContent = '确认裁剪'; }
    }

    // 初始布局：整图完整显示，选区为图中最大的 16:10 矩形（居中）
    function initCropLayout() {
      const view = $('#cropView');
      const rect = view.getBoundingClientRect();
      const viewW = Math.max(rect.width - 2, 100), viewH = Math.max(rect.height - 2, 100);
      const scale = Math.min(viewW / crop.imgW, viewH / crop.imgH);
      crop.minScale = scale;
      crop.scale = scale;
      crop.ox = (viewW - crop.imgW * scale) / 2;
      crop.oy = (viewH - crop.imgH * scale) / 2;
      let w, h;
      if (crop.imgW / crop.imgH > COVER_RATIO) { h = crop.imgH; w = h * COVER_RATIO; }
      else { w = crop.imgW; h = w / COVER_RATIO; }
      crop.sel = { x: (crop.imgW - w) / 2, y: (crop.imgH - h) / 2, w, h };
      $('#cropLoading').hidden = true;
      renderCrop();
    }

    function renderCrop() {
      if (!crop) return;
      const view = $('#cropView');
      const rect = view.getBoundingClientRect();
      const img = $('#cropImg');
      img.style.width = Math.round(crop.imgW * crop.scale) + 'px';
      img.style.height = Math.round(crop.imgH * crop.scale) + 'px';
      img.style.left = Math.round(crop.ox) + 'px';
      img.style.top = Math.round(crop.oy) + 'px';
      updateCropMasks(rect.width, rect.height);
    }

    function updateCropMasks(viewW, viewH) {
      const sel = crop.sel;
      const sx = crop.ox + sel.x * crop.scale;
      const sy = crop.oy + sel.y * crop.scale;
      const sw = sel.w * crop.scale;
      const sh = sel.h * crop.scale;
      const selEl = $('#cropSel');
      selEl.style.left = sx + 'px'; selEl.style.top = sy + 'px';
      selEl.style.width = sw + 'px'; selEl.style.height = sh + 'px';
      const place = (id, l, t, w, h) => {
        const el = $(id);
        el.style.left = l + 'px'; el.style.top = t + 'px';
        el.style.width = Math.max(0, w) + 'px'; el.style.height = Math.max(0, h) + 'px';
      };
      place('#cropMaskTop', 0, 0, viewW, sy);
      place('#cropMaskLeft', 0, sy, sx, sh);
      place('#cropMaskRight', sx + sw, sy, viewW - sx - sw, sh);
      place('#cropMaskBottom', 0, sy + sh, viewW, viewH - sy - sh);
    }

    // 确认裁剪：canvas 按选区输出 16:10 封面图，再走 /api/upload 上传入库
    function confirmCoverCrop() {
      if (!crop || !crop.img) return;
      const done = crop.onDone; // 开头捕获，避免异步回调中 crop 已被取消置 null
      const img = crop.img, sel = crop.sel;
      const outW = Math.max(320, Math.min(COVER_OUT_W, Math.round(sel.w)));
      const outH = Math.round(outW / COVER_RATIO);
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try {
        ctx.drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, outW, outH);
      } catch(e) {
        toast('无法处理该图片（可能跨域受限），已使用原图');
        const done = crop.onDone, url = crop.uploadedUrl;
        closeCoverCrop();
        done && done(url);
        return;
      }
      const btn = $('#btnCropConfirm');
      if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
      const finish = () => { if (btn) { btn.disabled = false; btn.textContent = '确认裁剪'; } };
      try {
        canvas.toBlob(blob => {
          if (!blob) { toast('裁剪失败'); finish(); return; }
          if (!crop) { finish(); return; } // 已取消：不发无意义请求
          const fd = new FormData();
          fd.set('file', blob, 'cover_' + Date.now() + '.webp');
          apiFetch('/api/upload', { method:'POST', body:fd })
            .then(r => r.json())
            .then(data => {
              if (data.error) { toast(data.error); return; }
              if (!crop) { toast('已取消，裁剪图仍保留在仓库'); return; }
              closeCoverCrop();
              done && done(data.url);
            })
            .catch(() => toast('裁剪图上传失败'))
            .finally(finish);
        }, 'image/webp', 0.92);
      } catch(e) {
        // canvas 被跨域图片污染时 toBlob 抛 SecurityError → 回退使用原图
        toast('无法处理该图片（跨域受限），已使用原图');
        finish();
        const url = crop.uploadedUrl;
        closeCoverCrop();
        done && done(url);
      }
    }

    function bindCoverCropModal() {
      const modal = $('#coverCropModal'); if (!modal) return;
      $('#btnCropCancel').onclick = closeCoverCrop;
      modal.addEventListener('click', e => { if (e.target === modal) closeCoverCrop(); });
      $('#btnCropOriginal').onclick = () => {
        if (!crop) return;
        const done = crop.onDone, url = crop.uploadedUrl;
        closeCoverCrop();
        done && done(url);
      };
      $('#btnCropConfirm').onclick = confirmCoverCrop;

      const view = $('#cropView');
      // 选区拖动移动 / 右下角手柄缩放（保持 16:10）
      view.addEventListener('pointerdown', e => {
        if (!crop || !crop.img) return;
        const handle = e.target.closest && e.target.closest('#cropHandle');
        const selEl = $('#cropSel');
        const inSel = handle || e.target === selEl || selEl.contains(e.target);
        if (!inSel) return;
        e.preventDefault();
        view.setPointerCapture(e.pointerId);
        const mode = handle ? 'resize' : 'move';
        const start = { x: e.clientX, y: e.clientY, sx: crop.sel.x, sy: crop.sel.y, sw: crop.sel.w, sh: crop.sel.h };
        const onMove = ev => {
          if (!crop) return;
          const dx = (ev.clientX - start.x) / crop.scale;
          const dy = (ev.clientY - start.y) / crop.scale;
          if (mode === 'move') {
            crop.sel.x = clamp(start.sx + dx, 0, crop.imgW - crop.sel.w);
            crop.sel.y = clamp(start.sy + dy, 0, crop.imgH - crop.sel.h);
          } else {
            // 以选区中心为锚缩放
            const cx = start.sx + start.sw / 2, cy = start.sy + start.sh / 2;
            let w = start.sw + Math.max(dx, dy / COVER_RATIO);
            const maxW = Math.min(cx * 2, (crop.imgW - cx) * 2, cy * 2 * COVER_RATIO, (crop.imgH - cy) * 2 * COVER_RATIO);
            const minW = Math.min(64, Math.max(1, maxW));
            w = clamp(w, minW, maxW);
            const h = w / COVER_RATIO;
            crop.sel = { x: cx - w / 2, y: cy - h / 2, w, h };
          }
          renderCrop();
        };
        const onUp = () => {
          view.removeEventListener('pointermove', onMove);
          view.removeEventListener('pointerup', onUp);
          view.removeEventListener('pointercancel', onUp);
        };
        view.addEventListener('pointermove', onMove);
        view.addEventListener('pointerup', onUp);
        view.addEventListener('pointercancel', onUp);
      });

      // 滚轮缩放（以鼠标位置为中心）
      view.addEventListener('wheel', e => {
        if (!crop || !crop.img) return;
        e.preventDefault();
        const rect = view.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const newScale = clamp(crop.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), crop.minScale, crop.minScale * 8);
        const ox = (px - crop.ox) / crop.scale, oy = (py - crop.oy) / crop.scale;
        crop.scale = newScale;
        crop.ox = px - ox * newScale;
        crop.oy = py - oy * newScale;
        renderCrop();
      }, { passive: false });

      window.addEventListener('beforeunload', e => {
      if (!postDirty) return;
      savePostDraftNow();
      e.preventDefault();
      e.returnValue = '';
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.style.display !== 'none') closeCoverCrop();
      });
    }

    async function uploadImage(file, target = 'content') {
      if(!isImageFile(file)){toast('仅支持图片');return}
      if (target === 'cover') return uploadCover(file);
      toast('上传中…');
      const fd = new FormData(); fd.set('file', file);
      try {
        const res = await apiFetch('/api/upload', { method:'POST', body:fd });
        const data = await res.json();
        if(data.error){toast(data.error);return}
        if (currentMode === 'frontend') {
          const imageInput = $('#' + frontendUploadField);
          if (imageInput) { imageInput.value = data.url; imageInput.focus(); syncFrontendPreview(); }
          toast('背景图已上传: ' + data.url);
        } else if (currentMode === 'gallery') {
          const srcInput = $('#fSrc');
          if (srcInput) { srcInput.value = data.url; srcInput.focus(); }
          const titleInput = $('#fGalleryTitle');
          if (titleInput && !titleInput.value.trim()) {
            titleInput.value = file.name.replace(/\.[^.]+$/, '');
          }
          const originalInput = $('#fOriginal');
          if (originalInput && !originalInput.value.trim() && data.originalUrl) {
            originalInput.value = data.originalUrl;
          }
          toast('已上传: ' + data.url);
        } else if (currentMode === 'about') {
          const avatarInput = $('#fAvatar');
          if (avatarInput) { avatarInput.value = data.url; avatarInput.focus(); refreshAvatarPreview(); }
          toast('已上传头像: ' + data.url);
        } else {
          insertImageIntoEditor(data.url, file.name.replace(/\.[^.]+$/, ''));
          toast('已上传: '+data.url);
        }
      } catch(e) { toast('上传失败') }
    }

    /* 转义与 Toast 已抽到 ./ui/dom.js 与 ./ui/toast.js */

    /* ── Markdown 实时预览（零依赖手写渲染器） ── */
    // 文本层轻转义：保留 > 与 "，避免破坏引用/标题等结构语法；仅需阻断标签与实体注入
    function mdEscapeText(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
    // 属性值转义：额外转义双引号，防止注入属性；先还原一次 &amp; 避免双重转义
    function mdEscapeAttr(s){return mdEscapeText(s).replace(/"/g,'&quot;')}
    function mdAttr(s){return mdEscapeAttr(String(s).replace(/&amp;/g,'&'))}


    document.addEventListener('keydown', e => {
      if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();currentMode==='gallery'?saveGalleryItem():currentMode==='about'?saveAbout():currentMode==='frontend'?saveFrontend():currentMode==='access'?savePrivateAccess():currentMode==='guestbook'?null:savePost()}
    });

    bindVideoModal();
    bindMusicModal();
    bindImgSizeModal();
    bindCoverCropModal();
    setupMediaPicker();
    installFocusTrap();
    setupSessionControls();
    setupBatchControls();
    applySavedFocusMode();
    initSyncCenter({ getMode: () => currentMode, reloadPosts: () => loadPosts(), reloadGallery: () => loadGallery() });
    initGallery({ setupUpload, setupGalleryMediaButton });
    initMedia({ getPosts: () => posts, putPostFields });
    initAbout({ setupUpload });
    initFrontend({ setupUpload, setUploadField: (v) => { frontendUploadField = v; } });
    initListControls();
    loadPosts();

    // ── 模式切换 ──
    $('#modeTabs').addEventListener('click', e => {
      const tab = e.target.closest('.mode-tab');
      if (!tab || tab.dataset.mode === currentMode) return;
      switchMode(tab.dataset.mode);
    });

    function switchMode(mode) {
      if (mode !== currentMode && !canLeavePostEditor()) return;
      if (mode !== 'posts') resetPostEditorTracking();
      currentMode = mode;
      const listControls = $('#listControls');
      if (listControls) listControls.style.display = mode === 'posts' ? '' : 'none';
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
      if (mode === 'gallery') {
        $('#btnNew').textContent = '＋ 新建';
        currentSlug = null;
        $('#editorTitle').textContent = '选择或创建一幅图像';
        $('#btnNew').style.display = '';
        $('#btnSave').style.display = '';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').disabled = true;
        $('#editorContainer').innerHTML = '<div class="empty-state">← 从左侧列表选择图像，或点击「新建」</div>';
        loadGallery();
      } else if (mode === 'media') {
        currentSlug = null;
        resetGallerySelection();
        $('#editorTitle').textContent = '媒体库';
        $('#btnNew').style.display = '';
        $('#btnNew').textContent = '⬆ 上传';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').style.display = 'none';
        $('#editorContainer').innerHTML = '<div class="empty-state">加载媒体库…</div>';
        renderMediaSidebar();
        loadMedia();
      } else if (mode === 'about') {
        currentSlug = null;
        resetGallerySelection();
        $('#editorTitle').textContent = '关于页面';
        $('#btnNew').style.display = 'none';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').style.display = '';
        $('#btnSave').disabled = true;
        $('#editorContainer').innerHTML = '<div class="empty-state">加载关于页面…</div>';
        renderAboutList();
        loadAbout();
      } else if (mode === 'frontend') {
        currentSlug = null;
        resetGallerySelection();
        $('#editorTitle').textContent = '前端定制';
        $('#btnNew').style.display = 'none';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').style.display = '';
        $('#btnSave').disabled = true;
        $('#editorContainer').innerHTML = '<div class="empty-state">加载前端配置…</div>';
        renderFrontendList();
        loadFrontend();
      } else if (mode === 'access') {
        currentSlug = null; resetGallerySelection();
        $('#editorTitle').textContent = '访问控制'; $('#btnNew').style.display = 'none'; $('#btnDelete').style.display = 'none'; $('#btnSave').style.display = 'none';
        renderPrivateAccess();
      } else if (mode === 'guestbook') {
        currentSlug = null;
        $('#editorTitle').textContent = '留言管理（Waline）';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').style.display = 'none';
        $('#btnNew').style.display = 'none';
        $('#editorContainer').innerHTML = '<div class="empty-state">连接 Waline 服务后管理留言</div>';
        renderGuestbookList();
        loadGuestbookComments();
      } else {
        resetGallerySelection();
        $('#editorTitle').textContent = '选择或创建一篇文章';
        $('#btnSave').style.display = '';
        $('#btnNew').style.display = '';
        $('#btnNew').textContent = '＋ 新建';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').disabled = true;
        $('#editorContainer').innerHTML = '<div class="empty-state">← 从左侧列表选择文章，或点击「新建」</div>';
        loadPosts();
      }
    }

    // ── 按钮分发 ──
    $('#btnNew').onclick = () => currentMode === 'media' ? triggerMediaUpload() : currentMode === 'gallery' ? newGalleryItem() : newPost();
    $('#btnRefresh').onclick = () => currentMode === 'gallery' ? loadGallery() : currentMode === 'media' ? loadMedia() : currentMode === 'about' ? loadAbout() : currentMode === 'frontend' ? loadFrontend() : currentMode === 'access' ? renderPrivateAccess() : currentMode === 'guestbook' ? loadGuestbookComments() : loadPosts();
    $('#btnSave').onclick = () => currentMode === 'gallery' ? saveGalleryItem() : currentMode === 'about' ? saveAbout() : currentMode === 'frontend' ? saveFrontend() : savePost();
    $('#btnPreflight').onclick = showPreflight;
    $('#btnDelete').onclick = () => currentMode === 'gallery' ? (getCurrentGalleryId() && deleteGalleryItem(getCurrentGalleryId())) : (currentSlug && deletePost(currentSlug));
    $('#previewClose').onclick = closePostPreview;
    $('#preflightClose').onclick = () => closeModal($('#preflightModal'));
    $('#preflightModal').addEventListener('click', (e) => { if (e.target === $('#preflightModal')) closeModal($('#preflightModal')); });
    $('#historyClose').onclick = () => closeModal($('#historyModal'));
    $('#historyRestore').onclick = restoreRevision;
    $('#historyModal').addEventListener('click', (e) => { if (e.target === $('#historyModal')) closeModal($('#historyModal')); });
    $('#mediaUsageClose').onclick = () => closeModal($('#mediaUsageModal'));
    $('#mediaUsageModal').addEventListener('click', (e) => { if (e.target === $('#mediaUsageModal')) closeModal($('#mediaUsageModal')); });
    $('#previewModal').addEventListener('click', (e) => { if (e.target === $('#previewModal')) closePostPreview(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (isModalOpen($('#mediaPickerModal'))) closeMediaPicker();
      else if (isModalOpen($('#mediaUsageModal'))) closeModal($('#mediaUsageModal'));
      else if (isSyncModalOpen()) closeSyncModal();
      else if (isModalOpen($('#preflightModal'))) closeModal($('#preflightModal'));
      else if (isModalOpen($('#historyModal'))) closeModal($('#historyModal'));
      else if (isModalOpen($('#previewModal'))) closePostPreview();
    });
    $('#btnSite').onclick = () => window.open('https://blog.acretiondisk.top/', '_blank');

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
        await loadPosts();
        return true;
      } catch (e) { toast('更新文章失败: ' + e.message); return false; }
    }    // ── 会话：锁定 / 重新验证 / 退出并清除凭据 ──
    async function fetchHealth() {
      try {
        const res = await apiFetch('/api/health');
        return await res.json();
      } catch { return null; }
    }

    function lockPanel() {
      const overlay = $('#lockOverlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      const input = $('#lockInput');
      if (input) { input.value = ''; setTimeout(() => input.focus(), 0); }
    }

    async function unlockPanel() {
      const value = $('#lockInput')?.value?.trim() || '';
      if (!value) { toast('请输入管理口令'); return; }
      try {
        const res = await fetch('/api/health', { headers: { 'x-admin-token': value } });
        if (!res.ok) { toast('口令不正确'); return; }
        setToken(value);
        $('#lockOverlay').style.display = 'none';
        toast('已解锁');
        await refreshSyncStatus({ silent: true });
      } catch (e) { toast('验证失败: ' + e.message); }
    }

    function logoutPanel() {
      if (!confirm('退出管理面板？将清除留言凭据并停止当前会话。')) return;
      clearCredentials();
      setToken('');
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#141418;color:#c8b080;font-family:inherit">
          <h1 style="font-size:16px;letter-spacing:2px;font-weight:normal">已退出管理面板</h1>
          <p style="color:#6a6a70;font-size:12px">凭据已清除。可关闭本页；重新打开 http://localhost:4322/admin 会重新获得本机口令。</p>
          <button onclick="location.reload()" style="padding:7px 14px;border:1px solid #5a5020;background:#2a2818;color:#c8b080;border-radius:6px;cursor:pointer">重新进入</button>
        </div>`;
    }

    function setupSessionControls() {
      const lock = $('#btnLock');
      if (lock) lock.onclick = lockPanel;
      const logout = $('#btnLogout');
      if (logout) logout.onclick = logoutPanel;
      const unlock = $('#btnUnlock');
      if (unlock) unlock.onclick = unlockPanel;
      const input = $('#lockInput');
      if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockPanel(); });
    }

    // ── 模块边界：暴露给 HTML 内联事件与自动化测试的少量接口 ──
    window.toggleDraft = toggleDraft;
    window.__adminStore = store;
    window.__adminReady = true;
