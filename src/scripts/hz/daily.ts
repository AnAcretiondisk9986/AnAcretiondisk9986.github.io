/**
 * HORIZON · daily.ts
 * 03 日常（X / Twitter TimeLine 交互逻辑）：
 *   1. 时间线排序（最新优先 / 最早优先）与 FLIP 过渡
 *   2. 栏目筛选（全部 / 含图集 / 纯文字 / 本地收藏）、#话题标签筛选、月份定位、线程聚合与即时搜索
 *   3. 本地共鸣（点赞）与收藏持久化（localStorage）、直达链接复制与锚点定位
 *   4. 1~9 张图像的高清灯箱查看器（缩略图条、滚轮/滑块/双指缩放、拖拽平移、键盘与触控滑动切图）
 */
import { captureFlipRects, playFlipRects } from './motion';

type TabKey = 'all' | 'media' | 'text' | 'bookmarked';
type SortKey = 'newest' | 'oldest';

interface ViewerMediaItem {
  src: string;
  thumb?: string;
  original?: string;
  fallback?: string;
  alt?: string;
}

const LIKE_KEY = 'hz-daily-likes-v1';
const BOOKMARK_KEY = 'hz-daily-bookmarks-v1';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pad2 = (n: number) => String(n).padStart(2, '0');

function readStorageSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function writeStorageSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore storage failures */
  }
}

