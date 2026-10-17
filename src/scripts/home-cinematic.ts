/**
 * home-cinematic.ts — 首页电影感滚动系统的控制器
 *
 * 只做三件事，且只在首页生效（页面里没有 [data-hero] / [data-reveal] 就直接退出）：
 *   1. 把首屏的滚动进度换算成 --hp（0→1），交给 CSS 做逐层退场；
 *   2. 用 IntersectionObserver 给各分区 / 卡片 / 图版挂 .is-in，触发 CSS 过渡；
 *   3. 跟随 Astro ClientRouter 的导航生命周期重装，避免重复监听、失效观察器。
 *
 * 设计上的几条硬约束：
 *   · 无脚本 / 脚本异常 / prefers-reduced-motion: reduce 时页面必须就是原样——
 *     所有"隐藏初态"的样式都挂在 html.fx 之下，而 fx 只有本脚本才会加；
 *     初始化抛异常时先移除 fx 再退出，内容不会卡在隐藏态。
 *   · 滚动只读一次 window.scrollY、只写一个 CSS 变量，用 rAF 合并，不读布局。
 *   · 首屏退场与原有的一次性入场动画（f-hero-in）靠 .is-fx 交棒，
 *     两者不会同时驱动同一组属性。
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * 首屏入场动画的真正终点：内容是 .72s + 最晚 .44s 延迟 = 1160ms，
 * 但域名下的铜线（f-rule-in 1.1s + .18s 延迟）到 1280ms 才展开完；
 * 交棒必须晚于最慢的那一个，否则铜线会在中途被截断。
 */
const HERO_HANDOVER_DELAY = 1340;

/** 首屏在滚动到自身底边约 88% 处完成退场：结束那一刻内容刚好要离开视口，不留空洞 */
const HERO_RANGE_RATIO = 0.88;
const HERO_MIN_RANGE = 320;

/** 进入视口判定：底部留 8% 余量，元素露头即触发，不等完全露全 */
const REVEAL_ROOT_MARGIN = '0px 0px -8% 0px';

/** 初始化时已经落在视口内（或已经滚过去）的目标，直接标记为已显现，不补播动画 */
const REVEAL_READY_RATIO = 0.92;

type Teardown = () => void;

const root = document.documentElement;
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

let teardown: Teardown | null = null;

/**
 * 当前 document 上已经接管过的那一屏（.f-hero 元素本身）。
 * 首次装载时模块顶层和 astro:page-load 会各调一次 init；用元素身份判断
 * "同一屏已经接管过"，避免第二次接管重置交棒计时（重资源页面 load 很晚时
 * 会把滚动退场无故推迟）。
 */
let activeHero: HTMLElement | null = null;

/** 卸载当前页面上的动画控制器（如果还挂着） */
function teardownAll(): void {
  if (teardown) {
    try {
      teardown();
    } catch {
      /* 清理失败不应阻断后续流程 */
    }
    teardown = null;
  }
  root.classList.remove('fx');
}

/**
 * 首屏滚动退场。
 *
 * 滚动区间不在 scroll 回调里测量：hero 的高度只在加载、字体就绪、窗口尺寸变化时
 * 变一次，其余时间直接用缓存值。paint() 只写 --hp，不读布局，因此不会造成
 * 强制同步布局（读取全部发生在 measure()）。
 */
