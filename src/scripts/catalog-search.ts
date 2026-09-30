const boundInputs = new WeakSet<HTMLInputElement>();

export function initCatalogSearch() {
  const input = document.querySelector<HTMLInputElement>('[data-catalog-search]');
  const list = document.querySelector<HTMLElement>('[data-catalog-list]');
  const result = document.querySelector<HTMLElement>('[data-catalog-results]');
  const empty = document.querySelector<HTMLElement>('[data-catalog-empty]');
  if (!input || !list || boundInputs.has(input)) return;

  boundInputs.add(input);
  const cards = [...list.querySelectorAll<HTMLElement>('[data-order-card]')];

  const apply = () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visibleCount = 0;

    for (const card of cards) {
      const text = (card.dataset.catalogSearchText || card.textContent || '').toLocaleLowerCase();
      const visible = !query || text.includes(query);
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    if (result) result.textContent = `${visibleCount} 篇文章`;
    if (empty) empty.hidden = visibleCount !== 0;
  };

  input.addEventListener('input', apply);
  apply();
}