function parseTagsAttr(el: HTMLElement): string[] {
  try {
    const parsed = JSON.parse(el.dataset.tags || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function initDailyViewer() {
  const viewer = document.getElementById('hz-daily-viewer') as HTMLDialogElement | null;
  if (!viewer) return null;

  const vMedia = viewer.querySelector<HTMLElement>('[data-dv-media]');
  const vImg = viewer.querySelector<HTMLImageElement>('[data-dv-img]');
  const vPrev = viewer.querySelector<HTMLButtonElement>('[data-dv-prev]');
  const vNext = viewer.querySelector<HTMLButtonElement>('[data-dv-next]');
  const vSidePrev = viewer.querySelector<HTMLButtonElement>('[data-dv-side-prev]');
  const vSideNext = viewer.querySelector<HTMLButtonElement>('[data-dv-side-next]');
  const vClose = viewer.querySelector<HTMLButtonElement>('[data-dv-close]');
  const vCounter = viewer.querySelector<HTMLElement>('[data-dv-counter]');
  const vThumbs = viewer.querySelector<HTMLElement>('[data-dv-thumbs]');
  const vZoom = viewer.querySelector<HTMLInputElement>('[data-dv-zoom]');
  const vZoomVal = viewer.querySelector<HTMLElement>('[data-dv-zoom-val]');
  const vZoomReset = viewer.querySelector<HTMLButtonElement>('[data-dv-zoom-reset]');
  const vOriginal = viewer.querySelector<HTMLAnchorElement>('[data-dv-original]');
  const vDate = viewer.querySelector<HTMLElement>('[data-dv-date]');
  const vTitle = viewer.querySelector<HTMLElement>('[data-dv-title]');
  const vExcerpt = viewer.querySelector<HTMLElement>('[data-dv-excerpt]');

  let items: ViewerMediaItem[] = [];
  let activeIndex = 0;

  const MIN_ZOOM = 100;
  const MAX_ZOOM = 400;
  let zoomPct = 100;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let justMoved = false;
  let swipeDownX = 0;
  let swipeDownY = 0;
  let lastX = 0;
  let lastY = 0;
  let prevPinchDist = 0;
  let prevPinchMidX = 0;
  let prevPinchMidY = 0;
  const pointers = new Map<number, { x: number; y: number }>();

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
    if (vZoom) vZoom.value = String(Math.round(zoomPct));
    if (vZoomVal) vZoomVal.textContent = `${Math.round(zoomPct)}%`;
  };

  const setZoom = (nextRaw: number, clientX?: number, clientY?: number) => {
    const prevScale = zoomPct / 100;
    const nextZoom = clamp(nextRaw, MIN_ZOOM, MAX_ZOOM);
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
    zoomPct = MIN_ZOOM;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  const renderThumbs = () => {
    if (!vThumbs) return;
    if (items.length <= 1) {
      vThumbs.hidden = true;
      vThumbs.innerHTML = '';
      return;
    }
    vThumbs.hidden = false;
    vThumbs.innerHTML = '';
    items.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hz-dv__thumb';
      btn.setAttribute('aria-current', idx === activeIndex ? 'true' : 'false');
      btn.setAttribute('aria-label', `切换到第 ${idx + 1} 张`);
      const img = document.createElement('img');
      img.src = item.thumb || item.src;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      if (item.fallback) img.setAttribute('data-gallery-fallback', item.fallback);
      btn.append(img);
      btn.addEventListener('click', () => showAt(idx));
      vThumbs.append(btn);
    });
  };

  const showAt = (idx: number) => {
    if (!vImg || items.length === 0) return;
    activeIndex = ((idx % items.length) + items.length) % items.length;
    const item = items[activeIndex];
    pointers.clear();
    dragging = false;
    vMedia?.classList.remove('is-dragging');
    resetZoom();

    vImg.classList.remove('is-swapping');
    void vImg.offsetWidth;
    vImg.classList.add('is-swapping');
    if (item.fallback) vImg.setAttribute('data-gallery-fallback', item.fallback);
    else vImg.removeAttribute('data-gallery-fallback');
    vImg.src = item.src;
    vImg.alt = item.alt || '';

    if (vCounter) vCounter.textContent = `${pad2(activeIndex + 1)} / ${pad2(items.length)}`;
    if (vPrev) vPrev.disabled = items.length <= 1;
    if (vNext) vNext.disabled = items.length <= 1;
    if (vSidePrev) vSidePrev.hidden = items.length <= 1;
    if (vSideNext) vSideNext.hidden = items.length <= 1;
    if (vTitle) vTitle.textContent = item.alt || `影像帧 ${pad2(activeIndex + 1)}`;
    if (vOriginal) {
      const origUrl = item.original || item.src;
      vOriginal.href = origUrl;
    }

    if (vThumbs && !vThumbs.hidden) {
      vThumbs.querySelectorAll<HTMLButtonElement>('.hz-dv__thumb').forEach((btn, i) => {
        btn.setAttribute('aria-current', i === activeIndex ? 'true' : 'false');
      });
    }
  };

  vClose?.addEventListener('click', () => viewer.close());
  vPrev?.addEventListener('click', () => showAt(activeIndex - 1));
  vNext?.addEventListener('click', () => showAt(activeIndex + 1));
  vSidePrev?.addEventListener('pointerdown', (e) => e.stopPropagation());
  vSideNext?.addEventListener('pointerdown', (e) => e.stopPropagation());
  vSidePrev?.addEventListener('click', (e) => {
    e.stopPropagation();
    showAt(activeIndex - 1);
  });
  vSideNext?.addEventListener('click', (e) => {
    e.stopPropagation();
    showAt(activeIndex + 1);
  });
  vMedia?.addEventListener('click', (e) => {
    if (justMoved) {
      justMoved = false;
      return;
    }
    if (e.target === vMedia && zoomPct <= 100.5) viewer.close();
  });
  vZoomReset?.addEventListener('click', resetZoom);
  vZoom?.addEventListener('input', () => setZoom(Number(vZoom.value) || MIN_ZOOM));
  vImg?.addEventListener('load', () => {
    clampPan();
    applyTransform();
  });
  vMedia?.addEventListener('dblclick', (e) => {
    setZoom(zoomPct > 120 ? 100 : 200, e.clientX, e.clientY);
  });
  vMedia?.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.0085 : 0.0022));
      setZoom(zoomPct * factor, e.clientX, e.clientY);
    },
    { passive: false },
  );

  vMedia?.addEventListener('pointerdown', (e) => {
    if ((e.target as Element)?.closest('.hz-dv__side')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      vMedia.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size === 1) {
      swipeDownX = e.clientX;
      swipeDownY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      prevPinchDist = 0;
      dragging = zoomPct > 100.5;
      vMedia.classList.toggle('is-dragging', dragging);
    } else if (pointers.size === 2) {
      dragging = false;
      vMedia.classList.remove('is-dragging');
      const [p1, p2] = [...pointers.values()];
      prevPinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      prevPinchMidX = (p1.x + p2.x) * 0.5;
      prevPinchMidY = (p1.y + p2.y) * 0.5;
    }
  });

  vMedia?.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5;
      if (prevPinchDist > 8 && dist > 8) {
        panX += midX - prevPinchMidX;
        panY += midY - prevPinchMidY;
        setZoom(zoomPct * (dist / prevPinchDist), midX, midY);
      }
      prevPinchDist = dist;
      prevPinchMidX = midX;
      prevPinchMidY = midY;
      return;
    }
    if (!dragging || pointers.size !== 1) return;
    panX += e.clientX - lastX;
    panY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    clampPan();
    applyTransform();
  });

  const endPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const wasSingleUnzoomed = pointers.size === 1 && zoomPct <= 100.5 && items.length > 1;
    const dx = e.clientX - swipeDownX;
    const dy = e.clientY - swipeDownY;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) prevPinchDist = 0;
    if (pointers.size === 0) {
      dragging = false;
      vMedia?.classList.remove('is-dragging');
      justMoved = Math.hypot(dx, dy) > 8;
      if (wasSingleUnzoomed && e.type === 'pointerup' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        showAt(dx < 0 ? activeIndex + 1 : activeIndex - 1);
      }
    }
  };

  vMedia?.addEventListener('pointerup', endPointer);
  vMedia?.addEventListener('pointercancel', endPointer);

  viewer.addEventListener('close', () => {
    pointers.clear();
    dragging = false;
    vMedia?.classList.remove('is-dragging');
    resetZoom();
  });
  viewer.addEventListener('click', (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showAt(activeIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showAt(activeIndex + 1);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(zoomPct * 1.2);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setZoom(zoomPct / 1.2);
    } else if (e.key === '0') {
      e.preventDefault();
      resetZoom();
    }
  });

  return {
    open(mediaList: ViewerMediaItem[], startIndex: number, dateLabel: string, excerpt: string) {
      if (mediaList.length === 0) return;
      items = mediaList;
      if (vDate) vDate.textContent = dateLabel || '—';
      if (vExcerpt) vExcerpt.textContent = excerpt || '';
      activeIndex = clamp(startIndex, 0, mediaList.length - 1);
      renderThumbs();
      showAt(activeIndex);
      if (!viewer.open) viewer.showModal();
    },
  };
}

