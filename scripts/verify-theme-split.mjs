// 主题样式按需加载后的回归验证：确认 5 个视觉主题都能正确拿到自己的样式，
// 且切换后关键视觉属性确实变化（而不是回落到无主题状态）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // 项目根（scripts/ 的上一级）
const DIST = join(ROOT, 'dist');
const PORT = 8793;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = process.env.PERF_CDP || 'http://127.0.0.1:9333';
const THEMES = ['cyanotype', 'still', 'fluid', 'minimal', 'trace'];
const EXPECTED_FILE = {
  cyanotype: 'cyanotype-theme.css',
  still: 'liquid-theme.css',
  fluid: 'liquid-theme.css',
  minimal: 'minimal-theme.css',
  trace: null, // trace 的规则在 theme-shared / fusion 中，无需额外文件
};

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
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
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
// 必须放行 CDN 图片，否则布局塌陷影响取色；同时记录主题 CSS 的请求
const requested = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/themes/')) requested.push(u.replace(`http://127.0.0.1:${PORT}`, '').split('?')[0]);
});

try {
  // 先清零上一次运行残留的主题偏好，保证从默认状态（cyanotype）开始
  await page.goto(`http://127.0.0.1:${PORT}/about/`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* 忽略 */ } });
  requested.length = 0;
  await page.reload({ waitUntil: 'load' });
  await wait(900);

  // 首屏：真正参与渲染的样式表应当只有「主样式表 + 当前主题」两个。
  // 其余主题是 rel=prefetch 的旁路预取（不参与首屏渲染），不计入。
  const initialSheets = await page.evaluate(() => ({
    blocking: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => (l.getAttribute('href') || '').replace(/\?.*$/, '').replace(/^.*\//, '')),
    prefetch: [...document.querySelectorAll('link[rel="prefetch"]')].length,
  }));
  check('首屏参与渲染的样式表 = 主样式表 + 默认主题',
    initialSheets.blocking.length === 2 && initialSheets.blocking.some((h) => h.endsWith('cyanotype-theme.css')),
    initialSheets.blocking.join(', '));
  check('其余主题以 prefetch 旁路加载（不阻塞渲染）', initialSheets.prefetch >= 2, `${initialSheets.prefetch} 个`);

  const probe = () => page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    const swatch = document.querySelector('.appearance-swatch');
    const picker = document.querySelector('.appearance-selector button');
    return {
      theme: document.documentElement.dataset.visualTheme,
      bodyBg: body.backgroundColor,
      bodyColor: body.color,
      paper: root.getPropertyValue('--paper').trim(),
      fontFamily: body.fontFamily.slice(0, 40),
      swatchVisible: swatch ? getComputedStyle(swatch).display !== 'none' : false,
      pickerHeight: picker ? Math.round(picker.getBoundingClientRect().height) : 0,
      themeCssHref: document.querySelector('#theme-css')?.getAttribute('href') || '(removed)',
      stylesheetCount: document.styleSheets.length,
    };
  });

  const seen = {};
  for (const theme of THEMES) {
    if (theme !== 'cyanotype') {
      await page.click(`[data-visual-theme-option="${theme}"]`);
      await wait(700); // 等预取到的样式表生效
    }
    const state = await probe();
    seen[theme] = state;
    const expected = EXPECTED_FILE[theme];
    const ok = state.theme === theme
      && (expected ? state.themeCssHref.includes(expected) : state.themeCssHref === '(removed)');
    check(`主题 ${theme}：样式表指向正确`, ok, `href=${state.themeCssHref}`);
    check(`主题 ${theme}：选择器 UI 仍可见`, state.swatchVisible && state.pickerHeight > 20,
      `swatch=${state.swatchVisible} 高度=${state.pickerHeight}px`);
    await page.screenshot({ path: join(ROOT, '.perf', `theme-${theme}.png`) });
  }

  // 主题之间必须有可观测的视觉差异（避免全部回落到同一套无色样式）
  const distinctBg = new Set(Object.values(seen).map((s) => s.bodyBg));
  check('至少 3 种主题产生不同的页面底色', distinctBg.size >= 3, `实际 ${distinctBg.size} 种: ${[...distinctBg].join(' / ')}`);
  const distinctPaper = new Set(Object.values(seen).map((s) => s.paper));
  check('至少 3 种主题产生不同的 --paper 变量', distinctPaper.size >= 3, `${distinctPaper.size} 种`);

  // 主题切换后预取应把其余主题补齐（供再次切换即时生效）
  const afterSwitch = [...new Set(requested)];
  check('切换后其余主题样式已被预取', afterSwitch.length >= 3, afterSwitch.join(', '));

  // 刷新后应保持用户选择的主题（localStorage 持久化 + 首屏同步应用）
  await page.reload({ waitUntil: 'load' });
  await wait(900);
  const afterReload = await probe();
  check('刷新后仍保持上次选择的主题', afterReload.theme === 'trace', `实际 ${afterReload.theme}`);
  check('刷新后 trace 主题不请求多余样式表',
    (afterReload.themeCssHref === '(removed)'), `href=${afterReload.themeCssHref}`);

  check('全过程无脚本错误', errors.length === 0, errors.join(' | ').slice(0, 200) || '无');
} finally {
  await page.close();
  if (ownedBrowser) await browser.close();
  else browser.disconnect();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 主题回归：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach((f) => console.log(`  · ${f.name} ${f.detail}`)); process.exit(1); }
