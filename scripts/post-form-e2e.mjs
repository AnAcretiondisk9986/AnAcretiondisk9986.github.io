/**
 * 文章编辑表单（分组折叠 / 模板 / Slug 自动生成 / 即时校验 / 内容统计）浏览器冒烟测试。
 *
 * 前置：管理面板已在 http://localhost:4322 运行。测试不保存、不写文件，仅操作新建编辑器。
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + String(extra).slice(0, 140) + ']' : ''));
  if (!cond) failures += 1;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList .post-item', { timeout: 15000 });

  await page.click('#btnNew');
  await page.waitForSelector('.vditor', { timeout: 15000 });
  await sleep(400);

  // 分组结构
  const sections = await page.$$eval('.form-section', (els) => els.map((e) => e.dataset.section));
  check('编辑器包含四个分组', JSON.stringify(sections) === JSON.stringify(['basic', 'publish', 'cover', 'body']), sections.join(','));

  // 分组折叠
  await page.click('.form-section[data-section="publish"] .form-section-head');
  await sleep(150);
  check('分组可折叠', await page.$eval('.form-section[data-section="publish"]', (el) => el.classList.contains('collapsed')));
  await page.click('.form-section[data-section="publish"] .form-section-head');
  await sleep(150);
  check('分组可展开', !(await page.$eval('.form-section[data-section="publish"]', (el) => el.classList.contains('collapsed'))));

  // 模板
  check('新建时显示模板选项', (await page.$$('#templateChips [data-template]')).length === 4);
  await page.click('#templateChips [data-template="tech"]');
  await sleep(200);
  check('模板写入标签', (await page.$eval('#fTags', (el) => el.value)).includes('技术'), await page.$eval('#fTags', (el) => el.value));
  check('模板写入正文骨架', (await page.evaluate(() => editor.getMarkdown())).includes('## 背景'));

  // Slug 自动生成
  await page.$eval('#fSlug', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('#fTitle', 'My New Post 2026');
  await sleep(200);
  check('标题自动生成 Slug', (await page.$eval('#fSlug', (el) => el.value)) === 'my-new-post-2026', await page.$eval('#fSlug', (el) => el.value));

  // 即时校验：Slug 重复
  await page.$eval('#fSlug', (el) => { el.value = 'HealthCN2030'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  check('重复 Slug 显示错误', (await page.$eval('#errSlug', (el) => el.textContent)).includes('占用'), await page.$eval('#errSlug', (el) => el.textContent));
  check('重复 Slug 标记输入框', await page.$eval('#fSlug', (el) => el.classList.contains('invalid')));

  // 即时校验：非法 Slug
  await page.$eval('#fSlug', (el) => { el.value = '-bad slug-'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  check('非法 Slug 显示格式错误', (await page.$eval('#errSlug', (el) => el.textContent)).includes('只能包含'), await page.$eval('#errSlug', (el) => el.textContent));

  // 即时校验：标题为空
  await page.$eval('#fTitle', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  check('空标题显示错误汇总', (await page.$eval('#postValidation', (el) => el.textContent)).includes('标题不能为空'), await page.$eval('#postValidation', (el) => el.textContent));

  // 内容统计 + 缺失 alt
  await page.evaluate(() => editor.setMarkdown('一段中文说明文字。\n\n![](https://cdn.example.com/no-alt.webp)\n\n[外链](https://example.com)\n'));
  await sleep(400);
  const stats = await page.$eval('#postStats', (el) => el.textContent);
  check('统计显示字数/图片/外链', stats.includes('图片') && stats.includes('外链'), stats);
  check('标记缺失 alt 的图片', stats.includes('缺 alt'), stats);

  // 富文本兼容状态
  await page.evaluate(() => editor.setMarkdown('<div style="text-align:center">居中段落</div>\n'));
  await sleep(400);
  check('富文本不兼容格式显示持续状态', !(await page.$eval('#richStatus', (el) => el.hidden)), await page.$eval('#richStatus', (el) => el.textContent));

  // 刷新后恢复本地草稿
  await page.evaluate(() => { const t = document.querySelector('#fTitle'); t.value = '草稿恢复测试'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => editor.setMarkdown('草稿正文内容'));
  await sleep(900);
  check('未保存内容写入本地草稿', await page.evaluate(() => Boolean(localStorage.getItem('admin-post-draft:__new__'))) === true);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList .post-item', { timeout: 15000 });
  await page.click('#btnNew');
  await page.waitForSelector('.vditor', { timeout: 15000 });
  await sleep(1800);
  check('刷新后恢复标题', (await page.$eval('#fTitle', (el) => el.value)) === '草稿恢复测试', await page.$eval('#fTitle', (el) => el.value));
  check('刷新后恢复正文', (await page.evaluate(() => window.editor.getMarkdown())).includes('草稿正文内容'));

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
