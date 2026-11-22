/**
 * HORIZON · spectrum.ts
 * /blog/ 光谱仪：光谱条与文章列表双向联动、谐波邻域联动、FLIP 排序动画、搜索（/ 快捷键 + 防抖）、
 * 标签筛选、URL 状态双向同步（返回/刷新不丢条件）、元数据预解析消除热路径重复 JSON/Date 解析。
 */
import { captureFlipRects, playFlipRects } from './motion';

type SortKey = 'newest' | 'oldest' | 'mass';

interface RowMeta {
  el: HTMLElement;
  id: string;
  ts: number;
  dayIndex: number;
  pos: number;
  mass: number;
  search: string;
  categories: string[];
  tags: string[];
}

export function initSpectrum() {
  const root = document.querySelector<HTMLElement>('[data-spectrum-root]');
  if (!root) return;

  const list = root.querySelector<HTMLElement>('[data-spec-list]');
  const rows = [...root.querySelectorAll<HTMLElement>('[data-post-row]')];
  const bars = [...root.querySelectorAll<HTMLElement>('[data-spec-bar]')];
  const readout = root.querySelector<HTMLElement>('[data-spec-readout]');
  const search = root.querySelector<HTMLInputElement>('[data-spec-search]');
  const countEl = root.querySelector<HTMLElement>('[data-spec-count]');
  const emptyEl = root.querySelector<HTMLElement>('[data-spec-empty]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-spec-reset]');
  const catBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-spec-cat]')];
  const tagBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-spec-tag]')];
  const sortBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-spec-sort]')];
  if (!list) return;

  // 预解析行元数据，避免每次筛选/输入重复 Date.parse / JSON.parse
  const parseArr = (raw: string | undefined) => {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  const metas: RowMeta[] = rows.map((el) => ({
    el,
    id: el.dataset.id || '',
    ts: Date.parse(el.dataset.date || '') || 0,
    dayIndex: Number(el.dataset.dayIndex || '0'),
    pos: Number(el.dataset.pos || '0'),
    mass: Number(el.dataset.mass || '0'),
    search: el.dataset.search || '',
    categories: parseArr(el.dataset.categories),
    tags: parseArr(el.dataset.tags),
  }));

  const barMap = new Map(bars.map((b) => [b.dataset.id || '', b]));
  const rowMap = new Map(rows.map((r) => [r.dataset.id || '', r]));

  let activeCategory = 'all';
  let activeTag = 'all';
  let sortKey: SortKey = 'newest';
  let query = '';

  const params = new URLSearchParams(location.search);
  const initQ = params.get('q')?.trim() || '';
  const initCat = params.get('cat')?.trim() || '';
  const initTag = params.get('tag')?.trim() || '';
  const initSort = params.get('sort')?.trim() || '';
  if (initQ && search) {
    search.value = initQ;
    query = initQ.toLowerCase();
  }
  if (initCat && catBtns.some((b) => b.dataset.specCat === initCat)) {
    activeCategory = initCat;
  }
  if (initTag && tagBtns.some((b) => b.dataset.specTag === initTag)) {
    activeTag = initTag;
  }
  if (initSort === 'newest' || initSort === 'oldest' || initSort === 'mass') {
    sortKey = initSort;
  }

  const syncUrl = () => {
    const next = new URLSearchParams();
    const rawQ = search?.value.trim() || '';
    if (rawQ) next.set('q', rawQ);
    if (activeCategory !== 'all') next.set('cat', activeCategory);
    if (activeTag !== 'all') next.set('tag', activeTag);
    if (sortKey !== 'newest') next.set('sort', sortKey);
    const qs = next.toString();
    const nextUrl = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
    if (nextUrl !== location.pathname + location.search + location.hash) {
      history.replaceState(null, '', nextUrl);
    }
  };

  const fmtMass = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  const updateReadout = (id: string | null) => {
    if (!readout) return;
    if (!id) {
      readout.textContent = 'HOVER SPECTRAL LINE OR RECORD TO LOCK WAVELENGTH';
      return;
    }
    const bar = barMap.get(id);
    if (!bar) return;
    readout.textContent = `${bar.dataset.folio || ''} · ${bar.dataset.title || ''} · ${bar.dataset.mass || '0'} 字 · z=${bar.dataset.z || '0'}`;
  };

  const barsWrap = root.querySelector<HTMLElement>('.hz-spec__bars');

  const linkPair = (id: string | null) => {
    const activeIdx = id ? bars.findIndex((b) => b.dataset.id === id) : -1;
    bars.forEach((b, i) => {
      const match = Boolean(id) && b.dataset.id === id;
      b.classList.toggle('is-linked', match);
      const dist = activeIdx >= 0 ? Math.abs(i - activeIdx) : 99;
      b.classList.toggle('is-near-1', dist === 1);
      b.classList.toggle('is-near-2', dist === 2);
    });
    if (barsWrap) {
      const activeBar = activeIdx >= 0 ? bars[activeIdx] : null;
      if (activeBar) {
        const cx = activeBar.offsetLeft + activeBar.offsetWidth * 0.5;
        barsWrap.style.setProperty('--spec-x', `${cx.toFixed(1)}px`);
        barsWrap.style.setProperty('--spec-laser', '1');
      } else {
        barsWrap.style.setProperty('--spec-laser', '0');
      }
    }
    rows.forEach((r) => r.classList.toggle('is-linked', Boolean(id) && r.dataset.id === id));
    updateReadout(id);
  };

  const apply = (animate = false, pushUrl = true) => {
    let shown = 0;
    let totalMass = 0;
    const firstRects = animate ? captureFlipRects(rows) : new Map<HTMLElement, DOMRect>();

    const sorted = [...metas].sort((a, b) => {
      if (sortKey === 'oldest') {
        return a.ts - b.ts || a.dayIndex - b.dayIndex || b.pos - a.pos;
      }
      if (sortKey === 'mass') {
        return b.mass - a.mass || b.ts - a.ts || a.pos - b.pos;
      }
      return b.ts - a.ts || b.dayIndex - a.dayIndex || a.pos - b.pos;
    });

    const frag = document.createDocumentFragment();
    for (const meta of sorted) {
      const matchQ = !query || meta.search.includes(query);
      const matchCat = activeCategory === 'all'
        || (activeCategory === 'uncategorized'
          ? meta.categories.length === 0
          : meta.categories.includes(activeCategory));
      const matchTag = activeTag === 'all' || meta.tags.includes(activeTag);
      const ok = matchQ && matchCat && matchTag;

      meta.el.hidden = !ok;
      barMap.get(meta.id)?.classList.toggle('is-dimmed', !ok);

      if (ok) {
        shown += 1;
        totalMass += meta.mass;
      }
      frag.append(meta.el);
    }
    list.append(frag);
    if (animate) playFlipRects(rows, firstRects, 360);

    if (countEl) {
      countEl.textContent = `${shown} / ${rows.length} RECORDS · ${fmtMass(totalMass)} CHARS`;
    }
    if (emptyEl) {
      emptyEl.hidden = shown > 0;
    }

    catBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.specCat === activeCategory));
    });
    tagBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.specTag === activeTag));
    });
    sortBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.specSort === sortKey));
    });

    if (pushUrl) syncUrl();
  };

  let searchTimer = 0;
  search?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const nextQ = search.value.trim().toLowerCase();
    if (!nextQ) {
      query = '';
      apply(false);
      return;
    }
    searchTimer = window.setTimeout(() => {
      query = nextQ;
      apply(false);
    }, 110);
  });

  catBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const clicked = btn.dataset.specCat || 'all';
      activeCategory = activeCategory === clicked && clicked !== 'all' ? 'all' : clicked;
      apply(true);
    });
  });

  tagBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const clicked = btn.dataset.specTag || 'all';
      activeTag = activeTag === clicked && clicked !== 'all' ? 'all' : clicked;
      apply(true);
    });
  });

  sortBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.specSort as SortKey;
      if (k === 'newest' || k === 'oldest' || k === 'mass') {
        if (k === sortKey) return;
        sortKey = k;
        apply(true);
      }
    });
  });

  resetBtn?.addEventListener('click', () => {
    query = '';
    activeCategory = 'all';
    activeTag = 'all';
    if (search) search.value = '';
    apply(true);
    search?.focus();
  });

  bars.forEach((bar) => {
    const id = bar.dataset.id || '';
    bar.addEventListener('pointerenter', () => linkPair(id));
    bar.addEventListener('focus', () => linkPair(id));
    bar.addEventListener('pointerleave', () => linkPair(null));
    bar.addEventListener('blur', () => linkPair(null));
    bar.addEventListener('click', () => {
      const row = rowMap.get(id);
      if (!row) return;
      if (row.hidden) {
        query = '';
        activeCategory = 'all';
        activeTag = 'all';
        if (search) search.value = '';
        apply(false);
      }
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      linkPair(id);
      row.querySelector<HTMLAnchorElement>('.hz-row__link')?.focus({ preventScroll: true });
    });
  });

  rows.forEach((row) => {
    const id = row.dataset.id || '';
    row.addEventListener('pointerenter', () => linkPair(id));
    row.addEventListener('pointerleave', () => linkPair(null));
  });

  document.addEventListener('keydown', (e) => {
    if (!search) return;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !active?.isContentEditable) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    } else if (e.key === 'Escape' && document.activeElement === search) {
      if (search.value) {
        window.clearTimeout(searchTimer);
        search.value = '';
        query = '';
        apply(false);
      } else {
        search.blur();
      }
    }
  });

  apply(false, false);
}

initSpectrum();
