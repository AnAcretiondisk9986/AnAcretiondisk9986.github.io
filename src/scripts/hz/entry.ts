/**
 * HORIZON · entry.ts
 * 文章页交互：
 *   - 目录生成 + 稳定滚动联动（自动将当前目录项滚入侧栏可视区 + aria-current）
 *   - 阅读进度条 + 侧栏折叠（[ 快捷键） + 正文字号三档调节（localStorage 持久化）
 *   - 正文图片高清查看灯箱（支持上一张/下一张、100%~400% 缩放、滚轮/双指/双击缩放、拖拽平移、触控滑动、焦点恢复）
 *   - 表格横向滚动包装、代码块语言探测与复制、短链开关与即点即复制、智能返回筛选态、打印、不蒜子统计
 * 门禁解锁后（hz:gate-unlocked）会自动重新扫描正文。
 */

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => legacyCopy(text),
    );
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let katexLoading: Promise<typeof import('katex')> | null = null;

function ensureKatexAssets(): Promise<typeof import('katex')> {
  if (!document.querySelector('link[data-hz-katex]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/vendor/katex/katex.min.css';
    link.dataset.hzKatex = '1';
    document.head.append(link);
  }
  if (!katexLoading) katexLoading = import('katex');
  return katexLoading;
}

function hydrateRichProseBlocks(prose: HTMLElement) {
  const CALLOUT_TITLES: Record<string, string> = {
    note: '📝 NOTE',
    tip: '💡 TIP',
    warn: '⚠ WARNING',
    danger: '❗ CAUTION',
    quote: '❝ QUOTE',
  };
  prose.querySelectorAll<HTMLElement>('.hz-callout').forEach((box) => {
    if (box.querySelector(':scope > .hz-callout__head')) return;
    const title = box.dataset.title?.trim() || CALLOUT_TITLES[box.dataset.callout || 'note'] || '📝 NOTE';
    const head = document.createElement('div');
    head.className = 'hz-callout__head';
    head.textContent = title;
    box.prepend(head);
  });

  const mathEls = [...prose.querySelectorAll<HTMLElement>('.hz-math[data-tex], .hz-math-block[data-tex]')];
  if (mathEls.length > 0) {
    ensureKatexAssets()
      .then((mod) => {
        const katex = mod.default || (mod as unknown as { render: (t: string, el: HTMLElement, opts?: object) => void });
        mathEls.forEach((el) => {
          if (el.dataset.mathRendered === '1') return;
          const tex = el.dataset.tex || '';
          const displayMode = el.classList.contains('hz-math-block');
          try {
            katex.render(tex, el, { displayMode, throwOnError: false, strict: false });
            el.dataset.mathRendered = '1';
          } catch {
            el.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
          }
        });
      })
      .catch(() => {});
  }
}

/* ── 正文图片查看灯箱 ──────────────────────────────────────────────────────── */
interface EntryViewerApi {
  bindProse(prose: HTMLElement): void;
}

function createEntryViewer(): EntryViewerApi | null {
  const dialog = document.getElementById('hz-entry-viewer') as HTMLDialogElement | null;
  if (!dialog) return null;

  const vMedia = dialog.querySelector<HTMLElement>('[data-ev-media]');
  const vImg = dialog.querySelector<HTMLImageElement>('[data-ev-img]');
  const vPrev = dialog.querySelector<HTMLButtonElement>('[data-ev-prev]');
  const vNext = dialog.querySelector<HTMLButtonElement>('[data-ev-next]');
  const vClose = dialog.querySelector<HTMLButtonElement>('[data-ev-close]');
  const vCounter = dialog.querySelector<HTMLElement>('[data-ev-counter]');
  const vZoom = dialog.querySelector<HTMLInputElement>('[data-ev-zoom]');
  const vZoomVal = dialog.querySelector<HTMLElement>('[data-ev-zoom-val]');
  const vReset = dialog.querySelector<HTMLButtonElement>('[data-ev-reset]');
  const vCap = dialog.querySelector<HTMLElement>('[data-ev-cap]');
  if (!vMedia || !vImg) return null;

  let images: HTMLImageElement[] = [];
  let activeIdx = 0;
  let lastTrigger: HTMLElement | null = null;

  const MIN_ZOOM = 100;
  const MAX_ZOOM = 400;
  let zoomPct = 100;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let swipeDownX = 0;
  let swipeDownY = 0;
  let justMoved = false;
  let prevPinchDist = 0;
  let prevPinchMidX = 0;
  let prevPinchMidY = 0;
  const pointers = new Map<number, { x: number; y: number }>();

  const clampPan = () => {
    if (zoomPct <= 100.5) {
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
    const scale = zoomPct / 100;
    vImg.style.transform = `translate3d(${panX.toFixed(1)}px, ${panY.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
    vMedia.classList.toggle('can-pan', zoomPct > 100.5);
    if (vZoom) vZoom.value = String(Math.round(zoomPct));
    if (vZoomVal) vZoomVal.textContent = `${Math.round(zoomPct)}%`;
  };

  const setZoom = (nextRaw: number, clientX?: number, clientY?: number) => {
    const prevScale = zoomPct / 100;
    const nextZoom = clamp(nextRaw, MIN_ZOOM, MAX_ZOOM);
    const nextScale = nextZoom / 100;
    if (clientX !== undefined && clientY !== undefined && Math.abs(nextScale - prevScale) > 1e-4) {
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

  const showAt = (idx: number) => {
    if (images.length === 0) return;
    activeIdx = ((idx % images.length) + images.length) % images.length;
    const srcImg = images[activeIdx];
    pointers.clear();
    dragging = false;
    vMedia.classList.remove('is-dragging');
    resetZoom();

    const src = srcImg.currentSrc || srcImg.src;
    const figCaption = srcImg.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || '';
    const caption = srcImg.alt?.trim() || figCaption || `图片 ${pad2(activeIdx + 1)}`;

    vImg.src = src;
    vImg.alt = caption;
    if (vCounter) vCounter.textContent = `${pad2(activeIdx + 1)} / ${pad2(images.length)}`;
    if (vPrev) vPrev.disabled = images.length <= 1;
    if (vNext) vNext.disabled = images.length <= 1;
    if (vCap) vCap.textContent = caption;
  };

  const openAt = (idx: number, trigger: HTMLElement) => {
    lastTrigger = trigger;
    showAt(idx);
    if (!dialog.open) dialog.showModal();
  };

  vClose?.addEventListener('click', () => dialog.close());
  vPrev?.addEventListener('click', () => showAt(activeIdx - 1));
  vNext?.addEventListener('click', () => showAt(activeIdx + 1));
  vReset?.addEventListener('click', resetZoom);
  vZoom?.addEventListener('input', () => setZoom(Number(vZoom.value) || MIN_ZOOM));
  vImg.addEventListener('load', () => {
    clampPan();
    applyTransform();
  });

  vMedia.addEventListener('dblclick', (e) => {
    setZoom(zoomPct > 120 ? 100 : 200, e.clientX, e.clientY);
  });
  vMedia.addEventListener('click', (e) => {
    if (justMoved) {
      justMoved = false;
      return;
    }
    if (e.target === vMedia && zoomPct <= 100.5) dialog.close();
  });
  vMedia.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.0085 : 0.0022));
      setZoom(zoomPct * factor, e.clientX, e.clientY);
    },
    { passive: false },
  );

  vMedia.addEventListener('pointerdown', (e) => {
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
  vMedia.addEventListener('pointermove', (e) => {
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

  const endPtr = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const wasSingleUnzoomed = pointers.size === 1 && zoomPct <= 100.5 && images.length > 1;
    const dx = e.clientX - swipeDownX;
    const dy = e.clientY - swipeDownY;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) prevPinchDist = 0;
    if (pointers.size === 0) {
      dragging = false;
      vMedia.classList.remove('is-dragging');
      justMoved = Math.hypot(dx, dy) > 8;
      if (wasSingleUnzoomed && e.type === 'pointerup' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        showAt(dx < 0 ? activeIdx + 1 : activeIdx - 1);
      }
    }
  };
  vMedia.addEventListener('pointerup', endPtr);
  vMedia.addEventListener('pointercancel', endPtr);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    pointers.clear();
    dragging = false;
    vMedia.classList.remove('is-dragging');
    resetZoom();
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
    lastTrigger = null;
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showAt(activeIdx - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showAt(activeIdx + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      showAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      showAt(images.length - 1);
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
    bindProse(prose: HTMLElement) {
      images = [...prose.querySelectorAll<HTMLImageElement>('img')].filter(
        (img) => !img.closest('.song-player__cover') && !img.closest('a'),
      );
      images.forEach((img, idx) => {
        if (img.dataset.zoomable === '1') return;
        img.dataset.zoomable = '1';
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        const label = img.alt?.trim() ? `查看大图：${img.alt.trim()}` : `查看大图（第 ${idx + 1} 张）`;
        img.setAttribute('aria-label', label);
        img.addEventListener('click', () => {
          const curIdx = images.indexOf(img);
          if (curIdx >= 0) openAt(curIdx, img);
        });
        img.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const curIdx = images.indexOf(img);
            if (curIdx >= 0) openAt(curIdx, img);
          }
        });
      });
    },
  };
}

let tocScrollCleanup: (() => void) | null = null;
const entryViewer = createEntryViewer();

function enhanceProse() {
  const article = document.querySelector<HTMLElement>('[data-entry-article]');
  const prose = article?.querySelector<HTMLElement>('.hz-prose');
  const tocNav = document.querySelector<HTMLElement>('[data-entry-toc]');
  const tocList = tocNav?.querySelector<HTMLElement>('[data-toc-list]');
  const railEl = document.getElementById('hz-entry-rail');
  if (!article || !prose) return;

  hydrateRichProseBlocks(prose);

  // 正文首个 # 标题常与页面 h1 重复，降级并隐藏
  prose.querySelectorAll(':scope > h1').forEach((h1) => {
    const h2 = document.createElement('h2');
    h2.className = 'hz-prose__dup';
    if (h1.id) h2.id = h1.id;
    h2.innerHTML = h1.innerHTML;
    h1.replaceWith(h2);
  });

  // 目录 + 稳定滚动联动
  const headings = [...prose.querySelectorAll<HTMLElement>('h2, h3')]
    .filter((h) => h.textContent?.trim())
    .filter((h) => !h.classList.contains('hz-prose__dup'));

  tocScrollCleanup?.();
  tocScrollCleanup = null;

  if (tocNav && tocList) {
    tocList.innerHTML = '';
    if (headings.length > 0) {
      const linkMap = new Map<string, HTMLAnchorElement>();
      const usedIds = new Set<string>();
      headings.forEach((h, i) => {
        if (!h.id || usedIds.has(h.id)) {
          const slug = (h.textContent || '')
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, '');
          h.id = `sec-${i + 1}-${slug || 'note'}`;
        }
        usedIds.add(h.id);
        const li = document.createElement('li');
        if (h.tagName === 'H3') li.className = 'hz-toc__sub';
        const a = document.createElement('a');
        a.href = `#${h.id}`;
        a.textContent = (h.textContent || '').trim();
        li.append(a);
        tocList.append(li);
        linkMap.set(h.id, a);
      });
      tocNav.hidden = false;

      let activeId = '';
      let spyRaf = 0;

      const setActive = (id: string) => {
        if (id === activeId) return;
        if (activeId) {
          const prev = linkMap.get(activeId);
          prev?.classList.remove('is-active');
          prev?.removeAttribute('aria-current');
        }
        activeId = id;
        const next = linkMap.get(id);
        if (next) {
          next.classList.add('is-active');
          next.setAttribute('aria-current', 'location');
          // 侧栏目录较长时自动将激活项滚入可视区
          if (railEl && railEl.scrollHeight > railEl.clientHeight + 8) {
            const railRect = railEl.getBoundingClientRect();
            const linkRect = next.getBoundingClientRect();
            if (linkRect.top < railRect.top + 48 || linkRect.bottom > railRect.bottom - 36) {
              next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      };

      const syncToc = () => {
        spyRaf = 0;
        const threshold = 116;
        let current = headings[0]?.id || '';
        for (const h of headings) {
          if (h.getBoundingClientRect().top <= threshold) {
            current = h.id;
          } else {
            break;
          }
        }
        // 已滚动到文末时高亮最后一节
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 24) {
          current = headings[headings.length - 1]?.id || current;
        }
        if (current) setActive(current);
      };

      const onScroll = () => {
        if (!spyRaf) spyRaf = requestAnimationFrame(syncToc);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      tocScrollCleanup = () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        if (spyRaf) cancelAnimationFrame(spyRaf);
      };
      syncToc();
    } else {
      tocNav.hidden = true;
    }
  }

  // 表格横向滚动容器
  const syncTable = (wrap: HTMLElement) => {
    if (wrap.scrollWidth > wrap.clientWidth + 1) wrap.dataset.scrollable = 'true';
    else delete wrap.dataset.scrollable;
  };
  prose.querySelectorAll('table').forEach((table) => {
    if (table.closest('.hz-table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'hz-table-wrap';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', '数据表格（内容较宽时可横向滚动）');
    table.replaceWith(wrap);
    wrap.append(table);

    const hint = document.createElement('p');
    hint.className = 'hz-table-hint hz-mono';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = '← SCROLL HORIZONTALLY →';
    wrap.after(hint);
    syncTable(wrap);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => syncTable(wrap)).observe(wrap);
    }
  });

  // 代码块工具条
  prose.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.hz-code')) return;
    const code = pre.querySelector('code') || pre;
    const wrap = document.createElement('div');
    wrap.className = 'hz-code';

    const bar = document.createElement('div');
    bar.className = 'hz-code__bar hz-mono';
    const lang = document.createElement('span');
    const codeLang = code.className.match(/language-([\w+-]+)/i)?.[1] || '';
    const rawLang = (pre.dataset.language || codeLang || 'CODE').trim();
    lang.textContent = rawLang === 'plaintext' || rawLang === 'text' ? 'TEXT' : rawLang.toUpperCase();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hz-code__copy';
    btn.textContent = 'COPY';
    btn.setAttribute('aria-label', '复制代码块内容');

    bar.append(lang, btn);
    pre.replaceWith(wrap);
    wrap.append(bar, pre);

    let timer = 0;
    btn.addEventListener('click', async () => {
      const text = (code.textContent || '').replace(/\r/g, '');
      const ok = await copyText(text);
      btn.textContent = ok ? 'COPIED ✓' : 'FAILED';
      btn.dataset.state = ok ? 'ok' : 'err';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        btn.textContent = 'COPY';
        delete btn.dataset.state;
      }, 1800);
    });
  });

  // 绑定文章正文图片查看灯箱
  entryViewer?.bindProse(prose);
}

