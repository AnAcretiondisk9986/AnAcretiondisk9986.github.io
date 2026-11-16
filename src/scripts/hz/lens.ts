/**
 * HORIZON · lens.ts
 * 悬停文章行时跟随指针的「引力透镜」圆形封面预览。
 * 事件委托 + 按需 RAF：鼠标离开列表后循环自动停止。
 */

export function initLens() {
  const lens = document.querySelector<HTMLElement>('[data-lens]');
  let img = lens?.querySelector<HTMLImageElement>('[data-lens-img]') ?? null;
  const cap = lens?.querySelector<HTMLElement>('[data-lens-cap]');
  if (!lens || !img) return;
  if (!matchMedia('(pointer: fine)').matches) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let activeRow: HTMLElement | null = null;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let raf = 0;

  const clampTarget = (x: number, y: number) => {
    const pad = 132;
    return {
      x: Math.max(pad, Math.min(window.innerWidth - pad, x + 28)),
      y: Math.max(pad, Math.min(window.innerHeight - pad, y - 24)),
    };
  };

  const frame = () => {
    raf = 0;
    if (!activeRow) return;
    if (reduce) {
      cx = tx;
      cy = ty;
    } else {
      cx += (tx - cx) * 0.2;
      cy += (ty - cy) * 0.2;
    }
    lens.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%)`;
    if (Math.abs(tx - cx) > 0.4 || Math.abs(ty - cy) > 0.4) {
      raf = requestAnimationFrame(frame);
    }
  };

  const showRow = (row: HTMLElement, e: PointerEvent) => {
    const thumb = row.dataset.lensThumb;
    if (!thumb) {
      hide();
      return;
    }
    activeRow = row;
    const pos = clampTarget(e.clientX, e.clientY);
    if (!lens.classList.contains('is-visible')) {
      cx = pos.x;
      cy = pos.y;
    }
    tx = pos.x;
    ty = pos.y;

    if (img.dataset.currentSrc !== thumb) {
      const nextImg = document.createElement('img');
      nextImg.alt = '';
      nextImg.setAttribute('data-lens-img', '');
      nextImg.dataset.currentSrc = thumb;
      if (row.dataset.lensOrig) nextImg.dataset.originalCover = row.dataset.lensOrig;
      nextImg.src = thumb;
      img.replaceWith(nextImg);
      img = nextImg;
    }
    if (cap) cap.textContent = row.dataset.lensLabel || '';
    lens.classList.add('is-visible');
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const hide = () => {
    activeRow = null;
    lens.classList.remove('is-visible');
  };

  document.addEventListener(
    'pointerover',
    (e) => {
      const target = e.target as HTMLElement | null;
      const row = target?.closest<HTMLElement>('[data-post-row]');
      if (row && row.dataset.lensThumb) {
        showRow(row, e);
      } else if (!row) {
        hide();
      }
    },
    { passive: true },
  );

  document.addEventListener(
    'pointermove',
    (e) => {
      if (!activeRow) return;
      const pos = clampTarget(e.clientX, e.clientY);
      tx = pos.x;
      ty = pos.y;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    { passive: true },
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      if (!activeRow) return;
      const rel = e.relatedTarget as HTMLElement | null;
      if (!rel?.closest?.('[data-post-row]')) hide();
    },
    { passive: true },
  );
}

initLens();
