/**
 * 画廊批量 / 文件夹上传浏览器 E2E 测试。
 *
 * 验证：
 * 1. 进入「画廊」模式直接展示批量上传工作区（支持多选与文件夹选择）。
 * 2. 复选多张图片（含非图片文件过滤）时，严格以并发 1 顺序上传（?deferPush=1）。
 * 3. 每张上传后自动写入画廊（无需填写标题或编号），队列全部完成后自动调用 /api/gallery/push 直接推送。
 * 4. 推送失败可重试推送；单张失败可重试上传。
 * 5. 单条画廊新建时留空标题也可保存（自动推导文件名）。
 *
 * 前置：管理面板已在 http://localhost:4322 运行（或通过 run-admin-e2e.mjs 调用）。拦截 /api/ 请求，不写入真实文件或推送。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + String(extra).slice(0, 150) + ']' : ''));
  if (!cond) failures += 1;
};
const json = (body, status = 200, headers = {}) => ({
  status,
  contentType: 'application/json; charset=utf-8',
  headers,
  body: JSON.stringify(body),
});

const tmp = await mkdtemp(join(tmpdir(), 'gallery-batch-e2e-'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const img1 = join(tmp, '01-alpha.png');
const img2 = join(tmp, '02-beta.png');
const img3 = join(tmp, '03-gamma.png');
const txtFile = join(tmp, 'ignore.txt');
await Promise.all([
  writeFile(img1, PNG),
  writeFile(img2, PNG),
  writeFile(img3, PNG),
  writeFile(txtFile, 'not an image', 'utf8'),
]);

let galleryItems = [];
let galleryHash = 'a'.repeat(64);
let inFlightUploads = 0;
let maxConcurrentUploads = 0;
const uploadQueries = [];
const galleryCreateTitles = [];
let pushCalls = [];
let failFirstPush = true;
let failThirdUploadOnce = true;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.setRequestInterception(true);
page.on('request', async (req) => {
  const url = new URL(req.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return req.continue();

  if (path === '/api/health') {
    return req.respond(json({ ok: true, limits: { uploadMaxBytes: 512 * 1024 * 1024, uploadConcurrency: 2 } }));
  }
  if (path === '/api/posts' && req.method() === 'GET') return req.respond(json([]));
  if (path === '/api/sync/status') {
    return req.respond(json({ ok: true, state: 'clean', stateLabel: '工作区干净', branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirtyCount: 0, dirty: false, files: [] }));
  }
  if (path === '/api/gallery' && req.method() === 'GET') {
    return req.respond(json(galleryItems, 200, { 'x-content-hash': galleryHash }));
  }
  if (path === '/api/gallery' && req.method() === 'POST') {
    const params = new URLSearchParams(req.postData() || '');
    const title = params.get('title') || '';
    galleryCreateTitles.push(title);
    const item = {
      id: `独立-${Date.now()}-${galleryItems.length + 1}`,
      src: params.get('src') || '',
      original: params.get('original') || '',
      title: title || '未命名图像',
      alt: '',
      caption: '',
      date: params.get('date') || '2026-11-16',
      dayIndex: galleryItems.length + 1,
    };
    galleryItems.unshift(item);
    galleryHash = String(galleryItems.length).repeat(64).slice(0, 64);
    return req.respond(json({ success: true, item, contentHash: galleryHash }, 201));
  }
  if (path === '/api/upload' && req.method() === 'POST') {
    inFlightUploads += 1;
    if (inFlightUploads > maxConcurrentUploads) maxConcurrentUploads = inFlightUploads;
    uploadQueries.push(url.search);
    await sleep(120);
    inFlightUploads -= 1;
    if (failThirdUploadOnce && uploadQueries.length === 3) {
      failThirdUploadOnce = false;
      return req.respond(json({ error: '模拟第3张失败' }, 500));
    }
    const n = uploadQueries.length;
    return req.respond(json({
      success: true,
      url: `https://cdn.example.com/image/img_${n}.webp`,
      originalUrl: `https://cdn.example.com/image/original/img_${n}.png`,
      deferredPush: url.searchParams.get('deferPush') === '1',
      pushed: false,
      type: 'image',
    }, 201));
  }
  if (path === '/api/gallery/push' && req.method() === 'POST') {
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* ignore */ }
    pushCalls.push(body);
    if (failFirstPush) {
      failFirstPush = false;
      return req.respond(json({ ok: false, success: false, error: '模拟推送失败' }, 502));
    }
    return req.respond(json({ ok: true, success: true, imageRepoPushed: true, message: '推送成功' }));
  }
  return req.respond(json({ ok: true }));
});

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.mode-tab[data-mode="gallery"]', { timeout: 15000 });
  await page.click('.mode-tab[data-mode="gallery"]');
  await page.waitForSelector('#galleryBatchDropzone', { timeout: 10000 });

  check('进入画廊直接显示批量上传工作区', Boolean(await page.$('#btnGalleryPickFiles')) && Boolean(await page.$('#btnGalleryPickFolder')));
  const folderHasAttr = await page.$eval('#fGalleryFolder', (el) => el.hasAttribute('webkitdirectory'));
  check('文件夹选择框启用 webkitdirectory', folderHasAttr);
  const autoPushChecked = await page.$eval('#fGalleryAutoPush', (el) => el.checked);
  check('默认勾选上传完成后直接推送', autoPushChecked);

  // 复选多张图片（包含 1 个 txt 非图片文件，应自动跳过）
  const multiInput = await page.$('#fGalleryMultiFiles');
  await multiInput.uploadFile(img1, img2, img3, txtFile);

  // 等待队列跑完（第 3 张模拟失败，前 2 张触发第一次推送并模拟失败）
  await page.waitForFunction(
    () => document.querySelector('#btnGalleryBatchPushNow') && !document.querySelector('#btnGalleryBatchPushNow').hidden,
    { timeout: 15000 },
  );

  check('严格按每次 1 张低并发上传', maxConcurrentUploads === 1, `maxConcurrent=${maxConcurrentUploads}`);
  check('过滤非图片文件，仅上传 3 张图片', uploadQueries.length === 3, `uploads=${uploadQueries.length}`);
  check('上传携带 deferPush=1 延迟统一推送', uploadQueries.every((q) => q.includes('deferPush=1')), JSON.stringify(uploadQueries));
  check('前 2 张成功自动入库并触发直接推送', galleryItems.length === 2 && pushCalls.length === 1, `items=${galleryItems.length} pushes=${pushCalls.length}`);

  // 重试第 3 张失败项 -> 成功后再次自动直接推送（这次会成功）
  await page.click('#btnGalleryBatchRetryFailed');
  await page.waitForFunction(
    () => (document.querySelector('#galleryBatchSummary')?.textContent || '').includes('直接推送上线'),
    { timeout: 15000 },
  );

  check('重试失败项后全部 3 张入库且并发仍为 1', galleryItems.length === 3 && maxConcurrentUploads === 1, `items=${galleryItems.length}`);
  check('全部完成后自动调用 /api/gallery/push 推送', pushCalls.length === 2 && Array.isArray(pushCalls[1].urls) && pushCalls[1].urls.length === 3, JSON.stringify(pushCalls[1]));

  // 验证单条新建画廊留空标题也可以保存
  await page.click('#btnNew');
  await page.waitForSelector('#fSrc', { timeout: 5000 });
  await page.type('#fSrc', 'https://cdn.example.com/image/no-title-test_1700000000.webp');
  await page.click('#btnSave');
  await sleep(400);
  check('单条画廊留空标题可保存并自动推导标题', galleryItems.length === 4 && galleryCreateTitles[3] === 'no-title-test', JSON.stringify(galleryCreateTitles));

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
