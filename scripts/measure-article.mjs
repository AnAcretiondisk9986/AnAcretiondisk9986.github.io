// 文章页三栏宽度测量：左边注 / 正文列 / 右边注 / 段落行宽，按视口逐个输出
//
// 用法：
//   1) npm run build
//   2) node scripts/measure-article.mjs [视口宽度，逗号分隔]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.argv[2] || '1101,1180,1280,1399,1400,1440').split(',').map(Number);
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

// 与 shoot-site.mjs 一致：取编目页第一条文章
const blogIndex = await readFile(join(DIST, 'blog', 'index.html'), 'utf8');
const post = decodeURIComponent(blogIndex.match(/href="(\/blog\/[^"#?]+\/)"/)?.[1] ?? '/blog/');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
console.log(post);
for (const w of WIDTHS) {
  await page.setViewport({ width: w, height: 900 });
  await page.goto(BASE + encodeURI(post), { waitUntil: 'domcontentloaded' }); await new Promise((r) => setTimeout(r, 800));
  const r = await page.evaluate(() => {
    const W = (s) => {
      const e = document.querySelector(s);
      if (!e || getComputedStyle(e).display === 'none') return null;
      return Math.round(e.getBoundingClientRect().width);
    };
    return {
      margin: W('.article-page .article-margin'),
      article: W('.article-page .article'),
      rail: W('.article-page .article-rail'),
      p: W('.article-page .article .prose > p, .article-page .article p'),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  console.log(w, JSON.stringify(r));
}
await browser.close();
server.close();
