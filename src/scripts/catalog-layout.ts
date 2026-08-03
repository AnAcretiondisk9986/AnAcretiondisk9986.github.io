const boundLists = new WeakSet<HTMLElement>();

type CatalogLayout = 'cards' | 'rows';

/** 标题自适应下限：基准字号的 55%，且不低于 12px */
const MIN_TITLE_RATIO = 0.55;
const MIN_TITLE_PX = 12;
/** 每次微调字号步长（px） */
const TITLE_STEP_PX = 0.25;

function readStoredLayout(): CatalogLayout {
  try {
    return localStorage.getItem('blog-layout') === 'cards' ? 'cards' : 'rows';
  } catch {
    return 'rows';
  }
}

/**
 * 标题自适应字号：在标题容器高度统一（line-clamp 行数 × 行高）的前提下，
 * 标题过长时逐级微调字号，使标题完整展示而不产生省略号。
 * 简介（description）不参与自适应，保持原有截断。
 */
function fitTitles(list: HTMLElement) {
  const titles = list.querySelectorAll<HTMLHeadingElement>('.catalog-content h2');
  for (const h2 of titles) {
    // 重置内联字号/高度，回到 CSS 基准
    h2.style.fontSize = '';
    h2.style.height = '';
    const cs = getComputedStyle(h2);
    const base = parseFloat(cs.fontSize);
    if (!base || !isFinite(base)) continue;

    const lineHeight =
      cs.lineHeight === 'normal' ? base * 1.3 : parseFloat(cs.lineHeight);
    const clampRaw = cs.getPropertyValue('-webkit-line-clamp');
    const clampLines =
      clampRaw && clampRaw !== 'none' ? Number(clampRaw) : 2;
    const boxHeight = Math.round(lineHeight * clampLines * 100) / 100;
    if (!isFinite(boxHeight) || boxHeight <= 0) continue;

    // 固定容器高度，保证所有条目标题区尺寸统一
    h2.style.height = boxHeight + 'px';

    let px = base;
    const minPx = Math.max(MIN_TITLE_PX, base * MIN_TITLE_RATIO);
    while (h2.scrollHeight > boxHeight + 1 && px > minPx) {
      px = Math.max(minPx, px - TITLE_STEP_PX);
      h2.style.fontSize = px + 'px';
    }
  }
}

export function initCatalogLayout() {
  const list = document.querySelector<HTMLElement>('[data-catalog-list]');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-catalog-view]')];
  const status = document.querySelector<HTMLElement>('[data-catalog-view-status]');
  const rule = document.querySelector<HTMLElement>('[data-catalog-rule]');
  if (!list) return;

  if (!boundLists.has(list)) {
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

      // 布局切换后容器尺寸变化，需重新计算标题字号
      fitTitles(list);

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

    // 窗口尺寸变化时防抖重算（标题容器宽度随视口变化）
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => fitTitles(list), 120);
    });

    // 字体加载完成后测量才准确
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => fitTitles(list)).catch(() => {});
    }

    applyLayout(readStoredLayout());
  }

  // 每次初始化（含 VT 导航）都重新适配标题字号
  fitTitles(list);
}
