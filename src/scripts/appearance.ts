(() => {
  const allowedVisualThemes = ['cyanotype', 'still', 'fluid', 'minimal', 'trace'];
  const syncStoredAppearance = (root: HTMLElement, defaultVisualTheme: string) => {
    let savedTheme: string | null = null;
    let savedVisualTheme: string | null = null;
    try {
      savedTheme = localStorage.getItem('theme');
      savedVisualTheme = localStorage.getItem('visual-theme');
    } catch { /* Storage can be disabled without disabling the theme controls. */ }
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = ['light', 'dark'].includes(savedTheme || '') ? savedTheme! : (systemDark ? 'dark' : 'light');
    root.dataset.visualTheme = allowedVisualThemes.includes(savedVisualTheme || '')
      ? savedVisualTheme || defaultVisualTheme
      : defaultVisualTheme;
    root.classList.add('js');
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.classList.add('vt');
    }
  };

  const syncThemeButton = () => {
    const button = document.querySelector<HTMLButtonElement>('.theme-toggle');
    const dark = document.documentElement.dataset.theme === 'dark';
    button?.setAttribute('aria-label', dark ? '切换为浅色模式' : '切换为深色模式');
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = dark ? '/favicon-dark.png' : '/favicon.png';
  };

  const bind = () => {
    syncThemeButton();
    const button = document.querySelector<HTMLButtonElement>('.theme-toggle');
    if (button && button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        const apply = () => {
          document.documentElement.dataset.theme = next;
          try { localStorage.setItem('theme', next); } catch {}
          syncThemeButton();
        };
        if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          document.startViewTransition(apply);
        } else {
          apply();
        }
      });
    }
    requestAnimationFrame(() => document.documentElement.classList.add('is-ready'));
  };

  const defaultVisualTheme = document.documentElement.dataset.defaultVisualTheme || 'cyanotype';
  syncStoredAppearance(document.documentElement, defaultVisualTheme);
  bind();

  if (!window.__acrAppearanceLifecycleBound) {
    window.__acrAppearanceLifecycleBound = true;
    document.addEventListener('astro:before-swap', (event) => {
      const root = event.newDocument?.documentElement;
      if (root) syncStoredAppearance(root, defaultVisualTheme);
    });
    document.addEventListener('astro:after-swap', () => {
      syncStoredAppearance(document.documentElement, defaultVisualTheme);
      bind();
    });
    document.addEventListener('astro:page-load', () => {
      syncStoredAppearance(document.documentElement, defaultVisualTheme);
      bind();
    });
  }
})();

