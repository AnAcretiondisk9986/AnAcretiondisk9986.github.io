interface GalleryImage {
  id: string;
  src: string;
  thumb?: string;
  alt: string;
  title: string;
  caption?: string;
  date?: string;
  dayIndex?: number;
  daySequence?: number;
  dayTotal?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  original?: string;
}
import { captureFlip, playFlip } from './reorder-anim';

// 独立收藏数据池(由上方 JSON 标签注入,避免 define:vars 内联导致 TS 语法残留)
  document.addEventListener('astro:page-load', () => {

  // ── jsDelivr 镜像自动降级：国内访问 cdn.jsdelivr.net 时常被墙/超时，
  // 捕获 img 加载失败后依次切换到 fastly / gcore / testingcf 镜像重试 ──
  const CDN_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net'];
  const nextCdnHost = (host: string) => {
    const i = CDN_HOSTS.indexOf(host);
    return i >= 0 && i < CDN_HOSTS.length - 1 ? CDN_HOSTS[i + 1] : null;
  };
  document.addEventListener('error', (event) => {
    const img = event.target as HTMLImageElement | null;
    if (!img || !(img instanceof HTMLImageElement)) return;
    try {
      const url = new URL(img.currentSrc || img.src);
      const next = nextCdnHost(url.hostname);
      if (!next) return; // 已到最后镜像,不再重试
      url.hostname = next;
      img.src = url.href; // 换镜像重试(失败会再次触发 error,自然推进到下一个)
    } catch { /* 非 jsDelivr URL,忽略 */ }
  }, true);

  // astro:page-load:整页加载与每次 VT 导航后触发,重新初始化(打包脚本只执行一次,事件驱动每次导航执行)

  const themeText = (minimal: string, trace: string) =>
    document.documentElement.dataset.visualTheme === 'trace' ? trace : minimal;

  // 让容器内当前可见的卡片播放一次「轻盈升起」进入动画(翻页时使用)
  const animateCardsEntering = (container: HTMLElement | null) => {
    if (!container || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const visible = [...container.querySelectorAll<HTMLElement>('[data-gallery-card]')]
      .filter((card) => !card.classList.contains('is-off-page'));
    if (!visible.length) return;
    visible.forEach((card) => card.classList.remove('is-entering'));
    void container.offsetWidth; // 强制 reflow,重触发动画
    visible.forEach((card) => card.classList.add('is-entering'));
  };
  const standalonePool = JSON.parse(document.querySelector<HTMLElement>('#gallery-pool')?.textContent || '[]') as GalleryImage[];
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-gallery-tab]')];
  const panels = [...document.querySelectorAll<HTMLElement>('[data-gallery-panel]')];
  const viewer = document.querySelector<HTMLDialogElement>('#gallery-viewer');
  const viewerImage = document.querySelector<HTMLImageElement>('#gallery-viewer-image');
  const viewerMedia = document.querySelector<HTMLElement>('#gallery-viewer-media');
  const viewerTitle = document.querySelector<HTMLElement>('#gallery-viewer-title');
  const viewerCaption = document.querySelector<HTMLElement>('#gallery-viewer-caption');
  const viewerSource = document.querySelector<HTMLAnchorElement>('#gallery-viewer-source');
  const viewerOriginalBtn = document.querySelector<HTMLButtonElement>('[data-gallery-original-btn]');
  const zoomSlider = document.querySelector<HTMLInputElement>('[data-gallery-zoom]');
  const zoomLabel = document.querySelector<HTMLElement>('[data-gallery-zoom-label]');
  const zoomReset = document.querySelector<HTMLButtonElement>('[data-gallery-zoom-reset]');
  const sortButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-gallery-sort]')];
  const orderStatus = document.querySelector<HTMLElement>('[data-gallery-order-status]');
  const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-gallery-view]')];
  const viewStatus = document.querySelector<HTMLElement>('[data-gallery-view-status]');
  const journalMasonry = document.querySelector<HTMLElement>('[data-gallery-masonry]');
  const albumsContainer = document.querySelector<HTMLElement>('[data-gallery-albums]');
  const pager = document.querySelector<HTMLElement>('[data-gallery-pager]');
  const pagerCurrent = document.querySelector<HTMLElement>('[data-gallery-page-current]');
  const pagerTotal = document.querySelector<HTMLElement>('[data-gallery-page-total]');
  const billboard = document.querySelector<HTMLElement>('[data-gallery-billboard]');
  const independentMasonry = document.querySelector<HTMLElement>('[data-independent-masonry]');
  const independentPager = document.querySelector<HTMLElement>('[data-independent-pager]');
  const independentPagerCurrent = document.querySelector<HTMLElement>('[data-independent-page-current]');
  const independentPagerTotal = document.querySelector<HTMLElement>('[data-independent-page-total]');

  type GalleryOrder = 'newest' | 'oldest';

  function setSequenceText(label: HTMLElement | null, sequence: string) {
    if (!label) return;
    const minimal = `${label.dataset.gallerySequenceMinimalPrefix || ''}${sequence}`;
    const trace = `${label.dataset.gallerySequenceTracePrefix || ''}${sequence}`;
    const minimalCopy = label.querySelector<HTMLElement>('[data-theme-copy-minimal]');
    const traceCopy = label.querySelector<HTMLElement>('[data-theme-copy-trace]');
    if (minimalCopy && traceCopy) {
      minimalCopy.textContent = minimal;
      traceCopy.textContent = trace;
    } else {
      label.textContent = themeText(minimal, trace);
    }
  }

  const JOURNAL_PAGE_SIZE = 9;
  const INDEPENDENT_PAGE_SIZE = 9;
  let currentOrder: GalleryOrder = 'newest';
  let journalView: 'timeline' | 'albums' = 'albums';
  let journalPage = 1;
  let independentPage = 1;

  // 随文图像时间线视图:按每页 9 张分页显示(编号保持全局连续)
  function renderJournalPage() {
    if (!journalMasonry || !pager) return;
    const cards = [...journalMasonry.querySelectorAll<HTMLElement>('[data-gallery-card]')];
    const total = Math.max(1, Math.ceil(cards.length / JOURNAL_PAGE_SIZE));
    journalPage = Math.min(Math.max(1, journalPage), total);
    cards.forEach((card, index) => {
      const onPage = Math.floor(index / JOURNAL_PAGE_SIZE) === journalPage - 1;
      card.classList.toggle('is-off-page', !onPage);
    });
    if (pagerCurrent) pagerCurrent.textContent = String(journalPage).padStart(2, '0');
    if (pagerTotal) pagerTotal.textContent = String(total).padStart(2, '0');
    const prevBtn = pager.querySelector<HTMLButtonElement>('[data-gallery-page="prev"]');
    const nextBtn = pager.querySelector<HTMLButtonElement>('[data-gallery-page="next"]');
    if (prevBtn) prevBtn.disabled = journalPage <= 1;
    if (nextBtn) nextBtn.disabled = journalPage >= total;
    pager.hidden = journalView !== 'timeline' || cards.length <= JOURNAL_PAGE_SIZE;
  }

  // 独立收藏:每页 9 张分页显示(编号保持全局连续)
  function renderIndependentPage() {
    if (!independentMasonry || !independentPager) return;
    const cards = [...independentMasonry.querySelectorAll<HTMLElement>('[data-gallery-card]')];
    const total = Math.max(1, Math.ceil(cards.length / INDEPENDENT_PAGE_SIZE));
    independentPage = Math.min(Math.max(1, independentPage), total);
    cards.forEach((card, index) => {
      const onPage = Math.floor(index / INDEPENDENT_PAGE_SIZE) === independentPage - 1;
      card.classList.toggle('is-off-page', !onPage);
    });
    if (independentPagerCurrent) independentPagerCurrent.textContent = String(independentPage).padStart(2, '0');
    if (independentPagerTotal) independentPagerTotal.textContent = String(total).padStart(2, '0');
    const prevBtn = independentPager.querySelector<HTMLButtonElement>('[data-independent-page="prev"]');
    const nextBtn = independentPager.querySelector<HTMLButtonElement>('[data-independent-page="next"]');
    if (prevBtn) prevBtn.disabled = independentPage <= 1;
    if (nextBtn) nextBtn.disabled = independentPage >= total;
    independentPager.hidden = cards.length <= INDEPENDENT_PAGE_SIZE;
  }

  // 文章图集视图:按当前排序重排分组
  function reorderAlbums() {
    if (!albumsContainer) return;
    const albums = [...albumsContainer.querySelectorAll<HTMLElement>('[data-gallery-album]')];
    const frames = captureFlip(albumsContainer);
    albums.sort((a, b) => {
      const aTime = Date.parse(a.dataset.galleryDate || '');
      const bTime = Date.parse(b.dataset.galleryDate || '');
      const aHasDate = Number.isFinite(aTime);
      const bHasDate = Number.isFinite(bTime);
      if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
      if (aHasDate && bHasDate && aTime !== bTime) return currentOrder === 'newest' ? bTime - aTime : aTime - bTime;
      const aSeq = Number(a.dataset.galleryDaySequence || '0');
      const bSeq = Number(b.dataset.galleryDaySequence || '0');
      if (aHasDate && bHasDate && aSeq !== bSeq) return currentOrder === 'newest' ? bSeq - aSeq : aSeq - bSeq;
      const positionDelta = Number(a.dataset.galleryPosition) - Number(b.dataset.galleryPosition);
      return currentOrder === 'newest' ? positionDelta : -positionDelta;
    });
    albumsContainer.append(...albums);
    playFlip(albumsContainer, frames);
    albums.forEach((album, index) => {
      const label = album.querySelector<HTMLElement>('[data-gallery-sequence]');
      setSequenceText(label, String(index + 1).padStart(2, '0'));
    });
  }

  // 时间线 / 文章图集 视图切换
  function setJournalView(view: 'timeline' | 'albums', animate = true) {
    journalView = view;
    viewButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.galleryView === view));
    });
    if (viewStatus) viewStatus.textContent = view === 'timeline' ? '时间线' : themeText('按文章', '文章图集');
    if (journalMasonry) journalMasonry.hidden = view !== 'timeline';
    if (albumsContainer) albumsContainer.hidden = view !== 'albums';
    renderJournalPage();
    if (animate) {
      const shown = view === 'timeline' ? journalMasonry : albumsContainer;
      if (shown) {
        shown.classList.remove('is-switching');
        void shown.offsetWidth;
        shown.classList.add('is-switching');
      }
    }
  }

  viewButtons.forEach((button) => {
    button.addEventListener('click', () => setJournalView(button.dataset.galleryView === 'albums' ? 'albums' : 'timeline'));
  });
  setJournalView('albums', false);

  document.querySelector<HTMLButtonElement>('[data-gallery-page="prev"]')?.addEventListener('click', () => {
    journalPage -= 1;
    renderJournalPage();
    animateCardsEntering(journalMasonry);
  });
  document.querySelector<HTMLButtonElement>('[data-gallery-page="next"]')?.addEventListener('click', () => {
    journalPage += 1;
    renderJournalPage();
    animateCardsEntering(journalMasonry);
  });

  document.querySelector<HTMLButtonElement>('[data-independent-page="prev"]')?.addEventListener('click', () => {
    independentPage -= 1;
    renderIndependentPage();
    animateCardsEntering(independentMasonry);
  });
  document.querySelector<HTMLButtonElement>('[data-independent-page="next"]')?.addEventListener('click', () => {
    independentPage += 1;
    renderIndependentPage();
    animateCardsEntering(independentMasonry);
  });

  function setGalleryOrder(order: GalleryOrder, updateUrl = true) {
    currentOrder = order;
    sortButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.gallerySort === order));
    });
    if (orderStatus) orderStatus.textContent = order === 'newest' ? '从新至旧' : '从旧至新';

    document.querySelectorAll<HTMLElement>('.gallery-masonry').forEach((gallery) => {
      const cards = [...gallery.querySelectorAll<HTMLElement>('[data-gallery-card]')];
      const frames = captureFlip(gallery);
      cards.sort((a, b) => {
        const aTime = Date.parse(a.dataset.galleryDate || '');
        const bTime = Date.parse(b.dataset.galleryDate || '');
        const aHasDate = Number.isFinite(aTime);
        const bHasDate = Number.isFinite(bTime);
        if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
        if (aHasDate && bHasDate && aTime !== bTime) return order === 'newest' ? bTime - aTime : aTime - bTime;
        const aSeq = Number(a.dataset.galleryDaySequence || '0');
        const bSeq = Number(b.dataset.galleryDaySequence || '0');
        if (aHasDate && bHasDate && aSeq !== bSeq) return order === 'newest' ? bSeq - aSeq : aSeq - bSeq;
        const positionDelta = Number(a.dataset.galleryPosition) - Number(b.dataset.galleryPosition);
        return order === 'newest' ? positionDelta : -positionDelta;
      });
      gallery.append(...cards);
      playFlip(gallery, frames);
      cards.forEach((card, index) => {
        const sequence = String(index + 1).padStart(2, '0');
        const stamp = card.querySelector<HTMLElement>('.gallery-image-stamp');
        const label = card.querySelector<HTMLElement>('[data-gallery-sequence]');
        if (stamp) stamp.textContent = sequence;
        setSequenceText(label, sequence);
      });
    });

    if (updateUrl) {
      const url = new URL(location.href);
      if (order === 'newest') url.searchParams.delete('order');
      else url.searchParams.set('order', 'oldest');
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    // 随文图像:刷新分页显示与图集排序
    journalPage = 1;
    renderJournalPage();
    // 独立收藏:刷新分页显示
    independentPage = 1;
    renderIndependentPage();
    reorderAlbums();
  }

  function selectGalleryTab(name: string, updateHash = true) {
    tabs.forEach((tab) => {
      const active = tab.dataset.galleryTab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      const active = panel.dataset.galleryPanel === name;
      panel.hidden = panel.dataset.galleryPanel !== name;
      if (active) {
        panel.classList.remove('is-switching');
        void panel.offsetWidth;
        panel.classList.add('is-switching');
      }
    });
    // 广告牌轮播仅在独立收藏面板可见时运行；懒构建：首次进入面板才创建（避免首屏生成 3×N 个图片节点）
    if (name === 'independent') {
      if (!billboardBuilt) {
        billboardBuilt = true;
        buildBillboard();
      }
      resumeBillboard();
    } else {
      pauseBillboard();
    }
    if (updateHash) history.replaceState(null, '', `#${name}`);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectGalleryTab(tab.dataset.galleryTab || 'journal'));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      selectGalleryTab(tabs[nextIndex].dataset.galleryTab || 'journal');
    });
  });

  // 注意:selectGalleryTab 的初始调用必须放在所有 let 声明之后(billboardTimer 等),
  // 否则 selectGalleryTab → pauseBillboard 访问 billboardTimer 会抛 TDZ(ReferenceError),
  // 中断后续初始化(排序/查看器/轮播全部失效)。初始调用已移至脚本末尾。
  // selectGalleryTab(location.hash === '#independent' ? 'independent' : 'journal', false);

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => setGalleryOrder(button.dataset.gallerySort === 'oldest' ? 'oldest' : 'newest'));
  });
  setGalleryOrder(new URLSearchParams(location.search).get('order') === 'oldest' ? 'oldest' : 'newest', false);

  // ── 图像查看器：按图片长宽比自适应 + 缩放滑块 + 拖拽平移 + 加载原图 ──
  let currentSrc = '';
  let originalUrl = '';
  let showingOriginal = false;
  let zoom = 1;
  let tx = 0;
  let ty = 0;

  function applyTransform() {
    if (!viewerImage) return;
    viewerImage.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    viewerMedia?.classList.toggle('can-pan', zoom > 1.001);
  }

  function resetView() {
    zoom = 1;
    tx = 0;
    ty = 0;
    if (zoomSlider) zoomSlider.value = '100';
    if (zoomLabel) zoomLabel.textContent = '100%';
    applyTransform();
  }

  // 图片加载完成后，把预览区尺寸设为图片等比适应视口的尺寸（横图/竖图均自然）
  function fitDialog() {
    if (!viewerMedia || !viewerImage) return;
    const naturalW = viewerImage.naturalWidth || 0;
    const naturalH = viewerImage.naturalHeight || 0;
    if (!naturalW || !naturalH) return;
    const maxW = Math.min(window.innerWidth * 0.9, 1600);
    const maxH = window.innerHeight * 0.72;
    const scale = Math.min(1, maxW / naturalW, maxH / naturalH);
    const w = Math.max(280, Math.round(naturalW * scale));
    const h = Math.max(200, Math.round(naturalH * scale));
    viewerMedia.style.width = `${w}px`;
    viewerMedia.style.height = `${h}px`;
    resetView();
  }

  viewerImage?.addEventListener('load', fitDialog);

  zoomSlider?.addEventListener('input', () => {
    zoom = Number(zoomSlider.value) / 100;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    applyTransform();
  });

  zoomReset?.addEventListener('click', resetView);

  // 拖拽平移（仅在放大后可用）
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginTx = 0;
  let dragOriginTy = 0;
  viewerMedia?.addEventListener('pointerdown', (event) => {
    if (zoom <= 1.001) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOriginTx = tx;
    dragOriginTy = ty;
    viewerMedia.setPointerCapture(event.pointerId);
    viewerMedia.classList.add('is-dragging');
  });
  viewerMedia?.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    tx = dragOriginTx + (event.clientX - dragStartX);
    ty = dragOriginTy + (event.clientY - dragStartY);
    applyTransform();
  });
  viewerMedia?.addEventListener('pointerup', () => {
    dragging = false;
    viewerMedia.classList.remove('is-dragging');
  });
  viewerMedia?.addEventListener('pointercancel', () => {
    dragging = false;
    viewerMedia.classList.remove('is-dragging');
  });

  // 加载原图 / 切回压缩图（仅独立收藏有原图）
  viewerOriginalBtn?.addEventListener('click', () => {
    if (!originalUrl || !viewerImage) return;
    if (showingOriginal) {
      viewerImage.src = currentSrc;
      viewerOriginalBtn.textContent = themeText('查看原图', '加载原图');
    } else {
      viewerImage.src = originalUrl;
      viewerOriginalBtn.textContent = themeText('显示压缩图', '切回压缩图');
    }
    showingOriginal = !showingOriginal;
  });

  viewer?.addEventListener('close', resetView);

  // ── 独立收藏广告牌:焦点轮播(当前图 1.2x 居中放大,两侧弱化,自动播放动画) ──
  let billboardTimer: number | undefined;
  let billboardViewport: HTMLElement | null = null;
  let billboardReduced = false;
  let billboardGoNext: (() => void) | null = null;
  let billboardBuilt = false; // 懒构建标记:首次切换到独立收藏面板时才创建轮播节点

  function pauseBillboard() {
    if (billboardTimer !== undefined) window.clearInterval(billboardTimer);
    billboardTimer = undefined;
  }

  function resumeBillboard() {
    pauseBillboard();
    if (!billboard || !billboardViewport || !billboardGoNext) return;
    if (billboard.closest('[data-gallery-panel]')?.hidden) return;
    if (billboard.matches(':hover')) return;
    if (billboardReduced) return;
    billboardTimer = window.setInterval(() => billboardGoNext?.(), 3800);
  }

  function buildBillboard() {
    if (!billboard) return;
    const track = billboard.querySelector<HTMLElement>('[data-billboard-track]');
    const viewport = billboard.querySelector<HTMLElement>('[data-billboard-viewport]');
    const dots = billboard.querySelector<HTMLElement>('[data-billboard-dots]');
    const prevBtn = billboard.querySelector<HTMLButtonElement>('[data-billboard-prev]');
    const nextBtn = billboard.querySelector<HTMLButtonElement>('[data-billboard-next]');
    if (!track || !viewport || !dots || !prevBtn || !nextBtn) return;
    billboardViewport = viewport;
    billboardReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Fisher–Yates 洗牌,全部独立收藏参与轮播
    const pool = [...standalonePool];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const selected = [...pool];

    // 伪无限循环:轨道复制 3 份,active 只在中间份活动,首尾通过「无感知瞬移」无缝衔接
    // (轨道平移一整份长度,同一张图落到相同屏幕位置,用户无感知)
    const COPIES = 3;
    for (let c = 0; c < COPIES; c++) {
      for (const image of selected) {
        const slide = document.createElement('button');
        slide.type = 'button';
        slide.className = 'gallery-billboard-slide';
        slide.dataset.galleryOpen = '';
        slide.dataset.gallerySrc = image.src;
        if (image.original) slide.dataset.galleryOriginal = image.original;
        slide.dataset.galleryAlt = image.alt || image.title;
        slide.dataset.galleryTitle = image.title;
        slide.dataset.galleryCaption = image.caption || image.alt;
        slide.dataset.gallerySource = image.sourceUrl || '';
        slide.dataset.gallerySourceTitle = image.sourceTitle || '';
        slide.setAttribute('aria-label', `查看${image.title}`);
        const img = document.createElement('img');
        img.src = image.thumb || image.src;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.alt = image.alt || image.title;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        slide.append(img);
        track.append(slide);
      }
    }

    const slides = [...track.children] as HTMLButtonElement[];
    const count = slides.length;
    const per = selected.length; // 每份张数
    let active = per; // 初始位于中间份第一张,两侧始终有图
    const GAP = 18;
    const FOCUS_SCALE = 1.2;
    const SIDE_SCALE = 0.82;

    // 线性轨道 ×3 份:每张图静态定位,切换时整个轨道平移(600ms 过渡);
    // 伪无限循环下没有真正的首尾,active 在中间份活动,越界时无缝瞬移一份
    const centers: number[] = [];
    const layoutTrack = () => {
      const widths = slides.map((slide) => slide.offsetWidth || 240);
      centers.length = 0;
      let x = (widths[0] || 240) / 2;
      centers.push(x);
      for (let i = 1; i < count; i++) {
        const a = widths[i - 1] || 240;
        const b = widths[i] || 240;
        // 相邻间距按「任一张成为焦点(1.2x)都不侵入邻居」预留:max(w)×1.2/2 + min(w)×0.82/2 + GAP
        x += Math.max(a, b) * FOCUS_SCALE / 2 + Math.min(a, b) * SIDE_SCALE / 2 + GAP;
        centers.push(x);
      }
      slides.forEach((slide, i) => { slide.style.left = `${centers[i]}px`; });
      applyTrack();
    };

    // 轨道平移:active 图中心对齐视口中心
    const applyTrack = () => {
      const cx = centers[active] ?? 0;
      track.style.transform = `translateX(${viewport.clientWidth / 2 - cx}px)`;
    };

    // 焦点样式:active 放大置顶,其余弱化(位置不变,只随轨道平移)
    const applyActive = () => {
      slides.forEach((slide, i) => {
        const isActive = i === active;
        slide.classList.toggle('is-active', isActive);
        slide.style.transform = `translate(-50%, -50%) scale(${isActive ? FOCUS_SCALE : SIDE_SCALE})`;
        slide.style.opacity = isActive ? '1' : '0.42';
        slide.style.zIndex = isActive ? '10' : '1';
      });
      updateDots();
    };

    // 正常步进用轨道过渡;末→首 / 首→末 / 指示点远跳均为瞬移(关过渡→设置→下一帧恢复)
    const setTransitions = (on: boolean) => {
      track.style.transition = on ? '' : 'none';
      slides.forEach((slide) => { slide.style.transition = on ? '' : 'none'; });
    };

    // 伪无限:active 越出中间份([per, 2per))时,等过渡结束后把轨道整体平移一份(瞬移,无过渡),
    // 使同一张图落到相同的屏幕位置,视觉无感知
    const wrapActive = () => {
      if (active < per || active >= per * 2) {
        const shift = active < per ? per : -per;
        setTransitions(false);
        active += shift;
        applyTrack();
        applyActive();
        void track.offsetWidth; // 提交瞬移
        setTransitions(true); // 恢复过渡,供随后的目标变化使用
        void track.offsetWidth;
      }
    };

    // 切换到目标「真实索引」(0..per-1):自动选择距当前物理位置最近的副本,
    // 相邻切换(±1)始终平滑,跨多张(指示点远跳/点击远处)瞬移
    const goToReal = (realTarget: number) => {
      const real = ((active % per) + per) % per;
      const delta = realTarget - real;
      if (delta === 0) return;
      const candNear = active + delta; // 当前所在份的同真实索引
      const candMid = per + realTarget; // 中间份的同真实索引
      const target = Math.abs(candNear - active) <= Math.abs(candMid - active) ? candNear : candMid;
      const jump = Math.abs(target - active) > 1;
      if (jump) {
        setTransitions(false);
        void track.offsetWidth; // 强制 reflow,使 transition:none 立即生效
      }
      active = target;
      applyTrack();
      applyActive();
      if (jump) {
        requestAnimationFrame(() => setTransitions(true));
        // 瞬移无过渡,立即无缝拉回中间份,保证后续调用方拿到的 active 不越界
        wrapActive();
      } else if (active < per || active >= per * 2) {
        // 相邻切换越界:等 600ms 过渡播完再无缝拉回(期间两侧始终有图,回拉视觉无感知)
        // 主触发用 transitionend(精确、不受后台定时器节流影响),setTimeout 仅作兜底
        window.setTimeout(() => wrapActive(), 620);
      }
    };

    // 过渡一结束立即把越界的 active 无缝拉回中间份(active 不长期越界,后续计算不错位)
    track.addEventListener('transitionend', () => wrapActive());

    const goPrev = () => goToReal(((active % per) + per - 1) % per);
    const goNext = () => goToReal((active % per + 1) % per);
    // 自动轮播:线性前进,伪无限下永远能前进
    billboardGoNext = goNext;

    // 指示点
    const dotButtons: HTMLButtonElement[] = [];
    selected.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `第 ${index + 1} 张`);
      dot.addEventListener('click', () => {
        goToReal(index);
      });
      dots.append(dot);
      dotButtons.push(dot);
    });

    const updateDots = () => {
      const realActive = active % per; // 指示点按真实索引高亮
      dotButtons.forEach((dot, index) => {
        dot.setAttribute('aria-current', String(index === realActive));
      });
    };

    // 图片宽度变化(懒加载头部到达即定比例/解码完成)便重新排轨道——仅靠 load 事件会在完整下载前留下旧间距
    const slideObserver = new ResizeObserver(layoutTrack);
    slides.forEach((slide) => slideObserver.observe(slide));
    // 视口尺寸变化(面板隐藏时宽度为 0、窗口缩放)时重新对齐平移量
    const viewportObserver = new ResizeObserver(applyTrack);
    viewportObserver.observe(viewport);

    prevBtn.addEventListener('click', goPrev);
    nextBtn.addEventListener('click', goNext);

    // 触摸/触控笔左右轻扫切换(鼠标点击不参与,避免与 click 双重触发导致一次跳两张)
    let touchStartX = 0;
    let isTouchPointer = false;
    let swipeLock = false;
    viewport.addEventListener('pointerdown', (event) => {
      touchStartX = event.clientX;
      isTouchPointer = event.pointerType !== 'mouse';
      swipeLock = false;
    });
    viewport.addEventListener('pointerup', (event) => {
      if (!isTouchPointer) return; // 鼠标点击交给 slide 的 click 处理,只切一次
      const dx = event.clientX - touchStartX;
      if (Math.abs(dx) > 48) {
        swipeLock = true; // 轻扫已切换,拦截随后的合成 click
        if (dx < 0) goNext();
        else goPrev();
      }
    });

    // 点击:焦点图打开查看器,两侧弱化图切换为焦点
    slides.forEach((slide, i) => {
      slide.addEventListener('click', () => {
        if (swipeLock) {
          swipeLock = false;
          return;
        }
        if (i === active) openGalleryViewer(slide);
        else if (i % per !== active % per) goToReal(i % per);
      });
    });

    layoutTrack();
    applyActive();

    // 自动轮播:悬停 / 聚焦时暂停,面板不可见时暂停(见 selectGalleryTab)
    billboard.addEventListener('mouseenter', pauseBillboard);
    billboard.addEventListener('mouseleave', resumeBillboard);
    viewport.addEventListener('focus', pauseBillboard);
    viewport.addEventListener('blur', resumeBillboard);
    resumeBillboard();
  }
  // 轮播懒构建：buildBillboard 改由 selectGalleryTab 首次切换到 independent 时调用，
  // 避免首屏即创建 3×独立照片数 的图片节点（此处不再直接构建）

  // 打开大图查看器(静态卡片与广告牌共用)
  function openGalleryViewer(button: HTMLButtonElement) {
    if (!viewer || !viewerImage || !viewerTitle || !viewerCaption || !viewerSource) return;
    currentSrc = button.dataset.gallerySrc || '';
    originalUrl = button.dataset.galleryOriginal || '';
    showingOriginal = false;
    viewerImage.src = currentSrc;
    viewerImage.alt = button.dataset.galleryAlt || '';
    viewerTitle.textContent = button.dataset.galleryTitle || '';
    viewerCaption.textContent = button.dataset.galleryCaption || '';
    const source = button.dataset.gallerySource || '';
    viewerSource.hidden = !source;
    viewerSource.href = source || '#';
    viewerSource.textContent = button.dataset.gallerySourceTitle
      ? `${themeText('阅读', '阅览')}《${button.dataset.gallerySourceTitle}》 ↗`
      : '查看来源 ↗';
    if (viewerOriginalBtn) {
      viewerOriginalBtn.hidden = !originalUrl;
      viewerOriginalBtn.textContent = themeText('查看原图', '加载原图');
    }
    viewer.showModal();
    fitDialog();
  }

  document.querySelectorAll<HTMLButtonElement>('[data-gallery-open]:not(.gallery-billboard-slide)').forEach((button) => {
    button.addEventListener('click', () => openGalleryViewer(button));
  });

  document.querySelector<HTMLButtonElement>('[data-gallery-close]')?.addEventListener('click', () => viewer?.close());
  viewer?.addEventListener('click', (event) => {
    if (event.target === viewer) viewer.close();
  });

  // 初始视图(默认 journal)的调用放在所有 let/const 声明之后,避免 TDZ(见上方注释)
  selectGalleryTab(location.hash === '#independent' ? 'independent' : 'journal', false);
  });
