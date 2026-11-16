/**
 * HORIZON · academics.ts
 * /academics/ 连续课程拼贴墙：原地 3D 翻转展示开课部门与成绩、聚光灯筛选、/ 搜索、跨轨互认联动。
 */

function initAcademics() {
  const root = document.querySelector<HTMLElement>('[data-acad-root]');
  if (!root) return;

  const tiles = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-tile]')];
  const tileMap = new Map(tiles.map((t) => [t.dataset.id || '', t]));
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

  const clearPeers = () => {
    tiles.forEach((t) => t.classList.remove('is-peer'));
  };

  const highlightPeers = (tile: HTMLButtonElement) => {
    clearPeers();
    const raw = tile.dataset.linked;
    if (!raw) return;
    for (const id of raw.split(',')) {
      tileMap.get(id)?.classList.add('is-peer');
    }
  };

  const toggleFlip = (tile: HTMLButtonElement) => {
    const flipped = tile.classList.toggle('is-flipped');
    tile.setAttribute('aria-pressed', String(flipped));
    const front = tile.querySelector('.hz-tile__face--front');
    const back = tile.querySelector('.hz-tile__face--back');
    front?.setAttribute('aria-hidden', String(flipped));
    back?.setAttribute('aria-hidden', String(!flipped));
  };

  tiles.forEach((tile) => {
    tile.addEventListener('pointerenter', () => highlightPeers(tile));
    tile.addEventListener('pointerleave', clearPeers);
    tile.addEventListener('focus', () => highlightPeers(tile));
    tile.addEventListener('blur', clearPeers);
    tile.addEventListener('click', () => toggleFlip(tile));
  });

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
