/**
 * 03 日常 · 朋友圈式九宫格多选上传 + 拖动排序共享模块
 * 供 PC 管理后台（admin/src/features/daily.js）与手机 /write/（src/scripts/write/mobile-editor.ts）共用。
 */

export const MAX_MOMENT_IMAGES = 9;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isImageFileLike(file) {
  if (!file || !file.name) return false;
  const lower = file.name.toLowerCase();
  if (lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini') return false;
  if (/\.(psd|raw|cr2|nef|arw|dng)$/i.test(lower)) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|jfif|gif|webp|avif|svg|heic|heif|tiff?)$/i.test(lower);
}

/** ISO 字符串（或当前时刻）→ <input type="datetime-local"> 所需的本地 YYYY-MM-DDTHH:mm（固定东八区视角） */
export function toLocalDateTimeValue(iso) {
  const ms = iso ? Date.parse(iso) : Date.now();
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const sh = new Date(d.getTime() + 8 * 3600_000);
  return `${sh.getUTCFullYear()}-${pad2(sh.getUTCMonth() + 1)}-${pad2(sh.getUTCDate())}T${pad2(sh.getUTCHours())}:${pad2(sh.getUTCMinutes())}`;
}

/** YYYY-MM-DDTHH:mm → YYYY-MM-DDTHH:mm:00+08:00 */
export function toShanghaiIsoOffset(localValue) {
  const clean = String(localValue || '').trim();
  const m = clean.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) {
    return `${m[1]}T${m[2]}:${m[3] || '00'}+08:00`;
  }
  return `${toLocalDateTimeValue('')}:00+08:00`;
}

