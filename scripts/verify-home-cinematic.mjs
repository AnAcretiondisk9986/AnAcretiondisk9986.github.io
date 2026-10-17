// 首页电影感滚动系统回归验证
//
// 覆盖：桌面/移动两种视口、滚动进度映射与可逆性、分区/卡片/图版的进入态、
//      reduced-motion 降级、无 JavaScript 降级、ClientRouter 导航后的重装、
//      横向溢出与控制台异常。
//
// 用法（与 verify-gallery-perf.mjs 同套路）：
//   1) npm run build
//   2) node scripts/verify-home-cinematic.mjs
//   截图输出到 perf-reports/home-cinematic/（已在 .gitignore 中）
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'perf-reports', 'home-cinematic');
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(DIST, normalize(p));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔ PASS' : '✖ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待条件成立 */
async function until(fn, timeout = 3000, step = 60) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(step);
  }
}

/** 计算样式里的 translate 是 "x y"（或 none），取纵向分量 */
const translateY = (value) => {
  if (!value || value === 'none') return 0;
  const parts = value.split(/\s+/).map((v) => Number.parseFloat(v)).filter((n) => Number.isFinite(n));
  return parts.length > 1 ? Math.abs(parts[1]) : 0;
};

/** transitionDelay 可能有多组（每个过渡属性一组），取最大值（毫秒） */
const maxDelayMs = (value) => {
  if (!value) return 0;
  return Math.max(...value.split(',').map((v) => {
    const t = v.trim();
    return t.endsWith('ms') ? Number.parseFloat(t) : Number.parseFloat(t) * 1000;
  }));
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

const pageErrors = [];
const page = await browser.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));

// 阻断外网（CDN 图片等），保证测量可重复；页面自身资源照常。
// blockScripts 用于模拟「首页脚本加载失败」：只拦 .js，CSS 与 HTML 照常。
// slowRequest 用于模拟「重资源页面」：让某张图挂起一段时间，推迟 window.load。
await page.setRequestInterception(true);
let blockScripts = false;
let slowRequest = null;
page.on('request', (req) => {
  const u = req.url();
  if (!u.startsWith(BASE) && !u.startsWith('data:')) {
    if (slowRequest && u.includes(slowRequest.match)) {
      setTimeout(() => {
        try {
          req.abort();
        } catch {
          /* 页面可能已经导航走了 */
        }
      }, slowRequest.delayMs);
      return;
    }
    return req.abort();
  }
  if (blockScripts && /\.js(\?|$)/.test(u)) return req.abort();
  req.continue();
});

const gotoHome = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' }).catch(() => {});
  // 站点全局设置了 scroll-behavior: smooth（用户点击锚点需要），
  // 但自动化里的 scrollTo/scrollIntoView 会被它变成动画、读数不稳；
  // 仅在测试页面里覆盖成 auto，不改站点本身。
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  // 等首屏入场动画播完并完成交棒（CSS 入场 0.72s + 最晚 0.44s 延迟 → 1.18s）
  await wait(1600);
};

/**
 * 统计 window 上 addEventListener 的净增计数（按类型）。
 * 做法是在新文档里包一层 add/removeEventListener，比 CDP 监听器快照更直接，
 * 也就能验证 ClientRouter 往返后不会累积 scroll 监听。
 */
const installListenerCounter = () =>
  page.evaluateOnNewDocument(() => {
    const counts = (window.__acrListenerCounts = {});
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = function (type, ...rest) {
      counts[type] = (counts[type] || 0) + 1;
      return add(type, ...rest);
    };
    window.removeEventListener = function (type, ...rest) {
      counts[type] = Math.max(0, (counts[type] || 0) - 1);
      return remove(type, ...rest);
    };
  });

const windowListeners = () => page.evaluate(() => window.__acrListenerCounts || {});

/** 读取首屏某一层在给定 --hp 下的计算样式 */
const applyProgressAndRead = (progress) =>
  page.evaluate((hp) => {
    const hero = document.querySelector('[data-hero]');
    const title = document.querySelector('.f-hero__title');
    const deck = document.querySelector('.f-hero__deck');
    const image = document.querySelector('.f-hero__image');
    const rule = document.querySelector('.f-hero__domain-rule');
    const read = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { opacity: Number(cs.opacity), translate: cs.translate, scale: cs.scale };
    };
    // 直接写进度变量，绕过滚动，测的是 CSS 映射本身
    hero.style.setProperty('--hp', String(hp));
    return {
      title: read(title),
      deck: read(deck),
      image: read(image),
      rule: read(rule),
      bodyOpacity: read(document.querySelector('.f-hero__body'))?.opacity ?? null,
    };
  }, progress);

