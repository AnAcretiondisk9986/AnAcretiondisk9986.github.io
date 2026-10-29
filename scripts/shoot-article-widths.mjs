// 文章页首屏截图（指定视口宽度），并报告左边注内容是否超出可视高度
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'perf-reports', 'shots', process.argv[3] || 'widths');
const PORT = 8797;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const d = await readFile(join(DIST, normalize(p))); res.writeHead(200, { 'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' }); res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });
const idx = await readFile(join(DIST, 'blog', 'index.html'), 'utf8');
const post = decodeURIComponent(idx.match(/href="(\/blog\/[^"#?]+\/)"/)?.[1]);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
for (const w of (process.argv[2] || '1280').split(',').map(Number)) {
  await page.setViewport({ width: w, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}` + encodeURI(post), { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 800));
  await page.evaluate((y) => window.scrollTo(0, y), Number(process.env.SY ?? 700));
  await new Promise((r) => setTimeout(r, 400));
  const m = await page.evaluate(() => { const t = [...document.querySelectorAll('.article-page .article-toc--margin, .article-page .article-rail')].find(e => getComputedStyle(e).display !== 'none'); const r = t.getBoundingClientRect(); return { client: t.clientHeight, scroll: t.scrollHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
  console.log(w, JSON.stringify(m), m.scroll > m.client + 1 ? 'scrolls inside' : 'fits', m.bottom <= m.vh ? 'in viewport' : 'OVERFLOWS VIEWPORT');
  await page.screenshot({ path: join(OUT, `post-${w}.png`) });
}
await browser.close(); server.close();
