/**
 * 文章列表（搜索 / 筛选 / 排序 / 视图 / 快速操作）浏览器冒烟测试。
 *
 * 前置：管理面板已在 http://localhost:4322 运行（npm run admin）。
 * 测试拦截 /api/ 请求并返回固定夹具，不会写文件、不会推送。
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + String(extra).slice(0, 160) + ']' : ''));
  if (!cond) failures += 1;
};

const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

const posts = [
  { slug: 'HealthCN2030', title: '关于健康中国2030战略', description: '政策总结', pubDate: '2026-07-30', dayIndex: 1, tags: ['医疗', '政策'], draft: false, access: 'public', updatedAt: '2026-08-03T06:44:42.393Z', excerpt: '健康中国 2030 规划纲要概述', astroId: 'healthcn2030', hasPublicPage: true, publicUrl: 'https://blog.acretiondisk.top/blog/healthcn2030/', shortUrl: 'https://blog.acretiondisk.top/s/abc123' },
  { slug: 'RunInMorning', title: '今早跑步随拍', description: '占位符', pubDate: '2026-08-02', dayIndex: 1, tags: ['日常', '分享'], draft: false, access: 'admin', updatedAt: '2026-08-02T01:00:00.000Z', excerpt: '跑步随拍图片', astroId: 'runinmorning', hasPublicPage: false, publicUrl: '', shortUrl: '' },
  { slug: 'DraftNote', title: '未完成的草稿', description: '草稿', pubDate: '2026-09-01', dayIndex: 2, tags: ['日常'], draft: true, access: 'public', updatedAt: '2026-09-02T02:00:00.000Z', excerpt: '草稿正文', astroId: 'draftnote', hasPublicPage: false, publicUrl: '', shortUrl: '' },
  { slug: 'social-paper', title: '自动化生产调研论文', description: '论文', pubDate: '2026-06-10', dayIndex: 3, tags: ['技术', '论文'], draft: false, access: 'authorized', updatedAt: '2026-06-11T03:00:00.000Z', excerpt: '调研论文流程', astroId: 'social-paper', hasPublicPage: true, publicUrl: 'https://blog.acretiondisk.top/blog/social-paper/', shortUrl: 'https://blog.acretiondisk.top/s/xyz789' },
  { slug: 'Birthday', title: '十九岁生日记', description: '生日', pubDate: '2026-08-22', dayIndex: 1, tags: ['生日'], draft: false, access: 'admin', updatedAt: '2026-08-23T04:00:00.000Z', excerpt: '生日记录', astroId: 'birthday', hasPublicPage: false, publicUrl: '', shortUrl: '' },
];

let putBody = null;
let putCount = 0;
let postCreateBody = null;
let clipboardText = '';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.evaluateOnNewDocument(() => {
  window.__clipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t) => { window.__clipboard.push(t); } },
  });
});

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = new URL(req.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return req.continue();
  if (path === '/api/posts' && req.method() === 'GET') return req.respond(json(posts));
  if (path === '/api/posts' && req.method() === 'POST') {
    try { postCreateBody = new URLSearchParams(req.postData() || ''); } catch { postCreateBody = null; }
    return req.respond(json({ success: true, slug: 'duplicated-post', contentHash: 'c'.repeat(64) }));
  }
  if (path === '/api/media' && req.method() === 'GET') return req.respond(json({ ok: true, images: [], audios: [], stats: { images: 0, audios: 0, referenced: 0, orphan: 0 } }));
  if (/\/revisions\/[^/]+$/.test(path) && req.method() === 'GET') return req.respond(json({ ok: true, id: 'r1.md', contentHash: 'd'.repeat(64), content: '# 旧正文' }));
  if (path.endsWith('/revisions') && req.method() === 'GET') return req.respond(json({ ok: true, revisions: [{ id: 'r1.md', savedAt: '2026-09-01T00:00:00.000Z', size: 20 }] }));
  if (path.startsWith('/api/posts/') && req.method() === 'GET') {
    const slug = decodeURIComponent(path.slice('/api/posts/'.length));
    const p = posts.find((x) => x.slug === slug);
    return req.respond(json({ ...p, contentHash: 'a'.repeat(64), content: '# 正文', cover: '' }));
  }
  if (path.startsWith('/api/posts/') && req.method() === 'PUT') {
    putCount += 1;
    try { putBody = new URLSearchParams(req.postData() || ''); } catch { putBody = null; }
    return req.respond(json({ success: true, slug: 'DraftNote', contentHash: 'b'.repeat(64) }));
  }
  if (path === '/api/sync/status') return req.respond(json({ ok: true, state: 'clean', stateLabel: '工作区干净', branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirtyCount: 0, dirty: false, files: [], autoPull: false }));
  if (path === '/api/operations') return req.respond(json({ ok: true, operations: [] }));
  return req.respond(json({ ok: true }));
});

const countItems = () => page.$$eval('#postList .post-item, #postList .post-card', (els) => els.length);

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#fPostSearch', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#postList .post-item').length > 0, { timeout: 8000 });

  check('列表渲染全部文章', (await countItems()) === posts.length, await countItems());
  const order0 = await page.$$eval('#postList .post-item .title', (els) => els.map((e) => e.textContent));
  check('默认按发布日期倒序', order0[0].includes('未完成的草稿'), order0.join(' | '));

  // 搜索
  await page.type('#fPostSearch', '健康');
  await sleep(300);
  check('关键词搜索命中标题/正文摘要', (await countItems()) === 1, await countItems());
  await page.$eval('#fPostSearch', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  check('清空搜索恢复全部', (await countItems()) === posts.length, await countItems());

  // 打开筛选面板
  await page.click('#btnToggleFilters');
  check('筛选面板可展开', !(await page.$eval('#listFilters', (el) => el.hidden)));

  // 状态筛选
  await page.select('#fPostStatus', 'draft');
  await sleep(200);
  check('草稿筛选只剩草稿', (await countItems()) === 1);
  await page.select('#fPostStatus', 'published');
  await sleep(200);
  check('已发布筛选排除草稿', (await countItems()) === posts.length - 1, await countItems());

  // 权限筛选
  await page.select('#fPostStatus', '');
  await page.select('#fPostAccess', 'admin');
  await sleep(200);
  check('权限筛选只剩管理员级', (await countItems()) === 2, await countItems());

  // 标签筛选
  await page.select('#fPostAccess', '');
  await page.select('#fPostTag', '技术');
  await sleep(200);
  check('标签筛选命中', (await countItems()) === 1);
  await page.select('#fPostTag', '');
  await sleep(150);

  // 日期范围
  await page.$eval('#fPostFrom', (el) => { el.value = '2026-08-01'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#fPostTo', (el) => { el.value = '2026-08-31'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(200);
  check('日期范围筛选生效', (await countItems()) === 2, await countItems());
  await page.click('#btnClearFilters');
  await sleep(200);
  check('清除筛选恢复全部', (await countItems()) === posts.length, await countItems());

  // 排序
  await page.select('#fPostSort', 'title-asc');
  await sleep(200);
  const byTitle = await page.$$eval('#postList .post-item .title', (els) => els.map((e) => e.textContent));
  const sorted = [...byTitle].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  check('标题排序生效', JSON.stringify(byTitle) === JSON.stringify(sorted), byTitle.join(' | '));

  // 卡片视图
  await page.select('#fPostView', 'card');
  await sleep(200);
  check('切换到卡片视图', (await page.$$('#postList .post-card')).length === posts.length);

  // 复制短链（卡片视图，公开文章）
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('关于健康中国2030战略'));
    card.querySelector('[data-action="copy-short"]').click();
  });
  await sleep(300);
  const clip = await page.evaluate(() => window.__clipboard);
  check('复制短链写入剪贴板', clip.some((t) => t.includes('/s/abc123')), JSON.stringify(clip));

  // 撤回（快速切换发布状态）
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('自动化生产调研论文'));
    card.querySelector('[data-action="toggle-draft"]').click();
  });
  await sleep(500);
  check('快速撤回发出 PUT 且 draft=true', putBody && putBody.get('draft') === 'true', putBody ? putBody.get('draft') : 'no put');
  check('快速撤回携带 expectedHash', putBody && /^a{64}$/.test(putBody.get('expectedHash') || ''), putBody ? putBody.get('expectedHash') : '');

  // 非公开文章隐藏链接操作，但仍可本地预览
  const adminCard = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('今早跑步随拍'));
    return {
      copyUrl: Boolean(card.querySelector('[data-action="copy-url"]')),
      copyShort: Boolean(card.querySelector('[data-action="copy-short"]')),
      preview: Boolean(card.querySelector('[data-action="preview"]')),
    };
  });
  check('管理员级文章隐藏公开链接操作', !adminCard.copyUrl && !adminCard.copyShort, JSON.stringify(adminCard));
  check('管理员级文章仍可本地预览', adminCard.preview === true);

  // 本地预览弹窗
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('今早跑步随拍'));
    card.querySelector('[data-action="preview"]').click();
  });
  await page.waitForFunction(() => document.querySelector('#previewModal')?.style.display === 'flex', { timeout: 5000 });
  check('预览弹窗打开并渲染正文', (await page.$eval('#previewBody', (el) => el.textContent)).includes('正文'), await page.$eval('#previewTitle', (el) => el.textContent));
  const linkHidden = await page.$eval('#previewOpenLink', (el) => el.style.display === 'none');
  check('无线上页面的文章隐藏「打开线上页面」', linkHidden === true);
  await page.click('#previewClose');
  await sleep(200);
  check('预览弹窗可关闭', (await page.$eval('#previewModal', (el) => el.style.display)) === 'none');

  // 复制为草稿
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('关于健康中国2030战略'));
    card.querySelector('[data-action="duplicate"]').click();
  });
  await sleep(500);
  check('复制文章发出 POST 且为草稿', postCreateBody && postCreateBody.get('draft') === 'true' && (postCreateBody.get('title') || '').includes('副本'), postCreateBody ? postCreateBody.get('title') : 'no post');

  // 归档
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('关于健康中国2030战略'));
    card.querySelector('[data-action="toggle-archive"]').click();
  });
  await sleep(500);
  check('归档发出 PUT 且 archived=true', putBody && putBody.get('archived') === 'true', putBody ? putBody.get('archived') : 'no put');

  // 修订历史
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#postList .post-card')].find((c) => c.textContent.includes('关于健康中国2030战略'));
    card.querySelector('[data-action="history"]').click();
  });
  await page.waitForFunction(() => document.querySelector('#historyModal')?.style.display === 'flex', { timeout: 6000 });
  await page.waitForSelector('#historyList [data-rev]', { timeout: 6000 });
  await page.click('#historyList [data-rev]');
  await page.waitForFunction(() => (document.querySelector('#historyDiff')?.textContent || '').includes('旧正文'), { timeout: 6000 });
  check('修订历史展示版本列表与差异', true);
  const beforeRestore = putCount;
  await page.click('#historyRestore');
  await sleep(600);
  check('恢复历史版本发出 PUT', putCount === beforeRestore + 1, `put ${beforeRestore}→${putCount}`);
  check('恢复内容为历史版本正文', (putBody.get('content') || '').includes('旧正文'), putBody.get('content'));

  // 批量操作
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#postList .post-select')].slice(0, 2);
    boxes.forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await sleep(200);
  check('勾选后显示批量操作栏', !(await page.$eval('#batchBar', (el) => el.hidden)), await page.$eval('#batchCount', (el) => el.textContent));
  const beforeBatch = putCount;
  await page.click('#batchBar [data-batch="archive"]');
  await sleep(900);
  check('批量归档对选中项发出 PUT', putCount === beforeBatch + 2, `put ${beforeBatch}→${putCount}`);
  check('批量归档后清空选择', (await page.$eval('#batchCount', (el) => el.textContent)).includes('0') || (await page.$eval('#batchBar', (el) => el.hidden)) === true);

  // 紧凑视图恢复
  await page.select('#fPostView', 'compact');
  await sleep(200);
  check('切换回紧凑视图', (await page.$$('#postList .post-item')).length === posts.length);

  // 切到其它模块时隐藏列表控件
  await page.click('.mode-tab[data-mode="gallery"]');
  await sleep(400);
  check('切换模块后隐藏文章列表控件', (await page.$eval('#listControls', (el) => el.style.display)) === 'none');

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
