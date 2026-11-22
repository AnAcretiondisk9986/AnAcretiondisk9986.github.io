/**
 * HORIZON · projects.ts (/projects/ 筛选与搜索)
 */
function initProjects() {
  const root = document.querySelector<HTMLElement>('[data-lab-root]');
  if (!root) return;

  const cards = [...root.querySelectorAll<HTMLElement>('[data-lab-card]')];
  const search = root.querySelector<HTMLInputElement>('[data-lab-search]');
  const statusBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-lab-status]')];
  const kindBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-lab-kind]')];
  const empty = root.querySelector<HTMLElement>('[data-lab-empty]');
  const reset = root.querySelector<HTMLButtonElement>('[data-lab-reset]');

  let activeStatus = 'all';
  let activeKind = 'all';
  let query = '';

  const apply = () => {
    let shown = 0;
    for (const card of cards) {
      const okStatus = activeStatus === 'all' || card.dataset.status === activeStatus;
      const okKind = activeKind === 'all' || card.dataset.kind === activeKind;
      const okQuery = !query || (card.dataset.search || '').includes(query);
      const ok = okStatus && okKind && okQuery;
      card.hidden = !ok;
      if (ok) shown += 1;
    }
    if (empty) empty.hidden = shown > 0;
    statusBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.labStatus === activeStatus)));
    kindBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.labKind === activeKind)));
  };

  statusBtns.forEach((b) => b.addEventListener('click', () => {
    const val = b.dataset.labStatus || 'all';
    activeStatus = activeStatus === val && val !== 'all' ? 'all' : val;
    apply();
  }));
  kindBtns.forEach((b) => b.addEventListener('click', () => {
    const val = b.dataset.labKind || 'all';
    activeKind = activeKind === val && val !== 'all' ? 'all' : val;
    apply();
  }));
  search?.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    apply();
  });
  reset?.addEventListener('click', () => {
    activeStatus = 'all';
    activeKind = 'all';
    query = '';
    if (search) search.value = '';
    apply();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && search && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        search.focus();
      }
    }
  });
}

initProjects();
document.addEventListener('astro:page-load', initProjects);
