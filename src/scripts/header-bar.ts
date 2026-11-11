/**
 * header-bar.ts — 页头吸顶的几何标定（全站生效，随 ClientRouter 重装）
 *
 * 页头用 `position: sticky; top: calc(-1 * var(--f-header-stick))` 实现
 * 「上半条滚走、品牌导航条常驻」。这个负值必须等于"从页头顶边到品牌条顶边"
 * 的距离（报头双行线的高度 + 上内边距），它会随断点、字体替换和文案长度变化，
 * 所以由这里量出来写到 :root：
 *   --f-header-stick  吸顶负偏移
 *   --f-header-bar    吸顶后常驻条的高度（供 scroll-padding-top 用）
 *
 * 当前 DOM 只有一段（.f-masthead），没有 .f-register 报头双行线，所以
 * stick 正常量到 0：整条 70px（桌面）/ 约 106px（移动）一起常驻。
 * 一旦以后把报头双行线加回来，这里的算术不需要改。
 *
 * 没有脚本时 CSS 里的兜底是 0：整条页头一起吸顶，功能不受影响。
 */

const ROOT = document.documentElement;
let observer: ResizeObserver | null = null;

/**
 * 给 <main> 补上 skip link 需要的落点：
 * `#main` + `tabindex="-1"`（没有 tabindex 的 main 无法被焦点跳转命中）。
 * BaseLayout 不归本任务改，所以在这里按需补齐，幂等。
 */
function ensureMainLandmark(): void {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  if (!main.id) main.id = 'main';
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
}

function measure(): void {
  const header = document.querySelector<HTMLElement>('.f-header');
  const masthead = header?.querySelector<HTMLElement>('.f-masthead');
  if (!header || !masthead) return;

  const headerRect = header.getBoundingClientRect();
  const mastheadRect = masthead.getBoundingClientRect();
  // 品牌条顶边相对页头顶边的距离 = 需要"藏到视口上方"的那一段
  const stick = Math.max(0, Math.round(mastheadRect.top - headerRect.top));
  const bar = Math.max(0, Math.round(headerRect.height - stick));

  ROOT.style.setProperty('--f-header-stick', `${stick}px`);
  ROOT.style.setProperty('--f-header-bar', `${bar}px`);
}

function setup(): void {
  observer?.disconnect();
  observer = null;

  ensureMainLandmark();

  const header = document.querySelector<HTMLElement>('.f-header');
  if (!header) return;

  measure();

  // 页头自身高度变化（字体替换、文案换行、断点切换）时重新标定
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(measure);
    observer.observe(header);
    const masthead = header.querySelector<HTMLElement>('.f-masthead');
    if (masthead) observer.observe(masthead);
  }
  document.fonts?.ready.then(measure).catch(() => {
    /* 字体加载失败时保持当前测量值即可 */
  });
}

// window 级监听随文档存活，模块只执行一次；页面导航后由 setup() 重新绑定观察器。
window.addEventListener('resize', measure, { passive: true });

// ClientRouter 导航会换掉 header 元素（脚本本身不会重执行），所以每次 page-load 重新接管
document.addEventListener('astro:page-load', setup);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup, { once: true });
} else {
  setup();
}

export {};
