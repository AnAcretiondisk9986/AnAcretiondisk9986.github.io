/**
 * HORIZON · academics.ts
 * /academics/ 连续课程拼贴墙：原地 3D 翻转展示开课部门与成绩、聚光灯筛选、空状态重置、URL 状态同步、/ 与 Escape 快捷键。
 */

function initAcademics() {
  const root = document.querySelector<HTMLElement>('[data-acad-root]');
  if (!root) return;

  const tiles = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-tile]')];
  const filterBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-filter]')];
  const search = root.querySelector<HTMLInputElement>('[data-acad-search]');
  const readout = root.querySelector<HTMLElement>('[data-acad-readout]');
  const emptyEl = root.querySelector<HTMLElement>('[data-acad-empty]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-acad-reset]');

  let activeFilter = 'all';
  let query = '';

  const params = new URLSearchParams(location.search);
  const initFilter = params.get('filter')?.trim() || '';
  const initQ = params.get('q')?.trim() || '';
  if (initFilter && filterBtns.some((b) => b.dataset.acadFilter === initFilter)) {
    activeFilter = initFilter;
  }
  if (initQ && search) {
    search.value = initQ;
    query = initQ.toLowerCase();
  }

  const syncUrl = () => {
    const next = new URLSearchParams();
    if (activeFilter !== 'all') next.set('filter', activeFilter);
    const rawQ = search?.value.trim() || '';
    if (rawQ) next.set('q', rawQ);
    const qs = next.toString();
    const target = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
    if (target !== location.pathname + location.search + location.hash) {
      history.replaceState(null, '', target);
    }
  };

  const matchesFilter = (tile: HTMLButtonElement): boolean => {
    const status = tile.dataset.status || '';
    if (activeFilter === 'lit') return status !== 'planned';
    if (activeFilter === 'early') return tile.dataset.early === 'true';
    if (activeFilter !== 'all') return status === activeFilter;
    return true;
  };

  const matchesQuery = (tile: HTMLButtonElement): boolean => {
    if (!query) return true;
    return (tile.dataset.search || '').includes(query);
  };

  const applySpotlight = (pushUrl = true) => {
    let matched = 0;
    for (const tile of tiles) {
      const ok = matchesFilter(tile) && matchesQuery(tile);
      tile.classList.toggle('is-dimmed', !ok);
      if (ok) matched += 1;
    }
    if (readout) {
      readout.textContent =
        matched === tiles.length && activeFilter === 'all' && !query
          ? `${tiles.length} / ${tiles.length}`
          : `${matched} / ${tiles.length}`;
    }
    if (emptyEl) {
      emptyEl.hidden = matched > 0;
    }
    filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.acadFilter === activeFilter)));
    if (pushUrl) syncUrl();
  };

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.acadFilter || 'all';
      applySpotlight();
    });
  });

  if (search) {
    let searchTimer = 0;
    search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      const nextQ = search.value.trim().toLowerCase();
      if (!nextQ) {
        query = '';
        applySpotlight();
        return;
      }
      searchTimer = window.setTimeout(() => {
        query = nextQ;
        applySpotlight();
      }, 100);
    });
  }

  resetBtn?.addEventListener('click', () => {
    activeFilter = 'all';
    query = '';
    if (search) search.value = '';
    applySpotlight();
    search?.focus();
  });

  const toggleFlip = (tile: HTMLButtonElement) => {
    const flipped = tile.classList.toggle('is-flipped');
    tile.setAttribute('aria-pressed', String(flipped));
    tile.classList.remove('is-flipping');
    void tile.offsetWidth;
    tile.classList.add('is-flipping');
    window.setTimeout(() => tile.classList.remove('is-flipping'), 540);
    const front = tile.querySelector('.hz-tile__face--front');
    const back = tile.querySelector('.hz-tile__face--back');
    front?.setAttribute('aria-hidden', String(flipped));
    back?.setAttribute('aria-hidden', String(!flipped));
  };

  tiles.forEach((tile) => {
    tile.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest('a')) return;
      toggleFlip(tile);
    });
  });

  if (matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let activeTile: HTMLButtonElement | null = null;
    let activeRect: DOMRect | null = null;
    let tx = 0;
    let ty = 0;
    let raf = 0;

    const invalidateRect = () => {
      activeRect = null;
    };
    window.addEventListener('scroll', invalidateRect, { passive: true });
    window.addEventListener('resize', invalidateRect, { passive: true });

    const clearTile = (t: HTMLButtonElement | null) => {
      if (!t) return;
      t.style.removeProperty('--tile-rx');
      t.style.removeProperty('--tile-ry');
    };

    const paint = () => {
      raf = 0;
      if (!activeTile) return;
      if (!activeRect) activeRect = activeTile.getBoundingClientRect();
      const r = activeRect;
      if (r.width <= 0 || r.height <= 0) return;
      const lx = tx - r.left;
      const ly = ty - r.top;
      const nx = Math.max(-1, Math.min(1, (lx / r.width - 0.5) * 2));
      const ny = Math.max(-1, Math.min(1, (ly / r.height - 0.5) * 2));
      const maxDeg = activeTile.dataset.milestone === 'true' ? 3.2 : 6.5;
      activeTile.style.setProperty('--tile-mx', `${lx.toFixed(1)}px`);
      activeTile.style.setProperty('--tile-my', `${ly.toFixed(1)}px`);
      activeTile.style.setProperty('--tile-rx', `${(-ny * maxDeg).toFixed(2)}deg`);
      activeTile.style.setProperty('--tile-ry', `${(nx * maxDeg).toFixed(2)}deg`);
    };

    root.addEventListener(
      'pointermove',
      (e) => {
        const tile = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-acad-tile]') ?? null;
        if (activeTile && activeTile !== tile) {
          clearTile(activeTile);
          activeRect = null;
        }
        activeTile = tile;
        if (!activeTile) return;
        tx = e.clientX;
        ty = e.clientY;
        if (!raf) raf = requestAnimationFrame(paint);
      },
      { passive: true },
    );

    root.addEventListener(
      'pointerout',
      (e) => {
        if (!activeTile) return;
        const rel = e.relatedTarget as Element | null;
        if (!rel || !activeTile.contains(rel)) {
          clearTile(activeTile);
          activeTile = null;
          activeRect = null;
        }
      },
      { passive: true },
    );
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search && document.activeElement === search) {
      if (search.value) {
        search.value = '';
        query = '';
        applySpotlight();
      } else {
        search.blur();
      }
      return;
    }

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
      e.preventDefault();
      search?.focus();
      search?.select();
    }
  });

  applySpotlight(false);
}

initAcademics();
