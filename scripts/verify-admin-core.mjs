/**
 * 后台缺陷修复验证（临时脚本）：
 * 1. 留言模块已从导航移除
 * 2. 发布中心总览可打开（曾因 fetchHealth 未注入抛 ReferenceError 而卡在"正在读取"）
 * 3. 编辑器「媒体库」选择器选中图片可插入正文（曾因 insertImageIntoEditor 未注入抛错）
 * 4. 「前端定制」上传背景图可回填字段（曾因 uploadImage 未定义抛错，且覆盖全局上传处理器）
 *
 * 只读为主：/api/upload 被拦截伪造，不会真的写入文件或推送图片仓库。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.ADMIN_URL || 'http://127.0.0.1:4322/admin/';
const out = process.env.SHOT_DIR || 'dist/_admin-fixes';
await mkdir(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok) => { assert.ok(ok, name); results.push(name); console.log('PASS', name); };

// 1x1 PNG，用于模拟本地选图（不会真的上传：/api/upload 被拦截）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const tmpPng = join(out, 'probe.png');
await writeFile(tmpPng, PNG);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// 编辑器进入 dirty 后 beforeunload 会拦截导航（守卫本身是预期行为），测试中自动接受
page.on('dialog', async (d) => { try { await d.accept(); } catch { /* 已被别处处理 */ } });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() !== 'error' || t.includes('favicon')) return;
  // 上传被拦截后会返回一个并不存在的 mock CDN 地址，预览图必然加载失败；
  // 这类「外部资源」失败与应用无关，只把本地（127.0.0.1:4322）资源失败视为错误。
  const url = m.location()?.url || '';
  if (!url.includes('127.0.0.1:4322') && /Failed to load resource|ERR_/.test(t)) return;
  errors.push('console: ' + t + (url ? ` [${url}]` : ''));
});
page.on('requestfailed', (r) => {
  if (r.url().includes('127.0.0.1:4322')) errors.push('requestfailed: ' + r.url());
});

// 拦截上传：伪造成功响应，避免真的写图库 / 推送图片仓库
const uploadHits = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/api/upload')) {
    uploadHits.push(req.url());
    req.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://cdn.jsdelivr.net/gh/mock/blog-images@main/image/mock.webp', originalUrl: '' }),
    });
    return;
  }
  req.continue();
});

await page.goto(base, { waitUntil: 'networkidle2' });
await sleep(1500);

// ── 1. 留言模块已移除、包含造物/年报/学业共 11 个模块 ──
const modes = await page.$$eval('.mode-tab', (els) => els.map((e) => ({ mode: e.dataset.mode, text: e.textContent.trim() })));
const expectedModes = ['posts', 'daily', 'gallery', 'media', 'about', 'frontend', 'access', 'schedule', 'projects', 'report', 'academics'];
check(`导航共 11 个模块（实际 ${modes.length}：${modes.map((m) => m.text).join('/')}）`,
  modes.length === 11 && expectedModes.every((m) => modes.some((x) => x.mode === m)));
check('导航无「留言」模块', !modes.some((m) => m.mode === 'guestbook' || m.text.includes('留言')));

// ── 2. 发布中心总览可打开 ──
await page.click('#syncCard');
const t0 = Date.now();
let syncBody = '';
for (let i = 0; i < 80; i++) {
  syncBody = await page.$eval('#syncModalBody', (el) => el.innerText);
  if (syncBody.includes('工作区状态')) break;
  await sleep(500);
}
const openMs = Date.now() - t0;
console.log(`--- 发布中心总览渲染耗时：${openMs} ms ---`);
console.log('--- #syncModalBody ---\n' + syncBody + '\n--- 运行时报错 ---\n' + (errors.join('\n') || '(无)') + '\n---');
check(`发布中心渲染出工作区状态（耗时 ${openMs}ms）`, syncBody.includes('工作区状态'));
check('发布中心未卡在"正在读取"', !syncBody.includes('正在读取同步状态…'));
check('发布中心显示发布操作区', syncBody.includes('发布操作'));
await page.screenshot({ path: join(out, 'sync-center.png') });
await page.evaluate(() => { const m = document.querySelector('#syncModal'); if (m) m.style.display = 'none'; });

// ── 3. 编辑器媒体库插入 ──
await page.click('#postList .post-item');
await sleep(1000);
const editorReady = await page.$('[data-editor-ready="1"]');
check('文章编辑器已打开', Boolean(editorReady));

const hasInsertBtn = await page.$('#btnInsertMedia');
check('存在「媒体库」插入按钮', Boolean(hasInsertBtn));
if (hasInsertBtn) {
  await page.click('#btnInsertMedia');
  await sleep(2000);
  const cardCount = await page.$$eval('#mediaPickerGrid .media-card', (els) => els.length);
  check(`媒体选择器加载出卡片（${cardCount} 张）`, cardCount > 0);
  await page.click('#mediaPickerGrid .media-card');
  await sleep(1200);
  const value = await page.evaluate(() => window.editor?.getValue?.() ?? '');
  check('选中图片后正文插入了该地址', value.includes('mock') || value.includes('![') || value.includes('<img'));
  const pickerClosed = await page.$eval('#mediaPickerModal', (el) => getComputedStyle(el).display === 'none');
  check('选择器已关闭', pickerClosed);
}

