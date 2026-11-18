/**
 * HORIZON · spectrum.ts
 * /blog/ 光谱仪：光谱条与文章列表双向联动、谐波邻域联动、FLIP 排序动画、搜索（/ 快捷键）、标签筛选。
 */
import { captureFlipRects, playFlipRects } from './motion';

type SortKey = 'newest' | 'oldest' | 'mass';

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
  const tagBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-spec-tag]')];
  const sortBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-spec-sort]')];
  if (!list) return;

  const barMap = new Map(bars.map((b) => [b.dataset.id || '', b]));
  const rowMap = new Map(rows.map((r) => [r.dataset.id || '', r]));

  let activeTag = 'all';
  let sortKey: SortKey = 'newest';
  let query = '';

  const params = new URLSearchParams(location.search);
  const initQ = params.get('q')?.trim() || '';
  const initTag = params.get('tag')?.trim() || '';
  if (initQ && search) {
    search.value = initQ;
    query = initQ.toLowerCase();
  }
  if (initTag && tagBtns.some((b) => b.dataset.specTag === initTag)) {
    activeTag = initTag;
  }

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

  const apply = (animate = false) => {
    let shown = 0;
    let totalMass = 0;
    const firstRects = animate ? captureFlipRects(rows) : new Map<HTMLElement, DOMRect>();

    const sorted = [...rows].sort((a, b) => {
      const ta = Date.parse(a.dataset.date || '') || 0;
      const tb = Date.parse(b.dataset.date || '') || 0;
      const da = Number(a.dataset.dayIndex || '0');
      const db = Number(b.dataset.dayIndex || '0');
      const pa = Number(a.dataset.pos || '0');
      const pb = Number(b.dataset.pos || '0');
      const ma = Number(a.dataset.mass || '0');
      const mb = Number(b.dataset.mass || '0');

      if (sortKey === 'oldest') {
        return ta - tb || da - db || pb - pa;
      }
      if (sortKey === 'mass') {
        return mb - ma || tb - ta || pa - pb;
      }
      return tb - ta || db - da || pa - pb;
    });

    const frag = document.createDocumentFragment();
    for (const row of sorted) {
      const text = row.dataset.search || '';
      let tags: string[] = [];
      try {
        tags = JSON.parse(row.dataset.tags || '[]');
      } catch {
        tags = [];
      }
      const matchQ = !query || text.includes(query);
      const matchTag = activeTag === 'all' || tags.includes(activeTag);
      const ok = matchQ && matchTag;

      const wasHidden = row.hidden;
      row.hidden = !ok;
      if (animate && ok && wasHidden) {
        row.classList.remove('hz-view-enter');
        void row.offsetWidth;
        row.classList.add('hz-view-enter');
      }
      const id = row.dataset.id || '';
      barMap.get(id)?.classList.toggle('is-dimmed', !ok);

      if (ok) {
        shown += 1;
        totalMass += Number(row.dataset.mass || '0');
      }
      frag.append(row);
    }
    list.append(frag);
    if (animate) playFlipRects(rows, firstRects);

    if (countEl) {
      countEl.textContent = `${shown} / ${rows.length} RECORDS · ${fmtMass(totalMass)} CHARS`;
    }
    if (emptyEl) {
      emptyEl.hidden = shown > 0;
    }

    tagBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.specTag === activeTag));
    });
    sortBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.specSort === sortKey));
    });
  };

  search?.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    apply(true);
  });

  tagBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTag = btn.dataset.specTag || 'all';
      apply(true);
    });
  });

  sortBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.specSort as SortKey;
      if (k === 'newest' || k === 'oldest' || k === 'mass') {
        sortKey = k;
        apply(true);
      }
    });
  });

  resetBtn?.addEventListener('click', () => {
    query = '';
    activeTag = 'all';
    if (search) search.value = '';
    apply(true);
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
        activeTag = 'all';
        if (search) search.value = '';
        apply();
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
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        search.focus();
      }
    } else if (e.key === 'Escape' && document.activeElement === search) {
      if (search.value) {
        search.value = '';
        query = '';
        apply();
      } else {
        search.blur();
      }
    }
  });

  apply();
}

initSpectrum();
