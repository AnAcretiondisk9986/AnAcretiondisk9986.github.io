/**
 * 质量与可访问性冒烟：空/错误/重试状态、模态焦点锁定与 aria、键盘导航、
 * 焦点可见性、颜色对比度、窄屏布局。
 *
 * 前置：管理面板已在 http://localhost:4322 运行。测试拦截 /api/，不写文件。
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + String(extra).slice(0, 150) + ']' : ''));
  if (!cond) failures += 1;
};
const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

const post = {
  slug: 'HealthCN2030', title: '关于健康中国2030战略', description: '', pubDate: '2026-07-30', dayIndex: 1,
  tags: ['医疗'], draft: false, access: 'public', archived: false, updatedAt: '2026-08-03T06:44:42.393Z',
  excerpt: '', astroId: 'healthcn2030', hasPublicPage: true,
  publicUrl: 'https://blog.acretiondisk.top/blog/healthcn2030/', shortUrl: 'https://blog.acretiondisk.top/s/abc123',
};

const mediaFixture = {
  ok: true,
  images: [{ type: 'image', name: 'alpha.webp', size: 100, mtime: '2026-09-02T00:00:00.000Z', width: 10, height: 10, url: 'https://cdn.example.com/image/alpha.webp', originalUrl: '', usedBy: [] }],
  audios: [],
  limits: { uploadMaxBytes: 36700160, remoteMaxBytes: 36700160, gitTimeoutMs: 60000, remoteFetchTimeoutMs: 30000, uploadConcurrency: 2 },
  stats: { images: 1, audios: 0, referenced: 0, orphan: 1 },
};

let postsMode = 'error';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = new URL(req.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return req.continue();
  if (path === '/api/posts' && req.method() === 'GET') {
    if (postsMode === 'error') return req.respond(json({ error: '服务器内部错误' }, 500));
    if (postsMode === 'empty') return req.respond(json([]));
    return req.respond(json([post]));
  }
  if (path === '/api/media') return req.respond(json(mediaFixture));
  if (path === '/api/gallery') return req.respond(json([]));
  if (path.startsWith('/api/posts/') && req.method() === 'GET') return req.respond(json({ ...post, contentHash: 'a'.repeat(64), content: '# 正文', cover: '' }));
  if (path === '/api/sync/status') return req.respond(json({ ok: true, state: 'clean', stateLabel: '工作区干净', branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirtyCount: 0, dirty: false, files: [], autoPull: false }));
  if (path === '/api/health') return req.respond(json({ ok: true, limits: mediaFixture.limits }));
  return req.respond(json({ ok: true }));
});

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList', { timeout: 15000 });
  await sleep(600);

  // 1. 错误状态 + 重试
  const errText = await page.$eval('#postList', (el) => el.textContent);
  check('接口失败显示错误状态', errText.includes('加载失败'), errText.replace(/\s+/g, ' ').trim());
  check('错误状态提供重试按钮', Boolean(await page.$('#postList button')));

  postsMode = 'empty';
  await page.evaluate(() => document.querySelector('#postList button').click());
  await sleep(500);
  check('空列表显示空状态', (await page.$eval('#postList', (el) => el.textContent)).includes('暂无文章'));

  postsMode = 'ok';
  await page.click('#btnRefresh');
  await page.waitForSelector('#postList .post-item', { timeout: 8000 });
  check('重试后恢复列表', (await page.$$('#postList .post-item')).length === 1);

  // 2. 键盘导航 + 焦点可见性
  const btnFocus = await page.evaluate(() => {
    const btn = document.querySelector('#btnNew');
    btn.focus();
    return document.activeElement === btn;
  });
  check('按钮可获得键盘焦点', btnFocus === true);
  const cssHasFocusVisible = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => h.includes('/admin/styles/'));
    const texts = await Promise.all(links.map((h) => fetch(h).then((r) => r.text()).catch(() => '')));
    return texts.some((t) => t.includes(':focus-visible'));
  });
  check('样式表包含 :focus-visible 规则', cssHasFocusVisible === true);

  // 3. 颜色对比度（关键文本）
  const contrastResults = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s) => { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
    const ratio = (fg, bg) => { const a = Math.max(lum(fg), lum(bg)); const b = Math.min(lum(fg), lum(bg)); return (a + 0.05) / (b + 0.05); };
    const samples = ['.btn', '.post-item .title'];
    const out = {};
    for (const sel of samples) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const fg = parse(getComputedStyle(el).color);
      let bg = null;
      let node = el;
      while (node && !bg) {
        const c = getComputedStyle(node).backgroundColor;
        const parsed = parse(c);
        if (parsed && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c)) bg = parsed;
        node = node.parentElement;
      }
      if (fg && bg) out[sel] = Number(ratio(fg, bg).toFixed(2));
    }
    return out;
  });
  const ratios = Object.values(contrastResults).filter((v) => Number.isFinite(v));
  const minContrast = ratios.length ? Math.min(...ratios) : 0;
  check('关键文本对比度 ≥ 3:1', minContrast >= 3, JSON.stringify(contrastResults));

  // 4. 模态焦点锁定与 aria
  await page.click('#postList .post-item .title');
  await page.waitForSelector('.vditor', { timeout: 15000 });
  await page.click('#btnInsertMedia');
  await page.waitForSelector('#mediaPickerModal[style*="flex"]', { timeout: 8000 });
  const aria = await page.$eval('#mediaPickerModal', (el) => ({ role: el.getAttribute('role'), modal: el.getAttribute('aria-modal') }));
  check('模态框标注 role=dialog / aria-modal', aria.role === 'dialog' && aria.modal === 'true', JSON.stringify(aria));
  for (let i = 0; i < 8; i += 1) { await page.keyboard.press('Tab'); }
  const trapped = await page.evaluate(() => document.querySelector('#mediaPickerModal').contains(document.activeElement));
  check('Tab 焦点锁定在模态框内', trapped === true);
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc 关闭模态框', (await page.$eval('#mediaPickerModal', (el) => el.style.display)) === 'none');

  // 5. 窄屏布局
  await page.setViewport({ width: 480, height: 900 });
  await sleep(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('窄屏无横向溢出', overflow <= 2, `overflow=${overflow}`);

  // 侧栏纵向滚动
  const sidebarOverflow = await page.$eval('.sidebar', (el) => getComputedStyle(el).overflowY);
  check('侧栏启用纵向滚动', sidebarOverflow === 'auto', sidebarOverflow);
  await page.setViewport({ width: 1440, height: 420 });
  await sleep(400);
  const scrollInfo = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    const before = el.scrollTop;
    el.scrollTop = 200;
    return { scrollable: el.scrollHeight > el.clientHeight, before, after: el.scrollTop };
  });
  check('短窗口下侧栏可上下滑动', scrollInfo.scrollable && scrollInfo.after > scrollInfo.before, JSON.stringify(scrollInfo));
  await page.setViewport({ width: 1440, height: 950 });

  // 关于 / 前端定制模式可正常渲染
  await page.click('.mode-tab[data-mode="about"]');
  await sleep(800);
  check('关于模式渲染表单', Boolean(await page.$('#fAvatar')), 'about');
  check('store 记录当前模块', (await page.evaluate(() => window.__adminStore.get().mode)) === 'about', 'about');
  await page.evaluate(() => { const el = document.querySelector('#fAvatar'); if (el) { el.value = '/favicon.svg'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
  await sleep(250);
  check('头像预览更新不报错', pageErrors.length === 0, pageErrors.join(' | '));
  await page.click('.mode-tab[data-mode="frontend"]');
  await sleep(800);
  check('前端定制模式渲染表单', Boolean(await page.$('#fSiteName')), 'frontend');
  await page.evaluate(() => { const el = document.querySelector('#fSiteName'); if (el) { el.value = '预览测试'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
  await sleep(250);
  check('前端预览更新不报错', pageErrors.length === 0, pageErrors.join(' | '));

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
