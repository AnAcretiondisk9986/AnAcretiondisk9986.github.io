/**
 * 发布前检查（preflight）浏览器冒烟测试。
 * 前置：管理面板已在 http://localhost:4322 运行。拦截 /api/，不写文件。
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

const posts = [{ slug: 'HealthCN2030', title: '关于健康中国2030战略', pubDate: '2026-07-30', tags: ['医疗'], draft: false, access: 'public', archived: false, excerpt: '', hasPublicPage: true, publicUrl: 'x', shortUrl: 'y' }];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = new URL(req.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return req.continue();
  if (path === '/api/posts' && req.method() === 'GET') return req.respond(json(posts));
  if (path.startsWith('/api/posts/') && req.method() === 'GET') return req.respond(json({ ...posts[0], contentHash: 'a'.repeat(64), content: '# 正文', cover: '' }));
  if (path === '/api/sync/status') return req.respond(json({ ok: true, state: 'clean', stateLabel: '工作区干净', branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirtyCount: 0, dirty: false, files: [] }));
  return req.respond(json({ ok: true }));
});

const listText = () => page.$eval('#preflightList', (el) => el.textContent);
const summaryText = () => page.$eval('#preflightSummary', (el) => el.textContent);

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList .post-item', { timeout: 15000 });
  await page.click('#btnNew');
  await page.waitForSelector('.vditor', { timeout: 15000 });
  await sleep(1500);
  check('新建时发布检查按钮可用', !(await page.$eval('#btnPreflight', (el) => el.disabled)));

  // 空白文章 → 应报必填错误
  await page.click('#btnPreflight');
  await page.waitForFunction(() => document.querySelector('#preflightModal')?.style.display === 'flex', { timeout: 5000 });
  check('空白文章提示必须修复', (await summaryText()).includes('必须修复'), await summaryText());
  const emptyList = await listText();
  check('列出标题/正文/Slug 错误', emptyList.includes('标题') && emptyList.includes('正文') && emptyList.includes('Slug'), emptyList.slice(0, 80));
  await page.keyboard.press('Escape');
  await sleep(300);

  // 填写完整后 → 不再有必填错误
  await page.$eval('#fTitle', (el) => { el.value = '一篇用于检查的文章'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#fDesc', (el) => { el.value = '这是一段长度足够的文章描述，用于通过发布前检查的描述长度建议。'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#fTags', (el) => { el.value = '测试, 排版'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => window.editor.setMarkdown('## 小标题\n\n一段足够长的正文内容，用来通过检查。这里补充更多文字以确保字数达到建议阈值，避免出现正文偏短的提醒。\n'));
  await sleep(700);
  await page.click('#btnPreflight');
  await sleep(400);
  check('填写完整后无必须修复项', !(await summaryText()).includes('必须修复'), await summaryText());
  check('正文检查通过', (await listText()).includes('正文'), await listText());
  await page.keyboard.press('Escape');
  await sleep(300);

  // 缺 alt 图片 → 警告
  await page.evaluate(() => window.editor.setMarkdown('## 图\n\n![](https://cdn.example.com/no-alt.webp)\n\n一段足够长的正文内容，用来通过检查。这里补充更多文字以确保字数达到建议阈值。\n'));
  await sleep(700);
  await page.click('#btnPreflight');
  await sleep(400);
  check('缺 alt 图片给出警告', (await listText()).includes('缺少 alt'), await listText());

  // Esc 关闭
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc 关闭检查弹窗', (await page.$eval('#preflightModal', (el) => el.style.display)) === 'none');

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