// ── 4. 「关于」模块头像上传回填字段（独立重新加载，避免前序编辑器状态干扰） ──
await page.goto(base, { waitUntil: 'networkidle2' });
await sleep(1500);
await page.evaluate(() => document.querySelector('.mode-tab[data-mode="about"]')?.click());
await sleep(2000);
const aboutUploadArea = await page.$('#uploadArea');
check('关于页上传区存在', Boolean(aboutUploadArea));
if (aboutUploadArea) {
  const before = await page.$eval('#fAvatar', (el) => el.value);
  const hitsBefore = uploadHits.length;
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 15000 }),
    page.evaluate(() => document.querySelector('#uploadArea').click()),
  ]);
  await chooser.accept([tmpPng]);
  await sleep(2500);
  const filled = await page.$eval('#fAvatar', (el) => el.value);
  console.log(`--- 上传诊断 ---\n字段：fAvatar\n点击前值：${before}\n点击后值：${filled}\n/api/upload 命中：${uploadHits.length - hitsBefore} 次（累计 ${uploadHits.length}）\n---`);
  check(`上传请求已发出（命中 ${uploadHits.length - hitsBefore} 次）`, uploadHits.length > hitsBefore);
  check(`上传后头像字段回填为上传结果（${filled.slice(0, 60)}）`, filled.includes('mock.webp'));
}

// ── 5. 「外观」模块：对齐 HORIZON 主站，移除旧版失效字段，预览实时拆分域名 ──
await page.goto(base, { waitUntil: 'networkidle2' });
await sleep(1500);
await page.evaluate(() => document.querySelector('.mode-tab[data-mode="frontend"]')?.click());
await sleep(2000);
const frontendInfo = await page.evaluate(() => ({
  preview: Boolean(document.querySelector('#frontendHeroPreview')),
  removed: ['#fFluidHeroImage', '#fStillHeroImage', '#fDisplayFont', '#fHeroRainbowEnabled', '#fStillAccent', '#fFluidPrimary', '#fGlassBlur'].filter((s) => document.querySelector(s)),
  kept: ['#fSiteName', '#fSiteTagline', '#fHeroEyebrow', '#fHeroTitleLine1', '#fHeroTitleLine2', '#fHeroDescription', '#fPrimaryCtaLabel', '#fPrimaryCtaHref', '#fInteractEndpoint'].filter((s) => document.querySelector(s)),
}));
check('外观：HORIZON 首屏预览卡片存在', frontendInfo.preview);
check(`外观：旧版失效主题字段已清理${frontendInfo.removed.length ? '（残留 ' + frontendInfo.removed.join(',') + '）' : ''}`, frontendInfo.removed.length === 0);
check(`外观：HORIZON 与互动端点字段完整保留（${frontendInfo.kept.length}/9）`, frontendInfo.kept.length === 9);

const previewSync = await page.evaluate(() => {
  const input = document.querySelector('#fHeroTitleLine1');
  if (!input) return null;
  input.value = '观测站Horizon.test';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    l1: document.querySelector('#frontendPreviewL1')?.textContent || '',
    domain: document.querySelector('#frontendPreviewDomain')?.textContent || '',
  };
});
check(`外观：预览随输入同步并拆分域名（${JSON.stringify(previewSync)}）`, previewSync?.l1 === '观测站' && previewSync?.domain === 'Horizon.test');

const apiFields = await page.evaluate(async () => {
  const res = await fetch('/api/frontend', { headers: { 'x-admin-token': window.__ADMIN_TOKEN__ } });
  const data = await res.json();
  return Object.keys(data.frontend || data || {});
});
check(`外观：服务端契约已同步 HORIZON（${apiFields.length} 个字段）`, !apiFields.some((k) => /stillHero|fluid|Rainbow|glassBlur|cardRadius|displayFont|defaultVisualTheme/i.test(k)));

// ── 5.5 新后台模块可视化表单渲染（08 日程期末考试 / 09 造物 / 10 年报 / 11 学业 / 文章大类管理）──
await page.evaluate(() => document.querySelector('.mode-tab[data-mode="schedule"]')?.click());
await sleep(1000);
await page.click('#btnSchedTabExams');
await sleep(500);
check('日程模块「期末考试」子页签渲染考试场次编辑器', Boolean(await page.$('#examRowsList')));

await page.evaluate(() => document.querySelector('.mode-tab[data-mode="projects"]')?.click());
await sleep(1000);
check('09 造物模块渲染项目名称与关联文章多选', Boolean(await page.$('#fProjName')) && Boolean(await page.$('#projPostChoices')));

await page.evaluate(() => document.querySelector('.mode-tab[data-mode="report"]')?.click());
await sleep(1000);
check('10 年报模块渲染报告周期与里程碑编辑器', Boolean(await page.$('#fRepTitle')) && Boolean(await page.$('#repMilestonesList')));

await page.evaluate(() => document.querySelector('.mode-tab[data-mode="academics"]')?.click());
await sleep(1000);
check('11 学业模块渲染课程列表与转专业编辑表单', Boolean(await page.$('#fAcadTitle')) && Boolean(await page.$('#acadTransferPosts')));

await page.evaluate(() => document.querySelector('.mode-tab[data-mode="posts"]')?.click());
await sleep(1000);
await page.click('#btnToggleFilters');
await page.click('#btnOpenCategoryManager');
await sleep(400);
check('01 文章：打开文章大类管理弹窗', await page.$eval('#categoryManagerModal', (el) => getComputedStyle(el).display !== 'none'));
await page.click('#btnCatMgrClose');

// ── 6. 无运行时报错 ──
check(`无浏览器运行时报错${errors.length ? '：' + errors.join(' | ') : ''}`, errors.length === 0);

console.log(`\n全部通过：${results.length} 项断言`);
await browser.close();

