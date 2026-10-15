// 验证全站 CDN 镜像降级：首页 hero、卡片封面等任意 <img> 加载失败时，
// 应依次切换 fastly → gcore → testingcf 镜像；镜像用尽后回退到原始封面。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = 8795;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = process.env.PERF_CDP || 'http://127.0.0.1:9333';

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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔ PASS' : '✖ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

let browser;
let owned = false;
try {
  browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
} catch {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  owned = true;
}
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
// 注意：这里**放行** CDN。若阻断，图片会一路降级到末端并回退成原图，
// 导致「封面是否为缩略图」的断言失真（那测到的是回退后的状态）。
await page.setRequestInterception(true);
page.on('request', (req) => req.continue());

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 700));

  // 1) 封面是否已走缩略图 + 是否带原始封面回退
  const covers = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.catalog-cover img')];
    return {
      total: imgs.length,
      thumb: imgs.filter((i) => i.src.includes('/image/thumb/')).length,
      withFallback: imgs.filter((i) => i.dataset.originalCover).length,
      sample: imgs[0]?.src.replace(/^https:\/\/[^/]+\//, '').slice(0, 60),
    };
  });
  check('卡片封面全部改用 480px 缩略图', covers.total > 0 && covers.thumb === covers.total,
    `${covers.thumb}/${covers.total}；样例 ${covers.sample}`);
  check('封面带有原始图回退数据', covers.withFallback === covers.total, `${covers.withFallback}/${covers.total}`);

  // 2) 从 cdn 起，连续失败 3 次 → 应依次切到 fastly / gcore / testingcf
  const chain = await page.evaluate(() => {
    const img = document.querySelector('.catalog-cover img') || document.querySelector('img[src*="jsdelivr"]');
    if (!img) return { hosts: [] };
    // 归位到首发镜像，便于断言完整链路
    img.src = img.src.replace(/^https:\/\/[^/]+\//, 'https://cdn.jsdelivr.net/');
    const hosts = ['cdn.jsdelivr.net'];
    for (let i = 0; i < 3; i += 1) {
      img.dispatchEvent(new Event('error'));
      hosts.push(new URL(img.src).hostname);
    }
    return { hosts };
  });
  check('镜像降级链 cdn → fastly → gcore → testingcf',
    chain.hosts.join(' → ') === 'cdn.jsdelivr.net → fastly.jsdelivr.net → gcore.jsdelivr.net → testingcf.jsdelivr.net',
    chain.hosts.join(' → '));

  // 3) 已是最后一个镜像时再失败 → 回退到原始封面（脱离 /thumb/）
  const fallback = await page.evaluate(() => {
    const img = document.querySelector('.catalog-cover img[data-original-cover]');
    if (!img) return { ok: false, reason: '没有带 data-original-cover 的封面' };
    img.src = img.src.replace(/^https:\/\/[^/]+\//, 'https://testingcf.jsdelivr.net/');
    const beforeHost = new URL(img.src).hostname;
    img.dispatchEvent(new Event('error'));
    return {
      ok: true,
      beforeHost,
      host: new URL(img.src).hostname,
      stillThumb: img.src.includes('/image/thumb/'),
      attrGone: !img.dataset.originalCover,
    };
  });
  check('镜像用尽后回退到原始封面（不再走 /thumb/）',
    fallback.ok && fallback.host === 'cdn.jsdelivr.net' && fallback.stillThumb === false,
    fallback.ok ? `${fallback.beforeHost} → ${fallback.host}，仍为缩略图=${fallback.stillThumb}` : fallback.reason);
  check('回退后清理标记，避免循环降级', fallback.ok && fallback.attrGone === true, `data-original-cover 已移除=${fallback.attrGone}`);

  // 5) 其他页面同样生效（文章正文图片也走同一委托）
  await page.goto(`http://127.0.0.1:${PORT}/blog/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const onList = await page.evaluate(() => {
    const img = document.querySelector('img[src*="cdn.jsdelivr.net"]');
    if (!img) return { ok: false };
    const before = new URL(img.src).hostname;
    img.dispatchEvent(new Event('error'));
    return { ok: true, before, after: new URL(img.src).hostname };
  });
  check('文章目录页的图片同样参与降级',
    onList.ok && onList.after === 'fastly.jsdelivr.net', `${onList.before} → ${onList.after}`);

  check('无脚本错误', errors.length === 0, errors.join(' | ').slice(0, 160) || '无');
} finally {
  await page.close();
  if (owned) await browser.close(); else browser.disconnect();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== CDN 降级验证：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach((f) => console.log(`  · ${f.name} ${f.detail}`)); process.exit(1); }
