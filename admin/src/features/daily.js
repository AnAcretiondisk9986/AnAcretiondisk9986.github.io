/**
 * 日常时刻编辑器（02 日常 · src/data/daily.json）
 * 参照微信朋友圈界面：正文 + #话题快捷 + 九宫格（多选上传 + 拖拽排序）+ 位置/标签/时间等行项目。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch, getToken } from '../api/app-client.js';
import {
  MAX_MOMENT_IMAGES,
  createMomentsPhotoGrid,
  toLocalDateTimeValue,
  toShanghaiIsoOffset,
  sanitizeDailyEntry,
  sortDailyItems,
  extractHashtagsFromText,
} from '/admin/shared/daily-moments-grid.mjs';

const DAILY_API = '/api/daily';
const DAILY_PUSH_API = '/api/daily/push';
const DEFAULT_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
const IMG_CDN_PREFIX = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/';

let dailyItems = [];
let currentDailyId = null;
let dailyHash = '';
let dailyFilter = { q: '', type: 'all' };
let dailyBaseline = '';
let dailyDirty = false;
let dailyEditorActive = false;
let dailyPublishing = false;
let gridCtrl = null;
let imageModalEl = null;

let ctx = {
  openMediaPicker: null,
  onDirtyChange: () => {},
  refreshSyncStatus: async () => null,
  getUploadMaxBytes: () => DEFAULT_UPLOAD_MAX_BYTES,
  isDailyMode: () => false,
};

export function initDaily(options = {}) {
  ctx = { ...ctx, ...options };
}

export function getCurrentDailyId() {
  return currentDailyId;
}

export function isDailyDirty() {
  return dailyDirty;
}

export function isDailyBusy() {
  return dailyPublishing || Boolean(gridCtrl?.hasPendingUploads());
}

export function clearDailyDirty() {
  dailyDirty = false;
  dailyBaseline = '';
  dailyEditorActive = false;
  ctx.onDirtyChange(false);
}

export function resetDailySelection() {
  currentDailyId = null;
  if (gridCtrl) {
    gridCtrl.destroy();
    gridCtrl = null;
  }
  clearDailyDirty();
}

function resolveLocalDailyPreview(itemOrUrl) {
  const raw = typeof itemOrUrl === 'string'
    ? itemOrUrl
    : (itemOrUrl?.previewUrl || itemOrUrl?.src || '');
  if (!raw) return '';
  if (raw.startsWith('blob:') || raw.startsWith('data:') || raw.startsWith('/admin/')) return raw;
  if (raw.startsWith(IMG_CDN_PREFIX)) {
    return `/admin/img-repo/${raw.slice(IMG_CDN_PREFIX.length)}`;
  }
  return raw;
}

function canLeaveDailyEditor() {
  if (!dailyDirty) return true;
  return confirm('当前日常有未保存的修改或配图顺序调整，确定离开？');
}

function parseTagsField(raw) {
  return [...new Set(
    String(raw || '')
      .split(/[,，、\s]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean),
  )];
}

function collectDailyFormState() {
  const text = ($('#fDailyText')?.value || '').replace(/\r\n?/g, '\n');
  const images = gridCtrl ? gridCtrl.getImages() : [];
  const manualTags = parseTagsField($('#fDailyTags')?.value || '');
  const hashTags = extractHashtagsFromText(text);
  const tags = [...new Set([...manualTags, ...hashTags])];
  const createdAt = toShanghaiIsoOffset($('#fDailyCreatedAt')?.value || '');
  const location = ($('#fDailyLocation')?.value || '').trim();
  const device = ($('#fDailyDevice')?.value || '').trim();
  const mood = ($('#fDailyMood')?.value || '').trim();
  const pinned = Boolean($('#fDailyPinned')?.checked);
  const draft = Boolean($('#fDailyDraft')?.checked);
  const threadId = ($('#fDailyThreadId')?.value || '').trim();
  const threadLabel = ($('#fDailyThreadLabel')?.value || '').trim();
  const linkTitle = ($('#fDailyLinkTitle')?.value || '').trim();
  const linkUrl = ($('#fDailyLinkUrl')?.value || '').trim();
  const linkLabel = ($('#fDailyLinkLabel')?.value || '').trim();
  const linkDescription = ($('#fDailyLinkDesc')?.value || '').trim();

  const payload = {
    createdAt,
    text: text.trimEnd(),
    images,
    tags,
    pinned,
    draft,
    location,
    device,
    mood,
    threadId,
    threadLabel,
  };
  if (linkUrl) {
    payload.linkCard = {
      title: linkTitle || linkUrl,
      url: linkUrl,
      label: linkLabel,
      description: linkDescription,
    };
  }
  return payload;
}

function syncDailyCounter() {
  const charEl = $('#dailyCharCount');
  if (charEl) charEl.textContent = `${($('#fDailyText')?.value || '').trim().length} 字`;
  const photoEl = $('#dailyPhotoCount');
  if (photoEl && gridCtrl) photoEl.textContent = `${gridCtrl.getCount()}/${MAX_MOMENT_IMAGES}`;
}

function syncDailyDirty() {
  syncDailyCounter();
  if (!dailyEditorActive || !$('#fDailyText')) return;
  const next = JSON.stringify(collectDailyFormState()) !== dailyBaseline;
  if (next !== dailyDirty) {
    dailyDirty = next;
    ctx.onDirtyChange(dailyDirty);
  }
}

function markDailyBaseline() {
  dailyEditorActive = true;
  dailyBaseline = JSON.stringify(collectDailyFormState());
  dailyDirty = false;
  ctx.onDirtyChange(false);
  syncDailyCounter();
}

function uploadDailyPhotoFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const maxBytes = ctx.getUploadMaxBytes?.() || DEFAULT_UPLOAD_MAX_BYTES;
    if (file.size > maxBytes) {
      reject(new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`));
      return;
    }
    const fd = new FormData();
    fd.append('file', file, file.name || `moment-${Date.now()}.png`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?deferPush=1');
    xhr.setRequestHeader('x-admin-token', getToken());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data?.url) {
          resolve({
            url: data.url,
            originalUrl: data.originalUrl || '',
            previewUrl: resolveLocalDailyPreview(data.url),
          });
          return;
        }
        reject(new Error(data?.error ? (data.detail ? `${data.error}（${data.detail}）` : data.error) : `HTTP ${xhr.status}`));
      } catch {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误，请检查后台服务'));
    xhr.send(fd);
  });
}

function ensureImagePreviewDialog() {
  if (imageModalEl) return imageModalEl;
  const dlg = document.createElement('dialog');
  dlg.className = 'mom-alt-dialog';
  dlg.innerHTML = `
    <div class="mom-alt-dialog__head">
      <span id="momAltTitle">图片详情</span>
      <button type="button" class="btn small" id="momAltClose">关闭 ✕</button>
    </div>
    <div class="mom-alt-dialog__media">
      <img id="momAltImg" src="" alt="" />
    </div>
    <div class="form-group">
      <label for="momAltInput">图片描述 / 替代文本 (alt)</label>
      <input id="momAltInput" type="text" placeholder="屏幕阅读器描述与悬浮说明（可选）" />
    </div>
    <div class="mom-alt-dialog__foot">
      <button type="button" class="btn small danger" id="momAltDelete">移除此图</button>
      <button type="button" class="btn small primary" id="momAltSave">确定</button>
    </div>
  `;
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.querySelector('#momAltClose')?.addEventListener('click', () => dlg.close());
  document.body.appendChild(dlg);
  imageModalEl = dlg;
  return dlg;
}

function openDailyImageModal(item, idx, items, sync) {
  const dlg = ensureImagePreviewDialog();
  const titleEl = dlg.querySelector('#momAltTitle');
  const imgEl = dlg.querySelector('#momAltImg');
  const inputEl = dlg.querySelector('#momAltInput');
  const saveBtn = dlg.querySelector('#momAltSave');
  const delBtn = dlg.querySelector('#momAltDelete');

  if (titleEl) titleEl.textContent = `第 ${idx + 1} / ${items.length} 张配图`;
  if (imgEl) {
    imgEl.src = resolveLocalDailyPreview(item);
    imgEl.alt = item.alt || '';
  }
  if (inputEl) inputEl.value = item.alt || '';

  if (saveBtn) {
    saveBtn.onclick = () => {
      item.alt = (inputEl?.value || '').trim();
      sync();
      dlg.close();
    };
  }
  if (delBtn) {
    delBtn.onclick = () => {
      const targetTileDel = document.querySelector(`#dailyMomentsGrid .mom-tile[data-uid="${item.uid}"] .mom-tile__del`);
      targetTileDel?.click();
      dlg.close();
    };
  }
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  setTimeout(() => inputEl?.focus(), 20);
}

function collectSuggestedTags() {
  const defaults = ['碎片', '随手拍', '开发', '校园', '夜景', '咖啡', '阅读'];
  const fromItems = [];
  for (const item of dailyItems) {
    for (const tag of item.tags || []) {
      if (tag && !fromItems.includes(tag)) fromItems.push(tag);
      if (fromItems.length >= 10) break;
    }
    if (fromItems.length >= 10) break;
  }
  return [...new Set([...fromItems, ...defaults])].slice(0, 10);
}

function formatSidebarTime(iso) {
  if (!iso) return '无时间';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getFilteredDailyItems() {
  const q = dailyFilter.q.trim().toLowerCase();
  return dailyItems.filter((item) => {
    if (dailyFilter.type === 'media' && !(item.images?.length)) return false;
    if (dailyFilter.type === 'text' && (item.images?.length || 0) > 0) return false;
    if (dailyFilter.type === 'pinned' && !item.pinned) return false;
    if (dailyFilter.type === 'draft' && !item.draft) return false;
    if (!q) return true;
    const hay = [
      item.id,
      item.text,
      item.location,
      item.device,
      item.mood,
      item.threadLabel,
      ...(item.tags || []),
    ].filter(Boolean).join('\n').toLowerCase();
    return hay.includes(q);
  });
}

function renderDailyRows() {
  const body = $('#dailyListBody');
  if (!body) return;
  if (!dailyItems.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px">暂无日常记录，写一条吧</div>';
    return;
  }
  const list = getFilteredDailyItems();
  if (!list.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px">没有匹配的日常</div>';
    return;
  }
  body.innerHTML = list.map((item) => {
    const firstImg = item.images?.[0];
    const cdnUrl = firstImg?.src || '';
    const thumbUrl = firstImg ? resolveLocalDailyPreview(firstImg) : '';
    const snippet = (item.text || '').replace(/\s+/g, ' ').trim()
      || (item.images?.length ? `分享了 ${item.images.length} 张图片` : '(空白日常)');
    return `
      <div class="daily-list-item${item.id === currentDailyId ? ' active' : ''}" data-daily-id="${escAttr(item.id)}">
        <div class="daily-list-item__thumb" data-daily-open="${escAttr(item.id)}">
          ${thumbUrl
            ? `<img src="${escAttr(thumbUrl)}" data-fb="${escAttr(cdnUrl)}" alt="" loading="lazy" onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){var u=this.dataset.fb;this.dataset.fb='';this.src=u;}else{this.style.display='none';}" />`
            : '<span class="daily-list-item__text-icon">文</span>'}
          ${(item.images?.length || 0) > 1 ? `<em>${item.images.length}</em>` : ''}
        </div>
        <div class="daily-list-item__info" data-daily-open="${escAttr(item.id)}">
          <div class="daily-list-item__snippet">${esc(snippet)}</div>
          <div class="daily-list-item__meta">
            <span>${esc(formatSidebarTime(item.createdAt))}</span>
            ${item.pinned ? '<span class="badge">置顶</span>' : ''}
            ${item.draft ? '<span class="badge draft">草稿</span>' : ''}
            ${item.location ? `<span>· ${esc(item.location)}</span>` : ''}
          </div>
        </div>
        <div class="actions">
          <button class="btn small danger" type="button" data-daily-delete="${escAttr(item.id)}" title="删除">×</button>
        </div>
      </div>`;
  }).join('');
}

function renderDailyList() {
  const listEl = $('#postList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div class="gallery-sidebar-tools">
      <div class="gallery-sidebar-tools__row">
        <input id="dailySearch" type="search" placeholder="搜索日常、标签、地点…" value="${escAttr(dailyFilter.q)}" />
        <button class="btn small primary" type="button" id="btnDailyNewSidebar">＋ 新建</button>
      </div>
      <div class="gallery-sidebar-tools__row">
        <select id="dailyFilterType">
          <option value="all"${dailyFilter.type === 'all' ? ' selected' : ''}>全部日常（${dailyItems.length}）</option>
          <option value="media"${dailyFilter.type === 'media' ? ' selected' : ''}>含配图</option>
          <option value="text"${dailyFilter.type === 'text' ? ' selected' : ''}>纯文字</option>
          <option value="pinned"${dailyFilter.type === 'pinned' ? ' selected' : ''}>已置顶</option>
          <option value="draft"${dailyFilter.type === 'draft' ? ' selected' : ''}>仅草稿</option>
        </select>
      </div>
    </div>
    <div id="dailyListBody"></div>`;

  $('#dailySearch')?.addEventListener('input', (e) => {
    dailyFilter.q = e.target.value || '';
    renderDailyRows();
  });
  $('#dailyFilterType')?.addEventListener('change', (e) => {
    dailyFilter.type = e.target.value || 'all';
    renderDailyRows();
  });
  $('#btnDailyNewSidebar')?.addEventListener('click', () => newDailyItem());

  const body = $('#dailyListBody');
  body?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-daily-delete]');
    if (delBtn) {
      e.stopPropagation();
      deleteDailyItem(delBtn.dataset.dailyDelete);
      return;
    }
    const row = e.target.closest('[data-daily-open],[data-daily-id]');
    if (row) {
      const id = row.dataset.dailyOpen || row.dataset.dailyId;
      if (id) selectDailyItem(id);
    }
  });

  renderDailyRows();
}

function renderDailyComposer(item = null) {
  const container = $('#editorContainer');
  if (!container) return;
  if (gridCtrl) {
    gridCtrl.destroy();
    gridCtrl = null;
  }

  const isEdit = Boolean(item?.id);
  currentDailyId = isEdit ? item.id : null;
  const createdVal = toLocalDateTimeValue(item?.createdAt || new Date().toISOString());
  const tagsText = Array.isArray(item?.tags) ? item.tags.join(', ') : '';
  const hasExtra = Boolean(item?.threadId || item?.threadLabel || item?.linkCard?.url);
  const suggestedTags = collectSuggestedTags();

  $('#editorTitle').textContent = isEdit ? `编辑日常 · ${item.id}` : '发表日常 · 微信朋友圈模式';
  $('#btnDelete').style.display = isEdit ? '' : 'none';
  $('#btnSave').style.display = '';
  $('#btnSave').disabled = false;

  container.innerHTML = `
    <div class="editor mom-editor-wrap">
      <div class="mom-composer" id="dailyMomentsComposer">
        <div class="mom-composer__head">
          <div class="mom-composer__title">
            <span class="mom-composer__badge">${isEdit ? '编辑日常' : '新时刻'}</span>
            <span class="mom-composer__id">${isEdit ? esc(item.id) : '03 日常时间线'}</span>
          </div>
          <div class="mom-composer__actions">
            <span class="mom-composer__stat" id="dailyCharCount">0 字</span>
            <span class="mom-composer__stat" id="dailyPhotoCount">0/${MAX_MOMENT_IMAGES}</span>
            <button type="button" class="btn small" id="btnDailyPickMulti">＋ 多选图片</button>
            <button type="button" class="btn small" id="btnDailyPickMedia">媒体库多选</button>
            <button type="button" class="btn small primary" id="btnDailyPublish">${isEdit ? '保存并推送 ↑' : '发表并推送 ↑'}</button>
          </div>
        </div>

        <div class="mom-compose-body">
          <textarea id="fDailyText" class="mom-textarea" rows="5" placeholder="这一刻的想法… 支持输入 #话题标签，拖入或 Ctrl+V 粘贴图片可多选上传">${esc(item?.text || '')}</textarea>
          <div class="mom-tag-chips" aria-label="快捷话题标签">
            ${suggestedTags.map((t) => `<button type="button" class="mom-chip" data-mom-tag="${escAttr(t)}">#${esc(t)}</button>`).join('')}
          </div>

          <div class="mom-grid-section">
            <div class="mom-grid" id="dailyMomentsGrid"></div>
            <input type="file" id="fDailyMultiPhotos" multiple accept="image/*,.heic,.heif,.avif,.webp" hidden />
            <p class="mom-grid-hint">支持一次多选至多 9 张图片 · 按住照片拖动可直接在九宫格内排序（上传后、发布前均可随时调序）</p>
          </div>
        </div>

        <div class="mom-rows">
          <label class="mom-row">
            <span class="mom-row__icon">📍</span>
            <span class="mom-row__label">所在位置</span>
            <input id="fDailyLocation" type="text" value="${escAttr(item?.location || '')}" placeholder="如：温州 · 校园 / 雨夜书桌（可选）" />
          </label>
          <label class="mom-row">
            <span class="mom-row__icon">#</span>
            <span class="mom-row__label">话题标签</span>
            <input id="fDailyTags" type="text" value="${escAttr(tagsText)}" placeholder="逗号分隔，也会自动识别正文里的 #标签" />
          </label>
          <div class="mom-row mom-row--split">
            <label class="mom-row__cell">
              <span class="mom-row__icon">📷</span>
              <span class="mom-row__label">设备</span>
              <input id="fDailyDevice" type="text" value="${escAttr(item?.device || '')}" placeholder="iPhone / 相机 / Web" />
            </label>
            <label class="mom-row__cell">
              <span class="mom-row__icon">💭</span>
              <span class="mom-row__label">状态</span>
              <input id="fDailyMood" type="text" value="${escAttr(item?.mood || '')}" placeholder="清醒 / 深夜 / 闲逛" />
            </label>
          </div>
          <div class="mom-row mom-row--split">
            <label class="mom-row__cell">
              <span class="mom-row__icon">🕒</span>
              <span class="mom-row__label">发布时间</span>
              <input id="fDailyCreatedAt" type="datetime-local" value="${escAttr(createdVal)}" />
            </label>
            <div class="mom-row__checks">
              <label class="mom-check"><input id="fDailyPinned" type="checkbox"${item?.pinned ? ' checked' : ''} /><span>置顶</span></label>
              <label class="mom-check"><input id="fDailyDraft" type="checkbox"${item?.draft ? ' checked' : ''} /><span>草稿</span></label>
            </div>
          </div>
          <details class="mom-extra-details"${hasExtra ? ' open' : ''}>
            <summary>🔗 串连线程 / 引用链接卡片（可选）</summary>
            <div class="mom-extra-grid">
              <div class="form-row">
                <div class="form-group">
                  <label>串连 ID (threadId)</label>
                  <input id="fDailyThreadId" value="${escAttr(item?.threadId || '')}" placeholder="同一话题连续条共用 ID" />
                </div>
                <div class="form-group">
                  <label>串连标题 (threadLabel)</label>
                  <input id="fDailyThreadLabel" value="${escAttr(item?.threadLabel || '')}" placeholder="例如：黑洞渲染折腾日记" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group" style="flex:1">
                  <label>卡片角标</label>
                  <input id="fDailyLinkLabel" value="${escAttr(item?.linkCard?.label || '')}" placeholder="文章 / 外链" />
                </div>
                <div class="form-group" style="flex:2">
                  <label>链接标题</label>
                  <input id="fDailyLinkTitle" value="${escAttr(item?.linkCard?.title || '')}" placeholder="链接卡片标题" />
                </div>
              </div>
              <div class="form-group">
                <label>链接地址 (URL)</label>
                <input id="fDailyLinkUrl" value="${escAttr(item?.linkCard?.url || '')}" placeholder="/posts/xxx 或 https://..." />
              </div>
              <div class="form-group">
                <label>链接简介</label>
                <input id="fDailyLinkDesc" value="${escAttr(item?.linkCard?.description || '')}" placeholder="一句话说明（可选）" />
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>`;

  const gridEl = $('#dailyMomentsGrid');
  const fileInputEl = $('#fDailyMultiPhotos');
  gridCtrl = createMomentsPhotoGrid({
    gridEl,
    fileInputEl,
    maxImages: MAX_MOMENT_IMAGES,
    uploadFile: uploadDailyPhotoFile,
    resolvePreviewSrc: resolveLocalDailyPreview,
    onChange: () => syncDailyDirty(),
    onToast: (msg) => toast(msg),
    onPreview: openDailyImageModal,
  });
  gridCtrl.setImages(item?.images || []);

  $('#btnDailyPickMulti')?.addEventListener('click', () => gridCtrl?.openPicker());
  $('#btnDailyPickMedia')?.addEventListener('click', () => {
    if (!ctx.openMediaPicker) {
      toast('媒体选择器未初始化');
      return;
    }
    const left = MAX_MOMENT_IMAGES - (gridCtrl?.getCount() || 0);
    if (left <= 0) {
      toast(`最多只能选择 ${MAX_MOMENT_IMAGES} 张图片`);
      return;
    }
    ctx.openMediaPicker({
      type: 'image',
      title: `从媒体库多选配图（还可加 ${left} 张）`,
      multiple: true,
      onPickBatch: (selected) => {
        if (!Array.isArray(selected) || !selected.length) return;
        const mapped = selected.map((m) => ({
          src: m.url,
          original: m.originalUrl || '',
          alt: '',
          previewUrl: resolveLocalDailyPreview(m.url),
        }));
        gridCtrl?.addExistingUrls(mapped);
      },
    });
  });
  $('#btnDailyPublish')?.addEventListener('click', () => saveDailyItem({ pushAfter: true }));

  const composer = $('#dailyMomentsComposer');
  composer?.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => String(f.type || '').startsWith('image/'));
    if (!files.length || !gridCtrl) return;
    e.preventDefault();
    gridCtrl.addFiles(files);
  });

  composer?.querySelectorAll('[data-mom-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.momTag;
      const tagsInput = $('#fDailyTags');
      if (!tag || !tagsInput) return;
      const existing = parseTagsField(tagsInput.value);
      const next = existing.includes(tag)
        ? existing.filter((t) => t !== tag)
        : [...existing, tag];
      tagsInput.value = next.join(', ');
      syncDailyDirty();
    });
  });

  composer?.querySelectorAll('input, textarea').forEach((el) => {
    el.addEventListener('input', syncDailyDirty);
    el.addEventListener('change', syncDailyDirty);
  });

  markDailyBaseline();
  renderDailyRows();
}

export async function loadDaily() {
  try {
    const res = await apiFetch(DAILY_API);
    dailyHash = res.headers.get('x-content-hash') || '';
    const data = await res.json();
    if (!Array.isArray(data)) {
      toast(data?.error || '加载日常失败');
      return;
    }
    dailyItems = sortDailyItems(data);
    renderDailyList();
  } catch (e) {
    toast(`加载日常失败: ${e.message}`);
  }
}

export function newDailyItem({ skipLeaveGuard = false } = {}) {
  if (!skipLeaveGuard && !canLeaveDailyEditor()) return false;
  renderDailyComposer(null);
  return true;
}

function selectDailyItem(id) {
  if (id !== currentDailyId && !canLeaveDailyEditor()) return;
  const target = dailyItems.find((it) => it.id === id);
  if (!target) {
    toast('未找到该日常条目');
    return;
  }
  renderDailyComposer(target);
}

export async function saveDailyItem({ pushAfter = false } = {}) {
  if (dailyPublishing) return;
  const pubBtn = $('#btnDailyPublish');
  const saveBtn = $('#btnSave');

  try {
    if (gridCtrl?.hasPendingUploads()) {
      toast('正在等待图片上传完成…');
      if (pubBtn) { pubBtn.disabled = true; pubBtn.textContent = '上传配图中…'; }
      const ok = await gridCtrl.waitForUploads();
      if (!ok) {
        toast('部分图片仍在上传失败状态，请重试或移除');
        return;
      }
    }
    if (gridCtrl?.hasErrors()) {
      toast('存在上传失败的图片，请点击缩略图右上角重传或移除');
      return;
    }

    const payload = collectDailyFormState();
    if (!payload.text.trim() && payload.images.length === 0) {
      toast('正文和图片不能同时为空');
      $('#fDailyText')?.focus();
      return;
    }

    dailyPublishing = true;
    if (pubBtn) { pubBtn.disabled = true; pubBtn.textContent = pushAfter ? '保存并推送中…' : '保存中…'; }
    if (saveBtn) saveBtn.disabled = true;

    const cleanEntry = sanitizeDailyEntry({
      ...(currentDailyId ? { id: currentDailyId } : {}),
      ...payload,
    }, dailyItems);

    const url = currentDailyId ? `${DAILY_API}/${encodeURIComponent(currentDailyId)}` : DAILY_API;
    const method = currentDailyId ? 'PUT' : 'POST';
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cleanEntry, expectedHash: dailyHash }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast(data.error || `保存失败（HTTP ${res.status}）`);
      return;
    }
    if (data.contentHash) dailyHash = data.contentHash;
    const saved = data.item || cleanEntry;
    currentDailyId = saved.id;
    clearDailyDirty();
    await loadDaily();
    const fresh = dailyItems.find((x) => x.id === saved.id) || saved;
    renderDailyComposer(fresh);

    if (!pushAfter) {
      dailyPublishing = false;
      toast(method === 'POST' ? '已保存新日常（尚未推送）' : '已保存到本地日常');
      ctx.refreshSyncStatus?.().catch?.(() => {});
      return;
    }

    const urls = (saved.images || [])
      .flatMap((img) => [img?.src, img?.original])
      .filter(Boolean);
    const pushRes = await apiFetch(DAILY_PUSH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const pushData = await pushRes.json();
    if (!pushRes.ok || pushData.error) {
      toast(`已保存本地，但推送失败：${pushData.error || `HTTP ${pushRes.status}`}`);
      return;
    }
    dailyPublishing = false;
    toast(pushData.pushed ? '已发表并推送上线（03 日常）' : `已保存（${pushData.message || '无需推送'}）`);
    ctx.refreshSyncStatus?.().catch?.(() => {});
  } catch (e) {
    toast(`操作失败: ${e.message}`);
  } finally {
    dailyPublishing = false;
    if (pubBtn) {
      pubBtn.disabled = false;
      pubBtn.textContent = currentDailyId ? '保存并推送 ↑' : '发表并推送 ↑';
    }
    if (saveBtn) saveBtn.disabled = false;
  }
}

export async function deleteDailyItem(id = currentDailyId) {
  if (!id) return;
  if (!confirm(`确定删除日常「${id}」？此操作不可撤销。`)) return;
  try {
    const res = await apiFetch(`${DAILY_API}/${encodeURIComponent(id)}?expectedHash=${encodeURIComponent(dailyHash)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast(data.error || `删除失败（HTTP ${res.status}）`);
      return;
    }
    if (data.contentHash) dailyHash = data.contentHash;
    toast('已删除日常');
    if (currentDailyId === id) {
      renderDailyComposer(null);
    }
    await loadDaily();
    await ctx.refreshSyncStatus?.();
  } catch (e) {
    toast(`删除失败: ${e.message}`);
  }
}
