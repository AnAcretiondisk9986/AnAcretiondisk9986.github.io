/**
 * HORIZON · motion.ts
 * 全站交互与视觉编排引擎：
 *   1. 跨文档 View Transition 方向判定（forward / back / channel）与顶栏光束反馈
 *   2. 导航栏、分段器 (.hz-seg)、图志标签 (.hz-gal-tabs) 的弹簧滑块指示器
 *   3. 大型视觉面板的光标光学聚光灯 (--mx / --my)
 *   4. 基于 IntersectionObserver 的滚动渐显编排（带安全兜底）
 *   5. 共享 FLIP 重排工具（供文章光谱、计价表等复用）
 */

const VT_DIR_KEY = 'hz-vt-dir';
const VT_FROM_KEY = 'hz-vt-from';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function pathDepth(pathname: string): number {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return 0;
  return clean.split('/').filter(Boolean).length;
}

function inferDirection(fromPath: string, toPath: string): 'forward' | 'back' | 'channel' {
  const dFrom = pathDepth(fromPath);
  const dTo = pathDepth(toPath);
  if (dTo > dFrom) return 'forward';
  if (dTo < dFrom) return 'back';
  return 'channel';
}

function initNavigationFeedback() {
  // 注入顶栏过渡扫光条
  if (!document.querySelector('.hz-nav-tracer')) {
    const tracer = document.createElement('div');
    tracer.className = 'hz-nav-tracer';
    tracer.setAttribute('aria-hidden', 'true');
    document.body.prepend(tracer);
  }

  // 恢复上一个页面记录的跳转方向（用于跨文档 View Transition）
  try {
    const dir = sessionStorage.getItem(VT_DIR_KEY);
    if (dir === 'forward' || dir === 'back' || dir === 'channel') {
      document.documentElement.dataset.vtDir = dir;
    }
  } catch {
    /* ignore */
  }

  window.addEventListener('pageswap', (e) => {
    const ev = e as unknown as { activation?: { navigationType?: string; entry?: { url?: string } }; viewTransition?: ViewTransition };
    if (!ev.viewTransition) return;
    const targetUrl = ev.activation?.entry?.url;
    if (!targetUrl) return;
    try {
      const nextPath = new URL(targetUrl, location.href).pathname;
      const dir = inferDirection(location.pathname, nextPath);
      document.documentElement.dataset.vtDir = dir;
      sessionStorage.setItem(VT_DIR_KEY, dir);
      sessionStorage.setItem(VT_FROM_KEY, location.pathname);
    } catch {
      /* ignore */
    }
  });

  window.addEventListener('pagereveal', (e) => {
    document.documentElement.classList.remove('is-navigating');
    const ev = e as unknown as { viewTransition?: ViewTransition };
    const vt = ev.viewTransition;
    if (vt?.finished) {
      vt.finished.finally(() => {
        delete document.documentElement.dataset.vtDir;
      });
    } else {
      delete document.documentElement.dataset.vtDir;
    }
  });

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const anchor = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    const rawHref = anchor.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;

    let url: URL;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;

    const dir = inferDirection(location.pathname, url.pathname);
    document.documentElement.dataset.vtDir = dir;
    try {
      sessionStorage.setItem(VT_DIR_KEY, dir);
      sessionStorage.setItem(VT_FROM_KEY, location.pathname);
    } catch {
      /* ignore */
    }

    if (!reduceMotion()) {
      document.documentElement.classList.add('is-navigating');
      window.setTimeout(() => {
        document.documentElement.classList.remove('is-navigating');
      }, 2400);
    }
  });

  window.addEventListener('pagehide', () => {
    document.documentElement.classList.remove('is-navigating');
  });
}

