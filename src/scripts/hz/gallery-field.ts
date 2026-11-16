/**
 * HORIZON · gallery-field.ts
 * /gallery/ 交互核心：
 *   - 两个数据源：独立收藏（plates） / 随文影像（journal） / 全部（all）
 *   - 两种视图：引力透镜场（FIELD：拖拽平移 + 近中心鱼眼放大 + 准星锁定）与 编目索引（INDEX：分页网格 + 排序 + 筛选）
 *   - 高清灯箱查看器：缩放 100%~400%、拖拽平移、加载无损原图、上一张/下一张快捷键
 */

interface GalleryItem {
  id: string;
  src: string;
  thumb?: string;
  original?: string;
  alt?: string;
  title?: string;
  caption?: string;
  date?: string;
  dayIndex?: number;
  sourceUrl?: string;
  sourceTitle?: string;
}

const FIELD_PAGE_SIZE = 32;
const INDEX_PAGE_SIZE = 24;

function readPool(id: string): GalleryItem[] {
  const el = document.getElementById(id);
  if (!el?.textContent) return [];
  try {
    return JSON.parse(el.textContent) as GalleryItem[];
  } catch {
    return [];
  }
}

export function initGallery() {
  const root = document.querySelector<HTMLElement>('[data-gal-root]');
  if (!root) return;

  const platesPool = readPool('hz-plates-pool');
  const journalPool = readPool('hz-journal-pool');

  const tabBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-gal-tab]')];
  const modeBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-gal-mode]')];
  const sortBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-gal-sort]')];
  const filterInput = root.querySelector<HTMLInputElement>('[data-gal-filter]');
  const countEl = root.querySelector<HTMLElement>('[data-gal-count]');

  const fieldWrap = root.querySelector<HTMLElement>('[data-gal-field-wrap]');
  const stage = root.querySelector<HTMLElement>('[data-field-stage]');
  const canvasEl = root.querySelector<HTMLElement>('[data-field-canvas]');
  const lockTitle = root.querySelector<HTMLElement>('[data-lock-title]');
  const lockMeta = root.querySelector<HTMLElement>('[data-lock-meta]');
  const coordEl = root.querySelector<HTMLElement>('[data-field-coord]');
  const sectorLabel = root.querySelector<HTMLElement>('[data-field-sector]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-field-reset]');
  const orbitBtn = root.querySelector<HTMLButtonElement>('[data-field-orbit]');
  const secPrev = root.querySelector<HTMLButtonElement>('[data-sector-prev]');
  const secNext = root.querySelector<HTMLButtonElement>('[data-sector-next]');

  const indexWrap = root.querySelector<HTMLElement>('[data-gal-index-wrap]');
  const gridEl = root.querySelector<HTMLElement>('[data-index-grid]');
  const pagerPrev = root.querySelector<HTMLButtonElement>('[data-page-prev]');
  const pagerNext = root.querySelector<HTMLButtonElement>('[data-page-next]');
  const pageStatus = root.querySelector<HTMLElement>('[data-page-status]');

  // 灯箱
  const viewer = document.getElementById('hz-viewer') as HTMLDialogElement | null;
  const vMedia = viewer?.querySelector<HTMLElement>('[data-viewer-media]');
  const vImg = viewer?.querySelector<HTMLImageElement>('[data-viewer-img]');
  const vTitle = viewer?.querySelector<HTMLElement>('[data-viewer-title]');
  const vCap = viewer?.querySelector<HTMLElement>('[data-viewer-cap]');
  const vSource = viewer?.querySelector<HTMLAnchorElement>('[data-viewer-source]');
  const vOrigBtn = viewer?.querySelector<HTMLButtonElement>('[data-viewer-original]');
  const vZoom = viewer?.querySelector<HTMLInputElement>('[data-viewer-zoom]');
  const vZoomVal = viewer?.querySelector<HTMLElement>('[data-viewer-zoom-val]');
  const vReset = viewer?.querySelector<HTMLButtonElement>('[data-viewer-reset]');
  const vClose = viewer?.querySelector<HTMLButtonElement>('[data-viewer-close]');
  const vPrev = viewer?.querySelector<HTMLButtonElement>('[data-viewer-prev]');
  const vNext = viewer?.querySelector<HTMLButtonElement>('[data-viewer-next]');

  const urlParams = new URLSearchParams(location.search);
  const initTab = urlParams.get('tab');
  let activeTab: 'plates' | 'journal' | 'all' =
    initTab === 'journal' ? 'journal' : initTab === 'all' ? 'all' : platesPool.length > 0 ? 'plates' : 'journal';
  const preferIndex =
    window.innerWidth < 768 || matchMedia('(prefers-reduced-motion: reduce)').matches || urlParams.get('mode') === 'index';
  let activeMode: 'field' | 'index' = preferIndex ? 'index' : 'field';
  let sortOrder: 'newest' | 'oldest' = 'newest';
  let filterText = '';
  let indexPage = 1;
  let fieldSector = 1;
  let orbitSeed = 0;

  let currentList: GalleryItem[] = [];
  let viewerIndex = -1;

  // 透镜场平移状态
  let camX = 0;
  let camY = 0;
  let targetX = 0;
  let targetY = 0;
  let vx = 0;
  let vy = 0;
  let dragging = false;
  let movedPx = 0;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let fieldRaf = 0;

  interface NodePos {
    el: HTMLElement;
    bx: number;
    by: number;
    item: GalleryItem;
  }
  let fieldNodes: NodePos[] = [];

  const getRawPool = (): GalleryItem[] => {
    if (activeTab === 'plates') return platesPool;
    if (activeTab === 'journal') return journalPool;
    return [...platesPool, ...journalPool];
  };

  const computeList = () => {
    const raw = [...getRawPool()];
    raw.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) || 0 : 0;
      const tb = b.date ? Date.parse(b.date) || 0 : 0;
      const da = a.dayIndex ?? 0;
      const db = b.dayIndex ?? 0;
      return sortOrder === 'newest' ? tb - ta || db - da : ta - tb || da - db;
    });
    if (!filterText) return raw;
    return raw.filter((item) => {
      const hay = `${item.title || ''} ${item.caption || ''} ${item.alt || ''} ${item.sourceTitle || ''} ${item.date || ''}`.toLowerCase();
      return hay.includes(filterText);
    });
  };

  const renderField = () => {
    if (!canvasEl || !stage) return;
    const totalSectors = Math.max(1, Math.ceil(currentList.length / FIELD_PAGE_SIZE));
    fieldSector = Math.min(Math.max(1, fieldSector), totalSectors);
    const slice = currentList.slice((fieldSector - 1) * FIELD_PAGE_SIZE, fieldSector * FIELD_PAGE_SIZE);

    if (sectorLabel) {
      sectorLabel.textContent = `SECTOR ${String(fieldSector).padStart(2, '0')} / ${String(totalSectors).padStart(2, '0')}`;
    }
    if (secPrev) secPrev.disabled = fieldSector <= 1;
    if (secNext) secNext.disabled = fieldSector >= totalSectors;

    canvasEl.innerHTML = '';
    fieldNodes = [];

    if (slice.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hz-gal-empty hz-mono';
      empty.textContent = 'NO OPTICAL SIGNATURES MATCH CURRENT FILTER';
      canvasEl.append(empty);
      return;
    }

    const golden = 2.399963229728653;
    const frag = document.createDocumentFragment();
    slice.forEach((item, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hz-fplate';
      card.dataset.id = item.id;
      card.setAttribute('aria-label', `打开图像：${item.title || item.caption || item.id}`);

      const angle = i * golden + orbitSeed * 1.1;
      const radius = i === 0 ? 0 : 195 + Math.sqrt(i) * 142;
      const bx = Math.cos(angle) * radius * 1.18;
      const by = Math.sin(angle) * radius * 0.88;

      const frame = document.createElement('span');
      frame.className = 'hz-fplate__frame';
      const img = document.createElement('img');
      img.src = item.thumb || item.src;
      img.alt = item.alt || item.title || '';
      img.loading = i < 12 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      if (item.thumb && item.src && item.thumb !== item.src) {
        img.dataset.galleryFallback = item.src;
      }
      img.addEventListener('load', () => card.classList.add('is-ready'), { once: true });
      img.addEventListener('error', () => card.classList.add('is-error'), { once: true });
      frame.append(img);

      const cap = document.createElement('span');
      cap.className = 'hz-fplate__cap hz-mono';
      const no = String((fieldSector - 1) * FIELD_PAGE_SIZE + i + 1).padStart(2, '0');
      cap.innerHTML = `<span>PL.${no}</span><span>${escapeHtml(item.title || item.date || 'PLATE')}</span>`;

      card.append(frame, cap);
      card.addEventListener('click', () => {
        if (movedPx > 7) return;
        const globalIdx = currentList.indexOf(item);
        if (globalIdx >= 0) openViewer(globalIdx);
      });

      frag.append(card);
      fieldNodes.push({ el: card, bx, by, item });
    });

    canvasEl.append(frag);
    layoutField();
  };

  const layoutField = () => {
    if (!stage) return;
    const sw = stage.clientWidth || 1200;
    const sh = stage.clientHeight || 640;
    const cx = sw * 0.5;
    const cy = sh * 0.5;
    const lensRadius = Math.min(sw, sh) * 0.55;

    let nearest: NodePos | null = null;
    let nearestDist = Infinity;

    for (const node of fieldNodes) {
      const sx = node.bx - camX;
      const sy = node.by - camY;
      const d = Math.hypot(sx, sy);
      const prox = Math.max(0, 1 - d / Math.max(240, lensRadius));
      const scale = 0.78 + 0.44 * prox * prox;
      const op = 0.36 + 0.64 * prox;

      node.el.style.transform = `translate3d(${(cx + sx).toFixed(1)}px, ${(cy + sy).toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      node.el.style.opacity = op.toFixed(3);
      node.el.style.zIndex = String(Math.round(prox * 100) + 1);

      if (d < nearestDist) {
        nearestDist = d;
        nearest = node;
      }
    }

    fieldNodes.forEach((n) => n.el.classList.toggle('is-locked', n === nearest && nearestDist < 220));
    if (lockTitle && lockMeta) {
      if (nearest && nearestDist < 260) {
        lockTitle.textContent = nearest.item.title || 'UNTITLED PLATE';
        lockMeta.textContent = `${nearest.item.date || 'NO DATE'}${nearest.item.sourceTitle ? ` · ${nearest.item.sourceTitle}` : ''}`;
      } else {
        lockTitle.textContent = 'DRAG TO SURVEY FIELD';
        lockMeta.textContent = 'SELECT ANY PLATE TO INSPECT';
      }
    }
    if (coordEl) {
      coordEl.textContent = `OFFSET [${Math.round(camX)}, ${Math.round(camY)}]`;
    }
  };

  const stepField = () => {
    fieldRaf = 0;
    if (activeMode !== 'field') return;

    if (!dragging) {
      targetX += vx;
      targetY += vy;
      vx *= 0.9;
      vy *= 0.9;
      if (Math.abs(vx) < 0.15) vx = 0;
      if (Math.abs(vy) < 0.15) vy = 0;
    }

    camX += (targetX - camX) * 0.22;
    camY += (targetY - camY) * 0.22;
    layoutField();

    if (dragging || Math.abs(targetX - camX) > 0.4 || Math.abs(targetY - camY) > 0.4 || Math.abs(vx) > 0.15 || Math.abs(vy) > 0.15) {
      fieldRaf = requestAnimationFrame(stepField);
    }
  };

  const kickField = () => {
    if (!fieldRaf && activeMode === 'field') {
      fieldRaf = requestAnimationFrame(stepField);
    }
  };

  const renderIndex = () => {
    if (!gridEl) return;
    const totalPages = Math.max(1, Math.ceil(currentList.length / INDEX_PAGE_SIZE));
    indexPage = Math.min(Math.max(1, indexPage), totalPages);
    const slice = currentList.slice((indexPage - 1) * INDEX_PAGE_SIZE, indexPage * INDEX_PAGE_SIZE);

    if (pageStatus) {
      pageStatus.textContent = `${String(indexPage).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`;
    }
    if (pagerPrev) pagerPrev.disabled = indexPage <= 1;
    if (pagerNext) pagerNext.disabled = indexPage >= totalPages;

    gridEl.innerHTML = '';
    if (slice.length === 0) {
      const p = document.createElement('p');
      p.className = 'hz-gal-empty hz-mono';
      p.textContent = 'NO PLATES MATCH CURRENT FILTER';
      gridEl.append(p);
      return;
    }

    const frag = document.createDocumentFragment();
    slice.forEach((item, idx) => {
      const globalIdx = (indexPage - 1) * INDEX_PAGE_SIZE + idx;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hz-iplate';
      card.setAttribute('aria-label', `预览：${item.title || item.caption || item.id}`);

      const frame = document.createElement('span');
      frame.className = 'hz-iplate__frame';
      const img = document.createElement('img');
      img.src = item.thumb || item.src;
      img.alt = item.alt || item.title || '';
      img.loading = idx < 8 ? 'eager' : 'lazy';
      img.decoding = 'async';
      if (item.thumb && item.src && item.thumb !== item.src) {
        img.dataset.galleryFallback = item.src;
      }
      img.addEventListener('load', () => card.classList.add('is-ready'), { once: true });
      img.addEventListener('error', () => card.classList.add('is-error'), { once: true });
      frame.append(img);

      const meta = document.createElement('span');
      meta.className = 'hz-iplate__meta';
      const serial = String(globalIdx + 1).padStart(3, '0');
      meta.innerHTML =
        `<span class="hz-mono hz-iplate__no">PL.${serial}${item.date ? ` · ${escapeHtml(item.date)}` : ''}</span>` +
        `<strong class="hz-iplate__title">${escapeHtml(item.title || '未命名')}</strong>` +
        (item.caption && item.caption !== item.title ? `<span class="hz-iplate__cap">${escapeHtml(item.caption)}</span>` : '');

      card.append(frame, meta);
      card.addEventListener('click', () => openViewer(globalIdx));
      frag.append(card);
    });
    gridEl.append(frag);
  };

  const syncAll = () => {
    currentList = computeList();
    if (countEl) {
      countEl.textContent = `${currentList.length} PLATES`;
    }
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.galTab === activeTab)));
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.galMode === activeMode)));
    sortBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.galSort === sortOrder)));

    if (fieldWrap) fieldWrap.hidden = activeMode !== 'field';
    if (indexWrap) indexWrap.hidden = activeMode !== 'index';

    if (activeMode === 'field') {
      renderField();
      kickField();
    } else {
      renderIndex();
    }
  };

  // 灯箱控制
  let zoomPct = 100;
  let panX = 0;
  let panY = 0;
  let imgDragging = false;
  let imgDownX = 0;
  let imgDownY = 0;

  const applyTransform = () => {
    if (!vImg) return;
    const scale = zoomPct / 100;
    vImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
    if (vZoom) vZoom.value = String(zoomPct);
    if (vZoomVal) vZoomVal.textContent = `${zoomPct}%`;
  };

  const resetZoom = () => {
    zoomPct = 100;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  const showViewerItem = (idx: number) => {
    if (!viewer || !vImg || currentList.length === 0) return;
    viewerIndex = ((idx % currentList.length) + currentList.length) % currentList.length;
    const item = currentList[viewerIndex];
    resetZoom();

    vImg.src = item.src;
    vImg.alt = item.alt || item.title || '';
    if (vTitle) vTitle.textContent = item.title || '未命名图版';
    if (vCap) {
      const parts = [item.date, item.caption && item.caption !== item.title ? item.caption : ''].filter(Boolean);
      vCap.textContent = parts.join(' · ') || 'ARCHIVE PLATE';
    }
    if (vSource) {
      if (item.sourceUrl) {
        vSource.href = item.sourceUrl;
        vSource.hidden = false;
      } else {
        vSource.hidden = true;
      }
    }
    if (vOrigBtn) {
      if (item.original && item.original !== item.src) {
        vOrigBtn.hidden = false;
        vOrigBtn.disabled = false;
        vOrigBtn.textContent = '加载无损原图';
        vOrigBtn.dataset.origSrc = item.original;
      } else {
        vOrigBtn.hidden = true;
      }
    }
  };

  const openViewer = (idx: number) => {
    if (!viewer) return;
    showViewerItem(idx);
    if (!viewer.open) viewer.showModal();
  };

  vClose?.addEventListener('click', () => viewer?.close());
  vPrev?.addEventListener('click', () => showViewerItem(viewerIndex - 1));
  vNext?.addEventListener('click', () => showViewerItem(viewerIndex + 1));
  vReset?.addEventListener('click', resetZoom);
  vZoom?.addEventListener('input', () => {
    zoomPct = Number(vZoom.value) || 100;
    if (zoomPct <= 100) {
      panX = 0;
      panY = 0;
    }
    applyTransform();
  });
  vOrigBtn?.addEventListener('click', () => {
    const orig = vOrigBtn.dataset.origSrc;
    if (!orig || !vImg) return;
    vOrigBtn.disabled = true;
    vOrigBtn.textContent = '原图加载中…';
    const loader = new Image();
    loader.onload = () => {
      vImg.src = orig;
      vOrigBtn.textContent = '已加载原图 ✓';
    };
    loader.onerror = () => {
      vOrigBtn.disabled = false;
      vOrigBtn.textContent = '原图加载失败，点击重试';
    };
    loader.src = orig;
  });

  vMedia?.addEventListener('pointerdown', (e) => {
    if (zoomPct <= 100) return;
    imgDragging = true;
    imgDownX = e.clientX - panX;
    imgDownY = e.clientY - panY;
    vMedia.setPointerCapture(e.pointerId);
  });
  vMedia?.addEventListener('pointermove', (e) => {
    if (!imgDragging) return;
    panX = e.clientX - imgDownX;
    panY = e.clientY - imgDownY;
    applyTransform();
  });
  vMedia?.addEventListener('pointerup', () => {
    imgDragging = false;
  });
  viewer?.addEventListener('click', (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showViewerItem(viewerIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showViewerItem(viewerIndex + 1);
    }
  });

  // 透镜场拖拽 & 键盘导航
  stage?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    movedPx = 0;
    downX = e.clientX;
    downY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    vx = 0;
    vy = 0;
    stage.classList.add('is-dragging');
    stage.setPointerCapture(e.pointerId);
    kickField();
  });

  stage?.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    movedPx = Math.max(movedPx, Math.hypot(e.clientX - downX, e.clientY - downY));
    targetX -= dx;
    targetY -= dy;
    vx = -dx * 0.55;
    vy = -dy * 0.55;
    kickField();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    stage?.classList.remove('is-dragging');
    kickField();
  };
  stage?.addEventListener('pointerup', endDrag);
  stage?.addEventListener('pointercancel', endDrag);

  stage?.addEventListener('keydown', (e) => {
    const step = 140;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      targetX -= step;
      kickField();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      targetX += step;
      kickField();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      targetY -= step;
      kickField();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      targetY += step;
      kickField();
    }
  });

  resetBtn?.addEventListener('click', () => {
    targetX = 0;
    targetY = 0;
    vx = 0;
    vy = 0;
    kickField();
  });
  orbitBtn?.addEventListener('click', () => {
    orbitSeed += 1;
    targetX = 0;
    targetY = 0;
    camX = 0;
    camY = 0;
    renderField();
  });
  secPrev?.addEventListener('click', () => {
    if (fieldSector > 1) {
      fieldSector -= 1;
      targetX = 0;
      targetY = 0;
      camX = 0;
      camY = 0;
      renderField();
    }
  });
  secNext?.addEventListener('click', () => {
    fieldSector += 1;
    targetX = 0;
    targetY = 0;
    camX = 0;
    camY = 0;
    renderField();
  });

  // 事件绑定
  tabBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const next = b.dataset.galTab as 'plates' | 'journal' | 'all';
      if (!next || next === activeTab) return;
      activeTab = next;
      indexPage = 1;
      fieldSector = 1;
      targetX = 0;
      targetY = 0;
      camX = 0;
      camY = 0;
      syncAll();
    });
  });

  modeBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const next = b.dataset.galMode as 'field' | 'index';
      if (!next || next === activeMode) return;
      activeMode = next;
      syncAll();
    });
  });

  sortBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const next = b.dataset.galSort as 'newest' | 'oldest';
      if (!next || next === sortOrder) return;
      sortOrder = next;
      indexPage = 1;
      fieldSector = 1;
      syncAll();
    });
  });

  filterInput?.addEventListener('input', () => {
    filterText = filterInput.value.trim().toLowerCase();
    indexPage = 1;
    fieldSector = 1;
    targetX = 0;
    targetY = 0;
    camX = 0;
    camY = 0;
    syncAll();
  });

  pagerPrev?.addEventListener('click', () => {
    if (indexPage > 1) {
      indexPage -= 1;
      renderIndex();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  pagerNext?.addEventListener('click', () => {
    indexPage += 1;
    renderIndex();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  window.addEventListener('resize', () => {
    if (activeMode === 'field') layoutField();
  });

  syncAll();

  // 如果 URL 指定了 ?plate=id，自动打开灯箱
  const plateId = urlParams.get('plate');
  if (plateId) {
    const idx = currentList.findIndex((i) => i.id === plateId);
    if (idx >= 0) openViewer(idx);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initGallery();
