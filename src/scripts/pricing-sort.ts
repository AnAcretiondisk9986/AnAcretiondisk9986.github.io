/**
 * 计价页排序：缓存命中 / 缓存未命中（输入）/ 输出 三档切换 + 正序倒序。
 *
 * 只重排 DOM，不动服务端渲染出来的数值与条形宽度：
 *   · 行节点带 data-cache / data-in / data-out 三个价格；
 *   · 堆叠图行带 data-name，跟着同一份顺序走；
 *   · 主图容器加 data-sort，CSS 把被排序的那一档高亮。
 *
 * 首次直载与站内跳转都走 astro:page-load；离开时不需要清理（没有定时器）。
 */
type SortKey = 'cache' | 'in' | 'out';
type SortDir = 'asc' | 'desc';

const KEY_LABEL: Record<SortKey, string> = {
  cache: '缓存命中',
  in: '缓存未命中',
  out: '输出',
};

function init(root: HTMLElement): void {
  const chart = root.querySelector<HTMLElement>('[data-pr-chart]');
  const list = root.querySelector<HTMLElement>('[data-pr-rows]');
  const stack = root.querySelector<HTMLElement>('[data-pr-stack]');
  if (!chart || !list) return;

  const rows = Array.from(list.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  const stackRows = stack
    ? new Map(
        Array.from(stack.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement)
          .map((node) => [node.dataset.name || '', node]),
      )
    : new Map<string, HTMLElement>();

  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-pr-sort]'));
  const dirButton = root.querySelector<HTMLButtonElement>('[data-pr-dir]');

  let key: SortKey = 'out';
  let dir: SortDir = 'desc';

  const valueOf = (row: HTMLElement, which: SortKey) => {
    const raw = which === 'cache' ? row.dataset.cache : which === 'in' ? row.dataset.in : row.dataset.out;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  };

  const paint = () => {
    for (const button of buttons) {
      const active = button.dataset.prSort === key;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (dirButton) {
      dirButton.textContent = dir === 'desc' ? '倒序 ↓' : '正序 ↑';
      dirButton.setAttribute('aria-label', dir === 'desc' ? '当前倒序，点击改为正序' : '当前正序，点击改为倒序');
    }
    chart.dataset.sort = key;
  };

  const apply = () => {
    const sorted = rows.slice().sort((a, b) => {
      const delta = valueOf(a, key) - valueOf(b, key);
      if (delta !== 0) return dir === 'desc' ? -delta : delta;
      // 同价：按名称稳定排序，避免每次点击顺序抖动
      return (a.dataset.name || '').localeCompare(b.dataset.name || '');
    });
    list.append(...sorted);

    if (stack) {
      const ordered = sorted.map((row) => stackRows.get(row.dataset.name || '')).filter(Boolean) as HTMLElement[];
      stack.append(...ordered);
    }
    paint();
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const next = button.dataset.prSort as SortKey | undefined;
      if (!next || next === key) return;
      key = next;
      apply();
    });
  }

  dirButton?.addEventListener('click', () => {
    dir = dir === 'desc' ? 'asc' : 'desc';
    apply();
  });

  // 服务端已按输出价倒序排好；这里只统一 aria 状态与高亮，避免首屏闪一下
  paint();
  apply();
}

const boot = () => {
  const root = document.querySelector<HTMLElement>('.pr-page');
  if (root) init(root);
};

document.addEventListener('astro:page-load', boot);
if (document.readyState !== 'loading') boot();
