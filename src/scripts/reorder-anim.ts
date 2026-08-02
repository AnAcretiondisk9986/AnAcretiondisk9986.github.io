// FLIP 排序动画:重排前后各调用 captureFlip / playFlip,让卡片平滑位移到新位置。
// 约定:重排前调用 captureFlip(container),DOM 重排(append/排序)后调用 playFlip(container)。
// 尊重 prefers-reduced-motion;display:none 的元素(如画廊翻页隐藏卡片)不参与测量。
export function captureFlip(container: HTMLElement) {
  const frames = new WeakMap<HTMLElement, DOMRect>();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return frames;
  container
    .querySelectorAll<HTMLElement>('[data-order-card], [data-gallery-card], [data-gallery-album]')
    .forEach((el) => {
      if (el.offsetParent === null) return;
      frames.set(el, el.getBoundingClientRect());
    });
  return frames;
}

export function playFlip(container: HTMLElement, frames: WeakMap<HTMLElement, DOMRect>) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  container
    .querySelectorAll<HTMLElement>('[data-order-card], [data-gallery-card], [data-gallery-album]')
    .forEach((el) => {
      if (el.offsetParent === null) return;
      const first = frames.get(el);
      if (!first) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // 强制 reflow,使补偿位移立即生效
      el.style.transition = '';
      el.style.transform = '';
    });
}
