import { captureFlip, playFlip } from './reorder-anim';

// 通用「从新至旧 / 从旧至新」客户端排序（主页 / 卷册目录页共用）
// 约定：排序条按钮 [data-order-sort="newest|oldest"]、状态 [data-order-status]、
//      列表容器 [data-order-list]、条目 [data-order-card]（带 data-order-date /
//      data-order-day-index / data-order-position）、编号元素 [data-order-sequence]
//      （data-order-pad 控制补零位数）。状态以 ?order=oldest 记忆在 URL 中。
// 幂等：首页与卷册页的脚本模块都会注册 astro:page-load 监听器并调用本函数，
// 对同一列表容器重复初始化会被跳过，避免按钮重复绑定导致排序来回切换。
const boundLists = new WeakSet<HTMLElement>();

export function initOrderToggle() {
  const sortButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-order-sort]')];
  const orderStatus = document.querySelector<HTMLElement>('[data-order-status]');
  const orderText = document.querySelector<HTMLElement>('[data-order-text]');
  const list = document.querySelector<HTMLElement>('[data-order-list]');
  if (!sortButtons.length || !list) return;
  if (boundLists.has(list)) return;
  boundLists.add(list);

  type Order = 'newest' | 'oldest';

  function setOrder(order: Order, updateUrl = true) {
    sortButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.orderSort === order));
    });
    if (orderStatus) orderStatus.textContent = order === 'newest' ? '从新至旧' : '从旧至新';
    if (orderText) orderText.textContent = order === 'newest' ? '由新至旧' : '由旧至新';

    const cards = [...list.querySelectorAll<HTMLElement>('[data-order-card]')];
    const frames = captureFlip(list);
    cards.sort((a, b) => {
      const aTime = Date.parse(a.dataset.orderDate || '');
      const bTime = Date.parse(b.dataset.orderDate || '');
      if (aTime !== bTime) return order === 'newest' ? bTime - aTime : aTime - bTime;
      const aDay = Number(a.dataset.orderDayIndex || '0');
      const bDay = Number(b.dataset.orderDayIndex || '0');
      if (aDay !== bDay) return order === 'newest' ? bDay - aDay : aDay - bDay;
      const positionDelta = Number(a.dataset.orderPosition) - Number(b.dataset.orderPosition);
      return order === 'newest' ? positionDelta : -positionDelta;
    });
    list.append(...cards);
    playFlip(list, frames);
    cards.forEach((card, index) => {
      const seq = card.querySelector<HTMLElement>('[data-order-sequence]');
      if (seq) seq.textContent = String(index + 1).padStart(Number(seq.dataset.orderPad || '2'), '0');
    });

    if (updateUrl) {
      const url = new URL(location.href);
      if (order === 'newest') url.searchParams.delete('order');
      else url.searchParams.set('order', 'oldest');
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => setOrder(button.dataset.orderSort === 'oldest' ? 'oldest' : 'newest'));
  });
  setOrder(new URLSearchParams(location.search).get('order') === 'oldest' ? 'oldest' : 'newest', false);
}