function initProgress() {
  const bar = document.querySelector<HTMLElement>('[data-reading-bar]');
  const article = document.querySelector<HTMLElement>('[data-entry-article]');
  if (!bar || !article) return;

  let raf = 0;
  const update = () => {
    raf = 0;
    const rect = article.getBoundingClientRect();
    const total = Math.max(1, article.scrollHeight - window.innerHeight);
    const passed = Math.min(total, Math.max(0, -rect.top));
    bar.style.transform = `scaleX(${passed / total})`;
  };
  const req = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', req, { passive: true });
  window.addEventListener('resize', req, { passive: true });
  document.addEventListener('hz:gate-unlocked', req);
  update();
}

function initFontSizeControl() {
  const root = document.querySelector<HTMLElement>('[data-entry-root]');
  const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-entry-fontsize]')];
  if (!root || btns.length === 0) return;

  const KEY = 'hz-entry-fontsize';
  const applySize = (size: 'sm' | 'md' | 'lg', persist: boolean) => {
    root.dataset.fontSize = size;
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.entryFontsize === size)));
    if (persist) {
      try {
        localStorage.setItem(KEY, size);
      } catch {
        /* ignore */
      }
    }
  };

  let init: 'sm' | 'md' | 'lg' = 'md';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'sm' || saved === 'md' || saved === 'lg') init = saved;
  } catch {
    /* ignore */
  }
  applySize(init, false);

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sz = btn.dataset.entryFontsize;
      if (sz === 'sm' || sz === 'md' || sz === 'lg') applySize(sz, true);
    });
  });
}

