/**
 * 画廊：独立收藏图片的增删改与批量/文件夹上传（src/data/gallery.json，带版本冲突校验）。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch, getToken } from '../api/app-client.js';
import { formatBytes } from '../util/format.js';

const GALLERY_API = '/api/gallery';
const GALLERY_BATCH_API = '/api/gallery/batch';
const GALLERY_PUSH_API = '/api/gallery/push';
const DEFAULT_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
const QUEUE_RENDER_CAP = 200;

let galleryItems = [];
let currentGalleryId = null;
let galleryHash = '';
let galleryFilter = { q: '', sort: 'date-desc' };
let galleryBaseline = '';
let galleryDirty = false;
let galleryEditorActive = false;

// ── 批量 / 文件夹上传队列（严格每次 1 张低并发，上传后直接入库并推送）──
let batchTasks = [];
let batchActive = 0;
let batchPaused = false;
let batchDate = '';
let batchAutoPush = true;
let pendingPushUrls = [];
let pushState = { status: 'idle', message: '', detail: '' };
let batchViewActive = false;

let ctx = {
  setupUpload: () => {},
  setupGalleryMediaButton: () => {},
  openMediaPicker: null,
  onDirtyChange: () => {},
  refreshSyncStatus: async () => null,
  getUploadMaxBytes: () => DEFAULT_UPLOAD_MAX_BYTES,
  isGalleryMode: () => false,
};

export function initGallery(options = {}) { ctx = { ...ctx, ...options }; }
export function getCurrentGalleryId() { return currentGalleryId; }
export function isGalleryDirty() { return galleryDirty; }
export function isGalleryBatchBusy() {
  return batchActive > 0
    || batchTasks.some((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'saving')
    || pushState.status === 'pushing';
}
export function clearGalleryDirty() { galleryDirty = false; galleryBaseline = ''; galleryEditorActive = false; ctx.onDirtyChange(false); }
export function resetGallerySelection() {
  currentGalleryId = null;
  batchViewActive = false;
  clearGalleryDirty();
}

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function titleFromFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  return base.replace(/\.[^.]+$/, '').trim() || '未命名图像';
}

function titleFromSrc(src, rawTitle) {
  const t = String(rawTitle || '').trim();
  if (t) return t;
  const last = String(src || '').split(/[?#]/)[0].split('/').pop() || '';
  let decoded = last;
  try { decoded = decodeURIComponent(last); } catch { /* ignore */ }
  return decoded.replace(/\.[^.]+$/, '').replace(/_\d{10,}(?:-\d+)?$/, '').trim() || '未命名图像';
}

function isGalleryImageFile(file) {
  if (!file || !file.name) return false;
  const lower = file.name.toLowerCase();
  if (lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini') return false;
  if (/\.(psd|raw|cr2|nef|arw|dng)$/i.test(lower)) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|jfif|gif|webp|avif|svg|heic|heif|tiff?)$/i.test(lower);
}

async function extractDroppedEntries(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) {
    return [...(dataTransfer?.files || [])].map((file) => ({
      file,
      relPath: file.webkitRelativePath || file.name,
    }));
  }
  const collected = [];
  async function walk(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) {
        collected.push({ file, relPath: prefix ? `${prefix}/${file.name}` : file.name });
      }
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = [];
      // Chromium readEntries 单次最多返回 100 条，必须循环读取直至空数组
      while (true) {
        const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
        if (!batch || !batch.length) break;
        children.push(...batch);
      }
      const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of children) await walk(child, nextPrefix);
    }
  }
  for (const entry of entries) await walk(entry);
  return collected;
}

function readGalleryFormState() {
  return {
    src: $('#fSrc')?.value || '',
    date: $('#fGalleryDate')?.value || '',
    dayIndex: $('#fGalleryDayIndex')?.value || '',
    title: $('#fGalleryTitle')?.value || '',
    alt: $('#fAlt')?.value || '',
    caption: $('#fCaption')?.value || '',
    original: $('#fOriginal')?.value || '',
    sourceUrl: $('#fSourceUrl')?.value || '',
    sourceTitle: $('#fSourceTitle')?.value || '',
  };
}

function syncGalleryDirty() {
  if (!galleryEditorActive || !$('#fSrc')) return;
  const next = JSON.stringify(readGalleryFormState()) !== galleryBaseline;
  if (next !== galleryDirty) {
    galleryDirty = next;
    ctx.onDirtyChange(galleryDirty);
  }
}

function markGalleryBaseline() {
  galleryEditorActive = true;
  galleryBaseline = JSON.stringify(readGalleryFormState());
  galleryDirty = false;
  ctx.onDirtyChange(false);
}

function bindGalleryDirtyInputs() {
  const root = $('#editorContainer');
  if (!root) return;
  root.querySelectorAll('input').forEach((el) => {
    if (el.id === 'fImportUrl' || el.id === 'fImportReferer') return;
    el.addEventListener('input', syncGalleryDirty);
    el.addEventListener('change', syncGalleryDirty);
  });
}

