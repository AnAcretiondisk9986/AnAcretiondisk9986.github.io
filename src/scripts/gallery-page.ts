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
import { iconMarkup } from '../lib/icons';
import { cyanotypeCopy } from '../lib/cyanotype-copy';
import { captureFlip, playFlip } from './reorder-anim';

// 独立收藏数据池(由上方 JSON 标签注入,避免 define:vars 内联导致 TS 语法残留)
/** 查看器点击入口：委托监听只注册一次，始终指向「当前这一次页面实例」的实现 */
let galleryViewerHandler: ((button: HTMLButtonElement) => void) | null = null;

  document.addEventListener('astro:page-load', () => {

  // jsDelivr 镜像降级已上移到全站脚本 src/scripts/cdn-fallback.ts（由 BaseLayout 在 head 引入）。
  // 原实现绑在这里的 astro:page-load 内，每次客户端导航都会重复注册一个 error 监听器，
  // 且只覆盖图库页；现在全站共用一份、只注册一次。

  // astro:page-load:整页加载与每次 VT 导航后触发,重新初始化(打包脚本只执行一次,事件驱动每次导航执行)

  const themeText = (minimal: string, trace: string) =>
    document.documentElement.dataset.visualTheme === 'trace' ? trace : document.documentElement.dataset.visualTheme === 'cyanotype' ? (cyanotypeCopy[minimal] ?? minimal) : minimal;

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
  // 数据池：#journal-pool / #gallery-pool 由服务端序列化注入。
  // 时间线与独立照片两个视图原先由服务端渲染全部卡片（387 张里 369 张被分页 CSS 隐藏），
  // 现在改为客户端按页构建；position 记录原始顺序，供排序兜底与 data-gallery-position 使用。
  type PooledImage = GalleryImage & { position: number };
  const readPool = (id: string): PooledImage[] =>
    (JSON.parse(document.querySelector<HTMLElement>(id)?.textContent || '[]') as GalleryImage[])
      .map((image, position) => ({ ...image, position }));
  const journalPool = readPool('#journal-pool');
  const standalonePool = readPool('#gallery-pool');
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
      const cyanotype = label.querySelector<HTMLElement>('[data-theme-copy-cyanotype]');
      if (cyanotype) cyanotype.textContent = `${label.dataset.gallerySequenceCyanotypePrefix || ''}${sequence}`;
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

  const escapeHtml = (value: string) =>
    String(value).replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

  /** 与服务端 ThemeCopy 组件同构的三语文案结构（哪一份可见由主题 CSS 决定） */
  const themeCopyMarkup = (minimal: string, trace: string, cyanotype = cyanotypeCopy[minimal] ?? minimal) =>
    `<span class="theme-copy" data-theme-copy><span data-theme-copy-minimal>${escapeHtml(minimal)}</span>`
    + `<span data-theme-copy-trace>${escapeHtml(trace)}</span>`
    + `<span data-theme-copy-cyanotype>${escapeHtml(cyanotype)}</span></span>`;

  /**
   * 构建一张图库卡片。结构必须与原先服务端输出的 HTML 逐项一致
   * （data-* 契约、多语文案、编号），否则查看器 / 排序 / 主题切换都会失去依据。
   */
  function buildGalleryCard(image: PooledImage, sequenceIndex: number, variant: 'journal' | 'independent'): HTMLElement {
    const sequence = String(sequenceIndex + 1).padStart(2, '0');
    const article = document.createElement('article');
    article.className = 'gallery-card';
    article.dataset.galleryCard = '';
    article.dataset.galleryDate = image.date || '';
    article.dataset.galleryDaySequence = String(image.daySequence ?? 0);
    article.dataset.galleryPosition = String(image.position);

    const button = document.createElement('button');
    button.className = 'gallery-image-button';
    button.type = 'button';
    button.dataset.galleryOpen = '';
    button.dataset.gallerySrc = image.src;
    if (variant === 'independent') button.dataset.galleryOriginal = image.original || '';
    button.dataset.galleryAlt = image.alt || image.title;
    button.dataset.galleryTitle = image.title;
    button.dataset.galleryCaption = variant === 'journal'
      ? (image.caption || '')
      : (image.caption || image.alt);
    button.dataset.gallerySource = image.sourceUrl || '';
    button.dataset.gallerySourceTitle = image.sourceTitle || '';
    button.setAttribute('aria-label', variant === 'journal'
      ? `查看${image.title}中的${image.caption ?? ''}`
      : `查看${image.title}`);

    const img = document.createElement('img');
    img.src = image.thumb || image.src;
    img.alt = variant === 'journal' ? image.alt : (image.alt || image.title);
    img.loading = 'lazy'; // 两个视图默认都不可见，切换过去时再加载
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    button.appendChild(img);

    const stamp = document.createElement('span');
    stamp.className = 'gallery-image-stamp';
    stamp.textContent = sequence;
    button.appendChild(stamp);

    const expand = document.createElement('span');
    expand.className = 'gallery-image-expand';
    expand.setAttribute('aria-hidden', 'true');
    expand.innerHTML = iconMarkup('arrow-up-right');
    button.appendChild(expand);

    article.appendChild(button);

    const meta = document.createElement('div');
    meta.className = 'gallery-card-meta';
    const labels = document.createElement('div');
    if (variant === 'journal' && image.date) {
      const dateLabel = document.createElement('span');
      dateLabel.className = 'gallery-card-label';
      dateLabel.textContent = image.date;
      labels.appendChild(dateLabel);
    }
    if (image.daySequence && image.dayTotal) {
      const dayLabel = document.createElement('span');
      dayLabel.className = 'gallery-card-label';
      dayLabel.dataset.galleryDay = '';
      dayLabel.textContent = `D.${String(image.daySequence).padStart(2, '0')}/${String(image.dayTotal).padStart(2, '0')}`;
      labels.appendChild(dayLabel);
    }
    const seqLabel = document.createElement('span');
    seqLabel.className = 'gallery-card-label';
    seqLabel.dataset.gallerySequence = '';
    const prefix = variant === 'journal'
      ? { cyanotype: '切片 ', minimal: '图片 ', trace: 'FOLIO ' }
      : { cyanotype: '散页 ', minimal: '照片 ', trace: 'INDEPENDENT / ' };
    seqLabel.dataset.gallerySequenceCyanotypePrefix = prefix.cyanotype;
    seqLabel.dataset.gallerySequenceMinimalPrefix = prefix.minimal;
    seqLabel.dataset.gallerySequenceTracePrefix = prefix.trace;
    seqLabel.innerHTML = themeCopyMarkup(
      `${prefix.minimal}${sequence}`,
      `${prefix.trace}${sequence}`,
      `${prefix.cyanotype}${sequence}`,
    );
    labels.appendChild(seqLabel);
    meta.appendChild(labels);

    const heading = document.createElement('h2');
    heading.textContent = variant === 'journal' ? (image.caption || '') : image.title;
    meta.appendChild(heading);

    if (variant === 'journal') {
      const link = document.createElement('a');
      link.href = image.sourceUrl || '#';
      link.innerHTML = themeCopyMarkup(
        `阅读《${image.sourceTitle ?? ''}》`,
        `阅览《${image.sourceTitle ?? ''}》`,
        `回到手记《${image.sourceTitle ?? ''}》`,
      );
      meta.appendChild(link);
    } else {
      if (image.caption) {
        const caption = document.createElement('p');
        caption.textContent = image.caption;
        meta.appendChild(caption);
      }
      if (image.sourceUrl) {
        const link = document.createElement('a');
        link.href = image.sourceUrl;
        link.textContent = image.sourceTitle || '查看来源';
        meta.appendChild(link);
      }
    }

    article.appendChild(meta);
    return article;
  }

  /** 排序规则与原 DOM 排序完全一致：date 降序 → 日内序号降序 → 原始位置 */
  function sortPool(images: PooledImage[], order: GalleryOrder): PooledImage[] {
    return [...images].sort((a, b) => {
      const aTime = a.date ? Date.parse(a.date) : NaN;
      const bTime = b.date ? Date.parse(b.date) : NaN;
      const aHas = Number.isFinite(aTime);
      const bHas = Number.isFinite(bTime);
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas && aTime !== bTime) return order === 'newest' ? bTime - aTime : aTime - bTime;
      const aSeq = a.daySequence ?? 0;
      const bSeq = b.daySequence ?? 0;
      if (aHas && bHas && aSeq !== bSeq) return order === 'newest' ? bSeq - aSeq : aSeq - bSeq;
      return order === 'newest' ? a.position - b.position : b.position - a.position;
    });
  }

  let journalSorted: PooledImage[] = sortPool(journalPool, currentOrder);
  let independentSorted: PooledImage[] = sortPool(standalonePool, currentOrder);

  // 随文图像时间线视图:按每页 9 张分页显示(编号保持全局连续)
  function renderJournalPage() {
    if (!journalMasonry || !pager) return;
    const total = Math.max(1, Math.ceil(journalSorted.length / JOURNAL_PAGE_SIZE));
    journalPage = Math.min(Math.max(1, journalPage), total);
    const start = (journalPage - 1) * JOURNAL_PAGE_SIZE;
    const pageItems = journalSorted.slice(start, start + JOURNAL_PAGE_SIZE);
    journalMasonry.replaceChildren(...pageItems.map((image, i) => buildGalleryCard(image, start + i, 'journal')));
    if (pagerCurrent) pagerCurrent.textContent = String(journalPage).padStart(2, '0');
    if (pagerTotal) pagerTotal.textContent = String(total).padStart(2, '0');
    const prevBtn = pager.querySelector<HTMLButtonElement>('[data-gallery-page="prev"]');
    const nextBtn = pager.querySelector<HTMLButtonElement>('[data-gallery-page="next"]');
    if (prevBtn) prevBtn.disabled = journalPage <= 1;
    if (nextBtn) nextBtn.disabled = journalPage >= total;
    pager.hidden = journalView !== 'timeline' || journalSorted.length <= JOURNAL_PAGE_SIZE;
  }

  // 独立收藏:每页 9 张分页显示(编号保持全局连续)
  function renderIndependentPage() {
    if (!independentMasonry || !independentPager) return;
    const total = Math.max(1, Math.ceil(independentSorted.length / INDEPENDENT_PAGE_SIZE));
    independentPage = Math.min(Math.max(1, independentPage), total);
    const start = (independentPage - 1) * INDEPENDENT_PAGE_SIZE;
    const pageItems = independentSorted.slice(start, start + INDEPENDENT_PAGE_SIZE);
    independentMasonry.replaceChildren(...pageItems.map((image, i) => buildGalleryCard(image, start + i, 'independent')));
    if (independentPagerCurrent) independentPagerCurrent.textContent = String(independentPage).padStart(2, '0');
    if (independentPagerTotal) independentPagerTotal.textContent = String(total).padStart(2, '0');
    const prevBtn = independentPager.querySelector<HTMLButtonElement>('[data-independent-page="prev"]');
    const nextBtn = independentPager.querySelector<HTMLButtonElement>('[data-independent-page="next"]');
    if (prevBtn) prevBtn.disabled = independentPage <= 1;
    if (nextBtn) nextBtn.disabled = independentPage >= total;
    independentPager.hidden = independentSorted.length <= INDEPENDENT_PAGE_SIZE;
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

    // 时间线 / 独立照片两个视图的卡片改为客户端按需构建，
    // 因此排序直接在数据池上进行，随后由下面的分页渲染重建当前页。
    journalSorted = sortPool(journalPool, currentOrder);
    independentSorted = sortPool(standalonePool, currentOrder);

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
      // 卡片改为客户端构建，首次进入面板时才渲染当前页（此前由服务端渲染 99 张、其中 90 张被隐藏）
      if (!independentRendered) {
        independentRendered = true;
        renderIndependentPage();
      }
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
  let independentRendered = false; // 独立照片卡片同样懒渲染:首次进入面板才构建当前页

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
      ? `${themeText('阅读', '阅览')}《${button.dataset.gallerySourceTitle}》`
      : themeText('查看来源', '查看来源');
    viewerSource.insertAdjacentHTML('beforeend', iconMarkup('arrow-up-right'));
    if (viewerOriginalBtn) {
      viewerOriginalBtn.hidden = !originalUrl;
      viewerOriginalBtn.textContent = themeText('查看原图', '加载原图');
    }
    viewer.showModal();
    fitDialog();
  }

  // 客户端按页构建的卡片无法预先绑定点击，改用事件委托（广告牌 slide 由自身逻辑处理，故排除）。
  // 处理器每次导航后重新指向当前实例，避免闭包引用上一页已失效的 DOM。
  galleryViewerHandler = openGalleryViewer;
  if (!document.documentElement.dataset.galleryDelegated) {
    document.documentElement.dataset.galleryDelegated = '1';
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.('[data-gallery-open]:not(.gallery-billboard-slide)');
      if (button instanceof HTMLButtonElement) galleryViewerHandler?.(button);
    });
  }

  document.querySelector<HTMLButtonElement>('[data-gallery-close]')?.addEventListener('click', () => viewer?.close());
  viewer?.addEventListener('click', (event) => {
    if (event.target === viewer) viewer.close();
  });

  // 初始视图(默认 journal)的调用放在所有 let/const 声明之后,避免 TDZ(见上方注释)
  selectGalleryTab(location.hash === '#independent' ? 'independent' : 'journal', false);
  });
