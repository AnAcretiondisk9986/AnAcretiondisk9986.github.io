/**
 * HORIZON · gallery-field.ts
 * /gallery/ 交互核心：
 *   - 两个数据源：独立收藏（plates） / 随文影像（journal） / 全部（all）
 *   - 两种视图：引力透镜场（FIELD：拖拽平移 + 滚轮/双指缩放 + 近中心鱼眼放大 + 随机跳转）与 编目索引（INDEX）
 *   - 高清灯箱查看器：缩放 100%~400%、拖拽平移、加载无损原图、上一张/下一张快捷键
 */

import { replayEnter } from './motion';

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

const INDEX_PAGE_SIZE = 24;
const MIN_FIELD_ZOOM = 0.2;
const MAX_FIELD_ZOOM = 2.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  const coordEl = root.querySelector<HTMLElement>('[data-field-coord]');
  const zoomLabel = root.querySelector<HTMLElement>('[data-field-zoom]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-field-reset]');
  const orbitBtn = root.querySelector<HTMLButtonElement>('[data-field-orbit]');
  const randomBtn = root.querySelector<HTMLButtonElement>('[data-field-random]');

  const indexWrap = root.querySelector<HTMLElement>('[data-gal-index-wrap]');
  const gridEl = root.querySelector<HTMLElement>('[data-index-grid]');
  const pagerPrev = root.querySelector<HTMLButtonElement>('[data-page-prev]');
  const pagerNext = root.querySelector<HTMLButtonElement>('[data-page-next]');
  const pageStatus = root.querySelector<HTMLElement>('[data-page-status]');

  // 灯箱
  const viewer = document.getElementById('hz-viewer') as HTMLDialogElement | null;
  const vMedia = viewer?.querySelector<HTMLElement>('[data-viewer-media]');
  const vImg = viewer?.querySelector<HTMLImageElement>('[data-viewer-img]');
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
  let orbitSeed = 0;

  let currentList: GalleryItem[] = [];
  let viewerIndex = -1;

  // 透镜场平移与缩放状态
  let camX = 0;
  let camY = 0;
  let targetX = 0;
  let targetY = 0;
  let vx = 0;
  let vy = 0;
  let fieldZoom = 1;
  let targetZoom = 1;
  let dragging = false;
  let movedPx = 0;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let prevPinchDist = 0;
  let prevPinchMidX = 0;
  let prevPinchMidY = 0;
  const activePointers = new Map<number, { x: number; y: number }>();
  let fieldRaf = 0;

  interface NodePos {
    el: HTMLElement;
    img: HTMLImageElement;
    bx: number;
    by: number;
    item: GalleryItem;
    lod: 'idle' | 'loading-thumb' | 'thumb' | 'loading-full' | 'full' | 'error';
    baseW: number;
    baseH: number;
    sx: number;
    sy: number;
    scale: number;
    focusDist: number;
    inViewport: boolean;
    inLoadWindow: boolean;
  }
  let fieldNodes: NodePos[] = [];
  let currentNearest: NodePos | null = null;
  let fieldGen = 0;
  let thumbInflight = 0;
  let fullInflight = 0;
  let pointerOffX = 0;
  let pointerOffY = 0;
  let pointerActive = false;
  let loadPumpRaf = 0;

  const MAX_THUMB_INFLIGHT = 4;
  const MAX_FULL_INFLIGHT = 2;
  const FOCUS_ZOOM_THRESHOLD = 0.85;
  const FOCUS_TARGET_ZOOM = 1.05;
  const FOCUS_CENTER_TOLERANCE = 85;

  interface GlideAnim {
    startTime: number;
    duration: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    fromZoom: number;
    toZoom: number;
  }
  let glideAnim: GlideAnim | null = null;

  const easeInOutCubic = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const cancelGlide = () => {
    if (!glideAnim) return;
    glideAnim = null;
    targetX = camX;
    targetY = camY;
    targetZoom = fieldZoom;
  };

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

  const lockPlateBox = (node: NodePos) => {
    const nw = node.img.naturalWidth;
    const nh = node.img.naturalHeight;
    if (!nw || !nh || node.baseW > 0) return;
    const maxW = Math.min(window.innerWidth * 0.72, 620);
    const maxH = Math.min(window.innerHeight * 0.64, 480);
    const ratio = nw / nh;
    const w = Math.round(Math.min(maxW, maxH * ratio));
    const h = Math.round(w / ratio);
    node.baseW = w;
    node.baseH = h;
    node.img.style.width = `${w}px`;
    node.img.style.height = `${h}px`;
  };

  const startThumbLoad = (node: NodePos, gen: number) => {
    if (node.lod !== 'idle') return;
    const thumbUrl = node.item.thumb || node.item.src;
    const fullUrl = node.item.src;
    if (!thumbUrl) {
      node.lod = 'error';
      return;
    }
    const isDirectFull = thumbUrl === fullUrl;
    node.lod = 'loading-thumb';
    thumbInflight += 1;

    const finish = () => {
      thumbInflight = Math.max(0, thumbInflight - 1);
      scheduleLoadPump();
    };

    const onReady = () => {
      if (gen !== fieldGen) { finish(); return; }
      lockPlateBox(node);
      node.lod = isDirectFull ? 'full' : 'thumb';
      node.el.classList.add('is-ready');
      finish();
    };

    const onFail = () => {
      if (gen !== fieldGen) { finish(); return; }
      if (!isDirectFull && fullUrl && node.img.dataset.triedFallback !== '1') {
        node.img.dataset.triedFallback = '1';
        node.img.addEventListener('load', onReady, { once: true });
        node.img.addEventListener('error', () => {
          if (gen === fieldGen) {
            node.lod = 'error';
            node.el.classList.add('is-error');
          }
          finish();
        }, { once: true });
        node.img.src = fullUrl;
        return;
      }
      node.lod = 'error';
      node.el.classList.add('is-error');
      finish();
    };

    node.img.addEventListener('load', onReady, { once: true });
    node.img.addEventListener('error', onFail, { once: true });
    node.img.src = thumbUrl;
  };

  const startFullUpgrade = (node: NodePos, gen: number) => {
    if (node.lod !== 'thumb' || !node.item.src || node.item.src === node.item.thumb) return;
    node.lod = 'loading-full';
    fullInflight += 1;
    const preloader = new Image();
    preloader.decoding = 'async';
    preloader.referrerPolicy = 'no-referrer';
    preloader.onload = () => {
      fullInflight = Math.max(0, fullInflight - 1);
      if (gen !== fieldGen) return;
      node.img.src = node.item.src;
      node.lod = 'full';
      scheduleLoadPump();
    };
    preloader.onerror = () => {
      fullInflight = Math.max(0, fullInflight - 1);
      if (gen === fieldGen) {
        node.lod = 'full';
        scheduleLoadPump();
      }
    };
    preloader.src = node.item.src;
  };

  const shouldUpgradeToFull = (node: NodePos): boolean => {
    if (node.lod !== 'thumb' || !node.inViewport) return false;
    if (!node.item.src || node.item.src === node.item.thumb) return false;
    const apparentW = (node.baseW || 480) * node.scale;
    // 缩放比例较小时仅使用 480px 缩略图；放大或聚焦在中心镜场且实际渲染尺寸较大时按需升级原图
    if (node === currentNearest && fieldZoom >= 0.85 && apparentW >= 380) return true;
    return fieldZoom >= 1.08 && apparentW >= 480;
  };

  const pumpFieldLoads = () => {
    loadPumpRaf = 0;
    if (activeMode !== 'field' || fieldNodes.length === 0) return;
    const gen = fieldGen;

    if (thumbInflight < MAX_THUMB_INFLIGHT) {
      const thumbCandidates = fieldNodes
        .filter((n) => n.lod === 'idle' && n.inLoadWindow)
        .sort((a, b) => a.focusDist - b.focusDist);
      for (const node of thumbCandidates) {
        if (thumbInflight >= MAX_THUMB_INFLIGHT) break;
        startThumbLoad(node, gen);
      }
    }

    if (fullInflight < MAX_FULL_INFLIGHT) {
      const fullCandidates = fieldNodes
        .filter((n) => shouldUpgradeToFull(n))
        .sort((a, b) => a.focusDist - b.focusDist);
      for (const node of fullCandidates) {
        if (fullInflight >= MAX_FULL_INFLIGHT) break;
        startFullUpgrade(node, gen);
      }
    }
  };

  const scheduleLoadPump = () => {
    if (loadPumpRaf || activeMode !== 'field') return;
    loadPumpRaf = requestAnimationFrame(pumpFieldLoads);
  };

  const renderField = () => {
    if (!canvasEl || !stage) return;

    glideAnim = null;
    fieldGen += 1;
    thumbInflight = 0;
    fullInflight = 0;
    if (randomBtn) randomBtn.disabled = currentList.length <= 1;

    canvasEl.innerHTML = '';
    fieldNodes = [];
    currentNearest = null;

    if (currentList.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hz-gal-empty hz-mono';
      empty.textContent = 'NO OPTICAL SIGNATURES MATCH CURRENT FILTER';
      canvasEl.append(empty);
      return;
    }

    const golden = 2.399963229728653;
    const frag = document.createDocumentFragment();
    currentList.forEach((item, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hz-fplate';
      card.dataset.id = item.id;
      card.setAttribute('aria-label', item.alt || '打开图像');

      const angle = i * golden + orbitSeed * 1.1;
      const radius = i === 0 ? 0 : 410 + Math.sqrt(i) * 320;
      const bx = Math.cos(angle) * radius * 1.18;
      const by = Math.sin(angle) * radius * 0.92;

      const frame = document.createElement('span');
      frame.className = 'hz-fplate__frame';
      const img = document.createElement('img');
      img.alt = item.alt || '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      frame.append(img);

      card.append(frame);
      card.addEventListener('click', (e) => {
        if (e.detail > 0 && movedPx > 7) return;
        const node = fieldNodes[i];
        if (!node) return;
        const distFromCenter = Math.hypot(node.sx, node.sy);
        const needsFocus = fieldZoom < FOCUS_ZOOM_THRESHOLD
          || distFromCenter > FOCUS_CENTER_TOLERANCE
          || node !== currentNearest;
        if (needsFocus) {
          startThumbLoad(node, fieldGen);
          const focusZoom = clamp(Math.max(fieldZoom, FOCUS_TARGET_ZOOM), MIN_FIELD_ZOOM, MAX_FIELD_ZOOM);
          glideTo(node.bx, node.by, focusZoom);
          return;
        }
        openViewer(i);
      });

      frag.append(card);
      fieldNodes.push({
        el: card,
        img,
        bx,
        by,
        item,
        lod: 'idle',
        baseW: 0,
        baseH: 0,
        sx: 0,
        sy: 0,
        scale: fieldZoom,
        focusDist: Infinity,
        inViewport: false,
        inLoadWindow: false,
      });
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
    const lensRadius = Math.min(sw, sh) * 0.65;
    const margin = 460 * Math.max(fieldZoom, 0.45);
    const cullX = sw * 0.62 + margin;
    const cullY = sw * 0.62 + margin;
    // 严格收紧懒加载窗口：仅加载当前视口及边缘小缓冲，按中心/指针优先队列分批加载
    const loadX = sw * 0.72 + 180;
    const loadY = sh * 0.72 + 180;
    const viewX = sw * 0.56 + 120;
    const viewY = sh * 0.56 + 120;

    const gSize = clamp(80 * fieldZoom, 24, 180);
    stage.style.backgroundSize = `${gSize.toFixed(1)}px ${gSize.toFixed(1)}px`;
    stage.style.backgroundPosition = `calc(50% - ${(camX * fieldZoom).toFixed(1)}px) calc(50% - ${(camY * fieldZoom).toFixed(1)}px)`;

    let nearest: NodePos | null = null;
    let nearestDist = Infinity;

    for (const node of fieldNodes) {
      const sx = (node.bx - camX) * fieldZoom;
      const sy = (node.by - camY) * fieldZoom;
      const d = Math.hypot(sx, sy);
      const pointerDist = pointerActive ? Math.hypot(sx - pointerOffX, sy - pointerOffY) : d;

      node.sx = sx;
      node.sy = sy;
      node.focusDist = Math.min(d, pointerDist * 0.92);
      node.inLoadWindow = Math.abs(sx) < loadX && Math.abs(sy) < loadY;
      node.inViewport = Math.abs(sx) < viewX && Math.abs(sy) < viewY;

      const visible = Math.abs(sx) < cullX && Math.abs(sy) < cullY;
      node.el.style.display = visible ? 'block' : 'none';

      if (visible) {
        const prox = Math.max(0, 1 - d / Math.max(220, lensRadius));
        const boost = 0.28 * Math.min(1, fieldZoom);
        const scale = (0.76 + boost * prox * prox) * fieldZoom;
        const op = fieldZoom < 0.65 ? 0.58 + 0.42 * prox : 0.36 + 0.64 * prox;
        node.scale = scale;

        node.el.style.transform = `translate3d(${(cx + sx).toFixed(1)}px, ${(cy + sy).toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        node.el.style.opacity = op.toFixed(3);
        node.el.style.zIndex = String(Math.round(prox * 100) + 1);
      } else {
        node.scale = fieldZoom;
      }

      if (d < nearestDist) {
        nearestDist = d;
        nearest = node;
      }
    }

    currentNearest = nearest;
    const lockRadius = 260 * Math.max(fieldZoom, 0.55);
    fieldNodes.forEach((n) => n.el.classList.toggle('is-locked', n === nearest && nearestDist < lockRadius));
    scheduleLoadPump();

    if (coordEl) {
      coordEl.textContent = `OFFSET [${Math.round(camX)}, ${Math.round(camY)}]`;
    }
    if (zoomLabel) {
      zoomLabel.textContent = `ZOOM ${Math.round(fieldZoom * 100)}%`;
    }
  };

  const stepField = (now = performance.now()) => {
    fieldRaf = 0;
    if (activeMode !== 'field') return;

    if (glideAnim) {
      const elapsed = Math.max(0, now - glideAnim.startTime);
      const u = clamp(elapsed / glideAnim.duration, 0, 1);
      const easePos = easeInOutCubic(u);
      const easeZoom = easeInOutCubic(clamp((u - 0.06) / 0.94, 0, 1));
      camX = glideAnim.fromX + (glideAnim.toX - glideAnim.fromX) * easePos;
      camY = glideAnim.fromY + (glideAnim.toY - glideAnim.fromY) * easePos;
      fieldZoom = glideAnim.fromZoom * Math.pow(glideAnim.toZoom / glideAnim.fromZoom, easeZoom);
      targetX = camX;
      targetY = camY;
      targetZoom = fieldZoom;
      layoutField();
      if (u < 1) {
        fieldRaf = requestAnimationFrame(stepField);
      } else {
        camX = glideAnim.toX;
        camY = glideAnim.toY;
        fieldZoom = glideAnim.toZoom;
        targetX = camX;
        targetY = camY;
        targetZoom = fieldZoom;
        glideAnim = null;
        layoutField();
      }
      return;
    }

    if (!dragging && activePointers.size === 0) {
      targetX += vx;
      targetY += vy;
      vx *= 0.9;
      vy *= 0.9;
      if (Math.abs(vx) < 0.15) vx = 0;
      if (Math.abs(vy) < 0.15) vy = 0;
    }

    camX += (targetX - camX) * 0.22;
    camY += (targetY - camY) * 0.22;
    fieldZoom += (targetZoom - fieldZoom) * 0.2;
    layoutField();

    if (
      dragging
      || activePointers.size > 0
      || Math.abs(targetX - camX) > 0.4
      || Math.abs(targetY - camY) > 0.4
      || Math.abs(targetZoom - fieldZoom) > 0.001
      || Math.abs(vx) > 0.15
      || Math.abs(vy) > 0.15
    ) {
      fieldRaf = requestAnimationFrame(stepField);
    }
  };

  const kickField = () => {
    if (!fieldRaf && activeMode === 'field') {
      fieldRaf = requestAnimationFrame(stepField);
    }
  };

  const glideTo = (toX: number, toY: number, toZoomRaw = fieldZoom) => {
    const toZoom = clamp(toZoomRaw, MIN_FIELD_ZOOM, MAX_FIELD_ZOOM);
    vx = 0;
    vy = 0;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      glideAnim = null;
      camX = toX;
      camY = toY;
      fieldZoom = toZoom;
      targetX = toX;
      targetY = toY;
      targetZoom = toZoom;
      layoutField();
      return;
    }
    const screenDist = Math.hypot((toX - camX) * fieldZoom, (toY - camY) * fieldZoom);
    const zoomDelta = Math.abs(Math.log(toZoom / Math.max(fieldZoom, 0.05)));
    const duration = clamp(520 + screenDist * 0.42 + zoomDelta * 220, 540, 1050);
    glideAnim = {
      startTime: performance.now(),
      duration,
      fromX: camX,
      fromY: camY,
      toX,
      toY,
      fromZoom: Math.max(fieldZoom, 0.05),
      toZoom,
    };
    targetX = toX;
    targetY = toY;
    targetZoom = toZoom;
    kickField();
  };

  const zoomAt = (nextZoomRaw: number, clientX?: number, clientY?: number) => {
    if (!stage) return;
    cancelGlide();
    const prevTarget = targetZoom;
    const nextZoom = clamp(nextZoomRaw, MIN_FIELD_ZOOM, MAX_FIELD_ZOOM);
    if (Math.abs(nextZoom - prevTarget) < 1e-4) return;

    if (clientX !== undefined && clientY !== undefined) {
      const rect = stage.getBoundingClientRect();
      const mx = clientX - rect.left - rect.width * 0.5;
      const my = clientY - rect.top - rect.height * 0.5;
      const factor = 1 / prevTarget - 1 / nextZoom;
      targetX += mx * factor;
      targetY += my * factor;
    }

    targetZoom = nextZoom;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      camX = targetX;
      camY = targetY;
      fieldZoom = targetZoom;
      layoutField();
    } else {
      kickField();
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
      card.style.setProperty('--i', String(Math.min(idx, 24)));
      card.setAttribute('aria-label', item.alt || '预览图像');

      const frame = document.createElement('span');
      frame.className = 'hz-iplate__frame';
      const img = document.createElement('img');
      img.src = item.thumb || item.src;
      img.alt = item.alt || '';
      img.loading = idx < 8 ? 'eager' : 'lazy';
      img.decoding = 'async';
      if (item.thumb && item.src && item.thumb !== item.src) {
        img.dataset.galleryFallback = item.src;
      }
      img.addEventListener('load', () => card.classList.add('is-ready'), { once: true });
      img.addEventListener('error', () => card.classList.add('is-error'), { once: true });
      frame.append(img);

      card.append(frame);
      card.addEventListener('click', () => openViewer(globalIdx));
      frag.append(card);
    });
    gridEl.append(frag);
    replayEnter(gridEl);
  };

  const syncAll = () => {
    currentList = computeList();
    if (countEl) {
      countEl.textContent = `${currentList.length} IMAGES`;
    }
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.galTab === activeTab)));
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.galMode === activeMode)));
    sortBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.galSort === sortOrder)));

    if (fieldWrap) fieldWrap.hidden = activeMode !== 'field';
    if (indexWrap) indexWrap.hidden = activeMode !== 'index';

    if (activeMode === 'field') {
      renderField();
      replayEnter(fieldWrap);
      kickField();
    } else {
      renderIndex();
      replayEnter(indexWrap);
    }
  };

  // 灯箱控制
  const VIEWER_MIN_ZOOM = 100;
  const VIEWER_MAX_ZOOM = 400;
  let zoomPct = 100;
  let panX = 0;
  let panY = 0;
  let imgDragging = false;
  let imgLastX = 0;
  let imgLastY = 0;
  let vPrevPinchDist = 0;
  let vPrevPinchMidX = 0;
  let vPrevPinchMidY = 0;
  const vPointers = new Map<number, { x: number; y: number }>();

  const clampPan = () => {
    if (!vMedia || !vImg || zoomPct <= 100.5) {
      panX = 0;
      panY = 0;
      return;
    }
    const scale = zoomPct / 100;
    const maxX = Math.max(0, (vImg.offsetWidth * scale - vMedia.clientWidth) * 0.5);
    const maxY = Math.max(0, (vImg.offsetHeight * scale - vMedia.clientHeight) * 0.5);
    panX = clamp(panX, -maxX, maxX);
    panY = clamp(panY, -maxY, maxY);
  };

  const applyTransform = () => {
    if (!vImg) return;
    const scale = zoomPct / 100;
    vImg.style.transform = `translate3d(${panX.toFixed(1)}px, ${panY.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
    vMedia?.classList.toggle('can-pan', zoomPct > 100.5);
    const pctText = `${Math.round(zoomPct)}%`;
    if (vZoom) vZoom.value = String(Math.round(zoomPct));
    if (vZoomVal) vZoomVal.textContent = pctText;
  };

  const setViewerZoom = (nextZoomRaw: number, clientX?: number, clientY?: number) => {
    const prevScale = zoomPct / 100;
    const nextZoom = clamp(nextZoomRaw, VIEWER_MIN_ZOOM, VIEWER_MAX_ZOOM);
    const nextScale = nextZoom / 100;
    if (vMedia && clientX !== undefined && clientY !== undefined && Math.abs(nextScale - prevScale) > 1e-4) {
      const rect = vMedia.getBoundingClientRect();
      const mx = clientX - (rect.left + rect.width * 0.5);
      const my = clientY - (rect.top + rect.height * 0.5);
      const ratio = nextScale / prevScale;
      panX = mx - (mx - panX) * ratio;
      panY = my - (my - panY) * ratio;
    }
    zoomPct = nextZoom;
    clampPan();
    applyTransform();
  };

  const resetZoom = () => {
    zoomPct = VIEWER_MIN_ZOOM;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  const showViewerItem = (idx: number) => {
    if (!viewer || !vImg || currentList.length === 0) return;
    viewerIndex = ((idx % currentList.length) + currentList.length) % currentList.length;
    const item = currentList[viewerIndex];
    vPointers.clear();
    imgDragging = false;
    vMedia?.classList.remove('is-dragging');
    resetZoom();

    vImg.classList.remove('is-swapping');
    void vImg.offsetWidth;
    vImg.classList.add('is-swapping');
    vImg.src = item.src;
    vImg.alt = item.alt || '';
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
    setViewerZoom(Number(vZoom.value) || VIEWER_MIN_ZOOM);
  });
  vImg?.addEventListener('load', () => {
    clampPan();
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

  vMedia?.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.0085 : 0.0022));
      setViewerZoom(zoomPct * factor, e.clientX, e.clientY);
    },
    { passive: false },
  );

  vMedia?.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    vPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      vMedia.setPointerCapture(e.pointerId);
    } catch {
      /* ignore if synthetic event */
    }
    if (vPointers.size === 1) {
      imgLastX = e.clientX;
      imgLastY = e.clientY;
      vPrevPinchDist = 0;
      imgDragging = zoomPct > 100.5;
      vMedia.classList.toggle('is-dragging', imgDragging);
    } else if (vPointers.size === 2) {
      imgDragging = false;
      vMedia.classList.remove('is-dragging');
      const [p1, p2] = [...vPointers.values()];
      vPrevPinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      vPrevPinchMidX = (p1.x + p2.x) * 0.5;
      vPrevPinchMidY = (p1.y + p2.y) * 0.5;
    }
  });
  vMedia?.addEventListener('pointermove', (e) => {
    if (!vPointers.has(e.pointerId)) return;
    vPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (vPointers.size === 2) {
      const [p1, p2] = [...vPointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5;
      if (vPrevPinchDist > 8 && dist > 8) {
        panX += midX - vPrevPinchMidX;
        panY += midY - vPrevPinchMidY;
        setViewerZoom(zoomPct * (dist / vPrevPinchDist), midX, midY);
      }
      vPrevPinchDist = dist;
      vPrevPinchMidX = midX;
      vPrevPinchMidY = midY;
      return;
    }

    if (!imgDragging || vPointers.size !== 1) return;
    panX += e.clientX - imgLastX;
    panY += e.clientY - imgLastY;
    imgLastX = e.clientX;
    imgLastY = e.clientY;
    clampPan();
    applyTransform();
  });
  const endViewerPointer = (e: PointerEvent) => {
    if (!vPointers.has(e.pointerId)) return;
    vPointers.delete(e.pointerId);
    if (vPointers.size < 2) {
      vPrevPinchDist = 0;
    }
    if (vPointers.size === 1) {
      const [rem] = [...vPointers.values()];
      imgLastX = rem.x;
      imgLastY = rem.y;
      imgDragging = zoomPct > 100.5;
      vMedia?.classList.toggle('is-dragging', imgDragging);
    } else if (vPointers.size === 0) {
      imgDragging = false;
      vMedia?.classList.remove('is-dragging');
    }
  };
  vMedia?.addEventListener('pointerup', endViewerPointer);
  vMedia?.addEventListener('pointercancel', endViewerPointer);
  viewer?.addEventListener('close', () => {
    vPointers.clear();
    imgDragging = false;
    vMedia?.classList.remove('is-dragging');
    resetZoom();
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
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setViewerZoom(zoomPct * 1.2);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setViewerZoom(zoomPct / 1.2);
    } else if (e.key === '0') {
      e.preventDefault();
      resetZoom();
    }
  });

  // 透镜场拖拽、滚轮缩放、双指捏合与键盘导航
  const tryCapturePointer = (pointerId: number) => {
    if (!stage) return;
    try {
      if (!stage.hasPointerCapture?.(pointerId)) {
        stage.setPointerCapture(pointerId);
      }
    } catch {
      /* ignore if synthetic event */
    }
  };

  stage?.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      dragging = true;
      movedPx = 0;
      downX = e.clientX;
      downY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      vx = 0;
      vy = 0;
      prevPinchDist = 0;
      stage.classList.add('is-dragging');
      // 仅在点击空白背景时立即捕获指针；点在卡片上时推迟到真正拖拽(>4px)后再捕获，
      // 否则 pointerup 被重定向到 stage 会导致浏览器把鼠标 click 目标合并到 stage 而不触发卡片 click。
      if (!(e.target as HTMLElement | null)?.closest('.hz-fplate')) {
        tryCapturePointer(e.pointerId);
      }
    } else if (activePointers.size === 2) {
      dragging = false;
      movedPx = 999;
      vx = 0;
      vy = 0;
      stage.classList.remove('is-dragging');
      for (const id of activePointers.keys()) {
        tryCapturePointer(id);
      }
      const [p1, p2] = [...activePointers.values()];
      prevPinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      prevPinchMidX = (p1.x + p2.x) * 0.5;
      prevPinchMidY = (p1.y + p2.y) * 0.5;
    }
  });

  const updatePointerOffset = (e: PointerEvent) => {
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    pointerOffX = e.clientX - rect.left - rect.width * 0.5;
    pointerOffY = e.clientY - rect.top - rect.height * 0.5;
    pointerActive = true;
  };

  stage?.addEventListener('pointermove', (e) => {
    if (activePointers.has(e.pointerId)) return;
    updatePointerOffset(e);
    scheduleLoadPump();
  });

  window.addEventListener('pointermove', (e) => {
    if (!stage || !activePointers.has(e.pointerId)) return;
    updatePointerOffset(e);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      cancelGlide();
      const [p1, p2] = [...activePointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5;

      if (prevPinchDist > 8 && dist > 8) {
        const dxMid = midX - prevPinchMidX;
        const dyMid = midY - prevPinchMidY;
        const invZ = 1 / Math.max(fieldZoom, MIN_FIELD_ZOOM);
        targetX -= dxMid * invZ;
        targetY -= dyMid * invZ;
        zoomAt(targetZoom * (dist / prevPinchDist), midX, midY);
      }

      prevPinchDist = dist;
      prevPinchMidX = midX;
      prevPinchMidY = midY;
      return;
    }

    if (!dragging || activePointers.size !== 1) return;
    movedPx = Math.max(movedPx, Math.hypot(e.clientX - downX, e.clientY - downY));
    if (movedPx <= 4) return;
    cancelGlide();
    tryCapturePointer(e.pointerId);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const invZ = 1 / Math.max(fieldZoom, MIN_FIELD_ZOOM);
    targetX -= dx * invZ;
    targetY -= dy * invZ;
    vx = -dx * 0.55 * invZ;
    vy = -dy * 0.55 * invZ;
    kickField();
  });

  const endPointer = (e: PointerEvent) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      prevPinchDist = 0;
    }
    if (activePointers.size === 1) {
      const [rem] = [...activePointers.values()];
      lastX = rem.x;
      lastY = rem.y;
      dragging = true;
      stage?.classList.add('is-dragging');
    } else if (activePointers.size === 0 && dragging) {
      dragging = false;
      stage?.classList.remove('is-dragging');
      if (movedPx > 4) kickField();
    }
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  stage?.addEventListener('pointerleave', () => { pointerActive = false; });

  stage?.addEventListener(
    'wheel',
    (e) => {
      if (activeMode !== 'field') return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.0085 : 0.0018));
      zoomAt(targetZoom * factor, e.clientX, e.clientY);
    },
    { passive: false },
  );

  stage?.addEventListener('keydown', (e) => {
    const step = 140 / Math.max(fieldZoom, MIN_FIELD_ZOOM);
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      cancelGlide();
      targetX -= step;
      kickField();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      cancelGlide();
      targetX += step;
      kickField();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cancelGlide();
      targetY -= step;
      kickField();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cancelGlide();
      targetY += step;
      kickField();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomAt(targetZoom * 1.18);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomAt(targetZoom / 1.18);
    } else if (e.key === '0') {
      e.preventDefault();
      zoomAt(1);
    }
  });

  resetBtn?.addEventListener('click', () => {
    glideTo(0, 0, 1);
  });
  orbitBtn?.addEventListener('click', () => {
    glideAnim = null;
    orbitSeed += 1;
    targetX = 0;
    targetY = 0;
    camX = 0;
    camY = 0;
    fieldZoom = 0.72;
    targetZoom = 1;
    renderField();
    kickField();
  });
  randomBtn?.addEventListener('click', () => {
    if (fieldNodes.length === 0) return;
    let idx = Math.floor(Math.random() * fieldNodes.length);
    if (fieldNodes.length > 1 && fieldNodes[idx] === currentNearest) {
      idx = (idx + 1 + Math.floor(Math.random() * (fieldNodes.length - 1))) % fieldNodes.length;
    }
    const chosen = fieldNodes[idx];
    startThumbLoad(chosen, fieldGen);
    const focusZoom = clamp(Math.max(fieldZoom, FOCUS_TARGET_ZOOM), MIN_FIELD_ZOOM, MAX_FIELD_ZOOM);
    glideTo(chosen.bx, chosen.by, focusZoom);
  });

  // 事件绑定
  tabBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const next = b.dataset.galTab as 'plates' | 'journal' | 'all';
      if (!next || next === activeTab) return;
      activeTab = next;
      indexPage = 1;
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
      cancelGlide();
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
      syncAll();
    });
  });

  filterInput?.addEventListener('input', () => {
    filterText = filterInput.value.trim().toLowerCase();
    indexPage = 1;
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

initGallery();
