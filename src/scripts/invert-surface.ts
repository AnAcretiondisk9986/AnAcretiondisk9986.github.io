/**
 * invert-surface.ts — 液态玻璃主题（still / fluid）的明暗自适应反色。
 *
 * 实时采样玻璃背后背景（hero 图片对应区域 / 页面纸面）的亮度：
 *  - 背景暗  → 注入深色玻璃 + 亮色文字（反色态）
 *  - 背景亮  → 清除变量，回退原浅玻璃 + 深色文字（原设计）
 *
 * 驱动源：滚动（header 背后在纸面 ↔ hero 图片之间变化）、resize、
 * 视觉主题 / 明暗主题切换（MutationObserver）、hero 图片加载完成。
 * 采样经 canvas 缩放 48×48 后加权亮度；图片以 CORS 模式加载（jsDelivr 支持）。
 * 仅 light 主题的 still/fluid 生效；dark 主题玻璃本就是深色系统，保持原设计。
 */
const ACTIVE_THEMES = new Set(['still', 'fluid']);
const SAMPLE = 48; // 采样画布边长
const THROTTLE_MS = 100; // 采样节流
const DARK_IN = 0.36; // 亮度低于此值进入暗态
const DARK_OUT = 0.44; // 亮度高于此值退出暗态

/** 暗态注入的 CSS 变量（键含前缀，见 applyVars；亮态清除后回退原设计） */
const DARK_VARS: Record<string, string> = {
  'hdr-ink': '#f4faf7',
  'hdr-soft': 'rgba(244, 250, 247, 0.88)',
  'hdr-faint': 'rgba(244, 250, 247, 0.6)',
  'hdr-glass': 'rgba(20, 31, 28, 0.62)',
  'hdr-border': 'rgba(255, 255, 255, 0.18)',
  'hdr-seal-bg': 'rgba(244, 250, 247, 0.94)',
  'hdr-seal-ink': '#172321',
  'hero-ink': '#f4faf7',
  'hero-soft': 'rgba(244, 250, 247, 0.86)',
  'hero-faint': 'rgba(244, 250, 247, 0.6)',
  'hero-glass': 'rgba(20, 31, 28, 0.66)',
  'hero-border': 'rgba(255, 255, 255, 0.2)',
  'hero-rule': 'rgba(255, 255, 255, 0.18)',
  'btn-ink': '#f4faf7',
  'btn-glass': 'rgba(20, 31, 28, 0.72)',
  'btn-glass-hover': 'rgba(255, 255, 255, 0.18)',
  'btn-border': 'rgba(255, 255, 255, 0.28)',
};

type Mode = 'light' | 'dark';
type Region = { x: number; y: number; w: number; h: number };