function initSmartBackLink() {
  const backLink = document.querySelector<HTMLAnchorElement>('.hz-entry__back');
  if (!backLink || backLink.getAttribute('href') !== '/blog/') return;
  try {
    if (!document.referrer) return;
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin && ref.pathname === '/blog/' && ref.search) {
      backLink.href = `/blog/${ref.search}`;
    }
  } catch {
    /* ignore invalid referrer */
  }
}

function initRailTools() {
  document.querySelector<HTMLButtonElement>('[data-print-btn]')?.addEventListener('click', () => {
    window.print();
  });

  const root = document.querySelector<HTMLElement>('[data-shortlink]');
  if (!root) return;
  const gen = root.querySelector<HTMLButtonElement>('[data-shortlink-generate]');
  const panel = root.querySelector<HTMLElement>('[data-shortlink-panel]');
  const copy = root.querySelector<HTMLButtonElement>('[data-shortlink-copy]');
  const urlEl = root.querySelector<HTMLElement>('[data-shortlink-url]');
  const titleEl = root.querySelector<HTMLElement>('[data-shortlink-title]');
  const hint = root.querySelector<HTMLElement>('[data-shortlink-hint]');
  if (!gen || !panel || !copy || !urlEl || !titleEl || !hint) return;

  let timer = 0;
  const doCopy = async () => {
    const title = (titleEl.textContent || '').trim();
    const url = (urlEl.textContent || '').trim();
    const ok = await copyText(title ? `${title} ${url}` : url);
    hint.textContent = ok ? 'COPIED ✓' : 'FAILED';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      hint.textContent = '';
    }, 2200);
  };

  gen.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    gen.setAttribute('aria-expanded', String(opening));
    if (opening) void doCopy();
  });
  copy.addEventListener('click', doCopy);
  urlEl.addEventListener('click', doCopy);
  urlEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void doCopy();
    }
  });
}

