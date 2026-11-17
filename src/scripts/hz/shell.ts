/**
 * HORIZON · shell.ts
 * 负责全局外壳交互：VOID/PLATE 主题切换、移动端全屏菜单、四角取景器实时读数。
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

function syncThemeColor(theme: string) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#eae8e2' : '#08080b';
}

function initThemeToggle() {
  const btn = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  syncThemeColor(current);
  if (!btn) return;

  btn.addEventListener('click', () => {
    const now = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const next = now === 'light' ? 'dark' : 'light';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* 隐私模式下允许失败 */
      }
      syncThemeColor(next);
      document.dispatchEvent(new CustomEvent('hz:theme-change', { detail: { theme: next } }));
    };

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) {
      document.startViewTransition(apply);
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

  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('hz-menu-open', open);
    if (open) {
      closeBtn.focus();
    } else {
      openBtn.focus();
    }
  };

  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));

  menu.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      menu.hidden = true;
      document.documentElement.classList.remove('hz-menu-open');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
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
    tickClock();
    window.setInterval(tickClock, 1000);
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
    const syncDepth = () => {
      scrollRaf = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.min(100, Math.max(0, Math.round((window.scrollY / max) * 100)));
      depthEl.textContent = `DEPTH ${String(pct).padStart(3, '0')}%`;
    };
    const req = () => {
      if (!scrollRaf) scrollRaf = requestAnimationFrame(syncDepth);
    };
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req, { passive: true });
    syncDepth();
  }
}

function initZoomLock() {
  // 规避 iOS Safari / 移动端 WebView 忽略 viewport user-scalable=no：
  // 禁用全站网页级双指缩放与非交互区域双击放大，同时保留组件内自定义双指手势。
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

initThemeToggle();
initMenu();
initReadouts();
initZoomLock();