function setupHero(cleanups: Teardown[]): void {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;

  let range = HERO_MIN_RANGE;
  let lastProgress = -1;
  let frame = 0;
  let handoverTimer = 0;
  let settleTimer = 0;
  let disposed = false;

  const measure = () => {
    const rect = hero.getBoundingClientRect();
    // hero 底边在文档中的绝对位置：滚到它附近时首屏正好退场完毕
    const absoluteBottom = rect.bottom + window.scrollY;
    range = Math.max(HERO_MIN_RANGE, absoluteBottom * HERO_RANGE_RATIO);
  };

  const paint = () => {
    frame = 0;
    if (disposed) return;
    const progress = clamp01(window.scrollY / range);
    // 同一次滚动的像素级抖动没必要重新写变量
    if (Math.abs(progress - lastProgress) < 0.0015) return;
    lastProgress = progress;
    hero.style.setProperty('--hp', progress.toFixed(4));
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(paint);
  };

  const onResize = () => {
    measure();
    schedule();
  };

  /** 入场动画播完后把首屏交给滚动进度：先量区间、写进度，再切状态位 */
  const handover = () => {
    if (handoverTimer) {
      window.clearTimeout(handoverTimer);
      handoverTimer = 0;
    }
    if (hero.classList.contains('is-fx')) return;
    measure();
    paint();
    // 交棒时 --hp 可能已不为 0（用户提前滚动 / 刷新停在中段）：
    // 用一次性过渡把这次跳变收成 0.34s 的落位，而不是瞬移。
    if (window.scrollY > 0) {
      hero.classList.add('is-settle');
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        hero.classList.remove('is-settle');
      }, 420);
    }
    hero.classList.add('is-fx');
  };

  measure();
  paint();

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  // hero 高度变化（字体替换、图片完全解码、旋转屏幕）都要重新标定区间
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(hero);
  }
  document.fonts?.ready
    .then(() => {
      if (disposed) return;
      measure();
      schedule();
    })
    .catch(() => {
      /* 字体加载失败时保持现有区间即可 */
    });

  // 刷新后停在中段时不要再补播入场动画，直接进入滚动驱动状态
  if (window.scrollY > 80) handover();
  else handoverTimer = window.setTimeout(handover, HERO_HANDOVER_DELAY);

  cleanups.push(() => {
    disposed = true;
    if (handoverTimer) window.clearTimeout(handoverTimer);
    if (settleTimer) window.clearTimeout(settleTimer);
    if (frame) window.cancelAnimationFrame(frame);
    // 落位过渡是一次性的：卸载时必须摘掉，否则重新接管后每次 --hp 变化都会被拖尾
    hero.classList.remove('is-settle');
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', onResize);
    resizeObserver?.disconnect();
  });
}

/**
 * 进入视口的显现。
 *
 * 返回尚未进入视口的目标；同时把已经可见的目标直接标成 .is-in（在加 fx 之前，
 * 两者在同一帧完成，不会触发过渡），避免首屏内容在装载时先露出来再收回去。
 */
function prepareReveal(): HTMLElement[] {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  const viewport = window.innerHeight || 800;
  const pending: HTMLElement[] = [];

  for (const target of targets) {
    if (target.getBoundingClientRect().top < viewport * REVEAL_READY_RATIO) {
      target.classList.add('is-in');
    } else {
      pending.push(target);
    }
  }

  return pending;
}

function observeReveal(pending: HTMLElement[], cleanups: Teardown[]): void {
  if (!pending.length) return;

  if (typeof IntersectionObserver !== 'function') {
    // 旧浏览器：没有观察器就一次性全部显现，宁可没有动画也不要内容缺失
    for (const target of pending) target.classList.add('is-in');
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        // 一次性的显现：向上滚回去不再重新隐藏，避免阅读时反复闪烁
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.01, rootMargin: REVEAL_ROOT_MARGIN },
  );

  for (const target of pending) observer.observe(target);
  cleanups.push(() => observer.disconnect());
}

/**
 * 首页初始化：幂等，可以反复调用（模块顶层 / DOMContentLoaded / 每次 ClientRouter 导航）。
 *
 * @param force 为 true 时强制重装；用于系统偏好从 reduce 切回 no-preference。
 *              首次装载时同一个 hero 元素会被调用两次（顶层 + astro:page-load），
 *              这里直接跳过第二次，避免重置交棒计时。
 */
function init(force = false): void {
  const hero = document.querySelector<HTMLElement>('[data-hero]');

  // 同一屏已经接管过（首次装载的第二次调用）：什么都不用做
  if (!force && hero && hero === activeHero) return;

  teardownAll();
  activeHero = hero;

  // 不是首页（没有首屏标记也没有显现目标）就什么都不做
  if (!hero && !document.querySelector('[data-reveal]')) return;

  // 减少动效：一行隐藏样式都不启用，页面保持静态可读
  if (window.matchMedia(REDUCED_MOTION).matches) return;

  const cleanups: Teardown[] = [];
  teardown = () => {
    for (const clean of cleanups.splice(0)) {
      try {
        clean();
      } catch {
        /* 单个清理失败不影响其它资源回收 */
      }
    }
    root.classList.remove('fx');
  };

  try {
    const pending = prepareReveal();
    // 先标记已可见目标，再加 fx：同一帧内完成，装载时没有闪烁
    root.classList.add('fx');
    observeReveal(pending, cleanups);
    setupHero(cleanups);
  } catch {
    // 任何异常都退回"内容全部可见"的静态状态
    teardownAll();
  }
}

// ── 系统偏好运行中切换（用户临时打开"减少动态效果"）──
const motionQuery = window.matchMedia(REDUCED_MOTION);
motionQuery.addEventListener?.('change', () => {
  if (motionQuery.matches) teardownAll();
  else init(true);
});

// ── Astro ClientRouter：新文档替换后重新接管，避免重复初始化 ──
document.addEventListener('astro:page-load', () => init());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init(), { once: true });
} else {
  init();
}

export {};
