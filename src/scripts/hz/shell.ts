/**
 * HORIZON · shell.ts
 * 负责全局外壳交互：VOID/PLATE 主题切换（含跨标签页/系统同步）、移动端全屏菜单（含焦点陷阱）、
 * 四角取景器实时读数（后台自动暂停）、触屏缩放锁（仅触控设备启用）、非 Speculation Rules 浏览器悬停预取兜底。
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

function syncThemeColor(theme: string) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#eae8e2' : '#08080b';
}

function initThemeToggle() {
  const btn = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  const syncBtnState = (theme: 'light' | 'dark') => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(theme === 'light'));
    btn.setAttribute(
      'aria-label',
      theme === 'light'
        ? '当前 PLATE 底片浅色，点击切换为 VOID 暗色'
        : '当前 VOID 暗色，点击切换为 PLATE 底片浅色',
    );
  };

  const getCurrent = (): 'light' | 'dark' =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

  const applyTheme = (next: 'light' | 'dark', persist: boolean) => {
    document.documentElement.dataset.theme = next;
    if (persist) {
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* 隐私模式下允许失败 */
      }
    }
    syncThemeColor(next);
    syncBtnState(next);
    document.dispatchEvent(new CustomEvent('hz:theme-change', { detail: { theme: next } }));
  };

  const initial = getCurrent();
  syncThemeColor(initial);
  syncBtnState(initial);

  // 跨标签页同步主题切换
  window.addEventListener('storage', (e) => {
    if (e.key !== 'theme') return;
    if (e.newValue === 'light' || e.newValue === 'dark') {
      if (getCurrent() !== e.newValue) applyTheme(e.newValue, false);
    }
  });

  // 未手动覆盖时跟随系统明暗变化
  const mql = matchMedia('(prefers-color-scheme: light)');
  mql.addEventListener?.('change', (e) => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('theme');
    } catch {
      /* ignore */
    }
    if (saved === 'light' || saved === 'dark') return;
    applyTheme(e.matches ? 'light' : 'dark', false);
  });

  if (!btn) return;

  btn.addEventListener('click', () => {
    const next = getCurrent() === 'light' ? 'dark' : 'light';
    const apply = () => applyTheme(next, true);

    const rect = btn.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width * 0.5);
    const y = Math.round(rect.top + rect.height * 0.5);
    const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)));

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) {
      const root = document.documentElement;
      root.style.setProperty('--vt-x', `${x}px`);
      root.style.setProperty('--vt-y', `${y}px`);
      root.style.setProperty('--vt-r', `${r}px`);
      root.dataset.vt = 'theme';
      const vt = document.startViewTransition(apply);
      vt.finished.finally(() => {
        if (root.dataset.vt === 'theme') delete root.dataset.vt;
      });
    } else {
      apply();
    }
  });
}

