// 全站前台截图：页面 × 明暗 × 桌面/移动，整页
//
// 用法：
//   1) npm run build
//   2) node scripts/shoot-site.mjs [标签]      # 标签默认 now，输出 perf-reports/shots/<标签>/
// 同时报告：横向溢出、控制台/页面错误。
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TAG = process.argv[2] || 'now';
const OUT = join(ROOT, 'perf-reports', 'shots', TAG);
const PORT = 8795;
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
    const data = await readFile(join(DIST, normalize(p)));
    res.writeHead(200, { 'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });

// 文章页：取最新一篇（目录按 mtime 不可靠，读编目页第一条链接）
const blogIndex = await readFile(join(DIST, 'blog', 'index.html'), 'utf8');
const firstPost = decodeURIComponent(blogIndex.match(/href="(\/blog\/[^"#?]+\/)"/)?.[1] ?? '/blog/');
const pages = { home: '/', blog: '/blog/', post: firstPost, gallery: '/gallery/', about: '/about/', '404': '/404.html' };
const only = process.env.PAGES ? process.env.PAGES.split(',') : Object.keys(pages);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const issues = [];
const vps = { desk: { width: 1440, height: 900 }, mob: { width: 390, height: 844, isMobile: true, hasTouch: true } };
for (const mode of ['light', 'dark']) {
  for (const [vpName, vp] of Object.entries(vps)) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((m) => { try { localStorage.setItem('theme', m); localStorage.removeItem('visual-theme'); } catch {} }, mode);
    page.on('pageerror', (e) => issues.push(`${mode}/${vpName} pageerror: ${String(e.message).slice(0, 160)}`));
    for (const name of only) {
      await page.goto(BASE + encodeURI(pages[name]), { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      // 逐屏滚动，触发进入态与懒加载，然后回顶
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        // 整页截图不会再触发 IntersectionObserver：把进入态直接置为已显现
        document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
        scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 500));
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) issues.push(`${name} ${mode}/${vpName} 横向溢出 ${overflow}px`);
      await page.screenshot({ path: join(OUT, `${name}-${mode}-${vpName}.png`), fullPage: true, captureBeyondViewport: true });
      await page.screenshot({ path: join(OUT, `${name}-${mode}-${vpName}-fold.png`) });
    }
    await page.close();
  }
}
await browser.close();
server.close();
console.log(`shots → perf-reports/shots/${TAG}/  (${only.length} 页 × 2 模式 × 2 视口)`);
console.log(issues.length ? issues.join('\n') : 'no overflow / page errors');
