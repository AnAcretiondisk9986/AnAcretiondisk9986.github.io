/**
 * HORIZON · motion.ts
 * 全站交互与光效编排引擎：
 *   1. 跨文档 View Transition 方向判定与高能等离子扫光反馈
 *   2. 全站实时 2D 相对论粒子与引力弧光场 ([data-hz-cosmos])
 *   3. 光标光学晕影 (.hz-cursor-aura) 与点击爱因斯坦环冲击波 (.hz-shockwave)
 *   4. 导航栏、分段器、图志标签的弹簧滑块指示器
 *   5. 大型卡片/列表/面板的双层边缘光追踪 (--mx/--my) 与 3D 光学倾角 (--tilt-x/--tilt-y)
 *   6. 按钮磁吸微交互 (.hz-btn, .hz-foot__top) 与滚动深度视差
 *   7. 基于 IntersectionObserver 的滚动渐显编排与遥测数字锁定动画
 *   8. 共享 FLIP 重排工具
 */

const VT_DIR_KEY = 'hz-vt-dir';
const VT_FROM_KEY = 'hz-vt-from';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => matchMedia('(pointer: fine)').matches;

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
  if (!document.querySelector('.hz-nav-tracer')) {
    const tracer = document.createElement('div');
    tracer.className = 'hz-nav-tracer';
    tracer.setAttribute('aria-hidden', 'true');
    document.body.prepend(tracer);
  }

  try {
    const dir = sessionStorage.getItem(VT_DIR_KEY);
    if (dir === 'forward' || dir === 'back' || dir === 'channel') {
      document.documentElement.dataset.vtDir = dir;
    }
  } catch {
    /* ignore */
  }

  window.addEventListener('pageswap', (e) => {
    const ev = e as unknown as {
      activation?: { navigationType?: string; entry?: { url?: string } };
      viewTransition?: ViewTransition;
    };
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

function initCosmosField() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-hz-cosmos]');
  if (!canvas) return;
  if (reduceMotion()) {
    canvas.style.display = 'none';
    return;
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const hero = document.querySelector<HTMLElement>('[data-hero]');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let isLight = document.documentElement.dataset.theme === 'light';

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = Math.max(1, window.innerWidth);
    h = Math.max(1, window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  document.addEventListener('hz:theme-change', (e) => {
    isLight = (e as CustomEvent<{ theme?: string }>).detail?.theme === 'light';
  });

  interface Star {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    r: number;
    tone: 0 | 1 | 2;
    phase: number;
  }

  const COUNT = 76;
  const stars: Star[] = Array.from({ length: COUNT }, (_, i) => ({
    x: Math.random() * w,
    y: Math.random() * h,
    z: 0.25 + Math.random() * 0.85,
    vx: (Math.random() - 0.5) * 0.16,
    vy: -0.06 - Math.random() * 0.22,
    r: 0.7 + Math.random() * 1.45,
    tone: (i % 7 === 0 ? 1 : i % 5 === 0 ? 2 : 0) as 0 | 1 | 2,
    phase: Math.random() * Math.PI * 2,
  }));

  let px = -9999;
  let py = -9999;
  let pointerOn = false;
  if (finePointer()) {
    window.addEventListener(
      'pointermove',
      (e) => {
        px = e.clientX;
        py = e.clientY;
        pointerOn = true;
      },
      { passive: true },
    );
    window.addEventListener(
      'pointerleave',
      () => {
        pointerOn = false;
      },
      { passive: true },
    );
  }

  let lastScrollY = window.scrollY;
  let scrollVel = 0;
  let pulseEnergy = 0;

  window.addEventListener(
    'pointerdown',
    () => {
      pulseEnergy = Math.min(1.4, pulseEnergy + 0.85);
    },
    { passive: true },
  );

  const syncVisibilityFade = () => {
    if (!hero || hero.dataset.diskMode === 'fallback') {
      canvas.style.opacity = '0.95';
      return 1;
    }
    const hh = Math.max(1, hero.offsetHeight);
    const ratio = Math.min(1, Math.max(0, (window.scrollY - hh * 0.22) / (hh * 0.52)));
    canvas.style.opacity = ratio.toFixed(3);
    return ratio;
  };

  let raf = 0;
  let lastT = performance.now();

  const frame = (now: number) => {
    raf = 0;
    if (document.hidden) return;

    const dt = Math.min(0.05, Math.max(0.008, (now - lastT) * 0.001));
    lastT = now;

    const sy = window.scrollY;
    const rawVel = (sy - lastScrollY) / Math.max(dt, 0.008);
    lastScrollY = sy;
    scrollVel += (Math.max(-2200, Math.min(2200, rawVel)) - scrollVel) * 0.14;
    pulseEnergy *= Math.pow(0.08, dt);

    const fade = syncVisibilityFade();
    if (fade <= 0.02) {
      raf = requestAnimationFrame(frame);
      return;
    }

    ctx.clearRect(0, 0, w, h);

    // 淡雅轨道引力弧线（背景天文仪刻度）
    const cx = w * 0.72;
    const cy = h * 0.42 - sy * 0.04;
    const t = now * 0.00025;
    ctx.lineWidth = 0.85;
    for (let ring = 0; ring < 3; ring++) {
      const radius = Math.min(w, h) * (0.28 + ring * 0.16);
      const start = t * (ring % 2 === 0 ? 1 : -0.7) + ring * 1.7;
      const span = 1.15 + ring * 0.25;
      ctx.strokeStyle = isLight
        ? ring === 1
          ? 'rgba(47, 91, 211, 0.09)'
          : 'rgba(228, 67, 10, 0.09)'
        : ring === 1
          ? 'rgba(143, 179, 255, 0.10)'
          : 'rgba(255, 90, 26, 0.11)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + span);
      ctx.stroke();
    }

    const warpLen = Math.min(34, Math.abs(scrollVel) * 0.024 + pulseEnergy * 9);

    for (const s of stars) {
      s.x += (s.vx * 34 + (s.z - 0.5) * 4) * dt;
      s.y += (s.vy * 42 - scrollVel * 0.045 * s.z) * dt;

      if (s.x < -12) s.x += w + 24;
      else if (s.x > w + 12) s.x -= w + 24;
      if (s.y < -16) s.y += h + 32;
      else if (s.y > h + 16) s.y -= h + 32;

      let drawX = s.x;
      let drawY = s.y;
      let boost = 0;

      if (pointerOn) {
        const dx = drawX - px;
        const dy = drawY - py;
        const dist2 = dx * dx + dy * dy;
        const maxR = 230;
        if (dist2 < maxR * maxR && dist2 > 9) {
          const dist = Math.sqrt(dist2);
          const pull = 1 - dist / maxR;
          boost = pull * 0.85;
          // 切向引力偏折 + 轻微向外透镜推开
          const inv = 1 / dist;
          drawX += (dx * inv * 14 - dy * inv * 10) * pull;
          drawY += (dy * inv * 14 + dx * inv * 10) * pull;
        }
      }

      const twinkle = 0.58 + 0.42 * Math.sin(now * 0.0022 + s.phase);
      const alpha = Math.min(0.95, (0.22 + 0.42 * s.z) * twinkle + boost * 0.45 + pulseEnergy * 0.16);

      let color: string;
      if (isLight) {
        color =
          s.tone === 1
            ? `rgba(228, 67, 10, ${alpha.toFixed(3)})`
            : s.tone === 2
              ? `rgba(47, 91, 211, ${alpha.toFixed(3)})`
              : `rgba(13, 13, 16, ${(alpha * 0.52).toFixed(3)})`;
      } else {
        color =
          s.tone === 1
            ? `rgba(255, 118, 56, ${alpha.toFixed(3)})`
            : s.tone === 2
              ? `rgba(143, 179, 255, ${alpha.toFixed(3)})`
              : `rgba(255, 241, 214, ${(alpha * 0.85).toFixed(3)})`;
      }

      if (warpLen > 1.8) {
        ctx.strokeStyle = color;
        ctx.lineWidth = s.r * (0.9 + boost * 0.6);
        ctx.beginPath();
        ctx.moveTo(drawX, drawY);
        ctx.lineTo(drawX, drawY + (scrollVel >= 0 ? 1 : -1) * warpLen * s.z);
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(drawX, drawY, s.r * (1 + boost * 0.75), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (!raf && !document.hidden) {
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
}

function initCursorEffects() {
  if (reduceMotion()) return;

  // 点击引力冲击波（桌面与移动端均触发）
  const shockLayer = document.createElement('div');
  shockLayer.className = 'hz-shock-layer';
  shockLayer.setAttribute('aria-hidden', 'true');
  document.body.append(shockLayer);

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button > 0) return;
      if (shockLayer.childElementCount >= 6) {
        shockLayer.firstElementChild?.remove();
      }
      const wave = document.createElement('span');
      wave.className = 'hz-shockwave';
      wave.style.left = `${e.clientX}px`;
      wave.style.top = `${e.clientY}px`;
      shockLayer.append(wave);
      const clean = () => wave.remove();
      wave.addEventListener('animationend', clean, { once: true });
      window.setTimeout(clean, 660);
    },
    { passive: true },
  );

  if (!finePointer()) return;

  // 游标光学晕影 + 顶栏高光跟踪
  const aura = document.createElement('div');
  aura.className = 'hz-cursor-aura';
  aura.setAttribute('aria-hidden', 'true');
  document.body.append(aura);

  const hud = document.querySelector<HTMLElement>('[data-hud]');

  let tx = window.innerWidth * 0.5;
  let ty = window.innerHeight * 0.5;
  let cx = tx;
  let cy = ty;
  let raf = 0;

  const tick = () => {
    raf = 0;
    const dx = tx - cx;
    const dy = ty - cy;
    cx += dx * 0.16;
    cy += dy * 0.16;
    const speed = Math.min(28, Math.hypot(dx, dy));
    const stretch = 1 + speed * 0.012;
    const angle = Math.atan2(dy, dx);
    aura.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) rotate(${angle.toFixed(3)}rad) scaleX(${stretch.toFixed(3)})`;
    if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35) {
      raf = requestAnimationFrame(tick);
    }
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      tx = e.clientX;
      ty = e.clientY;
      aura.classList.add('is-active');
      if (hud) {
        hud.style.setProperty('--hud-mx', `${e.clientX.toFixed(0)}px`);
      }
      if (!raf) raf = requestAnimationFrame(tick);
    },
    { passive: true },
  );

  document.addEventListener(
    'pointerleave',
    () => {
      aura.classList.remove('is-active');
    },
    { passive: true },
  );
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

function initSpotlightAndTilt() {
  const spotSelectors = [
    '.hz-dossier-teaser',
    '.hz-spec',
    '.hz-exam-cd',
    '.hz-exam-panel',
    '.hz-exam-card',
    '.hz-exam-kpi',
    '.hz-gate__box',
    '.hz-about-side',
    '.hz-freq',
    '.aq-card',
    '.pr-panel',
    '.hz-pager__link',
    '.hz-hplate',
    '.hz-iplate',
    '.hz-row',
    '.hz-sched-tele__cell',
  ];
  const tiltSelectors = [
    '.hz-dossier-teaser',
    '.hz-hplate',
    '.hz-iplate',
    '.hz-exam-card',
    '.hz-about-side',
    '.aq-card',
    '.hz-pager__link',
  ];

  const spotQuery = spotSelectors.join(',');
  const tiltQuery = tiltSelectors.join(',');

  const stamp = (root: ParentNode = document) => {
    root.querySelectorAll<HTMLElement>(spotQuery).forEach((el) => {
      if (!el.hasAttribute('data-hz-spot')) el.setAttribute('data-hz-spot', '');
    });
    if (finePointer() && !reduceMotion()) {
      root.querySelectorAll<HTMLElement>(tiltQuery).forEach((el) => {
        if (!el.hasAttribute('data-hz-tilt')) el.setAttribute('data-hz-tilt', '');
      });
    }
  };
  stamp();

  if (!finePointer() || reduceMotion()) return;

  let activeSpot: HTMLElement | null = null;
  let activeTilt: HTMLElement | null = null;
  let lastTilt: HTMLElement | null = null;
  let lastX = 0;
  let lastY = 0;
  let raf = 0;

  const clearTilt = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty('--tilt-x');
    el.style.removeProperty('--tilt-y');
  };

  const paint = () => {
    raf = 0;
    if (lastTilt && lastTilt !== activeTilt) {
      clearTilt(lastTilt);
      lastTilt = null;
    }
    if (activeSpot) {
      const rect = activeSpot.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const lx = lastX - rect.left;
        const ly = lastY - rect.top;
        activeSpot.style.setProperty('--mx', `${lx.toFixed(1)}px`);
        activeSpot.style.setProperty('--my', `${ly.toFixed(1)}px`);

        if (activeTilt === activeSpot) {
          const nx = Math.max(-1, Math.min(1, (lx / rect.width - 0.5) * 2));
          const ny = Math.max(-1, Math.min(1, (ly / rect.height - 0.5) * 2));
          const maxDeg = rect.width > 560 ? 2.6 : 5.2;
          activeTilt.style.setProperty('--tilt-x', `${(-ny * maxDeg).toFixed(2)}deg`);
          activeTilt.style.setProperty('--tilt-y', `${(nx * maxDeg).toFixed(2)}deg`);
          lastTilt = activeTilt;
        }
      }
    } else if (activeTilt) {
      const rect = activeTilt.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = Math.max(-1, Math.min(1, ((lastX - rect.left) / rect.width - 0.5) * 2));
        const ny = Math.max(-1, Math.min(1, ((lastY - rect.top) / rect.height - 0.5) * 2));
        const maxDeg = rect.width > 560 ? 2.6 : 5.2;
        activeTilt.style.setProperty('--tilt-x', `${(-ny * maxDeg).toFixed(2)}deg`);
        activeTilt.style.setProperty('--tilt-y', `${(nx * maxDeg).toFixed(2)}deg`);
        lastTilt = activeTilt;
      }
    }
  };

  document.addEventListener(
    'pointerover',
    (e) => {
      const target = e.target as Element | null;
      const spotMatch = target?.closest<HTMLElement>(spotQuery);
      if (spotMatch && !spotMatch.hasAttribute('data-hz-spot')) {
        spotMatch.setAttribute('data-hz-spot', '');
      }
      const tiltMatch = target?.closest<HTMLElement>(tiltQuery);
      if (tiltMatch && !tiltMatch.hasAttribute('data-hz-tilt')) {
        tiltMatch.setAttribute('data-hz-tilt', '');
      }
    },
    { passive: true },
  );

  document.addEventListener(
    'pointermove',
    (e) => {
      const target = e.target as Element | null;
      const footWord = target?.closest<HTMLElement>('.hz-foot__word');
      const spotHost = footWord || target?.closest<HTMLElement>('[data-hz-spot]') || null;
      const tiltHost = target?.closest<HTMLElement>('[data-hz-tilt]') || null;

      activeSpot = spotHost;
      activeTilt = tiltHost;
      lastX = e.clientX;
      lastY = e.clientY;

      if (!activeSpot && !activeTilt && !lastTilt) return;
      if (!raf) raf = requestAnimationFrame(paint);
    },
    { passive: true },
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      if (!lastTilt) return;
      const rel = e.relatedTarget as Element | null;
      if (!rel || !lastTilt.contains(rel)) {
        clearTilt(lastTilt);
        lastTilt = null;
        if (activeTilt && !activeTilt.contains(rel)) activeTilt = null;
      }
    },
    { passive: true },
  );
}

function initMagnetics() {
  if (!finePointer() || reduceMotion()) return;
  const selector = '.hz-btn, .hz-foot__top';

  let activeBtn: HTMLElement | null = null;
  let bx = 0;
  let by = 0;
  let raf = 0;

  const paint = () => {
    raf = 0;
    if (!activeBtn) return;
    const rect = activeBtn.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = ((bx - (rect.left + rect.width * 0.5)) / Math.max(1, rect.width * 0.5)) * 5;
    const dy = ((by - (rect.top + rect.height * 0.5)) / Math.max(1, rect.height * 0.5)) * 4;
    activeBtn.style.setProperty('--mag-x', `${Math.max(-5, Math.min(5, dx)).toFixed(2)}px`);
    activeBtn.style.setProperty('--mag-y', `${Math.max(-4, Math.min(4, dy)).toFixed(2)}px`);
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLElement>(selector) || null;
      if (activeBtn && activeBtn !== btn) {
        activeBtn.style.removeProperty('--mag-x');
        activeBtn.style.removeProperty('--mag-y');
      }
      activeBtn = btn;
      if (!activeBtn) return;
      bx = e.clientX;
      by = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    },
    { passive: true },
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      if (!activeBtn) return;
      const rel = e.relatedTarget as Element | null;
      if (!rel || !activeBtn.contains(rel)) {
        activeBtn.style.removeProperty('--mag-x');
        activeBtn.style.removeProperty('--mag-y');
        activeBtn = null;
      }
    },
    { passive: true },
  );
}

function initScrollTelemetry() {
  const root = document.documentElement;
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const heroInner = hero?.querySelector<HTMLElement>('.hz-hero__inner') ?? null;

  let scrollTimer = 0;
  let raf = 0;

  const sync = () => {
    raf = 0;
    const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    root.style.setProperty('--hz-scroll-p', p.toFixed(4));

    if (hero && heroInner && !reduceMotion()) {
      const hh = Math.max(1, hero.offsetHeight);
      const hp = Math.min(1, Math.max(0, window.scrollY / (hh * 0.85)));
      if (hp <= 0.002) {
        heroInner.style.removeProperty('transform');
        heroInner.style.removeProperty('opacity');
      } else {
        heroInner.style.transform = `translate3d(0, ${(hp * 42).toFixed(1)}px, 0) scale(${(1 - hp * 0.035).toFixed(4)})`;
        heroInner.style.opacity = `${Math.max(0.08, 1 - hp * 0.88).toFixed(3)}`;
      }
    }
  };

  const onScroll = () => {
    root.classList.add('is-scrolling');
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      root.classList.remove('is-scrolling');
    }, 180);
    if (!raf) raf = requestAnimationFrame(sync);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    if (!raf) raf = requestAnimationFrame(sync);
  }, { passive: true });
  sync();
}

function initReveals() {
  if (reduceMotion()) return;

  const groups: { selector: string; stagger: number; maxCap: number }[] = [
    { selector: '.hz-home-sec .hz-sect, .hz-home-sec .hz-dossier-teaser', stagger: 0, maxCap: 0 },
    { selector: '.hz-home-sec .hz-hplate', stagger: 80, maxCap: 320 },
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
      { rootMargin: '110px 0px -8px 0px', threshold: 0.01 },
    );
    candidates.forEach((el) => io.observe(el));

    // 安全兜底：滚动经过或打印时确保任何已进入/经过视口的元素都显影
    let sweepRaf = 0;
    const sweepPending = () => {
      sweepRaf = 0;
      const curVh = window.innerHeight || 900;
      for (const el of candidates) {
        if (!el.classList.contains('is-pending') || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top < curVh * 1.04) {
          revealEl(el);
          io.unobserve(el);
        }
      }
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!sweepRaf) sweepRaf = requestAnimationFrame(sweepPending);
      },
      { passive: true },
    );
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

function initTelemetryScramble() {
  if (reduceMotion()) return;
  const targets = [
    ...document.querySelectorAll<HTMLElement>('.hz-hero__tele b'),
    ...document.querySelectorAll<HTMLElement>('.hz-exam-kpi__val'),
  ];
  if (targets.length === 0) return;

  targets.forEach((el, idx) => {
    const textNode = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (!textNode || !textNode.textContent) return;
    const finalStr = textNode.textContent.trim();
    const match = finalStr.match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (!match) return;
    const targetVal = Number(match[1]);
    const suffix = match[2] || '';
    const decimals = match[1].includes('.') ? match[1].split('.')[1].length : 0;
    if (!Number.isFinite(targetVal) || targetVal <= 0) return;

    const delay = 220 + idx * 70;
    const dur = 580;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const t0 = performance.now() + delay;
      const tick = (now: number) => {
        if (now < t0) {
          requestAnimationFrame(tick);
          return;
        }
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const cur = targetVal * eased;
        textNode.textContent = (decimals > 0 ? cur.toFixed(decimals) : String(Math.round(cur))) + suffix;
        if (p < 1) {
          requestAnimationFrame(tick);
        } else {
          textNode.textContent = finalStr;
        }
      };
      requestAnimationFrame(tick);
    };

    const rect = el.getBoundingClientRect();
    if (rect.top < (window.innerHeight || 900) * 1.1) {
      run();
    } else if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) {
            run();
            io.disconnect();
          }
        },
        { threshold: 0.1 },
      );
      io.observe(el);
    }
  });
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
  duration = 440,
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
initCosmosField();
initCursorEffects();
initSlidingIndicators();
initSpotlightAndTilt();
initMagnetics();
initScrollTelemetry();
initReveals();
initTelemetryScramble();