function initBusuanzi() {
  const root = document.querySelector<HTMLElement>('[data-entry-root][data-busuanzi="true"]');
  const valueEl = document.getElementById('busuanzi_value_page_pv');
  const box = document.getElementById('busuanzi_container_page_pv');
  if (!root || !valueEl || !box) return;

  (window as unknown as { busuanziCallback?: (d: { page_pv?: unknown }) => void }).busuanziCallback = (data) => {
    const n = Number(data?.page_pv);
    if (Number.isFinite(n) && n > 0) {
      valueEl.textContent = n.toLocaleString('zh-CN');
      box.hidden = false;
    }
  };

  const s = document.createElement('script');
  s.async = true;
  s.referrerPolicy = 'no-referrer-when-downgrade';
  s.src = 'https://busuanzi.ibruce.info/busuanzi?jsonpCallback=busuanziCallback';
  s.onerror = () => {
    box.hidden = true;
  };
  document.head.append(s);
}

function initRailCollapse() {
  const root = document.querySelector<HTMLElement>('[data-entry-root]');
  if (!root) return;
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-rail-toggle]')];
  if (toggles.length === 0) return;

  const STORAGE_KEY = 'hz-entry-rail';

  const applyState = (collapsed: boolean, persist: boolean) => {
    root.dataset.railCollapsed = collapsed ? 'true' : 'false';
    toggles.forEach((btn) => {
      btn.setAttribute('aria-expanded', String(!collapsed));
      const label = btn.querySelector<HTMLElement>('[data-rail-toggle-text]');
      const icon = btn.querySelector<HTMLElement>('[data-rail-toggle-icon]');
      if (label) label.textContent = collapsed ? (btn.dataset.labelExpand || '展开侧栏') : (btn.dataset.labelCollapse || '收起侧栏');
      if (icon) icon.textContent = collapsed ? '⟫' : '⟪';
    });
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'open');
      } catch {
        /* 隐私模式下允许失败 */
      }
    }
  };

  let initCollapsed = root.dataset.railCollapsed === 'true';
  try {
    initCollapsed = localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch {
    /* ignore */
  }
  applyState(initCollapsed, false);

  toggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nowCollapsed = root.dataset.railCollapsed === 'true';
      applyState(!nowCollapsed, true);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const nowCollapsed = root.dataset.railCollapsed === 'true';
    applyState(!nowCollapsed, true);
  });
}

enhanceProse();
initProgress();
initFontSizeControl();
initSmartBackLink();
initRailCollapse();
initRailTools();
initBusuanzi();
document.addEventListener('hz:gate-unlocked', enhanceProse);
