/**
 * 个人页(/about/)词云回归验证。
 * 用法:npm run build 后,先起静态服务器(node scripts/static-server.mjs dist 8766),
 * 再运行本脚本。可选 BLOG_TEST_URL / CHROME_PATH / BLOG_SCREENSHOT_DIR。
 *
 * 断言:词云区块被挂进 dossier、canvas 真的画出像素(而非空白/纯白)、
 * 与页面内容左对齐、hover 显示词频提示、五套视觉主题下均可重绘、无页面报错。
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.BLOG_TEST_URL || 'http://127.0.0.1:8766';
const out = process.env.BLOG_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 已绘制字形像素下限:1082x411 画布约 44 万像素,正常渲染覆盖率 20% 以上,
// 该阈值同时排除"只画了一两个词就中断"的假成功。
const MIN_PAINT = 20000;

const results = [];
const check = (name, ok) => {
  assert.ok(ok, name);
  results.push(name);
  console.log('PASS', name);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1050 });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/about/`, { waitUntil: 'networkidle0' });

  /** canvas 中 alpha > 0 的像素数(wordcloud2 背景透明,等于已绘制的字形像素) */
  const paintedPixels = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-wordcloud]');
      if (!canvas || !canvas.width || !canvas.height) return 0;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
      return n;
    });

  /** 等待绘制收敛:wordcloud2 逐词异步绘制,取连续三次采样一致的结果 */
  const waitForPaint = async (min = MIN_PAINT) => {
    const deadline = Date.now() + 15000;
    let n = 0;
    let prev = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      n = await paintedPixels();
      stable = n >= min && n === prev ? stable + 1 : 0;
      prev = n;
      if (stable >= 3) return n;
      await sleep(250);
    }
    return n;
  };

  /** 清空画布,用于确认重绘(否则读到的是上一轮残留像素) */
  const clearCanvas = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-wordcloud]');
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    });

  const structure = await page.evaluate(() => {
    const section = document.querySelector('.wordcloud-section');
    const dossier = document.querySelector('.dossier');
    const canvas = document.querySelector('canvas[data-wordcloud]');
    const words = canvas ? JSON.parse(canvas.dataset.words || '[]') : [];
    return {
      inDossier: Boolean(section && dossier && dossier.contains(section)),
      // 词云位于个人档案正文之后(而非插在头部/外观设置中间)
      afterGrid: Boolean(section && document.querySelector('.dossier-grid')?.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING),
      wordCount: words.length,
      sectionRect: section ? section.getBoundingClientRect().toJSON() : null,
      headerRect: document.querySelector('.dossier-header')?.getBoundingClientRect().toJSON() ?? null,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : '',
      // 空态分支不应出现
      empty: Boolean(document.querySelector('.wordcloud-empty')),
      heading: section?.querySelector('h2')?.innerText.trim() ?? '',
    };
  });

  check('词云区块挂在个人档案(.dossier)内', structure.inDossier);
  check('词云位于档案正文之后', structure.afterGrid);
  check('词云数据非空(80 词上限内)', structure.wordCount > 0);
  check('未落到空态分支', !structure.empty);
  check('canvas 物理尺寸已设置', /^\d+x\d+$/.test(structure.canvasSize));
  check(
    '词云与页面内容左对齐',
    structure.sectionRect && structure.headerRect
      && Math.abs(structure.sectionRect.left - structure.headerRect.left) <= 1,
  );

  const painted = await waitForPaint();
  check(`canvas 已绘制像素(${painted} px)`, painted > 500);
  console.log('INFO 词云标题:', JSON.stringify(structure.heading), '尺寸:', structure.canvasSize);

  // hover 提示词频:先把词云滚进视口(否则 mouse.move 的坐标落在视口外),
  // 再网格扫描找到一个落在词上的位置
  const shot = async (name) => {
    if (out) await page.screenshot({ path: join(out, `${name}.png`) });
  };
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  await page.evaluate(() => document.querySelector('.wordcloud-section').scrollIntoView({ block: 'center' }));
  await sleep(500);
  const box = await page.$('.wordcloud-box');
  const rect = await box.boundingBox();
  const viewport = page.viewport();
  let tipText = '';
  for (let gy = 0.15; gy <= 0.9 && !tipText; gy += 0.15) {
    for (let gx = 0.1; gx <= 0.95 && !tipText; gx += 0.1) {
      const x = rect.x + rect.width * gx;
      const y = rect.y + rect.height * gy;
      if (x < 1 || y < 1 || x > viewport.width - 1 || y > viewport.height - 1) continue;
      await page.mouse.move(x, y);
      await sleep(90);
      tipText = await page.evaluate(() => {
        const tip = document.querySelector('[data-wordcloud-tip]');
        return tip && !tip.hidden ? tip.textContent.trim() : '';
      });
    }
  }
  check(`hover 显示词频提示(${JSON.stringify(tipText)})`, /\d/.test(tipText));
  await shot('about-wordcloud-cyanotype');

  // 五套视觉主题:切换后 MutationObserver 触发重绘,每套都要重新画出像素
  for (const theme of ['cyanotype', 'still', 'fluid', 'minimal', 'trace']) {
    await clearCanvas();
    await page.evaluate((t) => {
      document.documentElement.dataset.visualTheme = t;
      try { localStorage.setItem('visual-theme', t); } catch {}
    }, theme);
    const n = await waitForPaint();
    check(`主题 ${theme} 下重绘成功(${n} px)`, n > MIN_PAINT);
    if (theme === 'minimal' || theme === 'trace') await shot(`about-wordcloud-${theme}`);
  }

  // 暗色模式
  await clearCanvas();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const darkPixels = await waitForPaint();
  check(`暗色模式重绘成功(${darkPixels} px)`, darkPixels > MIN_PAINT);
  await shot('about-wordcloud-dark');

  // 通过站内导航再次进入个人页,验证 View Transitions 后脚本重新绑定
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.dataset.visualTheme = 'cyanotype'; });
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    document.querySelector('.site-header a[href="/about/"]').click();
  });
  await page.waitForFunction(() => location.pathname === '/about/');
  const afterNav = await waitForPaint();
  check(`站内导航后词云仍渲染(${afterNav} px)`, afterNav > MIN_PAINT);

  // 移动端窄屏:不能横向溢出,词云仍要画出来
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(`${base}/about/`, { waitUntil: 'networkidle0' });
  const mobilePaint = await waitForPaint(2000);
  const mobile = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    sectionWidth: Math.round(document.querySelector('.wordcloud-section').getBoundingClientRect().width),
    mainWidth: Math.round(document.querySelector('main').getBoundingClientRect().width),
  }));
  check(`移动端无横向溢出(${mobile.scrollWidth} <= ${mobile.clientWidth})`, mobile.scrollWidth <= mobile.clientWidth + 1);
  check(`移动端词云未超出容器(${mobile.sectionWidth} <= ${mobile.mainWidth})`, mobile.sectionWidth <= mobile.mainWidth);
  check(`移动端词云渲染(${mobilePaint} px)`, mobilePaint > 2000);
  await page.evaluate(() => document.querySelector('.wordcloud-section').scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot('about-wordcloud-mobile');

  check('无浏览器运行时报错', errors.length === 0);
  if (errors.length) console.log('ERRORS', errors);

  console.log(`\n全部通过:${results.length} 项断言`);
} finally {
  await browser.close();
}
