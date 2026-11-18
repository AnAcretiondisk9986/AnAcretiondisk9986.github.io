/**
 * HORIZON · entry.ts
 * 文章页交互：目录生成 + 滚动高亮、阅读进度、表格滚动包装、代码块复制、短链、打印、不蒜子统计。
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

let tocObserver: IntersectionObserver | null = null;

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

function enhanceProse() {
  const article = document.querySelector<HTMLElement>('[data-entry-article]');
  const prose = article?.querySelector<HTMLElement>('.hz-prose');
  const tocNav = document.querySelector<HTMLElement>('[data-entry-toc]');
  const tocList = tocNav?.querySelector<HTMLElement>('[data-toc-list]');
  if (!article || !prose) return;

  hydrateRichProseBlocks(prose);

  // 正文首个 # 标题常与页面 h1 重复，降级并隐藏
  prose.querySelectorAll(':scope > h1').forEach((h1) => {
    const h2 = document.createElement('h2');
    h2.className = 'hz-prose__dup';
    h2.innerHTML = h1.innerHTML;
    h1.replaceWith(h2);
  });

  // 目录
  const headings = [...prose.querySelectorAll<HTMLElement>('h2, h3')]
    .filter((h) => h.textContent?.trim())
    .filter((h) => !h.classList.contains('hz-prose__dup'));

  if (tocNav && tocList) {
    tocList.innerHTML = '';
    if (headings.length > 0) {
      const linkMap = new Map<string, HTMLAnchorElement>();
      headings.forEach((h, i) => {
        if (!h.id) {
          const slug = (h.textContent || '')
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, '');
          h.id = `sec-${i + 1}-${slug || 'note'}`;
        }
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

      tocObserver?.disconnect();
      tocObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            linkMap.forEach((a) => a.classList.remove('is-active'));
            linkMap.get(entry.target.id)?.classList.add('is-active');
          }
        },
        { rootMargin: '-18% 0px -72% 0px' },
      );
      headings.forEach((h) => tocObserver?.observe(h));
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
    lang.textContent = pre.dataset.language || 'CODE';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hz-code__copy';
    btn.textContent = 'COPY';

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
    panel.hidden = false;
    gen.hidden = true;
  });
  copy.addEventListener('click', doCopy);
  urlEl.addEventListener('click', doCopy);
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
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const nowCollapsed = root.dataset.railCollapsed === 'true';
    applyState(!nowCollapsed, true);
  });
}

enhanceProse();
initProgress();
initRailCollapse();
initRailTools();
initBusuanzi();
document.addEventListener('hz:gate-unlocked', enhanceProse);
