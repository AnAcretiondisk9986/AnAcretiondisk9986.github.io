// 图片健康检查：实际加载首页 / 文章页 / 图库页，统计图片是否 404 或解码失败。
// 用于确认孤儿清理没有误删仍被引用的图片。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = 8796;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const data = await readFile(join(DIST, normalize(p)));
    res.writeHead(200, { 'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await puppeteer.connect({ browserURL: process.env.PERF_CDP || 'http://127.0.0.1:9333', defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setCacheEnabled(false);

const bad = [];
page.on('response', (r) => {
  if (r.status() >= 400 && /\.(webp|png|jpe?g|gif|svg|avif)/i.test(r.url())) bad.push(`${r.status()} ${r.url().slice(0, 110)}`);
});

const PAGES = [
  ['首页', '/'],
  ['文章目录', '/blog/'],
  ['图库', '/gallery/'],
  ['关于', '/about/'],
  ['长文', '/blog/医学扩招-中国新闻网-2026-09-14/'],
];

let totalImgs = 0;
let brokenImgs = 0;
for (const [label, path] of PAGES) {
  try {
    await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'load', timeout: 60000 });
  } catch { /* 单页超时不阻塞整体 */ }
  await new Promise((r) => setTimeout(r, 1500));
  // 滚到底，触发懒加载
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 1200));
  const stat = await page.evaluate(() => {
    const imgs = [...document.images];
    // 只看真正发起过请求的图片：查看器的占位 <img> 没有 src，naturalWidth 也是 0，不应算失败
    const loaded = imgs.filter((i) => i.getAttribute('src'));
    const broken = loaded.filter((i) => i.complete && i.naturalWidth === 0);
    return {
      total: imgs.length,
      broken: broken.length,
      details: broken.slice(0, 4).map((i) => i.currentSrc.slice(0, 100)),
    };
  });
  totalImgs += stat.total;
  brokenImgs += stat.broken;
  console.log(`${label.padEnd(6)} 图片 ${String(stat.total).padStart(3)} 个，解码失败 ${stat.broken}${stat.broken ? ' ← ' + stat.details.join(' | ') : ''}`);
}

console.log(`\n合计 ${totalImgs} 张图片，解码失败 ${brokenImgs} 张`);
console.log(`HTTP 4xx/5xx 图片请求：${bad.length} 个`);
bad.slice(0, 8).forEach((b) => console.log('   ' + b));

await page.close();
browser.disconnect();
server.close();
process.exit(brokenImgs === 0 && bad.length === 0 ? 0 : 1);
