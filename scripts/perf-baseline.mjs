#!/usr/bin/env node
/**
 * 博客性能基线采集器（可重复运行，用于优化前后对比）。
 *
 * 采集两类数据：
 *  1. 传输层：每个页面加载的 HTML/CSS/JS/图片 原始字节与 gzip 字节（本地静态服务器实测）
 *  2. 运行时：DOM 节点数、元素数、FCP/LCP/DCL/load、CSS 与 JS 覆盖率
 *
 * 用法：
 *   node scripts/perf-baseline.mjs --label baseline
 *   node scripts/perf-baseline.mjs --label optimized --out perf-reports
 *
 * 外部请求（CDN 图片等）默认阻断，以保证可重复性并在报告中如实标注。
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PERF_PORT || 8791);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LABEL = argOf('label', 'run');
const OUT_DIR = join(ROOT, argOf('out', 'perf-reports'));
const ALLOW_EXTERNAL = argv.includes('--allow-external');
/** 连接已启动的 Chrome（沙箱下 Node 无法 spawn 子进程，见 scripts/perf-chrome.ps1） */
const CDP_URL = argOf('cdp', process.env.PERF_CDP || '');

const PAGES = [
  { id: 'home', path: '/' },
  { id: 'blog-index', path: '/blog/' },
  { id: 'gallery', path: '/gallery/' },
  { id: 'about', path: '/about/' },
  { id: 'post-long', path: '/blog/医学生首先应该是人-当医学教育用扩招回答过载/' },
  { id: 'post-code', path: '/blog/把教材变成可以解题的本地知识库-一次医学RAG实现记录/' },
];

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const categorize = (p) => {
  const e = extname(p).toLowerCase();
  if (e === '.html' || e === '') return 'html';
  if (e === '.css') return 'css';
  if (e === '.js' || e === '.mjs') return 'js';
  if (['.png', '.webp', '.jpg', '.jpeg', '.avif', '.gif', '.svg'].includes(e)) return 'image';
  if (e === '.woff2' || e === '.woff' || e === '.ttf') return 'font';
  return 'other';
};

/** requestId -> { category, raw, gzip }，由静态服务器在响应时登记 */
const transfer = new Map();

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(DIST, normalize(path));
    const data = await readFile(file);
    const cat = categorize(file);
    const gz = cat === 'image' || cat === 'font' ? data.length : gzipSync(data).length;
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'X-Perf-Raw': String(data.length),
      'X-Perf-Gzip': String(gz),
      'X-Perf-Cat': cat,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

const listen = () => new Promise((r) => server.listen(PORT, '127.0.0.1', r));

