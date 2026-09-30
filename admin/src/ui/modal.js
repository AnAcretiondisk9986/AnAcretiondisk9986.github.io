/** 模态框：显隐、aria 标注与键盘焦点锁定。 */
export function openModal(el) {
  if (!el) return;
  el.style.display = 'flex';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.dataset.open = '1';
  const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) setTimeout(() => focusable.focus(), 0);
}

export function closeModal(el) {
  if (!el) return;
  el.style.display = 'none';
  delete el.dataset.open;
}

export function isModalOpen(el) {
  return Boolean(el && el.style.display !== 'none');
}

export function openModals() {
  return [...document.querySelectorAll('.video-modal-mask')].filter((m) => m.style.display !== 'none');
}

/** 安装全局 Tab 焦点锁定：焦点始终停留在最上层打开模态框内。 */
export function installFocusTrap() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const open = openModals();
    if (!open.length) return;
    const modal = open[open.length - 1];
    const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    else if (!modal.contains(active)) { e.preventDefault(); first.focus(); }
  });
}
