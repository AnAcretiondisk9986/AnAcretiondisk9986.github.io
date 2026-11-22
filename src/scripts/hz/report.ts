/**
 * HORIZON · report.ts (/blog/report/ 多期切换与 URL ?period= 同步)
 */
function initReport() {
  const root = document.querySelector<HTMLElement>('[data-report-root]');
  if (!root) return;

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-rep-tab]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-rep-panel]')];
  if (!tabs.length || !panels.length) return;

  const select = (id: string, pushUrl = true) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.repTab === id)));
    panels.forEach((p) => { p.hidden = p.dataset.repPanel !== id; });
    if (pushUrl) {
      const next = new URLSearchParams(location.search);
      if (id && id !== (root.dataset.defaultReport || '')) next.set('period', id);
      else next.delete('period');
      const qs = next.toString();
      history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    }
  };

  const urlPeriod = new URLSearchParams(location.search).get('period')?.trim() || '';
  if (urlPeriod && panels.some((p) => p.dataset.repPanel === urlPeriod)) {
    select(urlPeriod, false);
  }

  tabs.forEach((t) => t.addEventListener('click', () => {
    const id = t.dataset.repTab || '';
    if (id) select(id);
  }));
}

initReport();
document.addEventListener('astro:page-load', initReport);
