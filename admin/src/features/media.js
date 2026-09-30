/**
 * 媒体库：统一媒体服务、上传队列、引用扫描与媒体选择器。
 * 通过 initMedia 注入文章列表与文章字段写入能力，避免循环依赖。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch, getToken } from '../api/app-client.js';
import { formatBytes } from '../util/format.js';
import { openModal, closeModal } from '../ui/modal.js';
import { store } from '../state/store.js';

let ctx = { getPosts: () => [], putPostFields: async () => false };

export function initMedia(options = {}) { ctx = { ...ctx, ...options }; }

    const MEDIA_API = '/api/media';
const POSTS_API = '/api/posts';
    let mediaData = null;
    let mediaVisible = 60;
    let mediaFilter = { q: '', type: 'all', usage: 'all' };
    let mediaTargetSlug = '';
    let mediaTasks = [];
    let mediaActiveUploads = 0;
    let pickerState = null;

    function allMediaItems() {
      if (!mediaData) return [];
      return [...(mediaData.images || []), ...(mediaData.audios || [])];
    }

    function filteredMedia() {
      const q = mediaFilter.q.trim().toLowerCase();
      return allMediaItems().filter((m) => {
        if (mediaFilter.type !== 'all' && m.type !== mediaFilter.type) return false;
        if (mediaFilter.usage === 'used' && !m.usedBy.length) return false;
        if (mediaFilter.usage === 'unused' && m.usedBy.length) return false;
        if (q && !m.name.toLowerCase().includes(q)) return false;
        return true;
      });
    }

    function renderMediaSidebar() {
      const el = $('#postList');
      if (!el) return;
      const s = mediaData?.stats;
      el.innerHTML = `
        <div style="padding:12px 14px;font-size:11px;color:#6a6a70;line-height:1.9">
          <div style="color:#c8b080;margin-bottom:4px">▤ 媒体库</div>
          <div>图片 <b style="color:#a09a80">${s ? s.images : '—'}</b> · 音频 <b style="color:#a09a80">${s ? s.audios : '—'}</b></div>
          <div>已引用 <b style="color:#a09a80">${s ? s.referenced : '—'}</b> · 未引用 <b style="color:#a09a80">${s ? s.orphan : '—'}</b></div>
          <div style="margin-top:6px;line-height:1.7">删除前会扫描引用；仍被引用的资源不会被删除。</div>
          <div style="margin-top:6px;line-height:1.7">上传大小限制：${mediaData?.limits ? formatBytes(mediaData.limits.uploadMaxBytes) : '35 MB'}</div>
        </div>`;
    }

    async function loadMedia() {
      try {
        const res = await apiFetch(MEDIA_API);
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '加载媒体库失败'); return; }
        mediaData = data;
        mediaVisible = 60;
        renderMediaSidebar();
        renderMediaEditor();
      } catch (e) { toast('加载媒体库失败: ' + e.message); }
    }

    function mediaCardHtml(m, { picker = false } = {}) {
      const dims = m.width && m.height ? ` · ${m.width}×${m.height}` : '';
      const used = m.usedBy.length ? `引用 ${m.usedBy.length}` : '未引用';
      const thumb = m.type === 'image'
        ? `<img loading="lazy" src="${escAttr(m.url)}" alt="${escAttr(m.name)}" />`
        : '<span>♪</span>';
      const actions = picker ? '' : `<div class="media-actions">
          <button class="btn small" data-maction="copy" data-type="${m.type}" data-name="${escAttr(m.name)}" title="复制 CDN 地址">CDN</button>
          ${m.type === 'image' ? `<button class="btn small" data-maction="copy-original" data-type="${m.type}" data-name="${escAttr(m.name)}" title="复制原图地址">原图</button>` : ''}
          <button class="btn small" data-maction="insert" data-type="${m.type}" data-name="${escAttr(m.name)}" title="插入目标文章正文">插入</button>
          ${m.type === 'image' ? `<button class="btn small" data-maction="cover" data-type="${m.type}" data-name="${escAttr(m.name)}" title="设为目标文章封面">封面</button>` : ''}
          <button class="btn small" data-maction="usage" data-type="${m.type}" data-name="${escAttr(m.name)}" title="查看引用">引用</button>
          <button class="btn small" data-maction="archive" data-type="${m.type}" data-name="${escAttr(m.name)}" title="移入 _archive">归档</button>
          <button class="btn small danger" data-maction="delete" data-type="${m.type}" data-name="${escAttr(m.name)}" title="删除（若被引用则拒绝）">删</button>
        </div>`;
      return `<div class="media-card${m.type === 'image' && !m.usedBy.length ? ' unused' : ''}" data-type="${m.type}" data-name="${escAttr(m.name)}">
          <div class="media-thumb">${thumb}</div>
          <div class="media-name" title="${escAttr(m.name)}">${esc(m.name)}</div>
          <div class="media-meta">${formatBytes(m.size)}${dims} · ${used}</div>
          ${actions}
        </div>`;
    }

    function updateMediaGrid() {
      const list = filteredMedia();
      const shown = list.slice(0, mediaVisible);
      const more = list.length - shown.length;
      const count = $('#mediaEditorCount');
      if (count) count.textContent = `${shown.length} / ${list.length} 项`;
      const grid = $('#mediaGrid');
      if (grid) grid.innerHTML = shown.length ? shown.map((m) => mediaCardHtml(m)).join('') : '<div class="media-empty">没有匹配的媒体</div>';
      const moreWrap = $('#mediaMoreWrap');
      if (moreWrap) {
        moreWrap.innerHTML = more > 0 ? `<button class="btn" id="btnMediaMore">加载更多（剩余 ${more}）</button>` : '';
        const moreBtn = $('#btnMediaMore');
        if (moreBtn) moreBtn.onclick = () => { mediaVisible += 60; updateMediaGrid(); };
      }
    }

    function renderMediaEditor() {
      const el = $('#editorContainer');
      if (!el) return;
      el.innerHTML = `
        <div class="editor media-editor">
          <div class="media-toolbar">
            <input id="fMediaSearch" placeholder="搜索文件名…" value="${escAttr(mediaFilter.q)}" style="min-width:180px" />
            <select id="fMediaType">
              <option value="all"${mediaFilter.type === 'all' ? ' selected' : ''}>全部类型</option>
              <option value="image"${mediaFilter.type === 'image' ? ' selected' : ''}>图片</option>
              <option value="audio"${mediaFilter.type === 'audio' ? ' selected' : ''}>音频</option>
            </select>
            <select id="fMediaUsage">
              <option value="all"${mediaFilter.usage === 'all' ? ' selected' : ''}>全部引用</option>
              <option value="used"${mediaFilter.usage === 'used' ? ' selected' : ''}>已被引用</option>
              <option value="unused"${mediaFilter.usage === 'unused' ? ' selected' : ''}>未引用</option>
            </select>
            <span class="filter-count" id="mediaEditorCount"></span>
            <span style="flex:1"></span>
            <input type="file" id="fMediaUpload" multiple accept="image/*,audio/*" style="display:none" />
            <button class="btn primary" id="btnMediaUpload">⬆ 上传</button>
          </div>
          <div class="media-queue" id="mediaQueue"></div>
          <div class="media-target">
            <label>目标文章</label>
            <select id="fMediaTargetPost"><option value="">（未选择，仅复制 / 引用）</option>${ctx.getPosts().map((p) => `<option value="${escAttr(p.slug)}"${mediaTargetSlug === p.slug ? ' selected' : ''}>${esc(p.title || p.slug)}</option>`).join('')}</select>
            <span>用于「插入」「封面」</span>
          </div>
          <div class="media-grid" id="mediaGrid"></div>
          <div id="mediaMoreWrap" style="text-align:center"></div>
        </div>`;

      $('#fMediaSearch').addEventListener('input', (e) => { mediaFilter.q = e.target.value; mediaVisible = 60; updateMediaGrid(); });
      $('#fMediaType').addEventListener('change', (e) => { mediaFilter.type = e.target.value; mediaVisible = 60; updateMediaGrid(); });
      $('#fMediaUsage').addEventListener('change', (e) => { mediaFilter.usage = e.target.value; mediaVisible = 60; updateMediaGrid(); });
      $('#fMediaTargetPost').addEventListener('change', (e) => { mediaTargetSlug = e.target.value; });
      $('#btnMediaUpload').addEventListener('click', triggerMediaUpload);
      $('#fMediaUpload').addEventListener('change', (e) => { enqueueMediaFiles([...e.target.files]); e.target.value = ''; });
      $('#mediaGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-maction]');
        if (!btn) return;
        e.stopPropagation();
        handleMediaAction(btn.dataset.maction, btn.dataset.type, btn.dataset.name);
      });
      updateMediaGrid();
      renderMediaQueue();
    }

    function renderMediaQueue() {
      const updateUploadState = () => store.set({
        upload: {
          active: mediaActiveUploads,
          failed: mediaTasks.filter((t) => t.status === 'failed').length,
        },
      });
      const el = $('#mediaQueue');
      if (!el) { updateUploadState(); return; }
      if (!mediaTasks.length) { el.innerHTML = ''; updateUploadState(); return; }
      const statusText = { queued: '等待', uploading: '上传中', ready: '完成', failed: '失败', cancelled: '已取消' };
      el.innerHTML = mediaTasks.map((t) => `
        <div class="media-task${t.status === 'failed' ? ' failed' : ''}">
          <span class="tname" title="${escAttr(t.name)}">${esc(t.name)}</span>
          ${t.duplicate && t.status !== 'ready' ? '<span style="color:#c08060">可能重复</span>' : ''}
          <span class="bar"><i style="width:${t.progress || 0}%"></i></span>
          <span>${t.status === 'failed' ? esc(t.error || '失败') : (statusText[t.status] || t.status)}${t.status === 'uploading' ? ` ${t.progress || 0}%` : ''}</span>
          ${t.status === 'uploading' ? `<button class="btn small" data-mtask="cancel" data-id="${t.id}">取消</button>` : ''}
          ${t.status === 'failed' || t.status === 'cancelled' ? `<button class="btn small" data-mtask="retry" data-id="${t.id}">重试</button>` : ''}
          ${t.status === 'ready' || t.status === 'failed' || t.status === 'cancelled' ? `<button class="btn small" data-mtask="remove" data-id="${t.id}">×</button>` : ''}
        </div>`).join('');
      el.querySelectorAll('[data-mtask]').forEach((btn) => {
        btn.onclick = () => {
          const task = mediaTasks.find((t) => t.id === btn.dataset.id);
          if (!task) return;
          if (btn.dataset.mtask === 'cancel') { if (task.xhr) task.xhr.abort(); else { task.status = 'cancelled'; renderMediaQueue(); } }
          if (btn.dataset.mtask === 'retry') { task.status = 'queued'; task.progress = 0; task.error = ''; pumpMediaQueue(); }
          if (btn.dataset.mtask === 'remove') { mediaTasks = mediaTasks.filter((t) => t.id !== task.id); renderMediaQueue(); }
        };
      });
      updateUploadState();
    }

    function findDuplicateMedia(file) {
      const all = allMediaItems();
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').slice(0, 60);
      return all.find((m) => m.size === file.size && m.name.startsWith(base)) || null;
    }

    function triggerMediaUpload() {
      const input = $('#fMediaUpload');
      if (input) input.click();
    }

    function enqueueMediaFiles(files) {
      const limit = mediaData?.limits?.uploadMaxBytes || 50 * 1024 * 1024;
      for (const file of files) {
        if (!file) continue;
        const tooLarge = file.size > limit;
        mediaTasks.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          name: file.name,
          status: tooLarge ? 'failed' : 'queued',
          progress: 0,
          error: tooLarge ? `文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限，请先压缩` : '',
          duplicate: findDuplicateMedia(file),
        });
      }
      renderMediaQueue();
      pumpMediaQueue();
    }

    function pumpMediaQueue() {
      const limit = mediaData?.limits?.uploadConcurrency || 2;
      while (mediaActiveUploads < limit) {
        const task = mediaTasks.find((t) => t.status === 'queued');
        if (!task) break;
        startMediaUpload(task);
      }
      renderMediaQueue();
    }

    function startMediaUpload(task) {
      mediaActiveUploads += 1;
      task.status = 'uploading';
      task.progress = 0;
      task.error = '';
      const xhr = new XMLHttpRequest();
      task.xhr = xhr;
      const fd = new FormData();
      fd.append('file', task.file, task.name);
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('x-admin-token', getToken());
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        task.progress = Math.round((e.loaded / e.total) * 100);
        renderMediaQueue();
      };
      xhr.onload = () => {
        mediaActiveUploads = Math.max(0, mediaActiveUploads - 1);
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300 && !data.error) { task.status = 'ready'; task.progress = 100; task.result = data; }
          else { task.status = 'failed'; task.error = data.error ? (data.detail ? `${data.error}（${data.detail}）` : data.error) : `HTTP ${xhr.status}`; }
        } catch { task.status = 'failed'; task.error = `HTTP ${xhr.status}`; }
        renderMediaQueue();
        afterMediaQueueChange();
        pumpMediaQueue();
      };
      xhr.onerror = () => { mediaActiveUploads = Math.max(0, mediaActiveUploads - 1); task.status = 'failed'; task.error = '网络错误'; renderMediaQueue(); pumpMediaQueue(); };
      xhr.onabort = () => { mediaActiveUploads = Math.max(0, mediaActiveUploads - 1); task.status = 'cancelled'; renderMediaQueue(); pumpMediaQueue(); };
      xhr.send(fd);
    }

    let mediaRefreshTimer = null;
    function afterMediaQueueChange() {
      const busy = mediaTasks.some((t) => t.status === 'queued' || t.status === 'uploading');
      if (busy) return;
      if (!mediaTasks.some((t) => t.status === 'ready')) return;
      clearTimeout(mediaRefreshTimer);
      mediaRefreshTimer = setTimeout(() => {
        loadMedia();
        if (pickerState && $('#mediaPickerGrid')) refreshMediaPicker();
      }, 400);
    }

    async function copyMediaUrl(url, label) {
      try { await navigator.clipboard.writeText(url); toast(`已复制${label}：${url}`); } catch { toast(`复制失败，请手动复制：${url}`); }
    }

    function mediaUsageLabel(owner) {
      if (owner.startsWith('gallery:')) return `画廊：${owner.slice('gallery:'.length)}`;
      if (owner.startsWith('post:')) {
        const slug = owner.slice('post:'.length);
        const p = ctx.getPosts().find((x) => x.slug === slug);
        return `文章：${p ? (p.title || slug) : slug}`;
      }
      return owner;
    }

    function showMediaUsage(name) {
      const m = allMediaItems().find((x) => x.name === name);
      const mask = $('#mediaUsageModal');
      if (!mask) return;
      const used = m?.usedBy || [];
      $('#mediaUsageTitle').textContent = m ? m.name : name;
      $('#mediaUsageList').innerHTML = used.length
        ? `<div class="media-usage-list">${used.map((o) => `<div>• ${esc(mediaUsageLabel(o))}</div>`).join('')}</div>`
        : '<div class="sync-ok">未被任何文章或画廊引用，可以安全删除或归档。</div>';
      openModal(mask);
    }

    async function targetPostForMedia() {
      if (!mediaTargetSlug) { toast('请先在上方选择目标文章'); return null; }
      const res = await apiFetch(`${POSTS_API}/${encodeURIComponent(mediaTargetSlug)}`);
      const post = await res.json();
      if (!res.ok || post.error) { toast(post.error || '读取目标文章失败'); return null; }
      return post;
    }

    async function insertMediaIntoPost(m) {
      const post = await targetPostForMedia();
      if (!post) return;
      const block = m.type === 'audio'
        ? `\n<div class="song-player" data-src="${m.url}" data-title="${m.name.replace(/\.[^.]+$/, '')}" data-artist="">♪ 播放音频</div>\n`
        : `\n![${m.name.replace(/\.[^.]+$/, '')}](${m.url})\n`;
      const content = `${post.content || ''}${block}`;
      await ctx.putPostFields(post, { content });
    }

    async function setMediaAsCover(m) {
      const post = await targetPostForMedia();
      if (!post) return;
      await ctx.putPostFields(post, { cover: m.url });
    }



    async function deleteMedia(type, name) {
      if (!confirm(`删除「${name}」？若仍被引用将被拒绝。`)) return;
      try {
        const res = await apiFetch(`${MEDIA_API}?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.status === 409 && data.usedBy) { showMediaUsage(name); toast(data.error); return; }
        if (!res.ok || data.error) { toast(data.error || '删除失败'); return; }
        toast('已删除：' + name);
        await loadMedia();
      } catch (e) { toast('删除失败: ' + e.message); }
    }

    async function archiveMedia(type, name) {
      if (!confirm(`归档「${name}」？文件将移入 _archive，不再出现在媒体库。`)) return;
      try {
        const res = await apiFetch('/api/media/archive', { method: 'POST', body: new URLSearchParams({ type, name }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '归档失败'); return; }
        toast('已归档：' + name);
        await loadMedia();
      } catch (e) { toast('归档失败: ' + e.message); }
    }

    async function handleMediaAction(action, type, name) {
      const m = allMediaItems().find((x) => x.name === name && x.type === type);
      if (!m) return;
      if (action === 'copy') copyMediaUrl(m.url, 'CDN 地址');
      else if (action === 'copy-original') copyMediaUrl(m.originalUrl || m.url, '原图地址');
      else if (action === 'usage') showMediaUsage(name);
      else if (action === 'insert') insertMediaIntoPost(m);
      else if (action === 'cover') setMediaAsCover(m);
      else if (action === 'archive') archiveMedia(type, name);
      else if (action === 'delete') deleteMedia(type, name);
    }

    // ── 媒体选择器（画廊 / 封面 / 正文插入复用）──
    async function openMediaPicker({ type = 'image', title = '选择媒体', onPick } = {}) {
      pickerState = { type, onPick };
      const mask = $('#mediaPickerModal');
      if (!mask) return;
      $('#mediaPickerTitle').textContent = title;
      openModal(mask);
      if (!mediaData) await loadMedia();
      refreshMediaPicker();
    }

    function closeMediaPicker() {
      closeModal($('#mediaPickerModal'));
      pickerState = null;
    }

    function refreshMediaPicker() {
      const grid = $('#mediaPickerGrid');
      if (!grid || !pickerState) return;
      const list = allMediaItems().filter((m) => pickerState.type === 'all' || m.type === pickerState.type);
      grid.innerHTML = list.length ? list.map((m) => mediaCardHtml(m, { picker: true })).join('') : '<div class="media-empty">媒体库为空，先上传一个文件</div>';
      grid.querySelectorAll('.media-card').forEach((card) => {
        card.onclick = () => {
          const m = allMediaItems().find((x) => x.name === card.dataset.name && x.type === card.dataset.type);
          if (m && pickerState?.onPick) pickerState.onPick(m);
        };
      });
    }

    function setupMediaPicker() {
      const close = $('#mediaPickerClose');
      if (close) close.onclick = closeMediaPicker;
      const mask = $('#mediaPickerModal');
      if (mask) mask.addEventListener('click', (e) => { if (e.target === mask) closeMediaPicker(); });
      const uploadBtn = $('#btnMediaPickerUpload');
      const input = $('#fMediaPickerUpload');
      if (uploadBtn && input) {
        uploadBtn.onclick = () => input.click();
        input.onchange = () => {
          const files = [...input.files];
          input.value = '';
          if (!files.length) return;
          pickerUploads(files);
        };
      }
    }

    async function pickerUploads(files) {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file, file.name);
        try {
          toast(`上传中：${file.name}`);
          const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok || data.error) { toast((data.error || '上传失败') + `：${file.name}`); continue; }
          toast('已上传：' + data.url);
        } catch (e) { toast(`上传失败：${file.name}（${e.message}）`); }
      }
      await loadMedia();
      refreshMediaPicker();
    }

    function setupCoverMediaButton() {
      const btn = $('#btnCoverFromMedia');
      if (!btn) return;
      btn.onclick = () => openMediaPicker({ type: 'image', title: '选择封面图片', onPick: (m) => {
        const input = $('#fCover');
        if (input) { input.value = m.url; syncPostCoverPreview(); markPostDirty(); }
        closeMediaPicker();
      }});
    }

    function setupMediaInsertButton() {
      const btn = $('#btnInsertMedia');
      if (!btn) return;
      btn.onclick = () => openMediaPicker({ type: 'all', title: '从媒体库插入', onPick: (m) => {
        if (m.type === 'audio') {
          insertMarkdownBlock(`<div class="song-player" data-src="${m.url}" data-title="${m.name.replace(/\.[^.]+$/, '')}" data-artist="">♪ 播放音频</div>`);
        } else {
          insertImageIntoEditor(m.url, m.name.replace(/\.[^.]+$/, ''));
        }
        closeMediaPicker();
      }});
    }

    function setupGalleryMediaButton() {
      const bar = document.querySelector('#editorContainer .url-import-bar');
      if (!bar) return;
      let btn = $('#btnGalleryMedia');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn small';
        btn.id = 'btnGalleryMedia';
        btn.textContent = '媒体库';
        btn.title = '从媒体库选择图片';
        bar.appendChild(btn);
      }
      btn.onclick = () => openMediaPicker({ type: 'image', title: '选择画廊图片', onPick: (m) => {
        const src = $('#fSrc');
        if (src) { src.value = m.url; src.focus(); }
        const original = $('#fOriginal');
        if (original && !original.value.trim() && m.originalUrl) original.value = m.originalUrl;
        const title = $('#fGalleryTitle');
        if (title && !title.value.trim()) title.value = m.name.replace(/\.[^.]+$/, '');
        closeMediaPicker();
      }});
    }


export {
  loadMedia, renderMediaSidebar, triggerMediaUpload, openMediaPicker, closeMediaPicker,
  setupMediaPicker, setupCoverMediaButton, setupMediaInsertButton, setupGalleryMediaButton,
};