async function collectPage(browser, pageDef) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false); // 首访语义：始终从网络加载
  const resources = [];
  const blocked = [];
  const externalResources = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    const req = resp.request();
    const h = resp.headers();
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      // 外部资源（CDN 图片等）：仅在放行时统计，单独汇总，避免与站内字节混淆
      if (ALLOW_EXTERNAL && /^https?:/.test(url)) {
        externalResources.push({
          url,
          category: categorize(url),
          raw: Number(h['content-length'] || 0),
          status: resp.status(),
          type: req.resourceType(),
        });
      }
      return;
    }
    resources.push({
      url: url.replace(`http://127.0.0.1:${PORT}`, ''),
      category: h['x-perf-cat'] || categorize(url),
      raw: Number(h['x-perf-raw'] || 0),
      gzip: Number(h['x-perf-gzip'] || 0),
      status: resp.status(),
      type: req.resourceType(),
    });
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    // --allow-external：放行 CDN 图片等外部资源，用于测量真实首访体积
    if (ALLOW_EXTERNAL) return req.continue();
    if (url.startsWith(`http://127.0.0.1:${PORT}`) || url.startsWith('data:')) return req.continue();
    blocked.push(url);
    return req.abort();
  });

  await page.evaluateOnNewDocument(() => {
    window.__lcp = 0;
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => {
        const e = l.getEntries();
        if (e.length) window.__lcp = e[e.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => {
        for (const entry of l.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* 老版本浏览器忽略 */ }
  });

  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}${pageDef.path}`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 900)); // 让懒加载与入场动画稳定
  const wallMs = Date.now() - t0;

  const dom = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');
    return {
      nodes: document.getElementsByTagName('*').length,
      images: document.images.length,
      lazyImages: [...document.images].filter((i) => i.loading === 'lazy').length,
      stylesheets: document.styleSheets.length,
      scripts: document.scripts.length,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      fcp: Math.round(fcp ? fcp.startTime : 0),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });

  const metrics = await page.evaluate(() => ({ lcp: Math.round(window.__lcp || 0), cls: +(window.__cls || 0).toFixed(4) }));

  const cssCov = await page.coverage.stopCSSCoverage();
  const jsCov = await page.coverage.stopJSCoverage();
  const cov = (list) => {
    let total = 0, used = 0;
    for (const e of list) {
      total += e.text.length;
      for (const r of e.ranges) used += r.end - r.start;
    }
    return { totalBytes: total, usedBytes: used, usedPct: total ? +(used / total * 100).toFixed(1) : 0 };
  };

  const byCat = {};
  for (const r of resources) {
    const c = (byCat[r.category] ||= { count: 0, raw: 0, gzip: 0 });
    c.count += 1; c.raw += r.raw; c.gzip += r.gzip;
  }

  await page.close();
  const localRaw = resources.reduce((s, r) => s + r.raw, 0);
  const externalRaw = externalResources.reduce((s, r) => s + r.raw, 0);
  return {
    id: pageDef.id,
    path: pageDef.path,
    wallMs,
    dom,
    lcp: metrics.lcp,
    cls: metrics.cls,
    byCategory: byCat,
    totalRaw: localRaw,
    totalGzip: resources.reduce((s, r) => s + r.gzip, 0),
    // 外部（CDN）资源单独汇总：这部分此前被漏计，却是真实首访的主要重量
    externalRaw,
    externalCount: externalResources.length,
    externalTop: [...externalResources].sort((a, b) => b.raw - a.raw).slice(0, 5),
    totalRawAll: localRaw + externalRaw,
    cssCoverage: cov(cssCov),
    jsCoverage: cov(jsCov),
    blockedExternal: [...new Set(blocked)].length,
    resources: resources.sort((a, b) => b.raw - a.raw),
  };
}

function fmtKB(n) { return (n / 1024).toFixed(1); }

function printSummary(report) {
  console.log(`\n=== PERF BASELINE [${report.label}] ${report.generatedAt} ===`);
  console.log('external requests: ' + (report.allowExternal ? 'allowed' : 'BLOCKED (reproducible)'));
  console.log('');
  const head = ['page', 'wallMs', 'LCP', 'FCP', 'DCL', 'nodes', 'imgs', 'HTML', 'CSS', 'JS', 'local', 'external', 'total', 'gzip', 'cssUse%', 'jsUse%'];
  console.log(head.map((h) => h.padEnd(9)).join(''));
  for (const p of report.pages) {
    const c = p.byCategory;
    const kb = (k) => fmtKB(c[k] ? c[k].raw : 0).padEnd(9);
    console.log([
      p.id.padEnd(9),
      String(p.wallMs).padEnd(9),
      String(p.lcp).padEnd(9),
      String(p.dom.fcp).padEnd(9),
      String(p.dom.domContentLoaded).padEnd(9),
      String(p.dom.nodes).padEnd(9),
      String(p.dom.images).padEnd(9),
      kb('html'), kb('css'), kb('js'),
      fmtKB(p.totalRaw).padEnd(9),
      fmtKB(p.externalRaw).padEnd(9),
      fmtKB(p.totalRawAll).padEnd(9),
      fmtKB(p.totalGzip).padEnd(9),
      String(p.cssCoverage.usedPct).padEnd(9),
      String(p.jsCoverage.usedPct).padEnd(9),
    ].join(''));
  }
  console.log('\n(单位: KB；local=站内原始字节，external=CDN 外部资源；gzip 仅统计站内)');
  if (report.allowExternal) {
    for (const p of report.pages) {
      if (!p.externalTop?.length) continue;
      console.log(`\n${p.id} 外部资源 TOP${p.externalTop.length}（共 ${p.externalCount} 个 / ${fmtKB(p.externalRaw)}KB）：`);
      for (const r of p.externalTop) {
        console.log(`   ${fmtKB(r.raw).padStart(9)}KB  ${r.status}  ${r.url.replace(/^https?:\/\/[^/]+\//, '').slice(0, 76)}`);
      }
    }
  }
}

async function main() {
  if (!existsSync(DIST)) { console.error('缺少 dist/，请先运行 npm run build'); process.exit(1); }
  await listen();
  // 沙箱下 Node 不能捕获子进程 stdio，因此优先连接外部已启动的 Chrome
  const browser = CDP_URL
    ? await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null })
    : await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
      });
  const pages = [];
  try {
    for (const def of PAGES) {
      process.stdout.write(`  collecting ${def.id} ... `);
      const r = await collectPage(browser, def);
      pages.push(r);
      console.log(`${r.wallMs}ms, ${fmtKB(r.totalRaw)}KB raw`);
    }
  } finally {
    if (CDP_URL) browser.disconnect();
    else await browser.close();
    server.close();
  }

  const report = {
    label: LABEL,
    generatedAt: new Date().toISOString(),
    allowExternal: ALLOW_EXTERNAL,
    pages,
    totals: {
      raw: pages.reduce((s, p) => s + p.totalRaw, 0),
      externalRaw: pages.reduce((s, p) => s + p.externalRaw, 0),
      rawAll: pages.reduce((s, p) => s + p.totalRawAll, 0),
      gzip: pages.reduce((s, p) => s + p.totalGzip, 0),
      nodes: pages.reduce((s, p) => s + p.dom.nodes, 0),
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(OUT_DIR, `${LABEL}-${stamp}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(OUT_DIR, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  printSummary(report);
  console.log(`\nreport: ${file}`);
  console.log(`latest: ${join(OUT_DIR, 'latest.json')}`);
}

main().catch((err) => { console.error(err); server.close(); process.exit(1); });
