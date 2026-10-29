// 全站前台 CSS 覆盖率：哪些源文件的规则在真实页面上还命中元素
//
// 用法：
//   1) npm run build
//   2) node scripts/css-coverage.mjs
// 输出：按 dist/_astro 下每个 CSS 包统计已用 / 总字节；
//      并把未命中的选择器写到 perf-reports/css-coverage/unused.txt
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'perf-reports', 'css-coverage');
const PORT = 8794;
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

// 代表页：每类模板至少一页
const blogDirs = (await readdir(join(DIST, 'blog'), { withFileTypes: true })).filter((d) => d.isDirectory());
const shareDirs = (await readdir(join(DIST, 's'), { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());
const pages = ['/', '/blog/', '/gallery/', '/about/', '/404.html', '/private/',
  ...blogDirs.slice(0, 3).map((d) => `/blog/${d.name}/`),
  ...shareDirs.slice(0, 1).map((d) => `/s/${d.name}/`)];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (req) => (req.url().startsWith(BASE) ? req.continue() : req.abort()));

// 每条样式规则：在任一页 × 视口 × 明暗下匹配到元素即为"已用"
// （Chrome 自带 CSS coverage 会把整个 @layer 块计为已用，不能用）
const hits = new Map(); // key = layer|selector -> { layer, selector, bytes, used }
const collect = () => {
  const out = [];
  const strip = (sel) => sel
    .replace(/::?(before|after|placeholder|selection|marker|backdrop|first-letter|first-line|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?/g, '')
    .replace(/:(hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|enabled|empty|link|any-link|user-invalid|invalid|placeholder-shown|popover-open|open)(?![\w-])/g, '');
  const walk = (rules, layer, file) => {
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        let used = false;
        for (const part of r.selectorText.split(',')) {
          const s = strip(part).trim() || '*';
          try { if (document.querySelector(s)) { used = true; break; } } catch { used = true; break; }
        }
        out.push({ layer, file, selector: r.selectorText.slice(0, 200), bytes: r.cssText.length, used });
        if (r.cssRules && r.cssRules.length) walk(r.cssRules, layer, file);
      } else if (r instanceof CSSLayerBlockRule) {
        walk(r.cssRules, r.name, file);
      } else if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule || (window.CSSContainerRule && r instanceof CSSContainerRule)) {
        walk(r.cssRules, layer, file);
      }
    }
  };
  for (const sh of document.styleSheets) {
    if (!sh.href || !sh.href.includes('/_astro/')) continue;
    try { walk(sh.cssRules, '(none)', sh.href.split('/').pop()); } catch {}
  }
  return out;
};
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844, isMobile: true }];
for (const mode of ['light', 'dark']) {
  for (const vp of viewports) {
    await page.setViewport(vp);
    for (const path of pages) {
      await page.goto(BASE + encodeURI(path), { waitUntil: 'networkidle0' }).catch(() => {});
      await page.evaluate((m) => { document.documentElement.dataset.theme = m; }, mode);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      });
      for (const r of await page.evaluate(collect)) {
        const k = `${r.file}|${r.layer}|${r.selector}`;
        const prev = hits.get(k);
        if (prev) prev.used ||= r.used; else hits.set(k, r);
      }
    }
  }
}
await browser.close();
server.close();

const byLayer = {};
const unused = [];
for (const r of hits.values()) {
  const b = (byLayer[r.layer] ||= { rules: 0, unusedRules: 0, bytes: 0, unusedBytes: 0 });
  b.rules++; b.bytes += r.bytes;
  if (!r.used) { b.unusedRules++; b.unusedBytes += r.bytes; unused.push(`[${r.layer}] ${r.selector}`); }
}
console.table(byLayer);
console.log(`pages: ${pages.length} × 2 viewports × 2 modes`);
await writeFile(join(OUT, 'unused.txt'), unused.sort().join('\n'));
console.log(`unused rules: ${unused.length} → perf-reports/css-coverage/unused.txt`);
