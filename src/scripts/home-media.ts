/**
 * 首页首屏横幅的「可读性自适应」与卡片封面的「渐进显影」。
 *
 * 背景：横幅背景图来自用户自选的摄影/插画，亮度从纯黑到过曝都可能出现。
 * 固定浓度的遮罩必然在某些图上失效——要么图被压得看不见（旧版 opacity .048，
 * 等于 95% 遮罩），要么亮图上深色文字彻底糊掉。所以这里在图片就绪后降采样取
 * 平均感知亮度，把遮罩浓度反解成「刚好保住文字对比」的值，交给 CSS 变量。
 *
 * 没有脚本、采样失败、CORS 被拒、图片加载失败，都会落到 CSS 里的默认值，
 * 首屏永远不会因为这段代码而空白。
 */

type MediaState = 'missing' | 'ready';

const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/** 降采样到 32×32 取平均感知亮度（sRGB 加权，0 = 黑，1 = 白） */
function sampleLuminance(img: HTMLImageElement): number | null {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let sum = 0;
    let count = 0;
    // 跳过四角 1/4 的暗角，避免边框留白把平均亮度拉偏
    for (let i = 0; i < data.length; i += 4) {
      const pixel = i / 4;
      const x = pixel % size;
      const y = (pixel / size) | 0;
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      if (edge) continue;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      count += 1;
    }
    if (!count) return null;
    return sum / count / 255;
  } catch {
    return null; // canvas 被跨域污染
  }
}

/**
 * 文字极性 + 遮罩浓度一起反解：
 *   tone="light"（背景图够亮）→ 用墨色文字，纸色薄纱只轻轻压一下，图保持通透；
 *   tone="dark" （背景图偏暗）→ 用纸白文字，深色纱幕压住中央文字区。
 * 暗色主题永远走 tone="dark"：暗底浅字是唯一稳妥的组合。
 * 两个区间都不允许把图压死——中央纱幕上限 0.8，四角只保底 18%。
 */
function decideTone(luma: number, darkTheme: boolean) {
  const tone: 'light' | 'dark' = !darkTheme && luma > 0.5 ? 'light' : 'dark';
  const veil = tone === 'light'
    // 亮图 + 墨字：纸色纱幕只做极轻的提亮，图几乎全显
    ? clamp(0.08, 0.08 + (luma - 0.58) * 0.3, 0.22)
    // 暗背景 + 纸白字：深色纱幕随图片亮度上升，越亮的图压得越狠
    : clamp(0.34, 0.34 + (luma - 0.18) * 0.62, 0.8);
  return { tone, veil };
}

function initHero(root: ParentNode) {
  const hero = root.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;
  const img = hero.querySelector<HTMLImageElement>('.f-hero__image');
  if (!img) {
    hero.dataset.media = 'missing';
    return;
  }

  const settle = (state: MediaState) => {
    hero.dataset.media = state;
    if (state === 'missing') return;
    const luma = sampleLuminance(img);
    if (luma === null) {
      // 采样失败（多半是 CORS）：保持 CSS 默认浓度，不折腾用户
      hero.style.removeProperty('--hero-veil');
      return;
    }
    const dark = document.documentElement.dataset.theme === 'dark';
    const { tone, veil } = decideTone(luma, dark);
    hero.dataset.tone = tone;
    hero.style.setProperty('--hero-veil', veil.toFixed(3));
    hero.style.setProperty('--hero-luma', luma.toFixed(3));
  };

  if (img.complete && img.naturalWidth > 0) {
    settle('ready');
  } else {
    img.addEventListener('load', () => settle('ready'), { once: true });
    img.addEventListener('error', () => settle('missing'), { once: true });
  }
}

/** 卡片封面：图片解码完成才淡入；未加载时是同尺寸骨架，不会造成版面跳动 */
function initCoverReveal(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.f-card__frame').forEach((frame) => {
    const img = frame.querySelector<HTMLImageElement>('img');
    if (!img) {
      frame.dataset.empty = 'true';
      return;
    }
    const done = () => {
      frame.dataset.loaded = 'true';
      frame.dataset.loading = 'false';
    };
    const fail = () => {
      frame.dataset.empty = 'true';
      frame.dataset.loading = 'false';
    };
    if (img.complete) {
      if (img.naturalWidth > 0) done();
      else fail();
      return;
    }
    frame.dataset.loading = 'true';
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', fail, { once: true });
  });
}

/** 主题切换后遮罩浓度要跟着重算（纸色纱幕 ↔ 墨色纱幕） */
function watchTheme() {
  if (typeof MutationObserver !== 'object') return;
  const observer = new MutationObserver(() => {
    const hero = document.querySelector<HTMLElement>('[data-hero]');
    const luma = hero?.style.getPropertyValue('--hero-luma');
    if (!hero || !luma) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const { tone, veil } = decideTone(Number(luma), dark);
    hero.dataset.tone = tone;
    hero.style.setProperty('--hero-veil', veil.toFixed(3));
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

const boot = () => {
  initHero(document);
  initCoverReveal(document);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
watchTheme();

// ClientRouter 导航后重新接管新页面
document.addEventListener('astro:page-load', boot);

export {};


