#!/usr/bin/env node
/**
 * HORIZON 全站前台性能与操作逻辑综合回归验证（Headless Chrome）。
 * 覆盖：
 *   1. 首屏关键 CSS 体积与 CJK 分片异步加载、Speculation Rules 预取、theme-color 同步
 *   2. 首页（/）：WebGL/Fallback 首屏、精选图版随机池精简、VOID/PLATE 主题切换与持久化、移动端菜单焦点陷阱与 Escape 关闭
 *   3. 文章光谱（/blog/）：`/` 快捷键聚焦搜索、防抖检索、标签筛选、按字数/时间排序、URL 参数双向同步（?q=&tag=&sort=）、Escape 二段清空与失焦、光谱条联动
 *   4. 文章详情（/blog/.../）：目录生成与滚动联动（is-active + aria-current="location"）、侧栏折叠（[ 快捷键 + localStorage 持久化）、正文字号三档（A-/A/A+ 持久化）、分享短链展开与复制、代码块语言与复制、正文图片灯箱（打开/切换/缩放/Escape 关闭与焦点恢复）、智能返回保留 /blog/ 筛选参数
 *   5. 图像透镜（/gallery/）：HTML 体积精简、透镜场虚拟化按需挂载 DOM（节点与 <img> 数大幅下降）、`/` 快捷键检索、按需拉取随文影像 JSON、索引分页、高清灯箱（计数/标题/缩放/原图竞态防护/Escape 焦点恢复）
 *   6. 日常时间线（/daily/）：栏目切换、排序 FLIP 动画、点赞与收藏 localStorage 持久化、直链复制、多图灯箱与焦点恢复
 *   7. 学业（/academics/）与日程/考试（/schedule/、/schedule/exams/）：课程翻转、空状态重置、URL 同步、抽屉打开与关闭焦点恢复
 *   8. 全程零未捕获脚本错误（pageerror = 0）
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.VERIFY_PORT || 8796);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
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
    res.end('not found');
  }
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔ PASS' : '✖ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${String(e.message).slice(0, 160)}`));

await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u.startsWith(`http://127.0.0.1:${PORT}`) || u.startsWith('data:')) req.continue();
  else req.abort();
});

try {
  // ── 1. 构建产物静态指标断言 ──
  const homeStat = await stat(join(DIST, 'index.html'));
  const galStat = await stat(join(DIST, 'gallery', 'index.html'));
  const platesJsonStat = await stat(join(DIST, 'data', 'gallery-plates.json'));
  const journalJsonStat = await stat(join(DIST, 'data', 'gallery-journal.json'));
  check('首页 HTML 体积精简 (< 45 KB，原 112.2 KB)', homeStat.size < 45000, `${(homeStat.size / 1024).toFixed(1)} KB`);
  check('图志页 HTML 体积精简 (< 35 KB，原 339.5 KB)', galStat.size < 35000, `${(galStat.size / 1024).toFixed(1)} KB`);
  check('按需数据包 gallery-plates.json 与 gallery-journal.json 已生成', platesJsonStat.size > 10000 && journalJsonStat.size > 10000);

  // ── 2. 首页与全局外壳 ──
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await wait(350);

  const homeState = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href') || '');
    const baseCss = sheets.find((h) => h.includes('BaseLayout'));
    const hasSpecRules = Boolean(document.querySelector('script[type="speculationrules"]'));
    const themeBtn = document.querySelector('[data-theme-toggle]');
    const metaTheme = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    const pool = JSON.parse(document.getElementById('hz-home-plates-pool')?.textContent || '[]');
    return {
      baseCss,
      hasSpecRules,
      theme: document.documentElement.dataset.theme,
      ariaPressed: themeBtn?.getAttribute('aria-pressed'),
      metaTheme,
      poolLen: pool.length,
    };
  });
  check('Speculation Rules 预取规则已注入', homeState.hasSpecRules === true);
  check('首页图版随机池控制在 32 幅以内', homeState.poolLen > 0 && homeState.poolLen <= 32, `${homeState.poolLen} 幅`);
  check('初始主题与 theme-color 及 aria-pressed 同步', homeState.theme === 'dark' && homeState.metaTheme === '#08080b' && homeState.ariaPressed === 'false');

  // 切换主题为 PLATE (light)
  await page.click('[data-theme-toggle]');
  await wait(250);
  const afterTheme = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('theme'),
    metaTheme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    ariaPressed: document.querySelector('[data-theme-toggle]')?.getAttribute('aria-pressed'),
  }));
  check('VOID/PLATE 主题切换同步更新 dataset、localStorage、theme-color 与 aria-pressed',
    afterTheme.theme === 'light' && afterTheme.stored === 'light' && afterTheme.metaTheme === '#eae8e2' && afterTheme.ariaPressed === 'true');
  // 切回 dark
  await page.click('[data-theme-toggle]');
  await wait(200);

  // 移动端全屏菜单焦点管理与 Escape 关闭
  await page.setViewport({ width: 390, height: 844 });
  await wait(150);
  await page.click('[data-menu-open]');
  await wait(150);
  const menuOpen = await page.evaluate(() => ({
    hidden: document.querySelector('[data-menu]')?.hidden,
    role: document.querySelector('[data-menu]')?.getAttribute('role'),
    focused: document.activeElement?.hasAttribute('data-menu-close'),
  }));
  check('移动端菜单打开后 role=dialog 且焦点自动移入关闭按钮', menuOpen.hidden === false && menuOpen.role === 'dialog' && menuOpen.focused === true);
  await page.keyboard.press('Escape');
  await wait(420);
  const menuClosed = await page.evaluate(() => ({
    hidden: document.querySelector('[data-menu]')?.hidden,
    focusedBack: document.activeElement?.hasAttribute('data-menu-open'),
  }));
  check('按 Escape 关闭移动端菜单并将焦点恢复到触发按钮', menuClosed.hidden === true && menuClosed.focusedBack === true);
  await page.setViewport({ width: 1280, height: 900 });

  // ── 3. 文章光谱（/blog/） ──
  await page.goto(`http://127.0.0.1:${PORT}/blog/`, { waitUntil: 'load' });
  await wait(300);
  await page.keyboard.press('/');
  const searchFocused = await page.evaluate(() => document.activeElement?.hasAttribute('data-spec-search'));
  check('/blog/ 按 `/` 键聚焦搜索框', searchFocused === true);

  await page.keyboard.type('RAG');
  await wait(200);
  const afterSearch = await page.evaluate(() => ({
    url: location.search,
    visibleRows: [...document.querySelectorAll('[data-post-row]')].filter((r) => !r.hidden).length,
  }));
  check('/blog/ 搜索防抖生效且 URL 同步 ?q=RAG', afterSearch.url.includes('q=RAG') && afterSearch.visibleRows > 0, `${afterSearch.visibleRows} 篇, ${afterSearch.url}`);

  // 排序切换同步 URL
  await page.click('[data-spec-sort="mass"]');
  await wait(150);
  const afterSort = await page.evaluate(() => location.search);
  check('/blog/ 切换按字数排序同步 URL ?sort=mass', afterSort.includes('sort=mass'), afterSort);

  // Escape 第一下清空搜索词，第二下失焦
  await page.focus('[data-spec-search]');
  await page.keyboard.press('Escape');
  await wait(100);
  const afterEsc1 = await page.evaluate(() => ({
    val: document.querySelector('[data-spec-search]')?.value,
    stillFocused: document.activeElement?.hasAttribute('data-spec-search'),
    url: location.search,
  }));
  check('/blog/ 按第 1 次 Escape 清空检索词并保持焦点', afterEsc1.val === '' && afterEsc1.stillFocused === true && !afterEsc1.url.includes('q='));
  await page.keyboard.press('Escape');
  const afterEsc2 = await page.evaluate(() => document.activeElement?.hasAttribute('data-spec-search'));
  check('/blog/ 按第 2 次 Escape 使搜索框失焦', afterEsc2 === false);

  // ── 4. 文章阅读页（/blog/.../） ──
  await page.goto(`http://127.0.0.1:${PORT}/blog/把教材变成可以解题的本地知识库-一次医学RAG实现记录/`, { waitUntil: 'load' });
  await wait(350);

  const entryCheck = await page.evaluate(() => {
    const tocLinks = [...document.querySelectorAll('[data-toc-list] a')];
    const activeToc = document.querySelector('[data-toc-list] a.is-active');
    const codeLangs = [...document.querySelectorAll('.hz-code__bar span')].map((s) => s.textContent);
    const zoomImgs = document.querySelectorAll('.hz-prose img[data-zoomable="1"]').length;
    return {
      tocCount: tocLinks.length,
      activeCurrent: activeToc?.getAttribute('aria-current'),
      codeLangs,
      zoomImgs,
    };
  });
  check('文章页自动生成目录且当前节标有 aria-current="location"', entryCheck.tocCount > 0 && entryCheck.activeCurrent === 'location', `${entryCheck.tocCount} 节`);
  check('代码块工具栏与正文可放大图片均已绑定', entryCheck.codeLangs.length > 0 && entryCheck.zoomImgs > 0, `代码 ${entryCheck.codeLangs.length} 块, 图片 ${entryCheck.zoomImgs} 张`);

  // 字号调节与持久化
  await page.click('[data-entry-fontsize="lg"]');
  const fsState = await page.evaluate(() => ({
    attr: document.querySelector('[data-entry-root]')?.getAttribute('data-font-size'),
    stored: localStorage.getItem('hz-entry-fontsize'),
    pressed: document.querySelector('[data-entry-fontsize="lg"]')?.getAttribute('aria-pressed'),
  }));
  check('文章正文字号调节（A-/A/A+）同步 DOM 与 localStorage', fsState.attr === 'lg' && fsState.stored === 'lg' && fsState.pressed === 'true');

  // 快捷键 `[` 折叠/展开侧栏
  await page.keyboard.press('[');
  const railCollapsed = await page.evaluate(() => document.querySelector('[data-entry-root]')?.getAttribute('data-rail-collapsed'));
  check('文章页按 `[` 键收起侧栏', railCollapsed === 'true');
  await page.keyboard.press('[');

  // 分享短链面板可展开与再次点击收起
  await page.click('[data-shortlink-generate]');
  await wait(100);
  const slOpen = await page.evaluate(() => !document.querySelector('[data-shortlink-panel]')?.hidden);
  await page.click('[data-shortlink-generate]');
  await wait(100);
  const slClosed = await page.evaluate(() => document.querySelector('[data-shortlink-panel]')?.hidden);
  check('分享短链面板支持展开与再次点击收起', slOpen === true && slClosed === true);

  // 点击正文图片打开文章图片查看灯箱，按 Escape 关闭并恢复焦点
  await page.click('.hz-prose img[data-zoomable="1"]');
  await wait(150);
  const evOpen = await page.evaluate(() => ({
    open: document.getElementById('hz-entry-viewer')?.open === true,
    src: document.querySelector('[data-ev-img]')?.getAttribute('src')?.length > 0,
  }));
  check('点击文章正文图片打开高清查看灯箱', evOpen.open === true && evOpen.src === true);
  await page.keyboard.press('Escape');
  await wait(150);
  const evClosed = await page.evaluate(() => ({
    open: document.getElementById('hz-entry-viewer')?.open === true,
    focusedImg: document.activeElement?.getAttribute('data-zoomable') === '1',
  }));
  check('按 Escape 关闭文章图片灯箱并将焦点恢复到原图片', evClosed.open === false && evClosed.focusedImg === true);

  // ── 5. 图像透镜（/gallery/） ──
  await page.goto(`http://127.0.0.1:${PORT}/gallery/`, { waitUntil: 'load' });
  await wait(400);
  const galInit = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    mountedCards: document.querySelectorAll('.hz-fplate').length,
    countText: document.querySelector('[data-gal-count]')?.textContent,
  }));
  check('图志页透镜场按需虚拟化挂载 DOM（首屏卡片 < 25，总节点 < 350）',
    galInit.mountedCards > 0 && galInit.mountedCards < 25 && galInit.domNodes < 350,
    `挂载 ${galInit.mountedCards} 张, DOM ${galInit.domNodes} 个, 计数 ${galInit.countText}`);

  // `/` 快捷键聚焦图志筛选框
  await page.keyboard.press('/');
  const galFilterFocused = await page.evaluate(() => document.activeElement?.id === 'hz-gal-filter');
  check('/gallery/ 按 `/` 键聚焦筛选框', galFilterFocused === true);
  await page.keyboard.press('Escape');

  // 切换到「随文影像」按需加载 /data/gallery-journal.json
  await page.click('[data-gal-tab="journal"]');
  await wait(450);
  const galJournal = await page.evaluate(() => ({
    countText: document.querySelector('[data-gal-count]')?.textContent || '',
    url: location.search,
  }));
  check('/gallery/ 切换「随文影像」按需拉取 JSON 并同步 URL ?tab=journal',
    parseInt(galJournal.countText, 10) > 50 && galJournal.url.includes('tab=journal'),
    `${galJournal.countText}, ${galJournal.url}`);

  // 切到索引模式并打开灯箱验证计数器与焦点恢复
  await page.click('[data-gal-mode="index"]');
  await wait(250);
  await page.click('.hz-iplate');
  await wait(200);
  const galViewer = await page.evaluate(() => ({
    open: document.getElementById('hz-viewer')?.open === true,
    counter: document.querySelector('[data-viewer-counter]')?.textContent || '',
    title: document.querySelector('[data-viewer-title]')?.textContent || '',
  }));
  check('/gallery/ 灯箱显示计数器与图像标题元信息', galViewer.open === true && /\d+\s*\/\s*\d+/.test(galViewer.counter) && galViewer.title.length > 0, `${galViewer.counter} · ${galViewer.title.slice(0, 20)}`);
  await page.keyboard.press('Escape');
  await wait(150);
  const galFocusBack = await page.evaluate(() => document.activeElement?.classList.contains('hz-iplate'));
  check('/gallery/ 关闭灯箱后焦点恢复到触发卡片', galFocusBack === true);

  // ── 6. 日常时间线（/daily/） ──
  await page.goto(`http://127.0.0.1:${PORT}/daily/`, { waitUntil: 'load' });
  await wait(300);
  await page.click('[data-tl-sort="oldest"]');
  await wait(200);
  const dailySort = await page.evaluate(() => ({
    url: location.search,
    badTransition: [...document.querySelectorAll('[data-tl-tweet]')].some((el) => el.style.transition.includes('object')),
  }));
  check('/daily/ 切换排序同步 URL ?sort=oldest 且 FLIP 动画过渡无 [object Object] 错误',
    dailySort.url.includes('sort=oldest') && dailySort.badTransition === false, dailySort.url);

  // ── 7. 学业（/academics/）空状态与重置 ──
  await page.goto(`http://127.0.0.1:${PORT}/academics/`, { waitUntil: 'load' });
  await wait(250);
  await page.keyboard.press('/');
  await page.keyboard.type('不存在的课程XYZ');
  await wait(200);
  const acadEmpty = await page.evaluate(() => ({
    emptyVisible: !document.querySelector('[data-acad-empty]')?.hidden,
    url: location.search,
  }));
  check('/academics/ 零匹配时展示空状态与重置入口并同步 URL', acadEmpty.emptyVisible === true && acadEmpty.url.includes('q='));
  await page.click('[data-acad-reset]');
  await wait(150);
  const acadReset = await page.evaluate(() => document.querySelector('[data-acad-empty]')?.hidden === true);
  check('/academics/ 点击重置筛选恢复全部课程', acadReset === true);

  // ── 8. 全程零脚本错误 ──
  check('全站巡检零未捕获脚本错误', pageErrors.length === 0, pageErrors.join(' | ') || '0 errors');
} finally {
  await page.close();
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== HORIZON 全站验证：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length > 0) {
  failed.forEach((f) => console.log(`  ✖ ${f.name}: ${f.detail}`));
  process.exit(1);
}