(() => {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let heroImg: HTMLImageElement | null = null;
  let heroEl: HTMLElement | null = null;
  let headerEl: HTMLElement | null = null;
  let bodyLum: number | null = null; // 页面纸面亮度（--paper）
  let overlay = 0; // hero scrim 不透明度（--liquid-overlay）
  let pending = false;
  let lastRun = 0;
  let headerMode: Mode = 'light';
  let heroMode: Mode = 'light';
  let btnMode: Mode = 'light';

  const isActive = () => {
    const vt = root.dataset.visualTheme;
    return !!vt && ACTIVE_THEMES.has(vt) && root.dataset.theme !== 'dark';
  };

  const lumOf = (data: Uint8ClampedArray): number => {
    let sum = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return sum / n / 255;
  };

  /** 采样 hero 图片上归一化区域（相对图片 0..1）的平均亮度，叠加 scrim 修正 */
  const sampleRegion = (region: Region | null): number | null => {
    if (!ctx || !heroImg || !heroImg.complete || heroImg.naturalWidth === 0) return null;
    const iw = heroImg.naturalWidth;
    const ih = heroImg.naturalHeight;
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const sx = region ? region.x * iw : 0;
    const sy = region ? region.y * ih : 0;
    const sw = region ? Math.max(1, region.w * iw) : iw;
    const sh = region ? Math.max(1, region.h * ih) : ih;
    try {
      ctx.drawImage(heroImg, sx, sy, sw, sh, 0, 0, SAMPLE, SAMPLE);
      return lumOf(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data) * (1 - overlay);
    } catch {
      return null;
    }
  };

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  /** 元素相对宿主（hero）的归一化区域 */
  const relRegion = (el: Element, host: Element): Region | null => {
    const er = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    if (hr.width <= 0 || hr.height <= 0) return null;
    const region: Region = {
      x: (er.left - hr.left) / hr.width,
      y: (er.top - hr.top) / hr.height,
      w: er.width / hr.width,
      h: er.height / hr.height,
    };
    // 越界裁剪
    if (region.x + region.w <= 0 || region.y + region.h <= 0) return null;
    region.x = clamp01(region.x);
    region.y = clamp01(region.y);
    region.w = clamp01(region.x + region.w) - region.x;
    region.h = clamp01(region.y + region.h) - region.y;
    return region.w > 0 && region.h > 0 ? region : null;
  };

  const parseLum = (css: string): number | null => {
    const t = css.trim();
    let r = 0;
    let g = 0;
    let b = 0;
    const hex = t.match(/^#([0-9a-f]{6})/i);
    if (hex) {
      r = parseInt(hex[1].slice(0, 2), 16);
      g = parseInt(hex[1].slice(2, 4), 16);
      b = parseInt(hex[1].slice(4, 6), 16);
    } else {
      const rgb = t.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (!rgb) return null;
      r = Number(rgb[1]);
      g = Number(rgb[2]);
      b = Number(rgb[3]);
    }
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  /** 带迟滞的明暗判定 */
  const decide = (lum: number | null, current: Mode): Mode => {
    if (lum == null) return 'light';
    if (current === 'dark') return lum > DARK_OUT ? 'light' : 'dark';
    return lum < DARK_IN ? 'dark' : 'light';
  };

  /** 注入 / 清除一组前缀变量 */
  const applyVars = (prefix: string, mode: Mode) => {
    for (const key of Object.keys(DARK_VARS)) {
      if (!key.startsWith(prefix)) continue;
      if (mode === 'dark') root.style.setProperty(`--acr-${key}`, DARK_VARS[key]);
      else root.style.removeProperty(`--acr-${key}`);
    }
  };

  const syncImage = () => {
    const media = document.querySelector('.liquid-hero-media');
    if (!media) {
      heroImg = null;
      return;
    }
    let current: HTMLImageElement | null = null;
    for (const img of media.querySelectorAll<HTMLImageElement>('img.liquid-hero-image')) {
      if (getComputedStyle(img).display !== 'none') {
        current = img;
        break;
      }
    }
    if (!current) {
      heroImg = null;
      return;
    }
    if (heroImg !== current) {
      heroImg = current;
      heroImg.addEventListener('load', schedule, { once: true });
    }
  };

  const computeHeader = () => {
    const hr = heroEl?.getBoundingClientRect();
    const er = headerEl?.getBoundingClientRect();
    let lum: number | null = bodyLum;
    if (hr && er && hr.height > 0 && er.height > 0 && heroImg) {
      const top = Math.max(hr.top, er.top);
      const bottom = Math.min(hr.bottom, er.bottom);
      const overlap = Math.max(0, bottom - top);
      if (overlap > 0) {
        const ratio = Math.min(1, overlap / er.height); // header 与 hero 的重叠比例
        const region: Region = {
          x: 0,
          y: clamp01((top - hr.top) / hr.height),
          w: 1,
          h: clamp01((bottom - top) / hr.height),
        };
        const imgLum = sampleRegion(region);
        if (imgLum != null) lum = (bodyLum ?? 0.9) * (1 - ratio) + imgLum * ratio;
      }
    }
    headerMode = decide(lum, headerMode);
    applyVars('hdr', headerMode);
  };

  const computeHeroElements = () => {
    if (!heroEl || !heroImg) return;
    const register = document.querySelector('.hero-register');
    const primary = document.querySelector('.primary-link');
    if (register) {
      const region = relRegion(register, heroEl);
      heroMode = decide(region ? sampleRegion(region) : null, heroMode);
      applyVars('hero', heroMode);
    }
    if (primary) {
      const region = relRegion(primary, heroEl);
      btnMode = decide(region ? sampleRegion(region) : null, btnMode);
      applyVars('btn', btnMode);
    }
  };

  const update = () => {
    if (!isActive()) {
      // 非 still/fluid 或 dark 主题：全部回退原设计
      applyVars('hdr', 'light');
      applyVars('hero', 'light');
      applyVars('btn', 'light');
      return;
    }
    if (!heroEl) heroEl = document.querySelector('.codex-hero');
    if (!headerEl) headerEl = document.querySelector('.site-header');
    syncImage();
    bodyLum = parseLum(getComputedStyle(root).getPropertyValue('--paper'));
    overlay = Number.parseFloat(getComputedStyle(root).getPropertyValue('--liquid-overlay')) || 0;
    computeHeader();
    computeHeroElements();
  };

  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const now = performance.now();
      if (now - lastRun >= THROTTLE_MS) {
        lastRun = now;
        update();
      }
    });
  };

  const ensure = () => {
    // window 级监听（scroll/resize）只需绑定一次。跨 document 的 View Transitions 导航
    // 会创建新 Window 对象，window.__acrInvertSurfaceBound 标记随之销毁、旧监听器随旧
    // Window GC，因此本脚本每次导航后重执行都会走全新绑定，不会累积双监听器。
    // MutationObserver/astro:page-load 绑定在 document 级，同样随旧 document 销毁，
    // 用新 root 的 dataset 标记判断是否需要重新绑定即可。
    const win = window as unknown as { __acrInvertSurfaceBound?: boolean };
    if (!win.__acrInvertSurfaceBound) {
      win.__acrInvertSurfaceBound = true;
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
    }
    if (root.dataset.acrInvertSurface) return; // 同一 document 只绑定一次
    root.dataset.acrInvertSurface = '1';
    new MutationObserver(schedule).observe(root, {
      attributes: true,
      attributeFilter: ['data-visual-theme', 'data-theme'],
    });
    document.addEventListener('astro:page-load', schedule);
    schedule();
  };

  document.addEventListener('astro:page-load', ensure);
  ensure();
})();