function canLeaveGalleryItem() {
  if (!galleryDirty) return true;
  return confirm('当前画廊项目有未保存修改，确定放弃并切换？');
}

async function loadGallery() {
  try {
    const res = await apiFetch(GALLERY_API);
    galleryHash = res.headers.get('x-content-hash') || '';
    galleryItems = await res.json();
    renderGalleryList();
  } catch (e) { toast('加载画廊失败: ' + e.message); }
}

async function ensureGalleryHash() {
  if (galleryHash) return galleryHash;
  const res = await apiFetch(GALLERY_API);
  galleryHash = res.headers.get('x-content-hash') || '';
  const data = await res.json();
  if (Array.isArray(data)) galleryItems = data;
  return galleryHash;
}

function getFilteredGalleryItems() {
  const q = galleryFilter.q.trim().toLowerCase();
  const filtered = galleryItems.filter((item) => {
    if (!q) return true;
    const hay = `${item.title || ''}\n${item.caption || ''}\n${item.alt || ''}\n${item.date || ''}\n${item.sourceTitle || ''}\n${item.id || ''}`.toLowerCase();
    return hay.includes(q);
  });
  return filtered.sort((a, b) => {
    if (galleryFilter.sort === 'date-asc') {
      return (a.date || '').localeCompare(b.date || '') || (a.dayIndex || 0) - (b.dayIndex || 0);
    }
    if (galleryFilter.sort === 'title-asc') {
      return (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN');
    }
    return (b.date || '').localeCompare(a.date || '') || (b.dayIndex || 0) - (a.dayIndex || 0);
  });
}

function renderGalleryRows() {
  const body = $('#galleryListBody');
  if (!body) return;
  if (!galleryItems.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px">暂无独立收藏</div>';
    return;
  }
  const list = getFilteredGalleryItems();
  if (!list.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px">没有匹配的图像</div>';
    return;
  }
  body.innerHTML = list.map((item) => `
    <div class="gallery-list-item${item.id === currentGalleryId ? ' active' : ''}" data-gallery-id="${escAttr(item.id)}">
      <img src="${escAttr(item.src)}" alt="${escAttr(item.alt || item.title)}" loading="lazy" onerror="this.style.display='none'" />
      <div class="info" data-gallery-open="${escAttr(item.id)}">
        <div class="title">${esc(item.title)}</div>
        <div class="meta">${item.date || '无日期'}${item.dayIndex ? ` · #${item.dayIndex}` : ''}</div>
      </div>
      <div class="actions">
        <button class="btn small danger" data-gallery-delete="${escAttr(item.id)}" title="删除">×</button>
      </div>
    </div>`).join('');
}

async function batchImportFromMedia(selected) {
  if (!Array.isArray(selected) || !selected.length) return;
  const today = localToday();
  await ensureGalleryHash();
  const payloadItems = selected.map((m) => {
    const title = m.name.replace(/\.[^.]+$/, '');
    return {
      src: m.url || '',
      original: m.originalUrl || '',
      title,
      alt: '',
      caption: '',
      date: today,
    };
  });
  try {
    const res = await apiFetch(GALLERY_BATCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payloadItems, expectedHash: galleryHash }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast(`批量导入失败：${data.error || `HTTP ${res.status}`}`);
      return;
    }
    if (data.contentHash) galleryHash = data.contentHash;
    toast(`批量加入画廊：成功 ${data.count || selected.length} 项`);
    await loadGallery();
  } catch (e) {
    toast(`批量导入失败：${e.message}`);
  }
}

function updateBatchSidebarBadge() {
  const btn = $('#btnGalleryBatchUpload');
  if (!btn) return;
  const queued = batchTasks.filter((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'saving').length;
  const done = batchTasks.filter((t) => t.status === 'ready').length;
  const total = batchTasks.length;
  if (pushState.status === 'pushing') {
    btn.textContent = '⬆ 推送中…';
  } else if (queued > 0) {
    btn.textContent = `⬆ 上传中 ${done}/${total}`;
  } else {
    btn.textContent = '⬆ 批量上传';
  }
}

function renderGalleryList() {
  const el = $('#postList');
  if (!el) return;
  el.innerHTML = `
    <div class="gallery-sidebar-tools">
      <div class="gallery-sidebar-tools__row">
        <input id="fGallerySearch" type="search" placeholder="搜索画廊记录 / 日期…" value="${escAttr(galleryFilter.q)}" autocomplete="off" />
      </div>
      <div class="gallery-sidebar-tools__row">
        <select id="fGallerySort" title="画廊排序">
          <option value="date-desc"${galleryFilter.sort === 'date-desc' ? ' selected' : ''}>日期 ↓</option>
          <option value="date-asc"${galleryFilter.sort === 'date-asc' ? ' selected' : ''}>日期 ↑</option>
          <option value="title-asc"${galleryFilter.sort === 'title-asc' ? ' selected' : ''}>文件名 A→Z</option>
        </select>
        <button class="btn small primary" type="button" id="btnGalleryBatchUpload" title="复选多张图片或整个文件夹顺序上传并推送">⬆ 批量上传</button>
        ${ctx.openMediaPicker ? '<button class="btn small" type="button" id="btnGalleryBatch" title="从媒体库多选批量加入画廊">媒体库</button>' : ''}
      </div>
    </div>
    <div id="galleryListBody"></div>`;
  $('#fGallerySearch').addEventListener('input', (e) => {
    galleryFilter.q = e.target.value;
    renderGalleryRows();
  });
  $('#fGallerySort').addEventListener('change', (e) => {
    galleryFilter.sort = e.target.value;
    renderGalleryRows();
  });
  $('#btnGalleryBatchUpload').onclick = () => openGalleryBatchUploader();
  const batchBtn = $('#btnGalleryBatch');
  if (batchBtn && ctx.openMediaPicker) {
    batchBtn.onclick = () => ctx.openMediaPicker({
      type: 'image',
      multiple: true,
      title: '批量选择图片加入画廊',
      onPickBatch: batchImportFromMedia,
    });
  }
  updateBatchSidebarBadge();
  renderGalleryRows();
  el.onclick = (e) => {
    const del = e.target.closest('[data-gallery-delete]');
    if (del) { e.stopPropagation(); deleteGalleryItem(del.dataset.galleryDelete); return; }
    const open = e.target.closest('[data-gallery-open]');
    if (open) selectGalleryItem(open.dataset.galleryOpen);
  };
}

// ── 批量上传到 04 图像档案 · 独立收藏 ──

function enqueueGalleryBatchFiles(rawEntries) {
  const list = Array.isArray(rawEntries) ? rawEntries : [];
  if (!list.length) return;
  const maxBytes = ctx.getUploadMaxBytes?.() || DEFAULT_UPLOAD_MAX_BYTES;
  const imageEntries = [];
  let skipped = 0;

  for (const entry of list) {
    const file = entry?.file || entry;
    const relPath = entry?.relPath || file?.webkitRelativePath || file?.name || '';
    if (!file) continue;
    if (!isGalleryImageFile(file)) {
      skipped += 1;
      continue;
    }
    imageEntries.push({ file, relPath });
  }

  if (!imageEntries.length) {
    toast(skipped ? `未发现支持的图片文件（已跳过 ${skipped} 个非图片文件）` : '未选择图片');
    return;
  }

  imageEntries.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));

  for (const { file, relPath } of imageEntries) {
    const tooLarge = file.size > maxBytes;
    batchTasks.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: tooLarge ? null : file,
      name: relPath || file.name,
      fileName: file.name,
      size: file.size,
      status: tooLarge ? 'failed' : 'queued',
      progress: 0,
      error: tooLarge ? `超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限` : '',
      url: '',
      xhr: null,
    });
  }

  if (pushState.status === 'done') {
    pushState = { status: 'idle', message: '', detail: '' };
  }

  const msg = skipped
    ? `已加入 ${imageEntries.length} 张图片（跳过 ${skipped} 个非图片文件）`
    : `已加入 ${imageEntries.length} 张图片，按每次 1 张顺序上传`;
  toast(msg);

  updateGalleryBatchUI();
  pumpGalleryBatchQueue();
}

async function saveUploadedToGallery({ url, originalUrl, fileName, date }) {
  await ensureGalleryHash();
  const title = titleFromFileName(fileName);
  const submitOnce = async () => {
    const fd = new URLSearchParams();
    fd.set('src', url);
    fd.set('original', originalUrl || '');
    fd.set('title', title);
    fd.set('alt', '');
    fd.set('caption', '');
    fd.set('date', date || localToday());
    fd.set('dayIndex', '');
    fd.set('sourceUrl', '');
    fd.set('sourceTitle', '');
    fd.set('expectedHash', galleryHash);
    const res = await apiFetch(GALLERY_API, {
      method: 'POST',
      body: fd,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = await res.json();
    return { res, data };
  };

  let { res, data } = await submitOnce();
  if (res.status === 409) {
    // 并发或其它页签改写导致 hash 过期时自动同步一次重试
    galleryHash = '';
    await ensureGalleryHash();
    ({ res, data } = await submitOnce());
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `写入画廊失败（HTTP ${res.status}）`);
  }
  if (data.contentHash) galleryHash = data.contentHash;
  if (data.item) {
    galleryItems.unshift(data.item);
    renderGalleryRows();
  }
  return data.item;
}

function uploadFileDeferred(task) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.xhr = xhr;
    const fd = new FormData();
    fd.append('file', task.file, task.fileName || task.name);
    xhr.open('POST', '/api/upload?deferPush=1');
    xhr.setRequestHeader('x-admin-token', getToken());
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      task.progress = Math.round((e.loaded / e.total) * 100);
      updateGalleryBatchUI();
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300 && !data.error && data.url) {
        resolve(data);
      } else {
        const msg = data.error ? (data.detail ? `${data.error}（${data.detail}）` : data.error) : `HTTP ${xhr.status}`;
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.onabort = () => {
      const err = new Error('已取消');
      err.aborted = true;
      reject(err);
    };
    xhr.send(fd);
  });
}

async function processGalleryUploadTask(task) {
  batchActive = 1;
  task.status = 'uploading';
  task.progress = 0;
  task.error = '';
  updateGalleryBatchUI();

  try {
    const uploaded = await uploadFileDeferred(task);
    task.status = 'saving';
    task.progress = 100;
    updateGalleryBatchUI();

    await saveUploadedToGallery({
      url: uploaded.url,
      originalUrl: uploaded.originalUrl || '',
      fileName: task.fileName || task.name,
      date: batchDate || localToday(),
    });

    task.status = 'ready';
    task.url = uploaded.url;
    task.file = null;
    pendingPushUrls.push(uploaded.url);
  } catch (err) {
    if (err.aborted) {
      task.status = 'cancelled';
      task.error = '';
    } else {
      task.status = 'failed';
      task.error = err.message || '上传失败';
    }
  } finally {
    task.xhr = null;
    batchActive = 0;
    updateGalleryBatchUI();
    pumpGalleryBatchQueue();
  }
}

function pumpGalleryBatchQueue() {
  if (batchPaused || batchActive >= 1 || pushState.status === 'pushing') {
    updateGalleryBatchUI();
    return;
  }
  const next = batchTasks.find((t) => t.status === 'queued');
  if (next) {
    processGalleryUploadTask(next);
    return;
  }
  updateGalleryBatchUI();
  if (batchAutoPush && pendingPushUrls.length > 0 && pushState.status !== 'error') {
    runGalleryBatchPush();
  }
}

async function runGalleryBatchPush() {
  if (pushState.status === 'pushing' || batchActive > 0) return;
  const urls = [...pendingPushUrls];
  pushState = { status: 'pushing', message: '正在推送图片仓库与 03 图像档案到线上…', detail: '' };
  updateGalleryBatchUI();

  try {
    const res = await apiFetch(GALLERY_PUSH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false || data.ok === false) {
      throw new Error(data.error || data.detail || `HTTP ${res.status}`);
    }
    pendingPushUrls = [];
    const failedCount = batchTasks.filter((t) => t.status === 'failed').length;
    pushState = {
      status: 'done',
      message: failedCount
        ? `已推送已入库图片（另有 ${failedCount} 张失败，可重试）`
        : '✔ 全部上传完成并已直接推送上线！',
      detail: data.detail || '',
    };
    toast('上传完成并已直接推送');
    ctx.refreshSyncStatus?.({ silent: true });
  } catch (err) {
    pushState = {
      status: 'error',
      message: `推送失败：${err.message}`,
      detail: err.detail || '',
    };
    toast(`图片已入库，但推送失败：${err.message}`);
  } finally {
    updateGalleryBatchUI();
    // 若推送期间有新文件入队，继续上传
    if (!batchPaused && batchTasks.some((t) => t.status === 'queued')) {
      pumpGalleryBatchQueue();
    }
  }
}

function updateGalleryBatchUI() {
  updateBatchSidebarBadge();
  if (!batchViewActive || !ctx.isGalleryMode()) return;

  const progressWrap = $('#galleryBatchProgressWrap');
  const queueEl = $('#galleryBatchQueue');
  if (!progressWrap || !queueEl) return;

  const total = batchTasks.length;
  const ready = batchTasks.filter((t) => t.status === 'ready').length;
  const failed = batchTasks.filter((t) => t.status === 'failed').length;
  const cancelled = batchTasks.filter((t) => t.status === 'cancelled').length;
  const queued = batchTasks.filter((t) => t.status === 'queued').length;
  const activeTask = batchTasks.find((t) => t.status === 'uploading' || t.status === 'saving');
  const finished = ready + failed + cancelled;
  const pct = total ? Math.round(((finished + (activeTask ? (activeTask.progress || 0) / 100 : 0)) / total) * 100) : 0;

  if (!total && pushState.status === 'idle' && !pendingPushUrls.length) {
    progressWrap.hidden = true;
    queueEl.innerHTML = '';
    return;
  }

  progressWrap.hidden = false;

  let summaryText = '';
  let statusCls = '';
  if (pushState.status === 'pushing') {
    summaryText = pushState.message;
    statusCls = 'is-pushing';
  } else if (pushState.status === 'error') {
    summaryText = pushState.message;
    statusCls = 'is-error';
  } else if (pushState.status === 'done' && !queued && !activeTask) {
    summaryText = pushState.message;
    statusCls = 'is-done';
  } else if (activeTask) {
    const step = activeTask.status === 'saving' ? '正在写入档案' : `${activeTask.progress || 0}%`;
    summaryText = `正在上传第 ${finished + 1} / ${total} 张（${step}）· 已入库 ${ready}${failed ? ` · 失败 ${failed}` : ''} · 排队 ${queued}`;
  } else if (batchPaused && queued) {
    summaryText = `已暂停 · 已入库 ${ready} / ${total} · 剩余 ${queued}${failed ? ` · 失败 ${failed}` : ''}`;
  } else if (total) {
    summaryText = `队列已完成：入库 ${ready} / ${total}${failed ? ` · 失败 ${failed}` : ''}${pendingPushUrls.length ? ` · 待推送 ${pendingPushUrls.length} 张` : ''}`;
    if (!failed && !pendingPushUrls.length) statusCls = 'is-done';
  }

  const summaryEl = $('#galleryBatchSummary');
  if (summaryEl) {
    summaryEl.textContent = summaryText;
    summaryEl.className = `gallery-batch-summary ${statusCls}`.trim();
  }
  const barFill = $('#galleryBatchBarFill');
  if (barFill) barFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;

  const pauseBtn = $('#btnGalleryBatchPause');
  if (pauseBtn) {
    pauseBtn.hidden = !(queued > 0 || activeTask);
    pauseBtn.textContent = batchPaused ? '▶ 继续上传' : '⏸ 暂停';
  }
  const retryBtn = $('#btnGalleryBatchRetryFailed');
  if (retryBtn) {
    retryBtn.hidden = failed + cancelled === 0;
    retryBtn.textContent = `🔁 重试失败 (${failed + cancelled})`;
  }
  const pushBtn = $('#btnGalleryBatchPushNow');
  if (pushBtn) {
    const showPush = pendingPushUrls.length > 0 && !activeTask && queued === 0 && pushState.status !== 'pushing';
    pushBtn.hidden = !showPush;
    pushBtn.textContent = pushState.status === 'error'
      ? `🔁 重试推送 (${pendingPushUrls.length})`
      : `⬆ 立即推送 (${pendingPushUrls.length})`;
  }
  const clearBtn = $('#btnGalleryBatchClearDone');
  if (clearBtn) {
    clearBtn.hidden = ready === 0 || pushState.status === 'pushing';
  }
  const cancelBtn = $('#btnGalleryBatchCancelAll');
  if (cancelBtn) {
    cancelBtn.hidden = !(queued > 0 || activeTask);
  }

  // 优先展示正在上传 / 失败 / 排队任务，其次展示最近已完成任务，避免千张文件卡顿 DOM
  const priority = [
    ...batchTasks.filter((t) => t.status === 'uploading' || t.status === 'saving'),
    ...batchTasks.filter((t) => t.status === 'failed' || t.status === 'cancelled'),
    ...batchTasks.filter((t) => t.status === 'queued'),
    ...batchTasks.filter((t) => t.status === 'ready').reverse(),
  ];
  const visible = priority.slice(0, QUEUE_RENDER_CAP);
  const foldedCount = priority.length - visible.length;
  const statusLabels = {
    queued: '等待',
    uploading: '上传中',
    saving: '写入档案',
    ready: '已入库',
    failed: '失败',
    cancelled: '已取消',
  };

  queueEl.innerHTML = visible.map((t) => `
    <div class="gallery-batch-row status-${t.status}">
      <span class="gname" title="${escAttr(t.name)}">${esc(t.name)}</span>
      <span class="gsize">${formatBytes(t.size)}</span>
      <span class="gbar"><i style="width:${t.progress || 0}%"></i></span>
      <span class="gstatus">${t.status === 'failed' ? esc(t.error || '失败') : (statusLabels[t.status] || t.status)}${t.status === 'uploading' ? ` ${t.progress || 0}%` : ''}</span>
      <span class="gops">
        ${(t.status === 'failed' || t.status === 'cancelled') && t.file ? `<button class="btn small" type="button" data-gbtask="retry" data-id="${escAttr(t.id)}">重试</button>` : ''}
        ${t.status !== 'uploading' && t.status !== 'saving' ? `<button class="btn small" type="button" data-gbtask="remove" data-id="${escAttr(t.id)}">×</button>` : ''}
      </span>
    </div>`).join('')
    + (foldedCount > 0 ? `<div class="gallery-batch-folded">还有 ${foldedCount} 项已完成任务未展开（保持界面流畅）</div>` : '');
}

function renderGalleryBatchUploader() {
  const container = $('#editorContainer');
  if (!container) return;
  batchViewActive = true;
  if (!batchDate) batchDate = localToday();

  container.innerHTML = `
    <div class="editor gallery-batch">
      <div class="gallery-batch-drop" id="galleryBatchDropzone">
        <div class="gallery-batch-drop__title">拖放多张图片或整个文件夹到此处</div>
        <div class="gallery-batch-drop__sub">直接上传到「03 图像档案 · 独立收藏」· 每次 1 张低并发顺序上传 · 无需填写标题或编号</div>
        <div class="gallery-batch-drop__btns">
          <button class="btn primary" type="button" id="btnGalleryPickFiles">🖼 选择多张图片</button>
          <button class="btn" type="button" id="btnGalleryPickFolder">📁 选择整个文件夹</button>
        </div>
        <input type="file" id="fGalleryMultiFiles" multiple accept="image/*,.heic,.heif,.avif,.tiff,.tif" style="display:none" />
        <input type="file" id="fGalleryFolder" webkitdirectory directory multiple style="display:none" />
      </div>

      <div class="gallery-batch-options">
        <label class="gallery-batch-opt">
          <span>归档日期</span>
          <input type="date" id="fGalleryBatchDate" value="${escAttr(batchDate)}" />
        </label>
        <label class="gallery-batch-opt gallery-batch-opt--check">
          <input type="checkbox" id="fGalleryAutoPush" ${batchAutoPush ? 'checked' : ''} />
          <span>上传完成后直接推送上线（图片仓库 + 图像档案）</span>
        </label>
        <span class="gallery-batch-pill">并发：每次 1 张 · 无数量限制</span>
      </div>

      <div class="gallery-batch-progress" id="galleryBatchProgressWrap" hidden>
        <div class="gallery-batch-progress__head">
          <span id="galleryBatchSummary" class="gallery-batch-summary"></span>
          <div class="gallery-batch-actions">
            <button class="btn small" type="button" id="btnGalleryBatchPause" hidden>⏸ 暂停</button>
            <button class="btn small" type="button" id="btnGalleryBatchRetryFailed" hidden>🔁 重试失败</button>
            <button class="btn small primary" type="button" id="btnGalleryBatchPushNow" hidden>⬆ 立即推送</button>
            <button class="btn small" type="button" id="btnGalleryBatchClearDone" hidden>清空已完成</button>
            <button class="btn small danger" type="button" id="btnGalleryBatchCancelAll" hidden>取消剩余</button>
          </div>
        </div>
        <div class="gallery-batch-bar"><i id="galleryBatchBarFill" style="width:0%"></i></div>
      </div>

      <div class="gallery-batch-queue" id="galleryBatchQueue"></div>
    </div>`;

  const multiInput = $('#fGalleryMultiFiles');
  const folderInput = $('#fGalleryFolder');
  const dropzone = $('#galleryBatchDropzone');

  $('#btnGalleryPickFiles').onclick = () => multiInput?.click();
  $('#btnGalleryPickFolder').onclick = () => folderInput?.click();

  multiInput.onchange = (e) => {
    const files = [...(e.target.files || [])].map((file) => ({ file, relPath: file.name }));
    e.target.value = '';
    enqueueGalleryBatchFiles(files);
  };
  folderInput.onchange = (e) => {
    const files = [...(e.target.files || [])].map((file) => ({
      file,
      relPath: file.webkitRelativePath || file.name,
    }));
    e.target.value = '';
    enqueueGalleryBatchFiles(files);
  };

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', (e) => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const entries = await extractDroppedEntries(e.dataTransfer);
    enqueueGalleryBatchFiles(entries);
  });

  $('#fGalleryBatchDate').addEventListener('change', (e) => {
    batchDate = e.target.value || localToday();
  });
  $('#fGalleryAutoPush').addEventListener('change', (e) => {
    batchAutoPush = Boolean(e.target.checked);
  });

  $('#btnGalleryBatchPause').onclick = () => {
    batchPaused = !batchPaused;
    if (!batchPaused) pumpGalleryBatchQueue();
    else updateGalleryBatchUI();
  };
  $('#btnGalleryBatchRetryFailed').onclick = () => {
    let count = 0;
    for (const t of batchTasks) {
      if ((t.status === 'failed' || t.status === 'cancelled') && t.file) {
        t.status = 'queued';
        t.progress = 0;
        t.error = '';
        count += 1;
      }
    }
    if (count) {
      batchPaused = false;
      if (pushState.status === 'error' || pushState.status === 'done') {
        pushState = { status: 'idle', message: '', detail: '' };
      }
      pumpGalleryBatchQueue();
    }
  };
  $('#btnGalleryBatchPushNow').onclick = () => runGalleryBatchPush();
  $('#btnGalleryBatchClearDone').onclick = () => {
    batchTasks = batchTasks.filter((t) => t.status !== 'ready');
    if (!batchTasks.length && pushState.status === 'done') {
      pushState = { status: 'idle', message: '', detail: '' };
    }
    updateGalleryBatchUI();
  };
  $('#btnGalleryBatchCancelAll').onclick = () => {
    for (const t of batchTasks) {
      if (t.status === 'queued') t.status = 'cancelled';
      if (t.status === 'uploading' && t.xhr) t.xhr.abort();
    }
    updateGalleryBatchUI();
  };

  $('#galleryBatchQueue').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gbtask]');
    if (!btn) return;
    const task = batchTasks.find((t) => t.id === btn.dataset.id);
    if (!task) return;
    if (btn.dataset.gbtask === 'retry' && task.file) {
      task.status = 'queued';
      task.progress = 0;
      task.error = '';
      batchPaused = false;
      if (pushState.status === 'error' || pushState.status === 'done') {
        pushState = { status: 'idle', message: '', detail: '' };
      }
      pumpGalleryBatchQueue();
    } else if (btn.dataset.gbtask === 'remove') {
      batchTasks = batchTasks.filter((t) => t.id !== task.id);
      updateGalleryBatchUI();
    }
  });

  updateGalleryBatchUI();
}

function openGalleryBatchUploader({ skipLeaveGuard = false } = {}) {
  if (!skipLeaveGuard && !canLeaveGalleryItem()) return false;
  currentGalleryId = null;
  clearGalleryDirty();
  $('#editorTitle').textContent = '独立收藏 · 批量上传';
  $('#btnDelete').style.display = 'none';
  $('#btnSave').disabled = true;
  renderGalleryRows();
  renderGalleryBatchUploader();
  return true;
}

async function selectGalleryItem(id, { skipLeaveGuard = false } = {}) {
  if (!skipLeaveGuard && id !== currentGalleryId && !canLeaveGalleryItem()) return;
  currentGalleryId = id;
  batchViewActive = false;
  try {
    const res = await apiFetch(`${GALLERY_API}/${id}`);
    const item = await res.json();
    if (item.error) { toast(item.error); return; }
    renderGalleryEditor(item);
    renderGalleryRows();
  } catch (e) { toast('加载失败'); }
}

function bindSingleDropMultiHandoff() {
  const area = $('#uploadArea');
  if (!area) return;
  area.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    const hasDir = [...(dt?.items || [])].some((it) => typeof it.webkitGetAsEntry === 'function' && it.webkitGetAsEntry()?.isDirectory);
    if ((dt?.files?.length || 0) > 1 || hasDir) {
      e.preventDefault();
      e.stopImmediatePropagation();
      area.classList.remove('dragover');
      const entries = await extractDroppedEntries(dt);
      openGalleryBatchUploader({ skipLeaveGuard: true });
      enqueueGalleryBatchFiles(entries);
    }
  }, true);
}

function renderGalleryEditor(item) {
  batchViewActive = false;
  $('#editorTitle').textContent = item.title ? '编辑：' + item.title : '编辑独立收藏';
  $('#btnDelete').style.display = '';
  $('#btnSave').disabled = false;
  $('#editorContainer').innerHTML = `
    <div class="editor">
      <div class="upload-area" id="uploadArea">📎 拖放或点击上传图片 → 自动填入图像地址（拖入多图或文件夹将自动转为批量上传）</div>
      <div class="url-import-bar">
        <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
        <button class="btn small" id="btnImportUrl">导入</button>
        <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>图像地址 (src) *</label><input id="fSrc" value="${escAttr(item.src || '')}" placeholder="https://cdn.jsdelivr.net/gh/…@main/image/example.webp"/></div>
        <div class="form-group" style="flex:1"><label>日期</label><input id="fGalleryDate" type="date" value="${item.date || ''}"/></div>
        <div class="form-group" style="flex:1"><label>同日序号（可选）</label><input id="fGalleryDayIndex" type="number" min="1" value="${item.dayIndex || ''}" placeholder="自动（前端已无编号）" title="同一天内的排序权重，留空自动推导"/></div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>标题（可选，仅后台检索）</label><input id="fGalleryTitle" value="${escAttr(item.title || '')}" placeholder="留空自动取文件名（03 图像档案不展示标题）"/></div>
        <div class="form-group" style="flex:1"><label>替代文本 (alt)</label><input id="fAlt" value="${escAttr(item.alt || '')}" placeholder="屏幕阅读器描述"/></div>
      </div>
      <div class="form-group"><label>说明文字 (caption)</label><input id="fCaption" value="${escAttr(item.caption || '')}" placeholder="可选备注"/></div>
      <div class="form-group"><label>原图地址 (original)</label><input id="fOriginal" value="${escAttr(item.original || '')}" placeholder="上传自动填入；留空则画廊无「加载原图」按钮"/></div>
      <div class="form-row">
        <div class="form-group"><label>来源链接 (sourceUrl)</label><input id="fSourceUrl" value="${escAttr(item.sourceUrl || '')}" placeholder="https://..."/></div>
        <div class="form-group"><label>来源标题 (sourceTitle)</label><input id="fSourceTitle" value="${escAttr(item.sourceTitle || '')}" placeholder="来源名称"/></div>
      </div>
      <div style="margin-top:8px;padding:8px;background:var(--surface-2);border-radius:2px">
        <img src="${escAttr(item.src || '')}" alt="预览" style="max-width:100%;max-height:200px;display:block;margin:0 auto" onerror="this.style.display='none'" />
      </div>
    </div>`;
  ctx.setupUpload();
  bindSingleDropMultiHandoff();
  ctx.setupGalleryMediaButton();
  bindGalleryDirtyInputs();
  markGalleryBaseline();
}

function newGalleryItem() {
  if (!canLeaveGalleryItem()) return;
  currentGalleryId = null;
  batchViewActive = false;
  $('#editorTitle').textContent = '新建独立收藏';
  $('#btnDelete').style.display = 'none';
  $('#btnSave').disabled = false;
  const today = localToday();
  $('#editorContainer').innerHTML = `
    <div class="editor">
      <div class="upload-area" id="uploadArea">📎 拖放或点击上传图片 → 自动填入图像地址（拖入多图或文件夹将自动转为批量上传）</div>
      <div class="url-import-bar">
        <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
        <button class="btn small" id="btnImportUrl">导入</button>
        <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>图像地址 (src) *</label><input id="fSrc" value="" placeholder="https://cdn.jsdelivr.net/gh/…@main/image/example.webp" autofocus/></div>
        <div class="form-group" style="flex:1"><label>日期</label><input id="fGalleryDate" type="date" value="${today}"/></div>
        <div class="form-group" style="flex:1"><label>同日序号（可选）</label><input id="fGalleryDayIndex" type="number" min="1" value="" placeholder="自动（前端已无编号）" title="同一天内的排序权重，留空自动推导"/></div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>标题（可选，仅后台检索）</label><input id="fGalleryTitle" value="" placeholder="留空自动取文件名（03 图像档案不展示标题）"/></div>
        <div class="form-group" style="flex:1"><label>替代文本 (alt)</label><input id="fAlt" value="" placeholder="屏幕阅读器描述"/></div>
      </div>
      <div class="form-group"><label>说明文字 (caption)</label><input id="fCaption" value="" placeholder="可选备注"/></div>
      <div class="form-group"><label>原图地址 (original)</label><input id="fOriginal" value="" placeholder="上传自动填入；留空则画廊无「加载原图」按钮"/></div>
      <div class="form-row">
        <div class="form-group"><label>来源链接 (sourceUrl)</label><input id="fSourceUrl" value="" placeholder="https://..."/></div>
        <div class="form-group"><label>来源标题 (sourceTitle)</label><input id="fSourceTitle" value="" placeholder="来源名称"/></div>
      </div>
    </div>`;
  ctx.setupUpload();
  bindSingleDropMultiHandoff();
  ctx.setupGalleryMediaButton();
  bindGalleryDirtyInputs();
  markGalleryBaseline();
  renderGalleryRows();
}

async function saveGalleryItem() {
  const src = $('#fSrc')?.value?.trim() || '';
  if (!src) { toast('图像地址不能为空'); return; }
  const title = titleFromSrc(src, $('#fGalleryTitle')?.value);

  const formData = new URLSearchParams();
  formData.set('src', src);
  formData.set('alt', $('#fAlt')?.value || '');
  formData.set('title', title);
  formData.set('caption', $('#fCaption')?.value || '');
  formData.set('original', $('#fOriginal')?.value || '');
  formData.set('date', $('#fGalleryDate')?.value || '');
  formData.set('dayIndex', $('#fGalleryDayIndex')?.value || '');
  formData.set('sourceUrl', $('#fSourceUrl')?.value || '');
  formData.set('sourceTitle', $('#fSourceTitle')?.value || '');
  formData.set('expectedHash', galleryHash);

  try {
    const url = currentGalleryId ? `${GALLERY_API}/${currentGalleryId}` : GALLERY_API;
    const method = currentGalleryId ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, body: formData, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await res.json();
    if (data.error) { toast(data.error); return; }
    if (data.contentHash) galleryHash = data.contentHash;
    clearGalleryDirty();
    toast(currentGalleryId ? '已保存' : '已创建');
    currentGalleryId = data.item?.id || currentGalleryId;
    await loadGallery();
    if (currentGalleryId) await selectGalleryItem(currentGalleryId, { skipLeaveGuard: true });
  } catch (e) { toast('保存失败: ' + e.message); }
}

async function deleteGalleryItem(id) {
  if (!confirm(`确定删除独立收藏「${id}」？此操作不可撤销。`)) return;
  try {
    const res = await apiFetch(`${GALLERY_API}/${id}?expectedHash=${encodeURIComponent(galleryHash)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { toast(data.error); return; }
    if (data.contentHash) galleryHash = data.contentHash;
    toast('已删除');
    if (currentGalleryId === id) {
      openGalleryBatchUploader({ skipLeaveGuard: true });
    }
    await loadGallery();
  } catch (e) { toast('删除失败'); }
}

export {
  loadGallery,
  renderGalleryList,
  newGalleryItem,
  saveGalleryItem,
  deleteGalleryItem,
  syncGalleryDirty,
  openGalleryBatchUploader,
};
