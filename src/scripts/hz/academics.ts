/**
 * HORIZON · academics.ts
 * /academics/ 连续课程拼贴墙：原地 3D 翻转展示开课部门与成绩、聚光灯筛选、/ 搜索。
 */

function initAcademics() {
  const root = document.querySelector<HTMLElement>('[data-acad-root]');
  if (!root) return;

  const tiles = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-tile]')];
  const filterBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-filter]')];
  const search = root.querySelector<HTMLInputElement>('[data-acad-search]');
  const readout = root.querySelector<HTMLElement>('[data-acad-readout]');

  let activeFilter = 'all';
  let query = '';

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

  const applySpotlight = () => {
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
  };

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.acadFilter || 'all';
      filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applySpotlight();
    });
  });

  if (search) {
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      applySpotlight();
    });
  }

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
    tile.addEventListener('click', () => toggleFlip(tile));
  });

  if (matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let activeTile: HTMLButtonElement | null = null;
    let tx = 0;
    let ty = 0;
    let raf = 0;

    const clearTile = (t: HTMLButtonElement | null) => {
      if (!t) return;
      t.style.removeProperty('--tile-rx');
      t.style.removeProperty('--tile-ry');
    };

    const paint = () => {
      raf = 0;
      if (!activeTile) return;
      const r = activeTile.getBoundingClientRect();
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
        if (activeTile && activeTile !== tile) clearTile(activeTile);
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
        }
      },
      { passive: true },
    );
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search && document.activeElement === search) {
      search.value = '';
      query = '';
      applySpotlight();
      search.blur();
      return;
    }

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      search?.focus();
    }
  });

  applySpotlight();
}

initAcademics();