function attachSlidingGlider(
  container: HTMLElement,
  itemSelector: string,
  activeCheck: (el: HTMLElement) => boolean,
  gliderClass: string,
  mode: 'pill' | 'underline',
) {
  if (container.dataset.gliderBound === '1') return;
  container.dataset.gliderBound = '1';

  const glider = document.createElement('span');
  glider.className = gliderClass;
  glider.setAttribute('aria-hidden', 'true');
  container.classList.add('has-glider', 'is-glider-boot');
  container.prepend(glider);

  let hoverEl: HTMLElement | null = null;

  const position = (targetEl?: HTMLElement | null) => {
    const items = [...container.querySelectorAll<HTMLElement>(itemSelector)];
    const current = targetEl || items.find(activeCheck) || null;
    if (!current || current.offsetWidth === 0 || current.offsetHeight === 0) {
      glider.style.opacity = '0';
      return;
    }
    glider.style.opacity = '1';
    if (mode === 'underline') {
      glider.style.width = `${current.offsetWidth}px`;
      glider.style.transform = `translate3d(${current.offsetLeft}px, 0, 0)`;
    } else {
      glider.style.width = `${current.offsetWidth}px`;
      glider.style.height = `${current.offsetHeight}px`;
      glider.style.transform = `translate3d(${current.offsetLeft}px, ${current.offsetTop}px, 0)`;
    }
  };

  position();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.classList.remove('is-glider-boot');
    });
  });

  if (mode === 'underline') {
    container.querySelectorAll<HTMLElement>(itemSelector).forEach((item) => {
      item.addEventListener('pointerenter', () => {
        hoverEl = item;
        position(hoverEl);
      });
    });
    container.addEventListener('pointerleave', () => {
      hoverEl = null;
      position(null);
    });
  }

  const mo = new MutationObserver(() => position(hoverEl));
  mo.observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'aria-selected', 'aria-current'],
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => position(hoverEl)).observe(container);
  }
  window.addEventListener('resize', () => position(hoverEl), { passive: true });
}

function initSlidingIndicators() {
  const nav = document.querySelector<HTMLElement>('.hz-nav');
  if (nav) {
    attachSlidingGlider(
      nav,
      'a',
      (el) => el.getAttribute('aria-current') === 'page',
      'hz-nav__glider',
      'underline',
    );
  }

  document.querySelectorAll<HTMLElement>('.hz-seg').forEach((seg) => {
    attachSlidingGlider(
      seg,
      'button',
      (el) => el.getAttribute('aria-pressed') === 'true',
      'hz-seg-glider',
      'pill',
    );
  });

  document.querySelectorAll<HTMLElement>('.hz-gal-tabs').forEach((tabs) => {
    attachSlidingGlider(
      tabs,
      'button',
      (el) => el.getAttribute('aria-selected') === 'true',
      'hz-seg-glider',
      'pill',
    );
  });
}

function initSpotlight() {
  const selectors = [
    '.hz-dossier-teaser',
    '.hz-spec',
    '.hz-exam-cd',
    '.hz-exam-panel',
    '.hz-gate__box',
    '.hz-about-side',
    '.hz-freq',
    '.aq-card',
    '.pr-panel',
    '.hz-pager__link',
    '.hz-foot__word',
  ];

  const targets = document.querySelectorAll<HTMLElement>(selectors.join(','));
  targets.forEach((el) => {
    if (!el.hasAttribute('data-hz-spot')) el.setAttribute('data-hz-spot', '');
  });

  if (!matchMedia('(pointer: fine)').matches || reduceMotion()) return;

  let activeEl: HTMLElement | null = null;
  let lastX = 0;
  let lastY = 0;
  let raf = 0;

  const paint = () => {
    raf = 0;
    if (!activeEl) return;
    const rect = activeEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    activeEl.style.setProperty('--mx', `${(lastX - rect.left).toFixed(1)}px`);
    activeEl.style.setProperty('--my', `${(lastY - rect.top).toFixed(1)}px`);
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      const host = (e.target as Element | null)?.closest<HTMLElement>('[data-hz-spot]');
      if (!host) {
        activeEl = null;
        return;
      }
      activeEl = host;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    },
    { passive: true },
  );
}