try {
  /* ─────────────── 一、桌面 1440×900（纸白主题：站点默认视觉） ─────────────── */
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  await gotoHome();
  await page.screenshot({ path: join(SHOTS, 'desktop-top.png') });

  const boot = await page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    return {
      fx: document.documentElement.classList.contains('fx'),
      isFx: hero?.classList.contains('is-fx'),
      heroHeight: hero?.getBoundingClientRect().height ?? 0,
      hp: Number(getComputedStyle(hero).getPropertyValue('--hp')),
      cards: document.querySelectorAll('.f-recent > .f-card').length,
      plates: document.querySelectorAll('.f-plates > .f-plate').length,
      heads: document.querySelectorAll('.f-section-head').length,
      revealTargets: document.querySelectorAll('[data-reveal]').length,
      navLinks: document.querySelectorAll('.f-nav a').length,
      footer: !!document.querySelector('.f-footer'),
      heroTitle: document.querySelector('.f-hero__title')?.textContent?.trim() ?? '',
      firstCardHref: document.querySelector('.f-recent > .f-card')?.getAttribute('href') ?? '',
    };
  });
  check('脚本接管：html.fx 已启用', boot.fx === true);
  check('首屏完成交棒：.f-hero.is-fx', boot.isFx === true);
  check('首屏初始进度为 0', Math.abs(boot.hp) < 0.001, `--hp=${boot.hp}`);
  check('原文案仍在：首屏标题', boot.heroTitle.includes('欢迎来到') && boot.heroTitle.length > 6, boot.heroTitle);
  check('原文案仍在：6 张编目卡片', boot.cards === 6, `${boot.cards}`);
  check('原文案仍在：3 幅图版', boot.plates === 3, `${boot.plates}`);
  check('原文案仍在：3 个分区标题（II / III / IV）', boot.heads === 3, `${boot.heads}`);
  check('导航 4 个入口仍在', boot.navLinks === 4, `${boot.navLinks}`);
  check('页脚仍在', boot.footer === true);
  check('卡片链接未被改动', boot.firstCardHref.startsWith('/blog/'), boot.firstCardHref);

  // 键盘兜底：焦点移入尚未显现的卡片时，CSS 必须让它立即可见
  const focusSafety = await page.evaluate(async () => {
    const cards = document.querySelectorAll('.f-recent > .f-card');
    const last = cards[cards.length - 1];
    const before = Number(getComputedStyle(last).opacity);
    last.focus({ preventScroll: true });
    await new Promise((r) => setTimeout(r, 700));
    const after = Number(getComputedStyle(last).opacity);
    const isIn = last.classList.contains('is-in');
    last.blur();
    return { before, after, isIn };
  });
  check(
    '键盘兜底：聚焦到尚未显现的卡片时立即可见',
    focusSafety.before < 0.1 && focusSafety.after > 0.99 && focusSafety.isIn === false,
    `before=${focusSafety.before} after=${focusSafety.after} is-in=${focusSafety.isIn}`,
  );

  // 进度映射：0 → 静止；0.5 → 已上移但未消失；1 → 完全退场
  const p0 = await applyProgressAndRead(0);
  const pMid = await applyProgressAndRead(0.5);
  const p1 = await applyProgressAndRead(1);
  check('进度 0：标题完全不透明', p0.title.opacity > 0.99, `opacity=${p0.title.opacity}`);
  check('进度 0：标题无位移', translateY(p0.title.translate) < 0.5, p0.title.translate);
  check(
    '进度 0.5：标题淡出中（0.3–0.9），副标题更靠后',
    pMid.title.opacity > 0.3 && pMid.title.opacity < 0.9 && pMid.deck.opacity > pMid.title.opacity,
    `title=${pMid.title.opacity.toFixed(2)} deck=${pMid.deck.opacity.toFixed(2)}`,
  );
  check('进度 0.5：标题上移，位移在 0–36px 内', (() => {
    const y = translateY(pMid.title.translate);
    return y > 2 && y <= 36.5;
  })(), pMid.title.translate);
  check('进度 1：标题完全退场', p1.title.opacity < 0.02, `opacity=${p1.title.opacity}`);
  check('进度 1：背景图版产生有限视差（≤ 25px）', (() => {
    const y = translateY(p1.image.translate);
    return y > 4 && y <= 25;
  })(), p1.image.translate);
  check('背景图版轻微推近（≤ 1.06）', (() => {
    const s = Number.parseFloat(p1.image.scale);
    return Number.isFinite(s) && s > 1 && s <= 1.06;
  })(), p1.image.scale);
  // 铜线（域名下那条规则线）：原设计终态是 opacity .85，fx 模式必须还原，不能更亮
  check('进度 0：铜线终态与原设计一致（opacity .85）',
    Math.abs((p0.rule?.opacity ?? 0) - 0.85) < 0.02, p0.rule?.opacity);
  check('进度 0.5：铜线随首屏一同退场',
    (pMid.rule?.opacity ?? 1) < 0.8, pMid.rule?.opacity);

  // 域名彩虹：整条色相环铺满字标，扫光放慢到 14s
  const rainbow = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.f-hero__domain-zone'));
    return {
      hasGradient: cs.backgroundImage.startsWith('linear-gradient'),
      stops: (cs.backgroundImage.match(/oklab\(|oklch\(|rgb\(|color\(/g) || []).length,
      size: cs.backgroundSize,
      anim: cs.animationName,
      dur: cs.animationDuration,
      fill: cs.webkitTextFillColor,
    };
  });
  check('域名：彩虹渐变已启用（≥7 个色相节点）',
    rainbow.hasGradient && rainbow.stops >= 7, `stops=${rainbow.stops}`);
  check('域名：彩虹铺满字标（130%）且保留 14s 慢扫光',
    rainbow.size === '130% 100%' && rainbow.anim === 'f-domain-sheen' && rainbow.dur === '14s',
    `${rainbow.size} ${rainbow.anim} ${rainbow.dur}`);
  check('域名：彩虹以背景裁切绘制（文字填充透明）',
    rainbow.fill === 'rgba(0, 0, 0, 0)', rainbow.fill);

  // 后台「前端定制」→ BaseLayout 的契约：开关属性 + 7 色 + 含色量 + 扫光周期
  const rainbowVars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      attr: document.documentElement.dataset.heroRainbow,
      c1: cs.getPropertyValue('--rainbow-1').trim(),
      c7: cs.getPropertyValue('--rainbow-7').trim(),
      mix: cs.getPropertyValue('--rainbow-mix-strong').trim(),
      light: cs.getPropertyValue('--rainbow-mix-light').trim(),
      sheen: cs.getPropertyValue('--rainbow-sheen-duration').trim(),
    };
  });
  check('域名彩虹：后台配置已下发（开关 / 7 色 / 含色量 / 扫光）',
    rainbowVars.attr === 'on' &&
      /^#[0-9a-f]{6}$/.test(rainbowVars.c1) && rainbowVars.c1 === '#ff6b5e' &&
      /^#[0-9a-f]{6}$/.test(rainbowVars.c7) &&
      rainbowVars.mix === '82%' && rainbowVars.light === '60%' && rainbowVars.sheen === '14s',
    JSON.stringify(rainbowVars));

  // 恢复滚动位置，验证真实滚动 ↔ 进度可逆
  await page.evaluate(() => {
    document.querySelector('[data-hero]').style.removeProperty('--hp');
    window.scrollTo(0, 0);
  });
  await wait(120);
  const afterReset = await page.evaluate(() => ({
    hp: Number(getComputedStyle(document.querySelector('[data-hero]')).getPropertyValue('--hp')),
    opacity: Number(getComputedStyle(document.querySelector('.f-hero__title')).opacity),
    translate: getComputedStyle(document.querySelector('.f-hero__title')).translate,
  }));
  check(
    '向上滚回顶部：首屏恢复原状（可逆）',
    afterReset.hp < 0.01 && afterReset.opacity > 0.99 && translateY(afterReset.translate) < 0.5,
    `--hp=${afterReset.hp} opacity=${afterReset.opacity} translate=${afterReset.translate}`,
  );

  // 真实滚动：进度随 scrollY 单调增加
  const samples = [];
  for (const y of [120, 260, 420]) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await wait(100);
    samples.push(await page.evaluate(() => ({
      y: window.scrollY,
      hp: Number(getComputedStyle(document.querySelector('[data-hero]')).getPropertyValue('--hp')),
    })));
  }
  check(
    '滚动驱动：--hp 随 scrollY 单调递增',
    samples[0].hp > 0 && samples[0].hp < samples[1].hp && samples[1].hp < samples[2].hp,
    samples.map((s) => `y${s.y}=${s.hp.toFixed(2)}`).join(' '),
  );
  // 退场中途留档，便于人工比对"内容是否仍然读得清"
  await page.evaluate(() => window.scrollTo(0, 300));
  await wait(350);
  await page.screenshot({ path: join(SHOTS, 'desktop-hero-exit.png') });

  // 分区的分步显现（取最后一个分区标题：它在首屏之外，确保是从隐藏态开始）
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(100);
  const headHiddenBefore = await page.evaluate(() => {
    const head = document.querySelectorAll('.f-section-head')[2];
    return { isIn: head.classList.contains('is-in'), opacity: Number(getComputedStyle(head.querySelector('.f-section-title')).opacity) };
  });
  await page.evaluate(() => document.querySelectorAll('.f-section-head')[2].scrollIntoView({ block: 'center' }));
  await until(() =>
    page.evaluate(() => document.querySelectorAll('.f-section-head')[2].classList.contains('is-in')),
  2500);
  await wait(1100);
  const headShown = await page.evaluate(() => {
    const head = document.querySelectorAll('.f-section-head')[2];
    const title = head.querySelector('.f-section-title');
    const more = head.querySelector('.f-section-more');
    const after = getComputedStyle(head, '::after');
    return {
      isIn: head.classList.contains('is-in'),
      titleOpacity: Number(getComputedStyle(title).opacity),
      moreOpacity: Number(getComputedStyle(more).opacity),
      titleDelay: getComputedStyle(title).transitionDelay,
      moreDelay: getComputedStyle(more).transitionDelay,
      lineTransform: after.transform,
      lineOrigin: after.transformOrigin,
    };
  });
  check('分区标题：进入视口前保持初始态', headHiddenBefore.isIn === false && headHiddenBefore.opacity < 0.05,
    `opacity=${headHiddenBefore.opacity}`);
  check('分区标题：进入视口后显现', headShown.isIn && headShown.titleOpacity > 0.99 && headShown.moreOpacity > 0.99);
  check('分区标题：入口链接比标题稍后（50–90ms）',
    maxDelayMs(headShown.moreDelay) - maxDelayMs(headShown.titleDelay) >= 40,
    `title=${headShown.titleDelay} more=${headShown.moreDelay}`);

  check(
    '分隔线：从左向右展开到位',
    /matrix\(1,\s*0,\s*0,\s*1/.test(headShown.lineTransform) && headShown.lineOrigin.startsWith('0px'),
    `${headShown.lineTransform} / ${headShown.lineOrigin}`,
  );
  await page.screenshot({ path: join(SHOTS, 'desktop-section-2.png') });

  // 流光：环境光（报头双线 / 首屏铜线 / 三条分区线）与悬停光
  const sheen = await page.evaluate(() => {
    const anims = document.getAnimations()
      .filter((a) => (a.animationName || '').includes('sheen'))
      .map((a) => {
        const t = a.effect.getComputedTiming();
        return { name: a.animationName, dur: t.duration, iter: t.iterations };
      });
    const line = document.querySelectorAll('.f-section-head')[0];
    const cs = getComputedStyle(line, '::after');
    return {
      ambient: anims.filter((a) => a.name === 'sheen-ambient').length,
      lineAnim: cs.animationName,
      lineDur: cs.animationDuration,
      lineLayers: cs.backgroundImage.split('),').length,
      linePos: cs.backgroundPosition,
    };
  });
  check('流光：报头/首屏/三条分区线均挂上环境流光', sheen.ambient >= 5, `ambient=${sheen.ambient}`);
  check('流光：分区线为 12s 循环光带（光带 + 线本体两层背景）',
    sheen.lineAnim === 'sheen-ambient' && sheen.lineDur === '12s' && sheen.lineLayers >= 2,
    `${sheen.lineAnim} ${sheen.lineDur} layers=${sheen.lineLayers}`);

  // 卡片错峰
  await page.evaluate(() => document.querySelector('.f-recent').scrollIntoView({ block: 'center' }));
  await until(() => page.evaluate(() =>
    Array.from(document.querySelectorAll('.f-recent > .f-card')).every((c) => c.classList.contains('is-in'))), 3000);
  await wait(800);
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.f-recent > .f-card')).map((c) => ({
      isIn: c.classList.contains('is-in'),
      opacity: Number(getComputedStyle(c).opacity),
      translate: getComputedStyle(c).translate,
      delay: getComputedStyle(c).transitionDelay,
      height: c.getBoundingClientRect().height,
      href: c.getAttribute('href'),
    })));
  check('卡片：全部显现且不透明', cards.every((c) => c.isIn && c.opacity > 0.99 && translateY(c.translate) < 0.5));
  check('卡片：错峰延迟在 0–180ms 内', (() => {
    const ds = cards.map((c) => maxDelayMs(c.delay));
    return ds[0] === 0 && ds.every((d) => d >= 0 && d <= 180) && ds.some((d) => d > 0);
  })(), cards.map((c) => c.delay).join(' '));
  check('卡片：尺寸与链接未变（高度 > 0 且 href 保留）', cards.every((c) => c.height > 120 && c.href?.startsWith('/blog/')));

  // 卡片 hover 的底边色过渡必须保留（不能被显现动画的 transition 简写覆盖）
  const cardHandle = await page.$('.f-recent > .f-card');
  const cardBefore = await page.evaluate(() => {
    const el = document.querySelector('.f-recent > .f-card');
    const cs = getComputedStyle(el);
    return { color: cs.borderBottomColor, props: cs.transitionProperty, durations: cs.transitionDuration };
  });
  if (cardHandle) await cardHandle.hover();
  await wait(500);
  const cardAfter = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.f-recent > .f-card')).borderBottomColor);
  check('卡片：hover 底边色过渡仍在（未被 transition 简写覆盖）',
    cardBefore.props.includes('border-color') && cardAfter !== cardBefore.color,
    `${cardBefore.color} → ${cardAfter} / ${cardBefore.props}`);
  const cardSheen = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.f-recent > .f-card'), '::after');
    return { anim: cs.animationName, dur: cs.animationDuration, op: Number(cs.opacity) };
  });
  check('流光：卡片悬停触发底边流光', cardSheen.anim === 'sheen-pass' && cardSheen.op > 0.9,
    JSON.stringify(cardSheen));

  // 图版画幅
  await page.evaluate(() => document.querySelector('.f-plates').scrollIntoView({ block: 'center' }));
  await until(() => page.evaluate(() =>
    Array.from(document.querySelectorAll('.f-plates > .f-plate')).every((p) => p.classList.contains('is-in'))), 3000);
  await wait(1000);
  const plates = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.f-plates > .f-plate')).map((p) => ({
      isIn: p.classList.contains('is-in'),
      opacity: Number(getComputedStyle(p).opacity),
      imgScale: getComputedStyle(p.querySelector('.f-plate__frame img')).scale,
      imgTransform: getComputedStyle(p.querySelector('.f-plate__frame img')).transform,
      alt: p.querySelector('img')?.getAttribute('alt') ?? '',
      href: p.getAttribute('href'),
    })));
  check('图版：全部显现且画幅回到 1', plates.every((p) => p.isIn && p.opacity > 0.99 && (p.imgScale === 'none' || Number.parseFloat(p.imgScale) === 1)),
    plates.map((p) => p.imgScale).join(','));
  check('图版：链接与替代文本未变', plates.every((p) => p.href === '/gallery/'));

  // 悬停仍有效（原有交互不被显现动画覆盖）
  const hoverBefore = await page.evaluate(() => {
    const img = document.querySelector('.f-plate__frame img');
    return getComputedStyle(img).transform;
  });
  const plateHandle = await page.$('.f-plates > .f-plate');
  if (plateHandle) await plateHandle.hover();
  await wait(600);
  const hoverAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.f-plate__frame img')).transform);
  check(
    '图版：悬停放大仍然生效（未被显现动画覆盖）',
    hoverAfter !== 'none' && hoverAfter !== hoverBefore,
    `${hoverBefore} → ${hoverAfter}`,
  );
  const plateSheen = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.f-plates > .f-plate .f-plate__frame'), '::after');
    return { anim: cs.animationName, dur: cs.animationDuration };
  });
  check('流光：图版悬停触发画框扫光', plateSheen.anim === 'plate-sheen', JSON.stringify(plateSheen));

  // 尾页
  await page.evaluate(() => document.querySelector('.f-coda').scrollIntoView({ block: 'center' }));
  await until(() => page.evaluate(() => document.querySelector('.f-coda').classList.contains('is-in')), 3000);
  await wait(700);
  const coda = await page.evaluate(() => {
    const c = document.querySelector('.f-coda');
    return {
      isIn: c.classList.contains('is-in'),
      quote: Number(getComputedStyle(c.querySelector('blockquote')).opacity),
      num: Number(getComputedStyle(c.querySelector('.f-num')).opacity),
      text: c.textContent.trim().slice(0, 40),
    };
  });
  check('尾页：引文与编号平稳显现', coda.isIn && coda.quote > 0.99 && coda.num > 0.99, coda.text);

  // 全页滚到底再回顶：不应留任何隐藏内容
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await wait(900);
  const hiddenCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-reveal]'))
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length);
  check('全页遍历后：没有残留的隐藏元素', hiddenCount === 0, `hidden=${hiddenCount}`);

  const overflowDesktop = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check('桌面：无横向溢出', overflowDesktop.scrollWidth <= overflowDesktop.clientWidth + 1,
    `${overflowDesktop.scrollWidth} / ${overflowDesktop.clientWidth}`);
  await page.screenshot({ path: join(SHOTS, 'desktop-coda.png') });

  /* ─────────────── 二、移动端 390×844 ─────────────── */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await gotoHome();
  const mobile = await page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    hero.style.setProperty('--hp', '0.5');
    const title = document.querySelector('.f-hero__title');
    const image = document.querySelector('.f-hero__image');
    const bounds = document.documentElement;
    return {
      fx: document.documentElement.classList.contains('fx'),
      titleTranslate: getComputedStyle(title).translate,
      imageTranslate: getComputedStyle(image).translate,
      overflow: bounds.scrollWidth - bounds.clientWidth,
    };
  });
  const mobileTitleShift = translateY(mobile.titleTranslate);
  const mobileImageShift = translateY(mobile.imageTranslate);
  check('移动端：脚本正常接管', mobile.fx === true);
  check('移动端：首屏位移已减幅（≤ 23px）', mobileTitleShift > 1 && mobileTitleShift <= 23,
    `title=${mobileTitleShift.toFixed(1)}px (${mobile.titleTranslate})`);
  check('移动端：背景视差已减幅（≤ 12px）', mobileImageShift > 0 && mobileImageShift <= 12,
    `${mobileImageShift.toFixed(1)}px (${mobile.imageTranslate})`);
  check('移动端：无横向溢出', mobile.overflow <= 1, `overflow=${mobile.overflow}`);
  await page.evaluate(() => {
    document.querySelector('[data-hero]').style.removeProperty('--hp');
    window.scrollTo(0, 0);
  });
  await wait(150);
  await page.screenshot({ path: join(SHOTS, 'mobile-top.png') });

  // 移动端滚动后卡片仍能显现
  await page.evaluate(() => document.querySelector('.f-recent').scrollIntoView({ block: 'center' }));
  await until(() => page.evaluate(() =>
    Array.from(document.querySelectorAll('.f-recent > .f-card')).every((c) => c.classList.contains('is-in'))), 3000);
  await wait(700);
  const mobileCards = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.f-recent > .f-card')).map((c) => ({
      opacity: Number(getComputedStyle(c).opacity),
      delays: getComputedStyle(c).transitionDelay,
    })));
  check('移动端：卡片全部显现', mobileCards.every((c) => c.opacity > 0.99));
  check('移动端：错峰已收敛（单列不再逐张延迟）', mobileCards.every((c) => maxDelayMs(c.delays) === 0),
    mobileCards.map((c) => c.delays).join(' '));
  await page.screenshot({ path: join(SHOTS, 'mobile-cards.png') });

  /* ─────────────── 三、减少动态效果 ─────────────── */
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await gotoHome();
  const reduced = await page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    const title = document.querySelector('.f-hero__title');
    return {
      fx: document.documentElement.classList.contains('fx'),
      isFx: hero.classList.contains('is-fx'),
      titleOpacity: Number(getComputedStyle(title).opacity),
      titleTranslate: getComputedStyle(title).translate,
      revealHidden: Array.from(document.querySelectorAll('[data-reveal]'))
        .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length,
      revealTargets: document.querySelectorAll('[data-reveal]').length,
    };
  });
  check('减少动效：不启用动效模式（html.fx 不存在）', reduced.fx === false);
  check('减少动效：首屏不进入滚动退场', reduced.isFx === false);
  check('减少动效：首屏内容完整可见', reduced.titleOpacity > 0.99 && /^none$|^0px/.test(reduced.titleTranslate || 'none'),
    `opacity=${reduced.titleOpacity} translate=${reduced.titleTranslate}`);
  check('减少动效：没有任何隐藏的显现目标', reduced.revealHidden === 0,
    `hidden=${reduced.revealHidden}/${reduced.revealTargets}`);
  await page.evaluate(() => window.scrollTo(0, 900));
  await wait(400);
  const reducedAfterScroll = await page.evaluate(() => ({
    hidden: Array.from(document.querySelectorAll('[data-reveal]'))
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length,
    titleOpacity: Number(getComputedStyle(document.querySelector('.f-hero__title')).opacity),
  }));
  check('减少动效：滚动后内容依旧完整可见', reducedAfterScroll.hidden === 0 && reducedAfterScroll.titleOpacity > 0.99);
  // CSS 兜底：即使运行中被强行切到动效态（例如脚本残留 class），也必须全部可见
  const forcedFx = await page.evaluate(async () => {
    const hero = document.querySelector('[data-hero]');
    document.documentElement.classList.add('fx');
    hero.classList.add('is-fx');
    hero.style.setProperty('--hp', '0.5');
    await new Promise((r) => setTimeout(r, 120));
    const hidden = Array.from(document.querySelectorAll('[data-reveal]'))
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length;
    const result = {
      hidden,
      titleOpacity: Number(getComputedStyle(document.querySelector('.f-hero__title')).opacity),
      ruleOpacity: Number(getComputedStyle(document.querySelector('.f-hero__domain-rule')).opacity),
      lineSheen: getComputedStyle(document.querySelectorAll('.f-section-head')[0], '::after').animationName,
      heroSheen: getComputedStyle(document.querySelector('.f-hero__domain-rule'), '::after').animationName,
      headerSheen: getComputedStyle(document.querySelector('.f-header .f-double-rule'), '::after').animationName,
    };
    document.documentElement.classList.remove('fx');
    hero.classList.remove('is-fx');
    hero.style.removeProperty('--hp');
    return result;
  });
  check('减少动效：CSS 兜底能压住被强行启用的动效态',
    forcedFx.hidden === 0 && forcedFx.titleOpacity > 0.99 && Math.abs(forcedFx.ruleOpacity - 0.85) < 0.02,
    JSON.stringify(forcedFx));
  check('减少动效：所有流光停止（分区线/首屏铜线/报头双线）',
    forcedFx.lineSheen === 'none' && forcedFx.heroSheen === 'none' && forcedFx.headerSheen === 'none',
    `${forcedFx.lineSheen}/${forcedFx.heroSheen}/${forcedFx.headerSheen}`);
  const reducedRainbow = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.f-hero__domain-zone'));
    return { anim: cs.animationName, hasGradient: cs.backgroundImage.includes('linear-gradient') };
  });
  check('减少动效：彩虹保留颜色但停止扫光',
    reducedRainbow.anim === 'none' && reducedRainbow.hasGradient === true, JSON.stringify(reducedRainbow));
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(120);
  await page.screenshot({ path: join(SHOTS, 'reduced-motion.png') });

  /* ─────────────── 三·五、交棒落位过渡的启用与清理 ─────────────── */
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  // 不等入场动画：加载后立刻滚动，交棒时 --hp 已非 0 → 应启用一次性落位过渡
  await page.goto(`${BASE}/`, { waitUntil: 'load' }).catch(() => {});
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  await page.evaluate(() => window.scrollTo(0, 140));
  const settleSeen = await until(
    () => page.evaluate(() => document.querySelector('[data-hero]')?.classList.contains('is-settle') === true),
    3000,
    30,
  );
  // 在落位窗口内切换系统偏好：teardown → init，必须把 is-settle 摘掉，避免之后一直拖尾
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  await wait(60);
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  await wait(1000);
  const settleAfter = await page.evaluate(() => ({
    stillSettle: document.querySelector('[data-hero]')?.classList.contains('is-settle') ?? null,
    isFx: document.querySelector('[data-hero]')?.classList.contains('is-fx') ?? null,
  }));
  check('交棒落位：滚动中交棒会短暂启用落位过渡', settleSeen === true);
  check('交棒落位：切换系统偏好后不残留 is-settle',
    settleAfter.stillSettle === false && settleAfter.isFx === true, JSON.stringify(settleAfter));

  /* ─────────────── 三·六、重资源页面上的交棒时机 ─────────────── */
  // 让首屏主图（唯一 eager 的图片）挂起 1.4s：window.load 被推迟，DOMContentLoaded 不受影响。
  // 交棒若被 astro:page-load（绑定在 load 上）重置，is-fx 会晚约 1.4s 出现。
  slowRequest = { match: '149066615_p0', delayMs: 1400 };
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  const handoverStart = Date.now();
  await until(
    () => page.evaluate(() => document.querySelector('[data-hero]')?.classList.contains('is-fx') === true),
    6000,
    40,
  );
  const handoverMs = Date.now() - handoverStart;
  slowRequest = null;
  check('重资源页面：交棒不会被晚到的 window.load 推迟（< 2200ms）', handoverMs < 2200, `${handoverMs}ms`);

  /* ─────────────── 四、脚本加载失败（模拟 JS 不可用） ─────────────── */
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  blockScripts = true;
  await gotoHome();
  const noJs = await page.evaluate(() => ({
    cards: document.querySelectorAll('.f-recent > .f-card').length,
    plates: document.querySelectorAll('.f-plates > .f-plate').length,
    navLinks: document.querySelectorAll('.f-nav a').length,
    fx: document.documentElement.classList.contains('fx'),
    titleOpacity: Number(getComputedStyle(document.querySelector('.f-hero__title')).opacity),
    hidden: Array.from(document.querySelectorAll('[data-reveal]'))
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length,
    bodyText: document.body.innerText.length,
  }));
  check('无 JS：内容完整渲染（卡片/图版/导航）',
    noJs.cards === 6 && noJs.plates === 3 && noJs.navLinks === 4);
  check('无 JS：不动效模式，首屏可见', noJs.fx === false && noJs.titleOpacity > 0.99,
    `opacity=${noJs.titleOpacity}`);
  check('无 JS：没有因动效而隐藏的内容', noJs.hidden === 0, `hidden=${noJs.hidden}`);
  check('无 JS：页面正文非空', noJs.bodyText > 500, `${noJs.bodyText} 字符`);
  await page.screenshot({ path: join(SHOTS, 'no-js.png') });
  blockScripts = false;

  /* ─────────────── 五、ClientRouter 导航后重装 ─────────────── */
  await installListenerCounter();
  await gotoHome();
  const listenersBefore = await windowListeners();
  // ClientRouter 是客户端导航，不会触发 waitForNavigation，只能等 DOM 换代
  await page.click('.f-nav a[href="/blog/"]').catch(() => {});
  const leftHome = await until(() => page.evaluate(() => !document.querySelector('[data-hero]')), 6000);
  await wait(500);
  const navToBlog = await page.evaluate(() => ({
    url: location.pathname,
    fx: document.documentElement.classList.contains('fx'),
    revealTargets: document.querySelectorAll('[data-reveal]').length,
  }));
  check('导航离开首页：新页面正常到达', leftHome && navToBlog.url === '/blog/', navToBlog.url);
  check('导航离开首页：fx 状态被清理', navToBlog.fx === false, `targets=${navToBlog.revealTargets}`);

  await page.click('.f-nav a[href="/"]').catch(() => {});
  const backHome = await until(() => page.evaluate(() => !!document.querySelector('[data-hero]')), 6000);
  await wait(1800);
  const navBackHome = await page.evaluate(async () => {
    const hero = document.querySelector('[data-hero]');
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
    const before = Number(getComputedStyle(hero).getPropertyValue('--hp'));
    window.scrollTo(0, 300);
    await new Promise((r) => setTimeout(r, 200));
    return {
      url: location.pathname,
      fx: document.documentElement.classList.contains('fx'),
      isFx: hero.classList.contains('is-fx'),
      hpCalm: before,
      hpScrolled: Number(getComputedStyle(hero).getPropertyValue('--hp')),
      revealTargets: document.querySelectorAll('[data-reveal]').length,
      hidden: Array.from(document.querySelectorAll('[data-reveal]'))
        .filter((el) => getComputedStyle(el).opacity === '0').length,
      cards: document.querySelectorAll('.f-recent > .f-card').length,
    };
  });
  check('返回首页：内容完整重建', backHome && navBackHome.cards === 6 && navBackHome.revealTargets > 10,
    `${navBackHome.url} targets=${navBackHome.revealTargets}`);
  check('返回首页：动效系统重新接管', navBackHome.fx === true && navBackHome.isFx === true);
  check('返回首页：滚动进度仍然有效（无失效观察器）',
    navBackHome.hpCalm < 0.01 && navBackHome.hpScrolled > 0.05,
    `calm=${navBackHome.hpCalm} → ${navBackHome.hpScrolled.toFixed(2)}`);

  // 一轮往返后 window 上的 scroll 监听不应累积（本脚本每次 init/teardown 成对处理）
  const listenersAfter = await windowListeners();
  check('ClientRouter 往返后：window scroll 监听没有累积',
    !!listenersBefore && !!listenersAfter && (listenersAfter.scroll || 0) <= (listenersBefore.scroll || 0),
    `${listenersBefore?.scroll} → ${listenersAfter?.scroll}`);

  /* ─────────────── 五·五、打印：任何滚动位置都必须完整可见 ─────────────── */
  await page.emulateMediaType('print');
  await wait(300);
  const inPrint = await page.evaluate(() => ({
    hidden: Array.from(document.querySelectorAll('[data-reveal]'))
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length,
    titleOpacity: Number(getComputedStyle(document.querySelector('.f-hero__title')).opacity),
    ruleOpacity: Number(getComputedStyle(document.querySelector('.f-hero__domain-rule')).opacity),
    sheen: getComputedStyle(document.querySelectorAll('.f-section-head')[0], '::after').animationName,
    rainbowFill: getComputedStyle(document.querySelector('.f-hero__domain-zone')).webkitTextFillColor,
    rainbowBg: getComputedStyle(document.querySelector('.f-hero__domain-zone')).backgroundImage,
  }));
  await page.emulateMediaType('screen');
  check('打印：滚动中也不会把退场/隐藏态印出来',
    inPrint.hidden === 0 && inPrint.titleOpacity > 0.99 && Math.abs(inPrint.ruleOpacity - 0.85) < 0.03,
    JSON.stringify({ hidden: inPrint.hidden, title: inPrint.titleOpacity }));
  check('打印：流光停止（纸上不印扫光）', inPrint.sheen === 'none', inPrint.sheen);
  check('打印：彩虹字标退回墨字（避免印成空白）',
    inPrint.rainbowFill === 'rgb(18, 16, 13)' && inPrint.rainbowBg === 'none',
    `${inPrint.rainbowFill} / ${inPrint.rainbowBg}`);

  /* ─────────────── 六、控制台 ─────────────── */
  check('没有未捕获的页面脚本异常', pageErrors.length === 0, pageErrors.join(' | '));

  /* ─────────────── 七、暗色主题留档（不参与断言） ─────────────── */
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
    { name: 'prefers-color-scheme', value: 'dark' },
  ]);
  await gotoHome();
  await page.evaluate(() => window.scrollTo(0, 300));
  await wait(350);
  await page.screenshot({ path: join(SHOTS, 'desktop-hero-exit-dark.png') });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('未通过：');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exitCode = 1;
}
