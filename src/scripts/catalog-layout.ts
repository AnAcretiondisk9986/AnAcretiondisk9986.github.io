const boundLists = new WeakSet<HTMLElement>();

type CatalogLayout = 'cards' | 'rows';

function readStoredLayout(): CatalogLayout {
  try {
    return localStorage.getItem('blog-layout') === 'cards' ? 'cards' : 'rows';
  } catch {
    return 'rows';
  }
}

export function initCatalogLayout() {
  const list = document.querySelector<HTMLElement>('[data-catalog-list]');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-catalog-view]')];
  const status = document.querySelector<HTMLElement>('[data-catalog-view-status]');
  const rule = document.querySelector<HTMLElement>('[data-catalog-rule]');
  if (!list || !buttons.length || boundLists.has(list)) return;
  boundLists.add(list);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function applyLayout(layout: CatalogLayout, persist = false, animate = false) {
    if (list.dataset.catalogLayout === layout) {
      if (persist) {
        try { localStorage.setItem('blog-layout', layout); } catch {}
      }
      return;
    }
    list.dataset.catalogLayout = layout;
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.catalogView === layout));
    });
    if (status) status.textContent = layout === 'cards' ? '卡片' : '横栏';
    if (rule) rule.hidden = layout === 'cards';

    if (persist) {
      try { localStorage.setItem('blog-layout', layout); } catch {}
    }

    if (animate && !reduceMotion.matches) {
      list.getAnimations().forEach((animation) => animation.cancel());
      list.animate(
        [
          { opacity: 0.76, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
    }
  }

  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const layout = button.dataset.catalogView === 'cards' ? 'cards' : 'rows';
      const pointerInitiated = event.detail > 0;
      applyLayout(layout, true, pointerInitiated);
    });
  });

  applyLayout(readStoredLayout());
}
