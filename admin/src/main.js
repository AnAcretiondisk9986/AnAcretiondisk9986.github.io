
    import { $, esc, escAttr } from './ui/dom.js';
    import { toast } from './ui/app-toast.js';
    import { apiFetch, apiJson, getToken, setToken } from './api/app-client.js';
    import { store } from './state/store.js';
    import { slugifyTitle } from './util/slug.js';
    import { openModal, closeModal, isModalOpen, installFocusTrap } from './ui/modal.js';
    import { runPreflight } from './features/preflight.js';
    import { renderPrivateAccess, savePrivateAccess } from './features/access.js';
    import { initSyncCenter, closeSyncModal, isSyncModalOpen, refreshSyncStatus } from './features/sync-center.js';
    import { initAbout, renderAboutList, loadAbout, saveAbout, refreshAvatarPreview, isAboutDirty, clearAboutDirty, syncAboutDirty } from './features/about.js';
    import { initFrontend, renderFrontendList, loadFrontend, saveFrontend, syncFrontendPreview, isFrontendDirty, clearFrontendDirty, syncFrontendDirty } from './features/frontend.js';
    import { initSchedule, renderScheduleSidebar, loadSchedule, saveSchedule, isScheduleDirty, clearScheduleDirty } from './features/schedule.js';
    import { initPosts, updateBatchBar, setupBatchControls, showRevisionHistory, previewPostBySlug, copyPostLink, duplicatePost, quickToggleDraft, toggleArchive, closePostPreview, putPostFields, restoreRevision, renderLineDiff, renderMarkdownPreviewInto } from './features/posts.js';
    import { initDaily, loadDaily, newDailyItem, saveDailyItem, deleteDailyItem, getCurrentDailyId, resetDailySelection, isDailyDirty, clearDailyDirty, isDailyBusy } from './features/daily.js';
    import { initGallery, loadGallery, newGalleryItem, saveGalleryItem, deleteGalleryItem, getCurrentGalleryId, resetGallerySelection, isGalleryDirty, clearGalleryDirty, syncGalleryDirty, openGalleryBatchUploader, isGalleryBatchBusy } from './features/gallery.js';
    import { initMedia, loadMedia, renderMediaSidebar, triggerMediaUpload, openMediaPicker, closeMediaPicker, setupMediaPicker, setupCoverMediaButton, setupMediaInsertButton, setupGalleryMediaButton } from './features/media.js';
    import { renderWordRibbonHtml, mountWordEditor, katex } from './editor/word-ui.js';

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
    let postUploadTarget = 'content';
    let appUploadMaxBytes = 512 * 1024 * 1024;

    async function loadPosts() {
      try {
        const res = await apiFetch(API);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          store.set({ page: 'error' });
          renderListError(data.error || `加载失败（HTTP ${res.status}）`);
          return;
        }
        posts = await res.json();
        if (!Array.isArray(posts)) { store.set({ page: 'error' }); renderListError('返回数据格式不正确'); return; }
        store.set({ page: posts.length ? 'ready' : 'empty' });
        refreshTagOptions();
        renderList();
      } catch(e) { store.set({ page: 'error' }); renderListError(e.message); }
    }

    /** 列表加载失败：统一的 error + retry 视图 */
    function renderListError(message) {
      const el = $('#postList');
      if (!el) return;
      el.innerHTML = `<div class="empty-state" style="padding:24px;text-align:center;color:var(--danger)">加载失败<br/><span style="font-size:10px;color:var(--danger)">${esc(message || '未知错误')}</span></div>`;
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
        el.innerHTML = '<div class="empty-state" style="padding:30px">没有匹配的文章<br/><span style="font-size:10px;color:var(--text-faint)">试试减少筛选条件</span></div>';
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

    async function selectPost(slug, { skipLeaveGuard = false } = {}) {
      if (!skipLeaveGuard && !canLeavePostEditor()) return;
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
        const post = await res.json();
        if (!res.ok || post.error) { toast(post.error || `加载失败（HTTP ${res.status}）`); return; }
        renderEditor(post); renderList();
      } catch(e) { toast('加载失败: ' + e.message) }
    }

    function localToday() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
              <label>文章封面（用于首页与目录悬浮引力透镜）</label>
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
        store.set({ editor: { status: 'saving', dirty: true, saving: true } });
      } else if (postDirty) {
        btn.disabled = false;
        btn.textContent = '💾 保存 (Ctrl+S)';
        setPostEditorStatus('有未保存修改', 'dirty');
        store.set({ editor: { status: 'dirty', dirty: true, saving: false } });
      } else {
        btn.disabled = true;
        btn.textContent = '✓ 已保存';
        setPostEditorStatus(savedStatusText());
        store.set({ editor: { status: 'saved', dirty: false, saving: false, lastSavedAt: Date.now() } });
      }
    }

    /**
     * 保存后的状态文案：写入本地 Markdown ≠ 线上已更新。
     * 用工作区是否有未提交改动区分「未发布 / 已同步」，
     * 避免「保存了但忘了发布、线上没更新」这一最常见的困惑。
     */
    function savedStatusText() {
      const sync = store.get()?.syncStatus;
      const dirtyCount = sync?.dirtyCount ?? 0;
      return sync && sync.state === 'clean' && dirtyCount === 0
        ? '已保存 · 已同步'
        : '已保存到本地 · 未发布';
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
        if (wordController) wordController.setMarkdown(state.content || '');
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
      if (wordController) {
        try { wordController.destroy(); } catch { /* ignore */ }
        wordController = null;
        window.editor = null;
        window.wordEditor = null;
      }
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
      store.set({ editor: { status: 'pristine', dirty: false, saving: false, lastError: null } });
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
      el.hidden = true;
      el.textContent = '';
    }

    function applyPostTemplate(key) {
      const tpl = POST_TEMPLATES[key];
      if (!tpl || currentSlug) return;
      if (tpl.tags) $('#fTags').value = tpl.tags;
      if (tpl.description) $('#fDesc').value = tpl.description;
      if (!getEditorMarkdown().trim() && tpl.content && wordController) {
        wordController.setMarkdown(tpl.content);
      }
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
        el.innerHTML = '<div style="color:var(--text-faint)">该文章为草稿或管理员级，没有线上公开链接；推送并公开后才可分享。</div>';
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
        slug: '', title: '', description: '', cover: '', pubDate: localToday(),
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
                  <span>发布</span><span style="font-size:10px;color:var(--text-faint)" id="draftStatus">${value.draft?'当前为草稿':'已发布'}</span>
                </div>
                <div class="form-group" style="flex:1"><label>访问权限</label><select id="fAccess"><option value="public" ${value.access==='public'?'selected':''}>访客级 · 公开查看</option><option value="authorized" ${value.access==='authorized'?'selected':''}>授权级 · 验证站长网名</option><option value="admin" ${value.access==='admin'?'selected':''}>管理员级 · 私密文章密码</option></select></div>
              </div>
              <input type="hidden" id="fArchived" value="${value.archived ? 'true' : 'false'}" />
              <div class="form-group"><label>定时发布（可留空）</label><input id="fScheduledAt" type="datetime-local" value="${toLocalInput(value.scheduledAt)}" /><span class="field-hint">到时间后由 GitHub Actions 每小时自动重建上线（手动推送可立即生效）；未到时间不会加入公开列表。</span></div>
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
              ${renderWordRibbonHtml()}
              <div class="post-stats" id="postStats"></div>
              <div class="field-hint" id="postDraftStatus"></div>
              <div class="rich-status" id="richStatus" hidden></div>
              <div class="editor-body" id="editorBody">
                <div id="wordEditorHost"></div>
              </div>
            </div>
          </section>
        </div>`;
      setupUpload();
      setupPostCover();
      setupPostDirtyTracking();
      setupFormSections();
      setupSlugAutogen();
      setupTemplateChips();
      setupShareInfo(isNew ? null : value);
      setupCoverMediaButton();
      const pfBtn = $('#btnPreflight');
      if (pfBtn) { pfBtn.style.display = ''; pfBtn.disabled = false; }
      initWordEditorController(value.content || '');
      setupMediaInsertButton();
      finalizePostEditorInit();
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
            toast(data.error || '文章版本冲突：当前内容已保留，请先确认差异');
            if (data.code === 'VERSION_CONFLICT') openConflictModal(currentSlug, data.currentHash);
            return;
          }
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        clearPostDraft();
        postDirty = false;
        postBaselineSnapshot = '';
        currentSlug = data.slug;
        // 刷新同步状态，让「未发布」判定基于最新工作区，并在提示里给出下一步
        try { await refreshSyncStatus({ silent: true }); } catch { /* 状态刷新失败不影响保存结果 */ }
        const published = (store.get()?.syncStatus?.dirtyCount ?? 0) === 0;
        if (published) {
          toast(isExistingPost ? '已保存 · 已同步' : '已创建 · 已同步');
        } else {
          toast(`${isExistingPost ? '已保存到本地' : '已创建'} · 未发布（点顶栏「发布」上线）`);
        }
        await loadPosts();
        await selectPost(data.slug, { skipLeaveGuard: true });
      } catch(e) {
        setPostEditorStatus('保存失败', 'error');
        store.set({ editor: { status: 'save-error', dirty: true, saving: false, lastError: e.message } });
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
        if(data.error){toast(uploadErrorText(data));return}
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

    /**
     * 全局文件输入与粘贴：启动时绑定一次，供所有模块复用。
     * uploadImage 内部按 currentMode 路由（正文 / 封面 / 画廊 / 关于头像 / 前端定制字段），
     * 所以各模块不需要（也不应该）自己覆盖 onchange —— 前端定制曾覆盖掉全局处理器，
     * 导致离开该模块后选图无反应。封面路径通过 postUploadTarget 传递。
     */
    function setupGlobalFileInput() {
      const fileInput = $('#fileInput');
      if (fileInput) {
        fileInput.onchange = async () => {
          const f = fileInput.files[0];
          const target = postUploadTarget;
          if (f) {
            if (f.type.startsWith('audio/')) { await uploadAudioTrack(f); }
            else { await uploadImage(f, target); }
            fileInput.value = '';
          }
          postUploadTarget = 'content';
        };
      }
      const multiImgInput = $('#editorMultiImgInput');
      if (multiImgInput) {
        multiImgInput.onchange = async () => {
          const files = [...(multiImgInput.files || [])];
          multiImgInput.value = '';
          if (files.length) await uploadMultipleImagesToEditor(files);
        };
      }
      document.onpaste = async e => {
        // 编辑器已接管粘贴时会先 preventDefault，此处跳过，避免同一张图上传两次
        if (e.defaultPrevented) return;
        const items = e.clipboardData?.items ? [...e.clipboardData.items] : [];
        const audioItem = items.find(i => i.type.startsWith('audio/'));
        const imgItem = items.find(i => i.type.startsWith('image/'));
        const item = audioItem || imgItem;
        if (item) {
          e.preventDefault();
          if (audioItem) { await uploadAudioTrack(audioItem.getAsFile()); }
          else { await uploadImage(imgItem.getAsFile(), 'content'); }
        }
      };
    }

    function setupUpload() {
      const area = $('#uploadArea'); if(!area) return;
      const fileInput = $('#fileInput');
      area.onclick = ()=>{postUploadTarget='content';fileInput.click()};
      area.ondragover = e=>{e.preventDefault();area.classList.add('dragover')};
      area.ondragleave = ()=>area.classList.remove('dragover');
      area.ondrop = async e=>{
        e.preventDefault();
        area.classList.remove('dragover');
        const files = [...(e.dataTransfer.files || [])];
        if (!files.length) return;
        const imgs = files.filter((f) => isImageFile(f));
        const others = files.filter((f) => !isImageFile(f));
        if (imgs.length) await uploadMultipleImagesToEditor(imgs);
        for (const f of others) {
          if (f.type.startsWith('audio/')) await uploadAudioTrack(f);
        }
      };

      // 编辑器区拖放：音频由外部接管；图片交给 ProseMirror handleDrop 在落点插入
      const editorBox = $('#wordEditorHost');
      if(editorBox){
        editorBox.ondragover = e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'};
        editorBox.ondrop = async e=>{
          const f=e.dataTransfer.files && e.dataTransfer.files[0];
          if(!f) return;
          if(f.type.startsWith('audio/')){
            e.preventDefault();
            await uploadAudioTrack(f);
          }
        };
      }

      const coverArea = $('#btnCoverUpload');
      if (coverArea) {
        coverArea.onclick = ()=>{postUploadTarget='cover';fileInput.click()};
        coverArea.ondragover = e=>{e.preventDefault();coverArea.classList.add('dragover')};
        coverArea.ondragleave = ()=>coverArea.classList.remove('dragover');
        coverArea.ondrop = async e=>{e.preventDefault();e.stopPropagation();coverArea.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f)await uploadImage(f,'cover')};
      }

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
          if (currentMode === 'gallery') {
            const srcInput = $('#fSrc');
            if (srcInput) { srcInput.value = data.url; srcInput.focus(); }
            const originalInput = $('#fOriginal');
            if (originalInput && !originalInput.value.trim() && data.originalUrl) {
              originalInput.value = data.originalUrl;
            }
            syncGalleryDirty();
          } else if (currentMode === 'about') {
            const avatarInput = $('#fAvatar');
            if (avatarInput) { avatarInput.value = data.url; avatarInput.focus(); refreshAvatarPreview(); syncAboutDirty(); }
          } else {
            insertImageIntoEditor(data.url, '');
          }
          toast('已导入: ' + data.url);
        } catch (e) { toast('导入失败: ' + e.message); }
        btnImport.textContent = '导入'; btnImport.disabled = false;
      };

      // 粘贴与文件选择由 setupGlobalFileInput() 在启动时统一绑定，
      // 这里不再重复覆盖（避免各模式互相顶掉处理器）。
    }

    /* ── 插入视频（B站 / YouTube / MP4 直链 / 本地视频 / 通用 iframe 嵌入） ── */
    // 把用户输入转换为标准 video-embed 代码；无法识别时返回 {error}
    function buildVideoEmbed(input, poster = ''){
      const s=(input||'').trim();
      if(!s) return {error:'请粘贴视频链接、嵌入代码，或先上传本地视频'};
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
      // 4) 直链 MP4 / WebM / MOV / OGV 视频文件
      if(/^(https?:)?\/\/.+\.(?:mp4|webm|mov|ogv)(?:[?#].*)?$/i.test(s)){
        const posterAttr = poster && /^(https?:)?\/\//i.test(poster.trim()) ? ` poster="${mdAttr(poster.trim())}"` : '';
        return {html:`<div class="video-embed"><video controls preload="metadata" src="${mdAttr(s)}"${posterAttr}></video></div>`};
      }
      return {error:'无法识别：请粘贴 B站 / YouTube / MP4 视频链接，或 iframe 嵌入代码'};
    }

    function openVideoModal(){
      const modal=$('#videoModal'); if(!modal) return;
      if($('#fVideoInput')) $('#fVideoInput').value='';
      if($('#fVideoPoster')) $('#fVideoPoster').value='';
      openModal(modal);
    }

    // 对话框事件（静态 HTML，初始化时绑定一次）
    function bindVideoModal(){
      const modal=$('#videoModal'); if(!modal) return;
      $('#btnVideoCancel').onclick=()=>{closeModal(modal)};
      modal.addEventListener('click',e=>{if(e.target===modal)closeModal(modal)});
      $('#btnVideoInsert').onclick=()=>{
        const r=buildVideoEmbed($('#fVideoInput')?.value, $('#fVideoPoster')?.value || '');
        if(r.error){toast(r.error);return}
        insertMarkdownBlock(r.html);
        closeModal(modal);
        toast('已插入视频');
      };
      $('#fVideoInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#btnVideoInsert').click()}});
      const videoFile = $('#fVideoFile'), videoUploadBtn = $('#btnVideoUpload');
      if (videoFile && videoUploadBtn) {
        videoUploadBtn.onclick = () => videoFile.click();
        videoFile.addEventListener('change', async () => {
          const f = videoFile.files?.[0];
          videoFile.value = '';
          if (!f) return;
          toast('上传视频中…');
          const fd = new FormData();
          fd.set('file', f);
          try {
            const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || data.error) { toast(uploadErrorText(data)); return; }
            if ($('#fVideoInput')) $('#fVideoInput').value = data.url;
            toast(data.jsDelivrWarn ? '视频已上传（>20MB 可能超出 jsDelivr 单文件加速上限）' : '视频已上传，点击插入即可');
          } catch (e) { toast('上传失败：' + e.message); }
        });
      }
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
    function openMusicModal(){
      const modal=$('#musicModal'); if(!modal) return;
      ['fMusicSrc','fMusicTitle','fMusicArtist','fMusicCover'].forEach(id=>{const el=$('#'+id);if(el) el.value=''});
      const st=$('#musicProbe'); if(st) st.hidden=true;
      openModal(modal);
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
      $('#btnMusicCancel').onclick=()=>{closeModal(modal)};
      modal.addEventListener('click',e=>{if(e.target===modal)closeModal(modal)});
      $('#btnMusicInsert').onclick=()=>{
        const r=buildMusicEmbed($('#fMusicSrc')?.value,$('#fMusicTitle')?.value,$('#fMusicArtist')?.value,$('#fMusicCover')?.value);
        if(r.error){toast(r.error);return}
        insertMarkdownBlock(r.html);
        closeModal(modal);
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
        if(data.error){toast(uploadErrorText(data));return}
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

    /* ── Word 级富文本编辑器（Tiptap / ProseMirror）：所见即所得 / 分屏 / 源码 ── */
    let wordController = null;

    async function uploadMultipleImagesToEditor(files) {
      const list = [...(files || [])].filter((f) => isImageFile(f));
      if (!list.length) return;
      for (const file of list) {
        if (file.size > appUploadMaxBytes) {
          toast(`文件超过 ${Math.round(appUploadMaxBytes / 1024 / 1024)}MB 上限：${file.name}`);
          continue;
        }
        toast(`上传中：${file.name}`);
        const fd = new FormData();
        fd.append('file', file, file.name);
        try {
          const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok || data.error || !data.url) {
            toast(uploadErrorText(data));
            continue;
          }
          insertImageIntoEditor(data.url, file.name.replace(/\.[^.]+$/, ''));
          toast('图片已上传：' + file.name);
        } catch (e) {
          toast(`上传失败：${file.name}（${e.message}）`);
        }
      }
    }

    async function rehostExternalImages(urls) {
      const list = (urls || []).slice(0, 8);
      if (!list.length || !wordController) return;
      toast(`检测到 ${list.length} 张外链图片，正在自动转存图库…`);
      let okCount = 0;
      for (const remoteUrl of list) {
        try {
          const fd = new URLSearchParams();
          fd.set('url', remoteUrl);
          const res = await apiFetch('/api/import-url', { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          const data = await res.json();
          if (res.ok && data.url && wordController.replaceImageSrc(remoteUrl, data.url)) {
            okCount += 1;
          }
        } catch { /* 单张转存失败保留原外链 */ }
      }
      if (okCount) {
        markPostDirty();
        toast(`已自动转存 ${okCount} 张粘贴图片到图库`);
      }
    }

    function openMathModal(displayBlock = true) {
      const modal = $('#mathModal');
      if (!modal) return;
      const input = $('#fMathInput');
      const blk = $('#fMathBlock');
      const preview = $('#mathLivePreview');
      if (input) input.value = '';
      if (blk) blk.checked = Boolean(displayBlock);
      if (preview) preview.textContent = '输入公式后实时预览…';
      openModal(modal);
      setTimeout(() => input?.focus(), 0);
    }

    function openAttachModal() {
      const modal = $('#attachModal');
      if (!modal) return;
      ['fAttachHref', 'fAttachName', 'fAttachSize'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
      openModal(modal);
    }

    function openBookmarkModal() {
      const modal = $('#bookmarkModal');
      if (!modal) return;
      ['fBookmarkUrl', 'fBookmarkTitle', 'fBookmarkDesc'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
      openModal(modal);
      setTimeout(() => $('#fBookmarkUrl')?.focus(), 0);
    }

    function openImgSizeModal() {
      const modal = $('#imgSizeModal');
      if (!modal) return;
      const selImg = wordController?.getSelectedImage?.();
      const md = getEditorMarkdown() || '';
      const parsed = selImg
        ? {
            src: selImg.src || '',
            alt: selImg.alt || '',
            width: selImg.width ? String(selImg.width).replace(/(%|px)$/i, '') : '',
            unit: String(selImg.width || '').endsWith('px') ? 'px' : '%',
            pos: selImg.pos,
            fromSelection: true,
          }
        : parseImageSyntax(md);
      imgSizeTarget = parsed || null;
      const sEl = $('#fImgSizeSrc'); if (sEl) sEl.value = parsed ? parsed.src : '';
      const vEl = $('#fImgSizeVal'); if (vEl) vEl.value = parsed && parsed.width ? parsed.width : 60;
      const uEl = $('#fImgSizeUnit'); if (uEl) uEl.value = parsed && parsed.unit === 'px' ? 'px' : '%';
      openModal(modal);
      if (parsed) setTimeout(() => $('#fImgSizeVal')?.focus(), 0);
    }

    function initWordEditorController(content) {
      const host = $('#wordEditorHost');
      if (!host) return null;
      if (wordController) {
        try { wordController.destroy(); } catch { /* ignore */ }
        wordController = null;
      }
      wordController = mountWordEditor({
        container: host,
        initialMarkdown: String(content || ''),
        renderPreview: renderMarkdownPreviewInto,
        onDirty: () => { syncPostCoverPreview(); markPostDirty(); updatePostValidation(); },
        onStatsChange: () => { updatePostValidation(); },
        onUploadImages: (files) => uploadMultipleImagesToEditor(files),
        onImportExternalImages: (urls) => rehostExternalImages(urls),
        onOpenMediaPicker: (opts) => openMediaPicker(opts),
        onOpenMath: (blk) => openMathModal(blk),
        onOpenVideo: openVideoModal,
        onOpenMusic: openMusicModal,
        onOpenAttach: openAttachModal,
        onOpenBookmark: openBookmarkModal,
        onOpenImgSize: openImgSizeModal,
        onSaveShortcut: () => { if (currentMode === 'posts') savePost(); },
        toast,
      });
      window.editor = createEditorShim();
      window.wordEditor = wordController;
      return wordController;
    }

    /** 兼容层：测试与外部模块通过 editor.getMarkdown() / setMarkdown() 读写正文 */
    function createEditorShim() {
      return {
        getMarkdown: () => getEditorMarkdown(),
        setMarkdown: (v) => {
          if (wordController) {
            wordController.setMarkdown(String(v || ''));
            syncPostCoverPreview();
            markPostDirty();
            updatePostValidation();
          }
        },
        getValue: () => getEditorMarkdown(),
        setValue: (v) => { if (wordController) wordController.setMarkdown(String(v || '')); },
        getHTML: () => (wordController ? wordController.getHTML() : ''),
        insertValue: (v) => { if (wordController) wordController.insertMarkdownBlock(v); },
        focus: () => { if (wordController) wordController.focus(); },
      };
    }

    function getEditorMarkdown() {
      try { return wordController ? wordController.getMarkdown() : ''; } catch { return ''; }
    }

    function insertMarkdownBlock(md) {
      if (!wordController) { toast('编辑器未就绪'); return; }
      wordController.insertMarkdownBlock(md);
      syncPostCoverPreview();
      markPostDirty();
      updatePostValidation();
    }

    function insertImageIntoEditor(url, alt) {
      insertMarkdownBlock(`![${alt || '图片'}](${url})`);
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

    /* ── 图片尺寸：提取选中图片或首图，生成带宽度样式的 <img> 并支持原地替换 ── */
    let imgSizeTarget = null;

    function parseImageSyntax(raw) {
      const s = String(raw || '').trim();
      if (!s) return null;
      const mdMatch = s.match(/!\[([^\]]*)\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/);
      if (mdMatch) {
        return { raw: mdMatch[0], alt: mdMatch[1] || '', src: mdMatch[2] || mdMatch[3] || '', width: '', unit: '%' };
      }
      const htmlMatch = s.match(/<img\b[^>]*>/i);
      if (htmlMatch) {
        const tag = htmlMatch[0];
        const srcM = tag.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i);
        const altM = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const widthM = tag.match(/\bwidth\s*:\s*([\d.]+)\s*(%|px)/i);
        if (srcM) {
          return {
            raw: tag,
            alt: (altM && (altM[1] ?? altM[2])) || '',
            src: srcM[1] || srcM[2] || srcM[3] || '',
            width: widthM ? widthM[1] : '',
            unit: widthM ? widthM[2].toLowerCase() : '%',
          };
        }
      }
      return null;
    }

    function bindImgSizeModal(){
      const modal=$('#imgSizeModal'); if(!modal) return;
      $('#btnImgSizeCancel').onclick=()=>{closeModal(modal);imgSizeTarget=null};
      modal.addEventListener('click',e=>{if(e.target===modal){closeModal(modal);imgSizeTarget=null}});
      $('#btnImgSizeClear').onclick=()=>{const v=$('#fImgSizeVal');if(v)v.value=''};
      $('#btnImgSizeInsert').onclick=()=>{
        const src=($('#fImgSizeSrc')?.value||'').trim();
        const val=($('#fImgSizeVal')?.value||'').trim();
        const unit=$('#fImgSizeUnit')?.value==='px'?'px':'%';
        if(!src){toast('请输入图片 URL');return}
        if(!/^(https?:)?\/\//i.test(src)){toast('图片 URL 必须是 http(s) 链接');return}
        const widthStr = val && Number.isFinite(parseFloat(val)) && parseFloat(val) > 0 ? `${parseFloat(val)}${unit}` : '';
        if (imgSizeTarget?.fromSelection && typeof imgSizeTarget.pos === 'number' && wordController?.updateSelectedImage) {
          wordController.updateSelectedImage(imgSizeTarget.pos, { src, width: widthStr });
        } else {
          const altText=(imgSizeTarget?.alt||'').trim()||'图片';
          let img='<img src="'+mdAttr(src)+'" alt="'+mdAttr(altText)+'"';
          if(widthStr) img+=' style="width:'+widthStr+'"';
          img+=' />';
          if (imgSizeTarget?.raw && wordController && imgSizeTarget.src === src) {
            const current = getEditorMarkdown() || '';
            if (current.includes(imgSizeTarget.raw)) {
              wordController.setMarkdown(current.replace(imgSizeTarget.raw, img));
              markPostDirty();
            } else {
              insertMarkdownBlock(img);
            }
          } else {
            insertMarkdownBlock(img);
          }
        }
        imgSizeTarget = null;
        closeModal(modal);
        toast('已设置图片尺寸');
      };
      $('#fImgSizeSrc').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#btnImgSizeInsert').click()}});
    }

    function bindMathModal() {
      const modal = $('#mathModal');
      if (!modal) return;
      const input = $('#fMathInput');
      const blk = $('#fMathBlock');
      const preview = $('#mathLivePreview');
      const renderLive = () => {
        if (!preview) return;
        const tex = (input?.value || '').trim();
        if (!tex) { preview.textContent = '输入公式后实时预览…'; return; }
        try {
          katex.render(tex, preview, { displayMode: Boolean(blk?.checked), throwOnError: false, strict: false });
        } catch {
          preview.textContent = tex;
        }
      };
      input?.addEventListener('input', renderLive);
      blk?.addEventListener('change', renderLive);
      $('#btnMathCancel').onclick = () => closeModal(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
      $('#btnMathInsert').onclick = () => {
        const tex = (input?.value || '').trim();
        if (!tex) { toast('请输入 LaTeX 公式'); return; }
        const isBlk = Boolean(blk?.checked);
        const safe = mdAttr(tex);
        if (isBlk) {
          insertMarkdownBlock(`<div class="hz-math-block" data-tex="${safe}"></div>`);
        } else if (wordController?.getView() === 'wysiwyg' && wordController?.editor) {
          wordController.editor.chain().focus().insertContent({ type: 'mathInline', attrs: { tex } }).run();
        } else {
          insertMarkdownBlock(`<span class="hz-math" data-tex="${safe}"></span>`);
        }
        closeModal(modal);
        toast('已插入数学公式');
      };
    }

    function bindAttachModal() {
      const modal = $('#attachModal');
      if (!modal) return;
      $('#btnAttachCancel').onclick = () => closeModal(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
      const fileEl = $('#fAttachFile');
      const uploadBtn = $('#btnAttachUpload');
      if (fileEl && uploadBtn) {
        uploadBtn.onclick = () => fileEl.click();
        fileEl.addEventListener('change', async () => {
          const f = fileEl.files?.[0];
          fileEl.value = '';
          if (!f) return;
          toast('上传附件中…');
          const fd = new FormData();
          fd.set('file', f);
          try {
            const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || data.error) { toast(uploadErrorText(data)); return; }
            if ($('#fAttachHref')) $('#fAttachHref').value = data.url;
            if ($('#fAttachName') && !$('#fAttachName').value.trim()) $('#fAttachName').value = data.originalName || data.name || f.name;
            if ($('#fAttachSize')) {
              const kb = Math.max(1, Math.round((data.size || f.size) / 1024));
              $('#fAttachSize').value = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
            }
            toast(data.jsDelivrWarn ? '附件已上传（>20MB 可能超出 jsDelivr 加速上限）' : '附件已上传');
          } catch (e) { toast('上传失败：' + e.message); }
        });
      }
      $('#btnAttachInsert').onclick = () => {
        const href = ($('#fAttachHref')?.value || '').trim();
        const name = ($('#fAttachName')?.value || '').trim() || '下载附件';
        const size = ($('#fAttachSize')?.value || '').trim();
        if (!href || !/^(https?:)?\/\//i.test(href)) { toast('请先上传文件或填写有效直链'); return; }
        const m = name.match(/(\.[a-z0-9]+)$/i);
        const ext = m ? m[1].toLowerCase() : '';
        insertMarkdownBlock(
          `<div class="hz-attachment" data-href="${mdAttr(href)}" data-name="${mdAttr(name)}" data-size="${mdAttr(size)}" data-ext="${mdAttr(ext)}"><a href="${mdAttr(href)}" target="_blank" rel="noopener">📎 ${mdEscapeText(name)}${size ? ` (${mdEscapeText(size)})` : ''}</a></div>`,
        );
        closeModal(modal);
        toast('已插入附件卡片');
      };
    }

    function bindBookmarkModal() {
      const modal = $('#bookmarkModal');
      if (!modal) return;
      $('#btnBookmarkCancel').onclick = () => closeModal(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
      $('#btnBookmarkFetch')?.addEventListener('click', async () => {
        const url = ($('#fBookmarkUrl')?.value || '').trim();
        if (!url) { toast('请先填写网页 URL'); return; }
        const btn = $('#btnBookmarkFetch');
        btn.disabled = true; btn.textContent = '抓取中…';
        try {
          const res = await apiFetch('/api/link-meta?url=' + encodeURIComponent(url));
          const data = await res.json();
          if (data.title && $('#fBookmarkTitle')) $('#fBookmarkTitle').value = data.title;
          if (data.description && $('#fBookmarkDesc')) $('#fBookmarkDesc').value = data.description;
          toast(data.ok ? '已获取网页标题' : '未能抓取标题，可手动填写');
        } catch { toast('抓取失败，请手动填写'); }
        btn.disabled = false; btn.textContent = '抓取标题';
      });
      $('#btnBookmarkInsert').onclick = () => {
        const url = ($('#fBookmarkUrl')?.value || '').trim();
        const title = ($('#fBookmarkTitle')?.value || '').trim() || url;
        const desc = ($('#fBookmarkDesc')?.value || '').trim();
        if (!url || !/^https?:\/\//i.test(url)) { toast('请输入有效 http(s) 链接'); return; }
        insertMarkdownBlock(
          `<div class="hz-bookmark"><a href="${mdAttr(url)}" target="_blank" rel="noopener"><strong>${mdEscapeText(title)}</strong>${desc ? `<span>${mdEscapeText(desc)}</span>` : ''}<small>${mdEscapeText(url)}</small></a></div>`,
        );
        closeModal(modal);
        toast('已插入网页书签卡片');
      };
    }

    // Chrome/Edge 等浏览器不识别 HEIC，file.type 为空字符串：用扩展名白名单兜底，交给后端自动转 WebP
    function isImageFile(f){
      return !!f && (f.type.startsWith('image/') || /\.(png|jpe?g|jfif|gif|webp|avif|svg|heic|heif|tiff?)$/i.test(f.name||''));
    }

    /* ── 封面裁剪：本地预览并截选 16:10 区域，确认后再单次上传（HEIC 自动回退服务端转码） ── */
    const COVER_RATIO = 16 / 10;
    const COVER_OUT_W = 1600;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    let crop = null; // { file, img, imgW, imgH, scale, ox, oy, minScale, sel, uploadedUrl, onDone, sourceIsLocal, fallbackUploading }

    async function uploadCoverFileOnce(file) {
      const fd = new FormData();
      fd.set('file', file);
      const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(uploadErrorText(data));
      return data.url;
    }

    // 封面上传流程：优先使用本地 Blob URL 直接打开裁剪框，仅当浏览器无法解码（如 HEIC）或用户点「使用原图」时才上传原图
    function uploadCover(file) {
      if (!isImageFile(file)) { toast('仅支持图片'); return; }
      openCoverCrop(file, '', url => {
        const coverInput = $('#fCover');
        if (coverInput) { coverInput.value = url; coverInput.focus(); syncPostCoverPreview(); markPostDirty(); }
        toast('封面已设置: ' + url);
      });
    }

    function openCoverCrop(file, uploadedUrl, onDone) {
      const modal = $('#coverCropModal');
      if (!modal) return;
      crop = { file, img: null, imgW: 0, imgH: 0, scale: 1, ox: 0, oy: 0, minScale: 1,
               sel: { x: 0, y: 0, w: 0, h: 0 }, uploadedUrl: uploadedUrl || '', onDone, sourceIsLocal: true, fallbackUploading: false };
      const img = $('#cropImg');
      const btn = $('#btnCropConfirm');
      const origBtn = $('#btnCropOriginal');
      if (btn) { btn.disabled = false; btn.textContent = '确认裁剪'; }
      if (origBtn) { origBtn.disabled = false; origBtn.textContent = '使用原图'; }
      $('#cropLoading').hidden = false;
      img.removeAttribute('src');
      img.onload = () => {
        if (!crop || !img.naturalWidth) return;
        crop.img = img;
        crop.imgW = img.naturalWidth;
        crop.imgH = img.naturalHeight;
        initCropLayout();
      };
      img.onerror = async () => {
        if (!crop) return;
        if (crop.sourceIsLocal && !crop.fallbackUploading) {
          // 浏览器本地无法解码（如 HEIC）：按需上传一次给服务端转码为 WebP 后再预览裁剪
          crop.sourceIsLocal = false;
          crop.fallbackUploading = true;
          if (crop.uploadedUrl) {
            img.src = crop.uploadedUrl;
            return;
          }
          try {
            toast('正在转码图片用于预览…');
            const url = await uploadCoverFileOnce(crop.file);
            if (!crop) return;
            crop.uploadedUrl = url;
            img.src = url;
          } catch (err) {
            toast(err.message || '上传失败');
            closeCoverCrop();
          }
        } else {
          // 服务器图片也加载失败：放弃裁剪，直接使用已上传结果
          if (crop.uploadedUrl) {
            toast('无法显示该图片，已直接使用上传结果');
            const done = crop.onDone, url = crop.uploadedUrl;
            closeCoverCrop();
            done && done(url);
          } else {
            toast('无法加载该图片');
            closeCoverCrop();
          }
        }
      };
      openModal(modal);
      img.crossOrigin = 'anonymous'; // 回退到服务器图（jsDelivr 等带 CORS）时 canvas 才可读
      try {
        crop.sourceIsLocal = true;
        crop.blobUrl = URL.createObjectURL(file);
        img.src = crop.blobUrl;
      } catch (e) {
        img.onerror();
      }
    }

    function closeCoverCrop() {
      const modal = $('#coverCropModal');
      if (modal) closeModal(modal);
      if (crop) {
        if (crop.blobUrl) { URL.revokeObjectURL(crop.blobUrl); crop.blobUrl = null; }
        const img = $('#cropImg');
        if (img) img.removeAttribute('src');
      }
      crop = null;
      const btn = $('#btnCropConfirm');
      const origBtn = $('#btnCropOriginal');
      if (btn) { btn.disabled = false; btn.textContent = '确认裁剪'; }
      if (origBtn) { origBtn.disabled = false; origBtn.textContent = '使用原图'; }
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
        if (crop.uploadedUrl) {
          toast('无法处理该图片（可能跨域受限），已使用原图');
          const url = crop.uploadedUrl;
          closeCoverCrop();
          done && done(url);
        } else {
          toast('无法处理该图片，请重试');
          closeCoverCrop();
        }
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
        finish();
        if (crop.uploadedUrl) {
          toast('无法处理该图片（跨域受限），已使用原图');
          const url = crop.uploadedUrl;
          closeCoverCrop();
          done && done(url);
        } else {
          toast('无法处理该图片');
          closeCoverCrop();
        }
      }
    }

    function bindCoverCropModal() {
      const modal = $('#coverCropModal'); if (!modal) return;
      $('#btnCropCancel').onclick = closeCoverCrop;
      modal.addEventListener('click', e => { if (e.target === modal) closeCoverCrop(); });
      $('#btnCropOriginal').onclick = async () => {
        if (!crop) return;
        const done = crop.onDone;
        if (crop.uploadedUrl) {
          const url = crop.uploadedUrl;
          closeCoverCrop();
          done && done(url);
          return;
        }
        const origBtn = $('#btnCropOriginal');
        if (origBtn) { origBtn.disabled = true; origBtn.textContent = '上传中…'; }
        try {
          const url = await uploadCoverFileOnce(crop.file);
          if (!crop) return;
          closeCoverCrop();
          done && done(url);
        } catch (err) {
          toast(err.message || '原图上传失败');
          if (origBtn) { origBtn.disabled = false; origBtn.textContent = '使用原图'; }
        }
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
    }

    function hasAnyDirtyState() {
      if (currentMode === 'posts') return postDirty;
      if (currentMode === 'daily') return isDailyDirty();
      if (currentMode === 'gallery') return isGalleryDirty();
      if (currentMode === 'about') return isAboutDirty();
      if (currentMode === 'frontend') return isFrontendDirty();
      if (currentMode === 'schedule') return isScheduleDirty();
      return false;
    }

    function updateSubModuleDirtyStatus(dirty) {
      if (currentMode === 'posts') return;
      setPostEditorStatus(dirty ? '有未保存修改' : '', dirty ? 'dirty' : '');
    }

    window.addEventListener('beforeunload', e => {
      if (!hasAnyDirtyState() && !isGalleryBatchBusy() && !isDailyBusy()) return;
      if (currentMode === 'posts') savePostDraftNow();
      e.preventDefault();
      e.returnValue = '';
    });

    /* ── 409 版本冲突可视化对比与处理 ── */
    let conflictState = null;

    async function openConflictModal(slug, latestHash) {
      const mask = $('#conflictModal');
      if (!mask || !slug) return;
      conflictState = { slug, latestHash: latestHash || '' };
      $('#conflictDiff').textContent = '正在读取磁盘最新版本…';
      $('#conflictOverwrite').disabled = true;
      openModal(mask);
      try {
        const res = await apiFetch(`${API}/${encodeURIComponent(slug)}`);
        const latest = await res.json();
        if (!res.ok || latest.error) {
          $('#conflictDiff').textContent = latest.error || '读取磁盘版本失败';
          return;
        }
        conflictState.latestHash = latest.contentHash || conflictState.latestHash;
        const localBody = getEditorMarkdown();
        const diskBody = latest.content || '';
        const diffHtml = localBody === diskBody
          ? '<div class="dl same">正文一致（差异可能来自标题、标签、日期等元数据字段）</div>'
          : renderLineDiff(localBody, diskBody);
        $('#conflictDiff').innerHTML = diffHtml;
        $('#conflictOverwrite').disabled = !/^[a-f0-9]{64}$/.test(conflictState.latestHash);
      } catch (err) {
        $('#conflictDiff').textContent = '读取磁盘版本失败：' + err.message;
      }
    }

    function bindConflictModal() {
      const mask = $('#conflictModal');
      if (!mask) return;
      $('#conflictCancel').onclick = () => closeModal(mask);
      mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(mask); });
      $('#conflictReload').onclick = async () => {
        if (!conflictState?.slug) return;
        const slug = conflictState.slug;
        closeModal(mask);
        clearPostDraft();
        postDirty = false;
        await selectPost(slug, { skipLeaveGuard: true });
        toast('已重新加载磁盘最新版本');
      };
      $('#conflictOverwrite').onclick = async () => {
        if (!conflictState?.latestHash) return;
        currentPostHash = conflictState.latestHash;
        closeModal(mask);
        await savePost();
      };
    }

    /** 统一拼接上传错误文案：优先展示服务端 detail */
    function uploadErrorText(data) {
      const base = (data && data.error) || '上传失败';
      const detail = data && data.detail ? String(data.detail) : '';
      return detail ? base + '（' + detail + '）' : base;
    }

    /** 上传图片的 Markdown 链接置入剪贴板；返回是否真的成功（用户手势过期会被浏览器拒绝）*/
    async function copyUploadedMarkdown(md) {
      try { await navigator.clipboard.writeText(md); return true; } catch { /* 手势过期 / 无权限，走 execCommand 兜底 */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }

    async function uploadImage(file, target = 'content') {
      if(!isImageFile(file)){toast('仅支持图片');return}
      if (target === 'cover') return uploadCover(file);
      toast('上传中…');
      const fd = new FormData(); fd.set('file', file);
      try {
        const res = await apiFetch('/api/upload', { method:'POST', body:fd });
        const data = await res.json();
        if(data.error){toast(uploadErrorText(data));return}
        if (currentMode === 'gallery') {
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
          syncGalleryDirty();
          toast('已上传: ' + data.url);
        } else if (currentMode === 'about') {
          const avatarInput = $('#fAvatar');
          if (avatarInput) { avatarInput.value = data.url; avatarInput.focus(); refreshAvatarPreview(); syncAboutDirty(); }
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
      if((e.ctrlKey||e.metaKey)&&e.key==='s'){
        e.preventDefault();
        // 各模块只处理自己可保存的内容；媒体/画廊列表等无「保存」语义的模块不应落到文章保存上
        // （此前 media 缺失分支，Ctrl+S 会误报「没有未保存修改」）
        if(currentMode==='daily') saveDailyItem();
        else if(currentMode==='gallery') saveGalleryItem();
        else if(currentMode==='about') saveAbout();
        else if(currentMode==='frontend') saveFrontend();
        else if(currentMode==='schedule') saveSchedule();
        else if(currentMode==='access') savePrivateAccess();
        else if(currentMode==='posts') savePost();
      }
    });

    bindVideoModal();
    bindMusicModal();
    bindImgSizeModal();
    bindMathModal();
    bindAttachModal();
    bindBookmarkModal();
    bindCoverCropModal();
    bindConflictModal();
    setupMediaPicker();
    setupGlobalFileInput();
    installFocusTrap();
    setupSessionControls();
    setupBatchControls();
    applySavedFocusMode();
    // 模块初始化：跨模块能力一律通过注入传递。
    // features/* 是独立 ES Module，无法看到 main.js 的模块作用域，
    // 直接调用这些函数会抛 ReferenceError（曾导致发布中心总览、媒体库「插入/封面」、
    // 前端定制背景图上传全部失效）。
    initSyncCenter({
      getMode: () => currentMode,
      reloadPosts: () => loadPosts(),
      reloadDaily: () => loadDaily(),
      reloadGallery: () => loadGallery(),
      fetchHealth,
    });
    initDaily({
      openMediaPicker,
      onDirtyChange: updateSubModuleDirtyStatus,
      refreshSyncStatus,
      getUploadMaxBytes: () => appUploadMaxBytes,
      isDailyMode: () => currentMode === 'daily',
    });
    initGallery({
      setupUpload,
      setupGalleryMediaButton,
      openMediaPicker,
      onDirtyChange: updateSubModuleDirtyStatus,
      refreshSyncStatus,
      getUploadMaxBytes: () => appUploadMaxBytes,
      isGalleryMode: () => currentMode === 'gallery',
    });
    initMedia({
      getPosts: () => posts,
      putPostFields,
      syncPostCoverPreview,
      markPostDirty,
      insertMarkdownBlock,
      insertImageIntoEditor,
    });
    initAbout({ setupUpload, openMediaPicker, closeMediaPicker, onDirtyChange: updateSubModuleDirtyStatus });
    fetchHealth();
    initFrontend({
      onDirtyChange: updateSubModuleDirtyStatus,
    });
    initSchedule({
      onDirtyChange: updateSubModuleDirtyStatus,
    });
    initPosts({
      getPosts: () => posts,
      getSelection: () => selectedSlugs,
      getCurrentSlug: () => currentSlug,
      isPostDirty: () => postDirty,
      clearCurrentSlug: () => { currentSlug = null; },
      loadPosts: () => loadPosts(),
      selectPost: (slug, options) => selectPost(slug, options),
      resetEditor: () => resetPostEditorTracking(),
      renderList: () => renderList(),
    });
    initListControls();
    loadPosts();

    // ── 模式切换 ──
    $('#modeTabs').addEventListener('click', e => {
      const tab = e.target.closest('.mode-tab');
      if (!tab || tab.dataset.mode === currentMode) return;
      switchMode(tab.dataset.mode);
    });

    function canLeaveCurrentEditor() {
      if (currentMode === 'posts') return canLeavePostEditor();
      if (currentMode === 'daily' && isDailyDirty()) return confirm('当前日常有未保存修改，确定离开？');
      if (currentMode === 'gallery' && isGalleryDirty()) return confirm('当前画廊项目有未保存修改，确定离开？');
      if (currentMode === 'about' && isAboutDirty()) return confirm('当前关于页面有未保存修改，确定离开？');
      if (currentMode === 'frontend' && isFrontendDirty()) return confirm('当前外观配置有未保存修改，确定离开？');
      if (currentMode === 'schedule' && isScheduleDirty()) return confirm('当前日程课表有未保存修改，确定离开？');
      return true;
    }

    function switchMode(mode) {
      if (mode !== currentMode && !canLeaveCurrentEditor()) return;
      if (mode !== 'posts') resetPostEditorTracking();
      if (mode !== 'daily') resetDailySelection();
      if (mode !== 'gallery') clearGalleryDirty();
      if (mode !== 'about') clearAboutDirty();
      if (mode !== 'frontend') clearFrontendDirty();
      if (mode !== 'schedule') clearScheduleDirty();
      setPostEditorStatus('');
      currentMode = mode;
      store.set({ mode });
      const listControls = $('#listControls');
      if (listControls) listControls.style.display = mode === 'posts' ? '' : 'none';
      // 批量操作只属于文章模块：切走后清空选择并隐藏操作栏，
      // 否则在画廊/媒体里仍能对先前勾选的文章执行发布、归档、删除。
      if (mode !== 'posts') {
        selectedSlugs.clear();
        const batchBar = $('#batchBar');
        if (batchBar) batchBar.hidden = true;
      }
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
      if (mode === 'daily') {
        currentSlug = null;
        resetGallerySelection();
        $('#btnNew').textContent = '＋ 新建';
        $('#btnNew').style.display = '';
        $('#btnSave').style.display = '';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').disabled = false;
        newDailyItem({ skipLeaveGuard: true });
        loadDaily();
      } else if (mode === 'gallery') {
        $('#btnNew').textContent = '＋ 新建';
        currentSlug = null;
        $('#btnNew').style.display = '';
        $('#btnSave').style.display = '';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').disabled = true;
        openGalleryBatchUploader({ skipLeaveGuard: true });
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
      } else if (mode === 'schedule') {
        currentSlug = null;
        resetGallerySelection();
        $('#editorTitle').textContent = '日程与课表管理';
        $('#btnNew').style.display = 'none';
        $('#btnDelete').style.display = 'none';
        $('#btnSave').style.display = '';
        $('#btnSave').disabled = true;
        $('#editorContainer').innerHTML = '<div class="empty-state">加载课表数据…</div>';
        renderScheduleSidebar();
        loadSchedule();
      } else if (mode === 'access') {
        currentSlug = null; resetGallerySelection();
        $('#editorTitle').textContent = '访问控制'; $('#btnNew').style.display = 'none'; $('#btnDelete').style.display = 'none'; $('#btnSave').style.display = 'none';
        renderPrivateAccess();
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
    $('#btnNew').onclick = () => currentMode === 'media' ? triggerMediaUpload() : currentMode === 'daily' ? newDailyItem() : currentMode === 'gallery' ? newGalleryItem() : newPost();
    $('#btnRefresh').onclick = () => currentMode === 'daily' ? loadDaily() : currentMode === 'gallery' ? loadGallery() : currentMode === 'media' ? loadMedia() : currentMode === 'about' ? loadAbout() : currentMode === 'frontend' ? loadFrontend() : currentMode === 'schedule' ? loadSchedule() : currentMode === 'access' ? renderPrivateAccess() : loadPosts();
    $('#btnSave').onclick = () => currentMode === 'daily' ? saveDailyItem() : currentMode === 'gallery' ? saveGalleryItem() : currentMode === 'about' ? saveAbout() : currentMode === 'frontend' ? saveFrontend() : currentMode === 'schedule' ? saveSchedule() : savePost();
    $('#btnPreflight').onclick = showPreflight;
    $('#btnDelete').onclick = () => currentMode === 'daily' ? (getCurrentDailyId() && deleteDailyItem(getCurrentDailyId())) : currentMode === 'gallery' ? (getCurrentGalleryId() && deleteGalleryItem(getCurrentGalleryId())) : (currentSlug && deletePost(currentSlug));
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
      if (isModalOpen($('#conflictModal'))) closeModal($('#conflictModal'));
      else if (isModalOpen($('#coverCropModal'))) closeCoverCrop();
      else if (isModalOpen($('#mediaPickerModal'))) closeMediaPicker();
      else if (isModalOpen($('#mediaUsageModal'))) closeModal($('#mediaUsageModal'));
      else if (isModalOpen($('#uploadSelfCheckModal'))) closeModal($('#uploadSelfCheckModal'));
      else if (isSyncModalOpen()) closeSyncModal();
      else if (isModalOpen($('#preflightModal'))) closeModal($('#preflightModal'));
      else if (isModalOpen($('#historyModal'))) closeModal($('#historyModal'));
      else if (isModalOpen($('#previewModal'))) closePostPreview();
      else if (isModalOpen($('#videoModal'))) closeModal($('#videoModal'));
      else if (isModalOpen($('#musicModal'))) closeModal($('#musicModal'));
      else if (isModalOpen($('#mathModal'))) closeModal($('#mathModal'));
      else if (isModalOpen($('#attachModal'))) closeModal($('#attachModal'));
      else if (isModalOpen($('#bookmarkModal'))) closeModal($('#bookmarkModal'));
      else if (isModalOpen($('#imgSizeModal'))) { closeModal($('#imgSizeModal')); imgSizeTarget = null; }
      else if (isModalOpen($('#schedGithubModal'))) closeModal($('#schedGithubModal'));
    });
    $('#btnSite').onclick = () => window.open('https://blog.acretiondisk.top/', '_blank');

    // ── 会话：锁定 / 重新验证 / 退出并清除凭据 ──
    async function fetchHealth() {
      try {
        const res = await apiFetch('/api/health');
        const data = await res.json();
        if (data && data.limits && Number(data.limits.uploadMaxBytes) > 0) {
          appUploadMaxBytes = Number(data.limits.uploadMaxBytes);
        }
        return data;
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
      if (!confirm('退出管理面板？将停止当前会话。')) return;
      setToken('');
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--bg);color:var(--accent);font-family:inherit">
          <h1 style="font-size:16px;letter-spacing:2px;font-weight:normal">已退出管理面板</h1>
          <p style="color:var(--text-faint);font-size:12px">凭据已清除。可关闭本页；重新打开 http://localhost:4322/admin 会重新获得本机口令。</p>
          <button onclick="location.reload()" style="padding:7px 14px;border:1px solid var(--accent-line);background:var(--surface-3);color:var(--accent);border-radius:6px;cursor:pointer">重新进入</button>
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