function initReveals() {
  if (reduceMotion()) return;

  const groups: { selector: string; stagger: number; maxCap: number }[] = [
    { selector: '.hz-home-sec .hz-sect, .hz-home-sec .hz-dossier-teaser', stagger: 0, maxCap: 0 },
    { selector: '.hz-home-sec .hz-hplate', stagger: 70, maxCap: 280 },
    { selector: '.hz-ledger .hz-row', stagger: 36, maxCap: 280 },
    { selector: '.hz-spec, .hz-controls', stagger: 60, maxCap: 120 },
    { selector: '.hz-about-side, .hz-about-copy, .hz-ledger-box, .hz-freq', stagger: 65, maxCap: 240 },
    { selector: '.hz-mosaic .hz-tile', stagger: 12, maxCap: 320 },
    { selector: '.hz-sched-tele, .hz-sched-controls, .hz-sched-shell', stagger: 55, maxCap: 165 },
    { selector: '.hz-exam-deck, .hz-exam-panel, .hz-exam-controls', stagger: 60, maxCap: 180 },
    { selector: '.aq-board .aq-card', stagger: 55, maxCap: 330 },
    { selector: '.pr-panel', stagger: 80, maxCap: 240 },
    { selector: '.hz-foot__grid', stagger: 0, maxCap: 0 },
  ];

  const candidates: HTMLElement[] = [];
  const vh = window.innerHeight || 900;

  for (const g of groups) {
    const els = [...document.querySelectorAll<HTMLElement>(g.selector)];
    els.forEach((el, idx) => {
      if (el.dataset.hzRevealBound === '1') return;
      el.dataset.hzRevealBound = '1';
      el.setAttribute('data-hz-reveal', '');
      const rect = el.getBoundingClientRect();
      // 仅对初始视口线以下较远的元素应用待显状态，避免首屏闪动或遮挡
      if (rect.top > vh * 0.96) {
        const delay = Math.min(g.maxCap, idx * g.stagger);
        el.style.setProperty('--hz-delay', `${delay}ms`);
        el.classList.add('is-pending');
        candidates.push(el);
      } else {
        el.classList.add('is-revealed');
      }
    });
  }

  if (candidates.length === 0) return;

  const revealEl = (el: HTMLElement) => {
    el.classList.remove('is-pending');
    el.classList.add('is-revealed');
  };

  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          revealEl(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '90px 0px -12px 0px', threshold: 0.01 },
    );
    candidates.forEach((el) => io.observe(el));

    // 安全兜底：确保打印或极端视口情况下不会永久隐藏
    window.addEventListener(
      'beforeprint',
      () => {
        candidates.forEach(revealEl);
      },
      { once: true },
    );
  } else {
    candidates.forEach(revealEl);
  }
}

/**
 * 通用 FLIP 重排动画工具：捕获元素初始位置并在 DOM 变更后平滑过渡到新位置
 */
export function captureFlipRects(elements: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>();
  if (reduceMotion()) return rects;
  for (const el of elements) {
    if (el.offsetParent === null) continue;
    rects.set(el, el.getBoundingClientRect());
  }
  return rects;
}

export function playFlipRects(
  elements: Iterable<HTMLElement>,
  firstRects: Map<HTMLElement, DOMRect>,
  duration = 420,
) {
  if (reduceMotion() || firstRects.size === 0) return;
  const moving: { el: HTMLElement; dx: number; dy: number }[] = [];
  for (const el of elements) {
    if (el.offsetParent === null) continue;
    const first = firstRects.get(el);
    if (!first) continue;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    moving.push({ el, dx, dy });
  }
  if (moving.length === 0) return;

  for (const { el, dx, dy } of moving) {
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }
  // 强制回流使补偿位移立即可见
  void moving[0].el.offsetWidth;
  requestAnimationFrame(() => {
    for (const { el } of moving) {
      el.style.transition = `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`;
      el.style.transform = '';
      window.setTimeout(() => {
        if (el.style.transition.includes('cubic-bezier(0.16, 1, 0.3, 1)')) {
          el.style.transition = '';
        }
      }, duration + 40);
    }
  });
}

export function replayEnter(el: HTMLElement | null) {
  if (!el || reduceMotion()) return;
  el.classList.remove('hz-view-enter');
  void el.offsetWidth;
  el.classList.add('hz-view-enter');
}

initNavigationFeedback();
initSlidingIndicators();
initSpotlight();
initReveals();
