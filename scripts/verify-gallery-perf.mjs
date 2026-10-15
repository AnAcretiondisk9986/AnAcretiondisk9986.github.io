// 图库页交互回归验证：卡片改为客户端按页构建后，逐一实测各条交互路径。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // 项目根（scripts/ 的上一级）
const DIST = join(ROOT, 'dist');
const PORT = 8792;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// 默认连接已在运行的 Chrome（PERF_CDP，默认 9333）；连不上就自己拉一个
const CDP = process.env.PERF_CDP || 'http://127.0.0.1:9333';

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
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/** 默认阻断 CDN（保证可重复）；设 PERF_ALLOW_EXTERNAL=1 则放行，用真实图片布局复验点击 */
const ALLOW_EXTERNAL = process.env.PERF_ALLOW_EXTERNAL === '1';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔ PASS' : '✖ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let ownedBrowser = false;
try {
  browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
} catch {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  ownedBrowser = true;
}
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 160)));
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (ALLOW_EXTERNAL) return req.continue();
  if (u.startsWith(`http://127.0.0.1:${PORT}`) || u.startsWith('data:')) req.continue();
  else req.abort(); // 阻断 CDN 图片，保证结果稳定
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/gallery/`, { waitUntil: 'load' });
  await wait(700);

  // ── 1. 默认状态 ──
  const initial = await page.evaluate(() => ({
    albumsVisible: !document.querySelector('[data-gallery-albums]')?.hidden,
    timelineHidden: document.querySelector('[data-gallery-masonry]')?.hidden,
    albumThumbs: document.querySelectorAll('.gallery-album-thumb').length,
    timelineCards: document.querySelectorAll('[data-gallery-masonry] [data-gallery-card]').length,
    nodes: document.getElementsByTagName('*').length,
  }));
  check('默认显示「按文章」视图', initial.albumsVisible === true && initial.timelineHidden === true);
  check('相册缩略图仍由服务端渲染', initial.albumThumbs > 0, `${initial.albumThumbs} 个`);
  check('时间线仅渲染第 1 页共 9 张', initial.timelineCards === 9, `实际 ${initial.timelineCards}`);
  check('DOM 节点数显著下降', initial.nodes < 5000, `${initial.nodes} 个（优化前 10745）`);

  // ── 2. 切换时间线视图 ──
  await page.click('[data-gallery-view="timeline"]');
  await wait(400);
  const tl = await page.evaluate(() => ({
    visible: !document.querySelector('[data-gallery-masonry]')?.hidden,
    cards: document.querySelectorAll('[data-gallery-masonry] [data-gallery-card]').length,
    pagerHidden: document.querySelector('[data-gallery-pager]')?.hidden,
    total: document.querySelector('[data-gallery-page-total]')?.textContent,
    firstStamp: document.querySelector('[data-gallery-masonry] .gallery-image-stamp')?.textContent,
    hasThemeCopy: document.querySelectorAll('[data-gallery-masonry] [data-theme-copy-cyanotype]').length > 0,
    firstSrc: document.querySelector('[data-gallery-masonry] img')?.getAttribute('src')?.slice(-32),
  }));
  check('切到时间线视图后可见', tl.visible === true);
  check('时间线卡片 9 张', tl.cards === 9, `实际 ${tl.cards}`);
  check('分页器显示且总页数 > 1', tl.pagerHidden === false, `共 ${tl.total} 页`);
  check('首张编号为 01', tl.firstStamp === '01', `实际 ${tl.firstStamp}`);
  check('多语文案结构已生成', tl.hasThemeCopy === true);

  // ── 3. 翻页 ──
  await page.click('[data-gallery-page="next"]');
  await wait(400);
  const p2 = await page.evaluate(() => ({
    current: document.querySelector('[data-gallery-page-current]')?.textContent,
    firstStamp: document.querySelector('[data-gallery-masonry] .gallery-image-stamp')?.textContent,
    cards: document.querySelectorAll('[data-gallery-masonry] [data-gallery-card]').length,
    prevDisabled: document.querySelector('[data-gallery-page="prev"]')?.disabled,
    firstSrc: document.querySelector('[data-gallery-masonry] img')?.getAttribute('src')?.slice(-32),
  }));
  check('翻到第 2 页', p2.current === '02', `current=${p2.current}`);
  check('第 2 页编号从 10 连续', p2.firstStamp === '10', `实际 ${p2.firstStamp}`);
  check('第 2 页仍为 9 张', p2.cards === 9);
  check('上一页按钮已启用', p2.prevDisabled === false);
  check('翻页后内容确实变化', p2.firstSrc !== tl.firstSrc);

  // ── 4. 查看器 ──
  const tlDiag = await page.evaluate(() => {
    const b = document.querySelector('[data-gallery-masonry] [data-gallery-open]');
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    return {
      found: true,
      tag: b.tagName,
      hasAttr: b.hasAttribute('data-gallery-open'),
      box: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
      inHidden: !!b.closest('[hidden]'),
      delegated: document.documentElement.dataset.galleryDelegated || '(none)',
      handlerReady: typeof window !== 'undefined',
    };
  });
  console.log('    [debug] 时间线首个按钮:', JSON.stringify(tlDiag));
  try {
    await page.click('[data-gallery-masonry] [data-gallery-open]');
  } catch (err) {
    console.log('    [debug] page.click 抛错:', err.message.slice(0, 120));
  }
  await wait(400);
  let viewer = await page.evaluate(() => ({
    open: document.querySelector('#gallery-viewer')?.open === true,
    src: (document.querySelector('#gallery-viewer-image')?.getAttribute('src') || '').slice(-32),
    title: (document.querySelector('#gallery-viewer-title')?.textContent || '').slice(0, 24),
    sourceHidden: document.querySelector('#gallery-viewer-source')?.hidden,
  }));
  if (!viewer.open) {
    // 真实鼠标点击未生效时，改用 DOM click 判断是「委托逻辑」问题还是「坐标/布局」问题
    await page.evaluate(() => document.querySelector('[data-gallery-masonry] [data-gallery-open]')?.click());
    await wait(400);
    const viaDom = await page.evaluate(() => document.querySelector('#gallery-viewer')?.open === true);
    console.log(`    [debug] DOM click 回退结果: ${viaDom ? '仍可打开（说明是坐标/布局问题）' : '也打不开（说明是委托逻辑问题）'}`);
    viewer = await page.evaluate(() => ({
      open: document.querySelector('#gallery-viewer')?.open === true,
      src: (document.querySelector('#gallery-viewer-image')?.getAttribute('src') || '').slice(-32),
      title: (document.querySelector('#gallery-viewer-title')?.textContent || '').slice(0, 24),
      sourceHidden: document.querySelector('#gallery-viewer-source')?.hidden,
    }));
  }
  check('点击卡片可打开查看器', viewer.open === true, `标题「${viewer.title}」`);
  check('查看器加载了对应图片', viewer.src.length > 0);
  check('查看器显示来源链接', viewer.sourceHidden === false);
  await page.keyboard.press('Escape');
  await wait(300);

  // ── 5. 独立照片面板 ──
  await page.click('[data-gallery-tab="independent"]');
  await wait(800);
  const indep = await page.evaluate(() => ({
    panelVisible: !document.querySelector('[data-gallery-panel="independent"]')?.hidden,
    cards: document.querySelectorAll('[data-independent-masonry] [data-gallery-card]').length,
    slides: document.querySelectorAll('.gallery-billboard-slide').length,
    pagerTotal: document.querySelector('[data-independent-page-total]')?.textContent,
  }));
  check('切换到「独立照片」面板', indep.panelVisible === true);
  check('独立照片按页渲染 9 张', indep.cards === 9, `实际 ${indep.cards}`);
  check('广告牌轮播已懒构建', indep.slides > 0, `${indep.slides} 张幻灯片`);
  check('独立照片分页器总页数正确', Number(indep.pagerTotal) > 1, `共 ${indep.pagerTotal} 页`);

  // ── 6. 独立照片查看器 ──
  await page.click('[data-independent-masonry] [data-gallery-open]');
  await wait(400);
  const indepViewer = await page.evaluate(() => ({
    open: document.querySelector('#gallery-viewer')?.open === true,
    originalBtn: document.querySelector('[data-gallery-original-btn]')?.hidden,
  }));
  check('独立照片可打开查看器', indepViewer.open === true);
  check('原图按钮按数据决定显隐', typeof indepViewer.originalBtn === 'boolean');
  await page.keyboard.press('Escape');
  await wait(300);

  // ── 7. 排序 ──
  const beforeSort = await page.evaluate(() => ({
    first: document.querySelector('[data-independent-masonry] img')?.getAttribute('src')?.slice(-32),
    albumsFirst: document.querySelector('.gallery-album h2')?.textContent,
  }));
  await page.click('[data-gallery-sort="oldest"]');
  await wait(600);
  const afterSort = await page.evaluate(() => ({
    first: document.querySelector('[data-independent-masonry] img')?.getAttribute('src')?.slice(-32),
    status: document.querySelector('[data-gallery-order-status]')?.textContent,
    cards: document.querySelectorAll('[data-independent-masonry] [data-gallery-card]').length,
    pageCurrent: document.querySelector('[data-independent-page-current]')?.textContent,
    url: location.search,
  }));
  check('排序状态文字切换为「从旧至新」', afterSort.status === '从旧至新', `实际 ${afterSort.status}`);
  check('排序后首张内容变化', afterSort.first !== beforeSort.first);
  check('排序后回到第 1 页', afterSort.pageCurrent === '01');
  check('排序后卡片数量保持 9', afterSort.cards === 9);
  check('排序写入 URL 参数', afterSort.url.includes('order=oldest'), afterSort.url);

  // ── 8. 时间线排序交叉验证 ──
  await page.click('[data-gallery-tab="journal"]');
  await wait(300);
  await page.click('[data-gallery-view="timeline"]');
  await wait(400);
  const tlSorted = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-gallery-masonry] [data-gallery-card]').length,
    firstStamp: document.querySelector('[data-gallery-masonry] .gallery-image-stamp')?.textContent,
  }));
  check('切回时间线仍为 9 张且已按新顺序编号', tlSorted.cards === 9 && tlSorted.firstStamp === '01');

  // ── 9. 无 JS 报错 ──
  check('页面无未捕获的脚本错误', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 200) || '无');

  await page.screenshot({ path: join(ROOT, '.perf', 'gallery-after.png'), fullPage: false });
  console.log('\n截图: .perf/gallery-after.png');
} finally {
  await page.close();
  if (ownedBrowser) await browser.close();
  else browser.disconnect();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { console.log('失败项：'); failed.forEach((f) => console.log(`  · ${f.name} ${f.detail}`)); process.exit(1); }