export function extractHashtagsFromText(text) {
  const tags = new Set();
  const re = /(?:^|[\s(（[【])#([A-Za-z0-9_\-\u4e00-\u9fff\u3040-\u30ff]+)/g;
  const str = String(text || '');
  let m;
  while ((m = re.exec(str))) {
    if (m[1]) tags.add(m[1]);
  }
  return [...tags];
}

export function createMomentId(existingItems = [], createdAt = '') {
  const local = toLocalDateTimeValue(createdAt);
  const datePart = local.slice(0, 10).replace(/-/g, '');
  const used = new Set((existingItems || []).map((i) => i?.id).filter(Boolean));
  let seq = 1;
  while (used.has(`daily-${datePart}-${pad2(seq)}`)) seq += 1;
  return `daily-${datePart}-${pad2(seq)}`;
}

export function sortDailyItems(items = []) {
  return [...items].sort((a, b) => {
    const pa = a?.pinned ? 1 : 0;
    const pb = b?.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = Date.parse(a?.createdAt || '') || 0;
    const tb = Date.parse(b?.createdAt || '') || 0;
    return tb - ta || String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

export function sanitizeDailyEntry(raw, existingItems = []) {
  const text = String(raw?.text || '').replace(/\r\n/g, '\n').trim();
  const createdAt = raw?.createdAt
    ? (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(raw.createdAt))
      ? toShanghaiIsoOffset(raw.createdAt)
      : String(raw.createdAt).trim())
    : `${toLocalDateTimeValue('')}:00+08:00`;

  const images = (Array.isArray(raw?.images) ? raw.images : [])
    .filter((img) => img && typeof img.src === 'string' && img.src.trim())
    .slice(0, MAX_MOMENT_IMAGES)
    .map((img) => {
      const out = { src: img.src.trim() };
      const alt = String(img.alt || '').trim();
      const orig = String(img.original || '').trim();
      if (alt) out.alt = alt;
      if (orig && orig !== out.src) out.original = orig;
      return out;
    });

  const explicitTags = (Array.isArray(raw?.tags) ? raw.tags : String(raw?.tags || '').split(/[,，]/))
    .map((t) => String(t || '').trim().replace(/^#/, ''))
    .filter(Boolean);
  const inlineTags = new Set(extractHashtagsFromText(text));
  const extraTags = [...new Set(explicitTags)].filter((t) => !inlineTags.has(t));

  const out = {
    id: String(raw?.id || '').trim() || createMomentId(existingItems, createdAt),
    createdAt,
    text,
    images,
  };

  if (raw?.pinned) out.pinned = true;
  if (raw?.draft) out.draft = true;
  if (extraTags.length) out.tags = extraTags;
  const location = String(raw?.location || '').trim();
  const device = String(raw?.device || '').trim();
  const mood = String(raw?.mood || '').trim();
  const threadId = String(raw?.threadId || '').trim();
  const threadLabel = String(raw?.threadLabel || '').trim();
  if (location) out.location = location;
  if (device) out.device = device;
  if (mood) out.mood = mood;
  if (threadId) out.threadId = threadId;
  if (threadLabel) out.threadLabel = threadLabel;

  const lc = raw?.linkCard;
  if (lc && typeof lc === 'object' && String(lc.url || '').trim()) {
    const card = {
      title: String(lc.title || lc.url).trim(),
      url: String(lc.url).trim(),
    };
    if (String(lc.label || '').trim()) card.label = String(lc.label).trim();
    if (String(lc.description || '').trim()) card.description = String(lc.description).trim();
    out.linkCard = card;
  }

  return out;
}

/**
 * 微信朋友圈式 3×3 九宫格组件：
 * - 多选上传 + 拖拽文件 + 粘贴图片（最多 9 张）
 * - 上传中即时显示本地预览，支持上传中/上传后直接拖动排序（鼠标 + 手机触屏指针统一）
 */
export function createMomentsPhotoGrid({
  gridEl,
  fileInputEl,
  maxImages = MAX_MOMENT_IMAGES,
  uploadFile,
  resolvePreviewSrc,
  onChange = () => {},
  onToast = () => {},
  onPreview = null,
}) {
  if (!gridEl) throw new Error('gridEl is required');

  let uidSeq = 0;
  const nextUid = () => `mom_${Date.now().toString(36)}_${++uidSeq}`;

  let items = [];
  let activeUploads = 0;
  const UPLOAD_CONCURRENCY = 2;
  let dragState = null;
  let justDragged = false;
  let destroyed = false;

  const addTile = document.createElement('button');
  addTile.type = 'button';
  addTile.className = 'mom-tile mom-tile--add';
  addTile.setAttribute('aria-label', '添加图片（可多选，最多9张）');
  addTile.innerHTML = `<span class="mom-add__plus" aria-hidden="true">＋</span><span class="mom-add__count" data-mom-count>0 / ${maxImages}</span>`;
  addTile.addEventListener('click', () => {
    if (items.length >= maxImages) {
      onToast(`最多支持 ${maxImages} 张图片`);
      return;
    }
    fileInputEl?.click();
  });

  function revokeItemPreview(item) {
    if (item?.previewUrl && item.previewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
    }
  }

  function displayUrlOf(item) {
    if (item.previewUrl) return item.previewUrl;
    if (typeof resolvePreviewSrc === 'function') {
      const resolved = resolvePreviewSrc(item);
      if (resolved) return resolved;
    }
    return item.src || '';
  }

  function syncAddTile() {
    const cnt = addTile.querySelector('[data-mom-count]');
    if (cnt) cnt.textContent = `${items.length} / ${maxImages}`;
    addTile.hidden = items.length >= maxImages;
  }

  function syncTileOrderBadges() {
    const tiles = [...gridEl.querySelectorAll('.mom-tile[data-uid]')];
    tiles.forEach((tile, i) => {
      const badge = tile.querySelector('[data-mom-idx-badge]');
      if (badge) badge.textContent = String(i + 1);
      tile.dataset.idx = String(i);
    });
    syncAddTile();
  }

  function syncSingleTileStatus(item) {
    const tile = gridEl.querySelector(`.mom-tile[data-uid="${item.uid}"]`);
    if (!tile) return;
    tile.classList.toggle('is-uploading', item.status === 'uploading');
    tile.classList.toggle('is-error', item.status === 'error');

    const img = tile.querySelector('img');
    const url = displayUrlOf(item);
    if (img && url && img.getAttribute('src') !== url) {
      img.src = url;
    }

    const bar = tile.querySelector('[data-mom-progress]');
    if (bar) bar.style.width = `${Math.max(4, Math.min(100, item.progress || 0))}%`;

    const stateEl = tile.querySelector('[data-mom-state]');
    if (stateEl) {
      if (item.status === 'uploading') {
        stateEl.hidden = false;
        stateEl.textContent = item.progress > 0 ? `${item.progress}%` : '上传中';
      } else if (item.status === 'error') {
        stateEl.hidden = false;
        stateEl.textContent = '失败·点重试';
      } else {
        stateEl.hidden = true;
        stateEl.textContent = '';
      }
    }

    const altEl = tile.querySelector('[data-mom-alt-badge]');
    if (altEl) altEl.hidden = !item.alt;
  }

  function buildTileEl(item, idx) {
    const tile = document.createElement('div');
    tile.className = 'mom-tile';
    tile.dataset.uid = item.uid;
    tile.dataset.idx = String(idx);
    tile.setAttribute('role', 'listitem');
    tile.setAttribute('title', '拖动可排序 · 点击预览或编辑说明');

    const img = document.createElement('img');
    img.src = displayUrlOf(item);
    img.alt = item.alt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      if (img.dataset.momFbDone) return;
      if (item.src && img.src !== item.src && !img.getAttribute('src')?.startsWith('blob:')) {
        img.dataset.momFbDone = '1';
        img.src = item.src;
        return;
      }
      if (typeof resolvePreviewSrc === 'function') {
        const altSrc = resolvePreviewSrc(item);
        if (altSrc && img.getAttribute('src') !== altSrc) {
          img.dataset.momFbDone = '1';
          img.src = altSrc;
        }
      }
    };

    const idxBadge = document.createElement('span');
    idxBadge.className = 'mom-tile__num';
    idxBadge.setAttribute('data-mom-idx-badge', '');
    idxBadge.textContent = String(idx + 1);

    const altBadge = document.createElement('span');
    altBadge.className = 'mom-tile__alt';
    altBadge.setAttribute('data-mom-alt-badge', '');
    altBadge.textContent = 'ALT';
    altBadge.hidden = !item.alt;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mom-tile__del';
    delBtn.setAttribute('aria-label', '删除图片');
    delBtn.textContent = '×';
    delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeByUid(item.uid);
    });

    const progWrap = document.createElement('div');
    progWrap.className = 'mom-tile__prog';
    progWrap.innerHTML = '<i data-mom-progress style="width:0%"></i>';

    const stateEl = document.createElement('button');
    stateEl.type = 'button';
    stateEl.className = 'mom-tile__state';
    stateEl.setAttribute('data-mom-state', '');
    stateEl.hidden = true;
    stateEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    stateEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.status === 'error' && item.file) {
        item.status = 'queued';
        item.error = '';
        item.progress = 0;
        syncSingleTileStatus(item);
        pumpUploads();
      }
    });

    tile.append(img, idxBadge, altBadge, delBtn, progWrap, stateEl);

    tile.addEventListener('pointerdown', (e) => startDrag(e, item.uid, tile));
    tile.addEventListener('click', (e) => {
      if (justDragged) {
        justDragged = false;
        return;
      }
      if ((e.target instanceof Element) && e.target.closest('button')) return;
      const curIdx = items.findIndex((x) => x.uid === item.uid);
      if (curIdx < 0) return;
      if (typeof onPreview === 'function') {
        onPreview(items[curIdx], curIdx, items, () => {
          syncSingleTileStatus(items[curIdx]);
          onChange();
        });
      } else {
        const nextAlt = window.prompt('输入图片说明文字（ALT，留空不显示）：', items[curIdx].alt || '');
        if (nextAlt !== null) {
          items[curIdx].alt = nextAlt.trim();
          syncSingleTileStatus(items[curIdx]);
          onChange();
        }
      }
    });

    return tile;
  }

  function renderAll() {
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const tile = buildTileEl(item, idx);
      frag.append(tile);
    });
    frag.append(addTile);
    gridEl.replaceChildren(frag);
    items.forEach((item) => syncSingleTileStatus(item));
    syncAddTile();
  }

  function removeByUid(uid) {
    const idx = items.findIndex((x) => x.uid === uid);
    if (idx < 0) return;
    const [removed] = items.splice(idx, 1);
    revokeItemPreview(removed);
    const tile = gridEl.querySelector(`.mom-tile[data-uid="${uid}"]`);
    tile?.remove();
    syncTileOrderBadges();
    onChange();
  }

  function moveItem(fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= items.length || toIdx >= items.length) return;
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);

    const movedEl = gridEl.querySelector(`.mom-tile[data-uid="${moved.uid}"]`);
    const targetItem = items[toIdx + 1];
    const refEl = targetItem
      ? gridEl.querySelector(`.mom-tile[data-uid="${targetItem.uid}"]`)
      : addTile;
    if (movedEl && refEl) {
      gridEl.insertBefore(movedEl, refEl);
    }
    syncTileOrderBadges();
  }

  function startDrag(e, uid, tileEl) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target instanceof Element) && e.target.closest('button')) return;
    if (items.length <= 1) return;

    const rect = tileEl.getBoundingClientRect();
    dragState = {
      uid,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      active: false,
      movedOrder: false,
      tileEl,
      ghostEl: null,
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
  }

  function onPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const dist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
    if (!dragState.active) {
      if (dist < 7) return;
      dragState.active = true;
      dragState.tileEl.classList.add('is-drag-source');
      gridEl.classList.add('is-reordering');

      const ghost = dragState.tileEl.cloneNode(true);
      ghost.classList.remove('is-drag-source');
      ghost.classList.add('mom-tile--ghost');
      ghost.style.width = `${dragState.width}px`;
      ghost.style.height = `${dragState.height}px`;
      ghost.style.left = `${e.clientX - dragState.offsetX}px`;
      ghost.style.top = `${e.clientY - dragState.offsetY}px`;
      document.body.append(ghost);
      dragState.ghostEl = ghost;
    }

    e.preventDefault();
    if (dragState.ghostEl) {
      dragState.ghostEl.style.left = `${e.clientX - dragState.offsetX}px`;
      dragState.ghostEl.style.top = `${e.clientY - dragState.offsetY}px`;
    }

    const tiles = [...gridEl.querySelectorAll('.mom-tile[data-uid]')];
    let hitUid = '';
    for (const t of tiles) {
      const r = t.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        hitUid = t.dataset.uid || '';
        break;
      }
    }
    if (hitUid && hitUid !== dragState.uid) {
      const fromIdx = items.findIndex((x) => x.uid === dragState.uid);
      const toIdx = items.findIndex((x) => x.uid === hitUid);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        moveItem(fromIdx, toIdx);
        dragState.movedOrder = true;
      }
    }
  }

  function onPointerEnd(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerEnd);

    const { active, movedOrder, tileEl, ghostEl } = dragState;
    tileEl.classList.remove('is-drag-source');
    gridEl.classList.remove('is-reordering');
    ghostEl?.remove();
    dragState = null;

    if (active) {
      justDragged = true;
      window.setTimeout(() => { justDragged = false; }, 120);
      if (movedOrder) onChange();
    }
  }

  async function runUploadItem(item) {
    activeUploads += 1;
    item.status = 'uploading';
    item.progress = 4;
    item.error = '';
    syncSingleTileStatus(item);
    try {
      const res = await uploadFile(item.file, (pct) => {
        item.progress = pct;
        syncSingleTileStatus(item);
      });
      if (destroyed) return;
      item.src = res.url;
      item.original = res.originalUrl || '';
      if (!item.previewUrl && res.previewUrl) item.previewUrl = res.previewUrl;
      item.status = 'ready';
      item.progress = 100;
      item.file = null;
      syncSingleTileStatus(item);
      onChange();
    } catch (err) {
      if (destroyed) return;
      item.status = 'error';
      item.error = err?.message || '上传失败';
      syncSingleTileStatus(item);
      onToast(`图片上传失败：${item.error}`);
    } finally {
      activeUploads = Math.max(0, activeUploads - 1);
      pumpUploads();
    }
  }

  function pumpUploads() {
    if (destroyed) return;
    while (activeUploads < UPLOAD_CONCURRENCY) {
      const next = items.find((it) => it.status === 'queued' && it.file);
      if (!next) break;
      runUploadItem(next);
    }
  }

  function addFiles(rawFiles) {
    const list = [...(rawFiles || [])].filter(isImageFileLike);
    if (!list.length) {
      onToast('请选择图片文件');
      return;
    }
    const room = maxImages - items.length;
    if (room <= 0) {
      onToast(`最多只能添加 ${maxImages} 张图片`);
      return;
    }
    const accepted = list.slice(0, room);
    if (list.length > room) {
      onToast(`最多支持 ${maxImages} 张图片，已选取前 ${accepted.length} 张`);
    }

    for (const file of accepted) {
      const item = {
        uid: nextUid(),
        src: '',
        original: '',
        alt: '',
        previewUrl: URL.createObjectURL(file),
        status: 'queued',
        progress: 0,
        error: '',
        file,
      };
      items.push(item);
      const tile = buildTileEl(item, items.length - 1);
      gridEl.insertBefore(tile, addTile);
      syncSingleTileStatus(item);
    }
    syncTileOrderBadges();
    onChange();
    pumpUploads();
  }

  function addExistingUrls(entries = []) {
    const room = maxImages - items.length;
    if (room <= 0) {
      onToast(`最多只能添加 ${maxImages} 张图片`);
      return;
    }
    const slice = entries.slice(0, room);
    if (entries.length > room) {
      onToast(`最多支持 ${maxImages} 张图片，已选取前 ${slice.length} 张`);
    }
    for (const entry of slice) {
      const src = String(entry?.src || entry?.url || '').trim();
      if (!src) continue;
      const item = {
        uid: nextUid(),
        src,
        original: String(entry?.original || entry?.originalUrl || '').trim(),
        alt: String(entry?.alt || '').trim(),
        previewUrl: '',
        status: 'ready',
        progress: 100,
        error: '',
        file: null,
      };
      items.push(item);
      const tile = buildTileEl(item, items.length - 1);
      gridEl.insertBefore(tile, addTile);
      syncSingleTileStatus(item);
    }
    syncTileOrderBadges();
    onChange();
  }

  const onFileInputChange = () => {
    const files = [...(fileInputEl?.files || [])];
    if (fileInputEl) fileInputEl.value = '';
    if (files.length) addFiles(files);
  };
  fileInputEl?.addEventListener('change', onFileInputChange);

  const onDragOver = (e) => {
    if (e.dataTransfer?.types && [...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      gridEl.classList.add('is-file-drop');
    }
  };
  const onDragLeave = (e) => {
    if (!gridEl.contains(e.relatedTarget)) {
      gridEl.classList.remove('is-file-drop');
    }
  };
  const onDrop = (e) => {
    gridEl.classList.remove('is-file-drop');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  gridEl.addEventListener('dragover', onDragOver);
  gridEl.addEventListener('dragleave', onDragLeave);
  gridEl.addEventListener('drop', onDrop);

  return {
    setImages(rawList = []) {
      items.forEach(revokeItemPreview);
      items = (Array.isArray(rawList) ? rawList : [])
        .filter((img) => img && img.src)
        .slice(0, maxImages)
        .map((img) => ({
          uid: nextUid(),
          src: String(img.src || '').trim(),
          original: String(img.original || '').trim(),
          alt: String(img.alt || '').trim(),
          previewUrl: '',
          status: 'ready',
          progress: 100,
          error: '',
          file: null,
        }));
      renderAll();
    },
    addFiles,
    addExistingUrls,
    openPicker() {
      if (items.length >= maxImages) {
        onToast(`最多支持 ${maxImages} 张图片`);
        return;
      }
      fileInputEl?.click();
    },
    getImages() {
      return items
        .filter((it) => it.status === 'ready' && it.src)
        .map((it) => {
          const out = { src: it.src };
          if (it.alt) out.alt = it.alt;
          if (it.original && it.original !== it.src) out.original = it.original;
          return out;
        });
    },
    getCount() {
      return items.length;
    },
    hasPendingUploads() {
      return items.some((it) => it.status === 'queued' || it.status === 'uploading');
    },
    hasErrors() {
      return items.some((it) => it.status === 'error');
    },
    async waitForUploads() {
      while (!destroyed && items.some((it) => it.status === 'queued' || it.status === 'uploading')) {
        await new Promise((r) => setTimeout(r, 150));
      }
      return !items.some((it) => it.status === 'error');
    },
    destroy() {
      destroyed = true;
      items.forEach(revokeItemPreview);
      fileInputEl?.removeEventListener('change', onFileInputChange);
      gridEl.removeEventListener('dragover', onDragOver);
      gridEl.removeEventListener('dragleave', onDragLeave);
      gridEl.removeEventListener('drop', onDrop);
    },
  };
}