function initMenu() {
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  const openBtn = document.querySelector<HTMLButtonElement>('[data-menu-open]');
  const closeBtn = document.querySelector<HTMLButtonElement>('[data-menu-close]');
  if (!menu || !openBtn || !closeBtn) return;

  let closeTimer = 0;
  let lastFocused: HTMLElement | null = null;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const getFocusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.hidden && el.offsetParent !== null,
    );

  const setOpen = (open: boolean) => {
    window.clearTimeout(closeTimer);
    openBtn.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('hz-menu-open', open);

    if (open) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : openBtn;
      menu.hidden = false;
      menu.classList.remove('is-open');
      void menu.offsetWidth;
      requestAnimationFrame(() => {
        menu.classList.add('is-open');
      });
      closeBtn.focus();
    } else {
      menu.classList.remove('is-open');
      if (reduce()) {
        menu.hidden = true;
      } else {
        closeTimer = window.setTimeout(() => {
          if (!menu.classList.contains('is-open')) menu.hidden = true;
        }, 360);
      }
      (lastFocused && lastFocused.isConnected ? lastFocused : openBtn).focus();
      lastFocused = null;
    }
  };

  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));

  menu.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      menu.hidden = true;
      menu.classList.remove('is-open');
      openBtn.setAttribute('aria-expanded', 'false');
      document.documentElement.classList.remove('hz-menu-open');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') {
      const focusables = getFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function initReadouts() {
  const xyEl = document.querySelector<HTMLElement>('[data-ro-xy]');
  const depthEl = document.querySelector<HTMLElement>('[data-ro-depth]');
  const clockEl = document.querySelector<HTMLElement>('[data-ro-clock]');
  const mjdEl = document.querySelector<HTMLElement>('[data-ro-mjd]');

  const tickClock = () => {
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = `UTC ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())}`;
    }
    if (mjdEl) {
      const mjdVal = now.getTime() / 86400000 + 40587;
      mjdEl.textContent = `MJD ${mjdVal.toFixed(4)}`;
    }
  };

  if (clockEl || mjdEl) {
    let clockTimer = 0;
    const startClock = () => {
      tickClock();
      if (!clockTimer && !document.hidden) {
        clockTimer = window.setInterval(tickClock, 1000);
      }
    };
    const stopClock = () => {
      if (clockTimer) {
        window.clearInterval(clockTimer);
        clockTimer = 0;
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopClock();
      else startClock();
    });
    startClock();
  }

  let px = 0;
  let py = 0;
  let pointerRaf = 0;

  if (xyEl && matchMedia('(pointer: fine)').matches) {
    window.addEventListener(
      'pointermove',
      (e) => {
        px = Math.round(e.clientX);
        py = Math.round(e.clientY);
        if (!pointerRaf) {
          pointerRaf = requestAnimationFrame(() => {
            pointerRaf = 0;
            xyEl.textContent = `X ${String(px).padStart(4, '0')} · Y ${String(py).padStart(4, '0')}`;
          });
        }
      },
      { passive: true },
    );
  }

  if (depthEl) {
    let scrollRaf = 0;
    let cachedMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    let lastPct = -1;

    const refreshMax = () => {
      cachedMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };
    const syncDepth = () => {
      scrollRaf = 0;
      const pct = Math.min(100, Math.max(0, Math.round((window.scrollY / cachedMax) * 100)));
      if (pct !== lastPct) {
        lastPct = pct;
        depthEl.textContent = `DEPTH ${String(pct).padStart(3, '0')}%`;
      }
    };
    const req = () => {
      if (!scrollRaf) scrollRaf = requestAnimationFrame(syncDepth);
    };
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener(
      'resize',
      () => {
        refreshMax();
        req();
      },
      { passive: true },
    );
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        refreshMax();
        req();
      }).observe(document.body);
    }
    syncDepth();
  }
}

function initZoomLock() {
  // 仅在触控设备上启用（避免桌面端挂无意义的 document 级非 passive touch 监听）
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  if (!hasTouch) return;

  const blockGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener('gesturestart', blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
  document.addEventListener('gestureend', blockGesture, { passive: false });

  const blockMultiTouch = (e: TouchEvent) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  };
  document.addEventListener('touchstart', blockMultiTouch, { passive: false });
  document.addEventListener('touchmove', blockMultiTouch, { passive: false });

  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length > 0 || e.changedTouches.length !== 1) {
        lastTapTime = 0;
        return;
      }
      const target = e.target as Element | null;
      if (target?.closest('a, button, input, select, textarea, label, [role="button"], [data-field-stage], [data-viewer-media]')) {
        lastTapTime = 0;
        return;
      }
      const touch = e.changedTouches[0];
      const now = performance.now();
      if (now - lastTapTime < 320 && Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY) < 30) {
        e.preventDefault();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      lastTapX = touch.clientX;
      lastTapY = touch.clientY;
    },
    { passive: false },
  );
}

function initHoverPrefetchFallback() {
  // Chromium 已使用 <script type="speculationrules">；仅对不支持的浏览器做轻量悬停预取
  const supportsSpec =
    typeof HTMLScriptElement !== 'undefined' &&
    typeof (HTMLScriptElement as unknown as { supports?: (t: string) => boolean }).supports === 'function' &&
    (HTMLScriptElement as unknown as { supports: (t: string) => boolean }).supports('speculationrules');
  if (supportsSpec) return;

  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return;

  const prefetched = new Set<string>();
  const maybePrefetch = (target: EventTarget | null) => {
    const a = (target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;
    let url: URL;
    try {
      url = new URL(a.href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    if (/^\/(api|write|s|admin)(\/|$)/.test(url.pathname)) return;
    const key = url.pathname + url.search;
    if (prefetched.has(key) || prefetched.size >= 16) return;
    prefetched.add(key);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url.href;
    document.head.append(link);
  };

  document.addEventListener('pointerover', (e) => maybePrefetch(e.target), { passive: true });
  document.addEventListener('focusin', (e) => maybePrefetch(e.target), { passive: true });
}

initThemeToggle();
initMenu();
initReadouts();
initZoomLock();
initHoverPrefetchFallback();
