/** 轻量 Toast：创建后在指定时长后自动移除。 */
export function createToast({ duration = 4000 } = {}) {
  return function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = String(message ?? '');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
    return el;
  };
}