export function initDailyTimeline() {
  const root = document.querySelector<HTMLElement>('[data-daily-root]');
  if (!root || root.dataset.dailyBound === '1') return;
  root.dataset.dailyBound = '1';

  const feed = root.querySelector<HTMLElement>('[data-tl-feed]');
  const tweets = [...root.querySelectorAll<HTMLElement>('[data-tl-tweet]')];
  if (!feed) return;

  const readoutEl = root.querySelector<HTMLElement>('[data-tl-readout]');
  const streamCountEl = root.querySelector<HTMLElement>('[data-tl-stream-count]');
  const emptyEl = root.querySelector<HTMLElement>('[data-tl-empty]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-tl-reset]');
  const activeChip = root.querySelector<HTMLButtonElement>('[data-tl-active-chip]');
  const activeChipText = root.querySelector<HTMLElement>('[data-tl-active-chip-text]');

  const searchInputs = [...root.querySelectorAll<HTMLInputElement>('[data-tl-search]')];
  const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-tl-tab]')];
  const sortButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-tl-sort]')];
  const tagButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-tl-tag]')];
  const monthButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-tl-month]')];
  const bmCounts = [...root.querySelectorAll<HTMLElement>('[data-tl-bm-count]')];
  const bmCountsInline = [...root.querySelectorAll<HTMLElement>('[data-tl-bm-count-inline]')];

  const likes = readStorageSet(LIKE_KEY);
  const bookmarks = readStorageSet(BOOKMARK_KEY);
  const viewer = initDailyViewer();

  const totalFrames = tweets.reduce((sum, el) => sum + Number(el.dataset.mediaCount || '0'), 0);

  let activeTab: TabKey = 'all';
  let sortKey: SortKey = 'newest';
  let activeTag = '';
  let activeMonth = '';
  let activeThread = '';
  let query = '';

  const params = new URLSearchParams(location.search);
  const initTab = params.get('tab');
  const initSort = params.get('sort');
  const initTag = params.get('tag')?.trim() || '';
  const initMonth = params.get('month')?.trim() || '';
  const initQ = params.get('q')?.trim() || '';

  if (initTab === 'media' || initTab === 'text' || initTab === 'bookmarked' || initTab === 'all') {
    activeTab = initTab;
  }
  if (initSort === 'oldest' || initSort === 'newest') {
    sortKey = initSort;
  }
  if (initTag) activeTag = initTag;
  if (initMonth) activeMonth = initMonth;
  if (initQ) {
    query = initQ.toLowerCase();
    searchInputs.forEach((input) => {
      input.value = initQ;
    });
  }

  const syncInteractionUI = () => {
    bmCounts.forEach((el) => {
      el.textContent = pad2(bookmarks.size);
    });
    bmCountsInline.forEach((el) => {
      el.textContent = String(bookmarks.size);
    });

    tweets.forEach((tweet) => {
      const id = tweet.dataset.id || '';
      const likeBtn = tweet.querySelector<HTMLButtonElement>('[data-tl-like]');
      const likeLabel = tweet.querySelector<HTMLElement>('[data-tl-like-label]');
      const liked = likes.has(id);
      if (likeBtn) likeBtn.setAttribute('aria-pressed', String(liked));
      if (likeLabel) likeLabel.textContent = liked ? '已共鸣 1' : '共鸣';

      const bmBtn = tweet.querySelector<HTMLButtonElement>('[data-tl-bookmark]');
      const bmLabel = tweet.querySelector<HTMLElement>('[data-tl-bookmark-label]');
      const saved = bookmarks.has(id);
      if (bmBtn) bmBtn.setAttribute('aria-pressed', String(saved));
      if (bmLabel) bmLabel.textContent = saved ? '已收藏' : '收藏';
    });
  };

  const syncControls = () => {
    tabButtons.forEach((btn) => {
      const match = btn.dataset.tlTab === activeTab;
      if (btn.getAttribute('role') === 'tab') btn.setAttribute('aria-selected', String(match));
      else btn.setAttribute('aria-pressed', String(match));
    });
    sortButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.tlSort === sortKey));
    });
    tagButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Boolean(activeTag) && btn.dataset.tlTag === activeTag));
    });
    monthButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Boolean(activeMonth) && btn.dataset.tlMonth === activeMonth));
    });

    const chipParts: string[] = [];
    if (activeTag) chipParts.push(`#${activeTag}`);
    if (activeMonth) chipParts.push(activeMonth.replace('-', '.'));
    if (activeThread) chipParts.push(`THREAD:${activeThread}`);
    if (query) chipParts.push(`"${query}"`);

    if (activeChip && activeChipText) {
      activeChip.hidden = chipParts.length === 0;
      activeChipText.textContent = chipParts.join(' · ');
    }
  };

  const updateThreadConnectors = (visibleList: HTMLElement[]) => {
    tweets.forEach((el) => el.classList.remove('is-thread-cont'));
    for (let i = 0; i < visibleList.length - 1; i += 1) {
      const cur = visibleList[i];
      const next = visibleList[i + 1];
      const tid = cur.dataset.threadId;
      if (tid && tid === next.dataset.threadId) {
        cur.classList.add('is-thread-cont');
      }
    }
  };

  const apply = (animate = false) => {
    const firstRects = animate ? captureFlipRects(tweets) : new Map<HTMLElement, DOMRect>();

    const sorted = [...tweets].sort((a, b) => {
      const pa = Number(a.dataset.pinned || '0');
      const pb = Number(b.dataset.pinned || '0');
      const ta = Number(a.dataset.ts || '0');
      const tb = Number(b.dataset.ts || '0');
      const posA = Number(a.dataset.pos || '0');
      const posB = Number(b.dataset.pos || '0');

      if (sortKey === 'oldest') {
        return ta - tb || posB - posA;
      }
      return pb - pa || tb - ta || posA - posB;
    });

    const visibleList: HTMLElement[] = [];
    let visibleFrames = 0;
    const frag = document.createDocumentFragment();

    for (const tweet of sorted) {
      const id = tweet.dataset.id || '';
      const hasMedia = tweet.dataset.hasMedia === '1';
      const month = tweet.dataset.month || '';
      const threadId = tweet.dataset.threadId || '';
      const searchText = tweet.dataset.search || '';
      const tags = parseTagsAttr(tweet);

      const matchTab =
        activeTab === 'all' ||
        (activeTab === 'media' && hasMedia) ||
        (activeTab === 'text' && !hasMedia) ||
        (activeTab === 'bookmarked' && bookmarks.has(id));
      const matchTag = !activeTag || tags.includes(activeTag);
      const matchMonth = !activeMonth || month === activeMonth;
      const matchThread = !activeThread || threadId === activeThread;
      const matchQuery = !query || searchText.includes(query);

      const ok = matchTab && matchTag && matchMonth && matchThread && matchQuery;
      tweet.hidden = !ok;

      if (ok) {
        tweet.classList.remove('is-pending');
        tweet.classList.add('is-revealed');
        visibleList.push(tweet);
        visibleFrames += Number(tweet.dataset.mediaCount || '0');
      }
      frag.append(tweet);
    }

    feed.append(frag);
    updateThreadConnectors(visibleList);

    if (animate) {
      playFlipRects(visibleList, firstRects, { duration: 360 });
    }

    if (emptyEl) emptyEl.hidden = visibleList.length > 0;
    if (streamCountEl) {
      streamCountEl.textContent = `${pad2(visibleList.length)} / ${pad2(tweets.length)}`;
    }
    if (readoutEl) {
      readoutEl.textContent = `${visibleList.length} / ${tweets.length} MOMENTS · ${visibleFrames} / ${totalFrames} FRAMES`;
    }

    syncControls();
  };

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.tlTab as TabKey | undefined;
      if (!next) return;
      activeTab = next;
      apply(true);
    });
  });

  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.tlSort as SortKey | undefined;
      if (!next || next === sortKey) return;
      sortKey = next;
      apply(true);
    });
  });

  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tlTag || '';
      activeTag = activeTag === tag ? '' : tag;
      apply(true);
    });
  });

  monthButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const month = btn.dataset.tlMonth || '';
      activeMonth = activeMonth === month ? '' : month;
      apply(true);
    });
  });

  searchInputs.forEach((input) => {
    input.addEventListener('input', () => {
      const val = input.value;
      query = val.trim().toLowerCase();
      searchInputs.forEach((other) => {
        if (other !== input) other.value = val;
      });
      apply(false);
    });
  });

  activeChip?.addEventListener('click', () => {
    activeTag = '';
    activeMonth = '';
    activeThread = '';
    query = '';
    searchInputs.forEach((input) => {
      input.value = '';
    });
    apply(true);
  });

  resetBtn?.addEventListener('click', () => {
    activeTab = 'all';
    sortKey = 'newest';
    activeTag = '';
    activeMonth = '';
    activeThread = '';
    query = '';
    searchInputs.forEach((input) => {
      input.value = '';
    });
    apply(true);
  });

  // 委托点击：内联 #标签、Thread 聚合、图片灯箱、点赞、收藏、复制直链
  feed.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (!target) return;

    const inlineTag = target.closest<HTMLElement>('[data-tl-tag-inline]');
    if (inlineTag) {
      const tag = inlineTag.dataset.tlTagInline || '';
      activeTag = activeTag === tag ? '' : tag;
      apply(true);
      return;
    }

    const threadBtn = target.closest<HTMLElement>('[data-tl-thread-filter]');
    if (threadBtn) {
      const tid = threadBtn.dataset.tlThreadFilter || '';
      activeThread = activeThread === tid ? '' : tid;
      apply(true);
      return;
    }

    const openImgBtn = target.closest<HTMLElement>('[data-tl-open-img]');
    if (openImgBtn) {
      const tweet = openImgBtn.closest<HTMLElement>('[data-tl-tweet]');
      const mediaBox = tweet?.querySelector<HTMLElement>('[data-media]');
      if (tweet && mediaBox && viewer) {
        try {
          const list = JSON.parse(mediaBox.dataset.media || '[]') as ViewerMediaItem[];
          const idx = Number(openImgBtn.dataset.tlOpenImg || '0');
          viewer.open(list, idx, tweet.dataset.dateLabel || '', tweet.dataset.excerpt || '');
        } catch {
          /* ignore invalid json */
        }
      }
      return;
    }

    const likeBtn = target.closest<HTMLButtonElement>('[data-tl-like]');
    if (likeBtn) {
      const id = likeBtn.dataset.tlLike || '';
      if (!id) return;
      if (likes.has(id)) likes.delete(id);
      else likes.add(id);
      writeStorageSet(LIKE_KEY, likes);
      syncInteractionUI();
      return;
    }

    const bmBtn = target.closest<HTMLButtonElement>('[data-tl-bookmark]');
    if (bmBtn) {
      const id = bmBtn.dataset.tlBookmark || '';
      if (!id) return;
      if (bookmarks.has(id)) bookmarks.delete(id);
      else bookmarks.add(id);
      writeStorageSet(BOOKMARK_KEY, bookmarks);
      syncInteractionUI();
      if (activeTab === 'bookmarked') apply(true);
      return;
    }

    const copyBtn = target.closest<HTMLButtonElement>('[data-tl-copy]');
    if (copyBtn) {
      const id = copyBtn.dataset.tlCopy || '';
      const labelEl = copyBtn.querySelector<HTMLElement>('[data-tl-copy-label]');
      const url = `${location.origin}${location.pathname}#${encodeURIComponent(id)}`;
      const finishCopy = () => {
        copyBtn.classList.add('is-copied');
        if (labelEl) labelEl.textContent = '已复制 ✓';
        window.setTimeout(() => {
          copyBtn.classList.remove('is-copied');
          if (labelEl) labelEl.textContent = '直链';
        }, 1800);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(finishCopy).catch(finishCopy);
      } else {
        finishCopy();
      }
    }
  });

  // 键盘快捷键 `/` 聚焦搜索、`Escape` 清空
  document.addEventListener('keydown', (e) => {
    const dialogOpen = Boolean((document.getElementById('hz-daily-viewer') as HTMLDialogElement | null)?.open);
    if (dialogOpen) return;
    const active = document.activeElement;
    const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      const targetInput = searchInputs.find((el) => el.offsetParent !== null) || searchInputs[0];
      targetInput?.focus();
    } else if (e.key === 'Escape' && isTyping && searchInputs.includes(active as HTMLInputElement)) {
      if (query) {
        query = '';
        searchInputs.forEach((el) => {
          el.value = '';
        });
        apply(false);
      } else {
        (active as HTMLElement).blur();
      }
    }
  });

  syncInteractionUI();
  apply(false);

  // 支持 #id 锚点高亮定位
  const hashId = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (hashId) {
    const hit = tweets.find((t) => t.id === hashId);
    if (hit && !hit.hidden) {
      hit.classList.add('is-anchor-hit');
      requestAnimationFrame(() => {
        hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      window.setTimeout(() => hit.classList.remove('is-anchor-hit'), 3200);
    }
  }
}

initDailyTimeline();
document.addEventListener('astro:page-load', initDailyTimeline);
