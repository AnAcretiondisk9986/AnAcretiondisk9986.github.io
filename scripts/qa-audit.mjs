// 全站前端质量巡检：截图（可用作视觉回归）+ 可度量的问题清单
//
// 用法：
//   node scripts/qa-audit.mjs [标签]            # 默认 baseline
//   PAGES=home,blog node scripts/qa-audit.mjs   # 只跑某几页
//
// 输出：
//   perf-reports/qa/<标签>/*.png                整页 + 首屏
//   perf-reports/qa/<标签>/audit.json           机器可读
//   perf-reports/qa/<标签>/audit.md             人读清单（按页面分组）
//
// 与旧 shoot-site.mjs 的区别：截图前把图片强制 eager + decode，避免整页截图里
// 懒加载图变成灰块（旧脚本的假阳性），并额外采集对比度 / 触控目标 / 字号 /
// 溢出 / 文本裁切 / 标题层级 / 可访问名等可度量的细节问题。
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TAG = process.argv[2] || 'baseline';
const OUT = join(ROOT, 'perf-reports', 'qa', TAG);
const PORT = Number(process.env.QA_PORT || 8798);
const EXTERNAL_BASE = process.env.QA_BASE || '';
const BASE = EXTERNAL_BASE || `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
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
// QA_BASE 指向一个已经在跑的 dev/preview 服务时，不再自己起静态服务（多人并行巡检用）
if (!EXTERNAL_BASE) await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });

const firstPost = decodeURIComponent(
  (await readFile(join(DIST, 'blog', 'index.html'), 'utf8')).match(/href="(\/blog\/[^"#?]+\/)"/)?.[1] ?? '/blog/',
);
const ROUTES = {
  home: '/',
  blog: '/blog/',
  post: firstPost,
  gallery: '/gallery/',
  about: '/about/',
  quota: '/ai-quota/',
  pricing: '/ai-quota/pricing/',
  notfound: '/404.html',
  private: '/private/',
};
const only = process.env.PAGES ? process.env.PAGES.split(',').filter((k) => ROUTES[k]) : Object.keys(ROUTES);
const MOBILE = process.env.MOBILE !== '0';
const VPS = MOBILE
  ? { desk: { width: 1440, height: 900 }, mob: { width: 390, height: 844, isMobile: true, hasTouch: true } }
  : { desk: { width: 1440, height: 900 } };

/** 注入到页面：先让所有图片解码，再跑可度量的检查，返回问题数组 */
function auditInPage() {
  const out = [];
  const add = (kind, detail, extra = {}) => out.push({ kind, detail, ...extra });

  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const L = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const describe = (el) => {
    if (!el) return '?';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.tagName || '?').toLowerCase() + id + cls;
  };

  /** 向上找第一个不透明的背景；遇到背景图/渐变则判定为未知。
   *  同时回传"该背景色是在哪一层定下来的"，供判断这一层里是否还有图片压在文字上。 */
  const solidBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 0.999 || c.a >= 0.999) return { color: acc, el: node };
        return { color: over(acc, { r: 255, g: 255, b: 255, a: 1 }), el: node };
      }
      node = node.parentElement;
    }
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
    const base = bodyBg && bodyBg.a > 0 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
    return { color: acc ? over(acc, base) : base, el: document.body };
  };

  /** 背景色是在 container 这一层定下来的；若这个容器里还有图片/视频盖住文字，
   *  实际底色就是那张图，纯色对比度算不出来 —— 返回覆盖物的描述，交给人工看。 */
  const artworkCovering = (el, container) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (const node of container.querySelectorAll('img, video, canvas')) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = node.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      if (r.left - 2 <= cx && r.right + 2 >= cx && r.top - 2 <= cy && r.bottom + 2 >= cy) return describe(node);
    }
    return null;
  };

  /** 图片的父级是否已经用 aspect-ratio / 固定高度预留了空间（预留了就无 CLS） */
  const boxReserved = (node) => {
    let p = node.parentElement;
    for (let hop = 0; p && hop < 4; hop += 1) {
      const cs = getComputedStyle(p);
      const ar = cs.aspectRatio;
      if (ar && ar !== 'auto' && !ar.startsWith('auto')) return true;
      if (/^\d+(\.\d+)?px$/.test(cs.height) && parseFloat(cs.height) > 0) return true;
      p = p.parentElement;
    }
    return false;
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ── 1. 文本对比度 ─────────────────────────────────────────────
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const t = textNode.nodeValue;
    if (!t || !t.trim() || t.trim().length < 2) continue;
    const el = textNode.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (!visible(el)) continue;
    if (el.closest('[aria-hidden="true"], .sr-only, [hidden]')) continue;
    const cs = getComputedStyle(el);
    // 渐变文字（background-clip:text）的 color 是 transparent，无法按纯色算对比度
    if ((cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') && cs.backgroundImage !== 'none') continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.05) continue;
    const bgInfo = solidBg(el);
    if (!bgInfo) continue;
    // 文字实际压在照片/视频上：底色不是纯色，跳过（这些由人工视觉评审覆盖）
    if (artworkCovering(el, bgInfo.el)) continue;
    const bg = bgInfo.color;
    const c = ratio(over(fg, bg), bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;
    if (c < min) {
      add('contrast', `${describe(el)} ${size}px 对比度 ${c.toFixed(2)} < ${min}`, {
        el: describe(el), sample: t.trim().slice(0, 28), ratio: Number(c.toFixed(2)), size,
      });
    }
  }

  // ── 2. 字号过小 ───────────────────────────────────────────────
  seen.clear();
  const sizeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while ((textNode = sizeWalker.nextNode())) {
    if (!textNode.nodeValue.trim()) continue;
    const el = textNode.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) {
      add('font-small', `${describe(el)} ${size}px`, { el: describe(el), size, sample: textNode.nodeValue.trim().slice(0, 24) });
    }
  }

  // ── 3. 文本被裁切（写死了高度/宽度 + overflow hidden）────────────
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,span,a,strong,em,td,th,button,label,figcaption')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (!/hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
      const hasText = el.textContent && el.textContent.trim().length > 0;
      if (!hasText) continue;
      // 单行省略号是有意为之
      if (cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap') continue;
      // -webkit-line-clamp 的多行截断同样是有意为之：DOM 里保留全文，
      // scrollHeight 必然大于 clientHeight，视觉上带省略号，不算缺陷。
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') continue;
      // .sr-only 一类的视觉隐藏元素本来就是 1×1 + 溢出，去掉这类误报
      if (el.closest('.sr-only,[class*="sr-only"],[class*="visually-hidden"]')) continue;
      add('clipped', `${describe(el)} 内容 ${el.scrollWidth}×${el.scrollHeight} 容器 ${el.clientWidth}×${el.clientHeight}`, { el: describe(el) });
    }
  }

  // ── 4. 横向溢出（找出具体越界的元素）──────────────────────────
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth - vw > 0) {
    add('overflow', `文档横向溢出 ${document.documentElement.scrollWidth - vw}px`, { amount: document.documentElement.scrollWidth - vw });
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        offenders.push(`${describe(el)} [${Math.round(r.left)}→${Math.round(r.right)}]`);
      }
    }
    add('overflow-el', offenders.slice(0, 12).join(' | ') || '(未定位到具体元素)', { offenders: offenders.slice(0, 12) });
  }

  // ── 5. 触控目标（仅移动端）────────────────────────────────────
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) {
    for (const el of document.querySelectorAll('a[href],button,[role="button"],input:not([type="hidden"]),select,summary')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 段落内联链接不算独立触控目标
      const inlineLink = el.tagName === 'A' && cs.display.startsWith('inline') && el.closest('p,li,figcaption');
      if (inlineLink) continue;
      if (r.width < 24 || r.height < 24) {
        add('tap-tiny', `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)} < 24×24`, { el: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
      } else if (r.width < 44 || r.height < 44) {
        add('tap-small', `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`, { el: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  }

  // ── 6. 图片：缺宽高（CLS）/ 缺 alt / 未加载 ──────────────────────
  for (const img of document.querySelectorAll('img')) {
    const r0 = img.getBoundingClientRect();
    if (r0.width === 0 || r0.height === 0) continue;
    const cs0 = getComputedStyle(img);
    if (cs0.visibility === 'hidden' || cs0.display === 'none') continue;
    const flow = cs0.position === 'static' || cs0.position === 'relative';
    const r = r0;
    const hasRatio = cs0.aspectRatio && cs0.aspectRatio !== 'auto';
    const hasAttrs = img.hasAttribute('width') && img.hasAttribute('height');
    // 只有参与文档流的图片才可能造成 CLS；父级已用 aspect-ratio / 固定高度预留空间的也不算
    if (flow && !hasRatio && !hasAttrs && r.width > 24 && r.height > 24 && !boxReserved(img)) {
      add('img-no-dims', `${describe(img)} ${Math.round(r.width)}×${Math.round(r.height)} src=${(img.currentSrc || img.src).split('/').pop()}`, { src: (img.currentSrc || img.src).split('/').pop() });
    }
    if (!img.hasAttribute('alt')) add('img-no-alt', `${describe(img)} src=${(img.currentSrc || img.src).split('/').pop()}`, { src: (img.currentSrc || img.src).split('/').pop() });
    if (r.width > 40 && r.height > 40 && img.complete && img.naturalWidth === 0) {
      add('img-broken', `${describe(img)} src=${(img.currentSrc || img.src).split('/').pop()}`, { src: (img.currentSrc || img.src).split('/').pop() });
    }
    if (img.loading === 'lazy' && r.top < 900 && r.width > 300) {
      add('img-lazy-above-fold', `${describe(img)} ${Math.round(r.width)}px 首屏内用 lazy`, { src: (img.currentSrc || img.src).split('/').pop() });
    }
  }

  // ── 7. 标题层级跳级 ──────────────────────────────────────────
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  let prev = 0;
  for (const h of headings) {
    const lv = Number(h.tagName[1]);
    if (prev && lv > prev + 1) add('heading-skip', `h${prev} → h${lv}: ${h.textContent.trim().slice(0, 30)}`, { from: prev, to: lv });
    prev = lv;
  }
  const h1s = headings.filter((h) => h.tagName === 'H1');
  if (h1s.length === 0) add('heading-none', '页面没有 h1');
  if (h1s.length > 1) add('heading-multi-h1', `${h1s.length} 个 h1`);

  // ── 8. 链接 / 按钮无可访问名 ──────────────────────────────────
  for (const el of document.querySelectorAll('a[href],button')) {
    if (!visible(el)) continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    const imgAlt = [...el.querySelectorAll('img')].some((i) => (i.getAttribute('alt') || '').trim());
    if (!name && !imgAlt) add('no-accessible-name', `${describe(el)}`, { el: describe(el) });
  }

  // ── 9. 区块之间的空白（过大的空隙＝版式松散）────────────────────
  const sections = [...document.querySelectorAll('main > section, main > div > section, body > section, .f-section, .archive-section, .fusion-section')].filter(visible);
  for (let i = 1; i < sections.length; i++) {
    const prevR = sections[i - 1].getBoundingClientRect();
    const curR = sections[i].getBoundingClientRect();
    const gap = Math.round(curR.top - prevR.bottom);
    if (gap > 140) add('dead-space', `${describe(sections[i - 1])} → ${describe(sections[i])} 间距 ${gap}px`, { gap });
  }

  // ── 10. 触底留白（内容结束后的大片空白）─────────────────────────
  const main = document.querySelector('main') || document.body;
  const footer = document.querySelector('footer');
  if (footer && main) {
    const gap = Math.round(footer.getBoundingClientRect().top - main.getBoundingClientRect().bottom);
    if (gap > 120) add('dead-space', `main → footer 间距 ${gap}px`, { gap });
  }

  // ── 11. 焦点样式（是否明确移除了 outline）───────────────────────
  for (const el of [...document.querySelectorAll('a[href],button,input,select,textarea,summary')].slice(0, 200)) {
    if (!visible(el)) continue;
    el.focus({ preventScroll: true });
    const cs = getComputedStyle(el);
    const outline = `${cs.outlineStyle} ${cs.outlineWidth}`;
    const shadow = cs.boxShadow !== 'none';
    if (/^none/.test(outline) && !shadow) {
      add('focus-invisible', `${describe(el)} 聚焦后 outline=${outline} boxShadow=none`, { el: describe(el) });
    }
    el.blur();
  }

  // ── 12. 首屏主标题是否被页头盖住 / 首屏内容是否过多 ─────────────
  const header = document.querySelector('header, .f-header');
  if (header) {
    const hb = header.getBoundingClientRect().bottom;
    const firstContent = document.querySelector('main h1, main .f-hero, main section');
    if (firstContent) {
      const r = firstContent.getBoundingClientRect();
      if (r.top < hb && r.bottom > hb && getComputedStyle(header).position === 'sticky') {
        add('header-overlap', `${describe(firstContent)} 顶部 ${Math.round(r.top)} 被页头 ${Math.round(hb)} 遮住`, {});
      }
    }
  }

  return out;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});

const report = [];
for (const mode of ['light', 'dark']) {
  for (const [vpName, vp] of Object.entries(VPS)) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((m) => {
      try { localStorage.setItem('theme', m); localStorage.removeItem('visual-theme'); } catch {}
    }, mode);
    for (const name of only) {
      const url = BASE + encodeURI(ROUTES[name]);
      const errors = [];
      const failed = [];
      const onErr = (e) => errors.push(String(e.message).slice(0, 200));
      const onFail = (r) => { const s = typeof r.status === 'function' ? r.status() : 200; if (s >= 400) failed.push(`${s} ${r.url()}`); };
      page.on('pageerror', onErr);
      page.on('response', onFail);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      // 逐屏滚动触发进入态/懒加载，然后回顶
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
          scrollTo(0, y); await new Promise((r) => setTimeout(r, 50));
        }
        document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
        scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 300));
      });
      // 关键：截图前把所有图片变成 eager 并解码，否则整页截图里懒图是灰块
      await page.evaluate(async () => {
        const imgs = [...document.images];
        imgs.forEach((i) => { i.loading = 'eager'; });
        await Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const issues = await page.evaluate(auditInPage);
      if (overflow > 0) issues.unshift({ kind: 'overflow', detail: `横向溢出 ${overflow}px` });
      const stem = `${name}-${mode}-${vpName}`;
      await page.screenshot({ path: join(OUT, `${stem}.png`), fullPage: true, captureBeyondViewport: true });
      await page.screenshot({ path: join(OUT, `${stem}-fold.png`) });
      report.push({ route: name, mode, vp: vpName, url: ROUTES[name], overflow, errors, failed: failed.filter((f) => !/favicon/.test(f)), issues });
      page.off('pageerror', onErr);
      page.off('response', onFail);
      process.stdout.write('.');
    }
    await page.close();
  }
}
await browser.close();
if (!EXTERNAL_BASE) server.close();

// ── 汇总 ───────────────────────────────────────────────────────
const counts = {};
for (const r of report) for (const i of r.issues) counts[i.kind] = (counts[i.kind] || 0) + 1;
const md = [];
md.push(`# 前端巡检 · ${TAG}\n`);
md.push(`生成时间：${new Date().toISOString()}\n`);
md.push(`页面 ${only.length} × 主题 2 × 视口 ${Object.keys(VPS).length} ＝ **${report.length}** 次采样\n`);
md.push(`## 问题统计\n`);
md.push('| 类型 | 次数 |');
md.push('| --- | --- |');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
md.push('');
for (const route of only) {
  const rows = report.filter((r) => r.route === route);
  const kinds = {};
  for (const r of rows) for (const i of r.issues) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
  md.push(`## ${route} \`${ROUTES[route]}\`\n`);
  md.push(`问题：${Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join('，') || '无'}\n`);
  const errs = [...new Set(rows.flatMap((r) => r.errors))];
  if (errs.length) md.push(`- **控制台错误**：${errs.map((e) => '`' + e + '`').join('；')}\n`);
  const fails = [...new Set(rows.flatMap((r) => r.failed))];
  if (fails.length) md.push(`- **请求失败**：${fails.slice(0, 8).join('；')}\n`);
  // 去重后列出问题
  const uniq = new Map();
  for (const r of rows) for (const i of r.issues) {
    const key = `${i.kind}|${i.detail}`;
    if (!uniq.has(key)) uniq.set(key, { ...i, where: new Set() });
    uniq.get(key).where.add(`${r.mode}/${r.vp}`);
  }
  for (const i of uniq.values()) {
    md.push(`- \`${i.kind}\` ${i.detail} _(${[...i.where].join(', ')})_`);
  }
  md.push('');
}
await writeFile(join(OUT, 'audit.json'), JSON.stringify(report, null, 1));
await writeFile(join(OUT, 'audit.md'), md.join('\n'));
console.log(`\nqa → perf-reports/qa/${TAG}/  采样 ${report.length}`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
