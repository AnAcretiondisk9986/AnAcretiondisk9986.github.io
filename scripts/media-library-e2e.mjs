/**
 * 媒体库（统一媒体服务 / 引用扫描 / 上传队列 / 选择器）浏览器冒烟测试。
 *
 * 前置：管理面板已在 http://localhost:4322 运行。测试拦截 /api/ 请求，不真实上传/删除。
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
const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

const posts = [
  { slug: 'HealthCN2030', title: '关于健康中国2030战略', description: '', pubDate: '2026-07-30', dayIndex: 1, tags: ['医疗'], draft: false, access: 'public', archived: false, updatedAt: '2026-08-03T06:44:42.393Z', excerpt: '', astroId: 'healthcn2030', hasPublicPage: true, publicUrl: 'https://blog.acretiondisk.top/blog/healthcn2030/', shortUrl: 'https://blog.acretiondisk.top/s/abc123' },
  { slug: 'social-paper', title: '自动化生产调研论文', description: '', pubDate: '2026-06-10', dayIndex: 1, tags: ['技术'], draft: false, access: 'public', archived: false, updatedAt: '2026-06-11T03:00:00.000Z', excerpt: '', astroId: 'social-paper', hasPublicPage: true, publicUrl: 'https://blog.acretiondisk.top/blog/social-paper/', shortUrl: 'https://blog.acretiondisk.top/s/xyz789' },
];

const mediaFixture = {
  ok: true,
  images: [
    { type: 'image', name: 'alpha.webp', size: 1234, mtime: '2026-09-02T00:00:00.000Z', width: 800, height: 600, url: 'https://cdn.example.com/image/alpha.webp', originalUrl: 'https://cdn.example.com/image/original/alpha.webp', usedBy: ['post:HealthCN2030'] },
    { type: 'image', name: 'beta.webp', size: 2345, mtime: '2026-09-01T00:00:00.000Z', width: 400, height: 300, url: 'https://cdn.example.com/image/beta.webp', originalUrl: 'https://cdn.example.com/image/original/beta.webp', usedBy: [] },
  ],
  audios: [
    { type: 'audio', name: 'song.mp3', size: 3456, mtime: '2026-08-30T00:00:00.000Z', url: 'https://cdn.example.com/audio/song.mp3', usedBy: [] },
  ],
  limits: { uploadMaxBytes: 36700160, uploadConcurrency: 2 },
  stats: { images: 2, audios: 1, referenced: 1, orphan: 2 },
};

let deleteCalls = [];
let archiveCalls = [];
let uploadCalls = 0;
let failNextUpload = false;
let putBody = null;
let clipboard = [];

const tmp = await mkdtemp(join(tmpdir(), 'media-e2e-'));
const pngPath = join(tmp, 'uploaded.webp');
await writeFile(pngPath, Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=', 'base64'));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.evaluateOnNewDocument(() => {
  window.__clipboard = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clipboard.push(t); } } });
});

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = new URL(req.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return req.continue();
  if (path === '/api/media' && req.method() === 'GET') return req.respond(json(mediaFixture));
  if (path === '/api/media' && req.method() === 'DELETE') {
    deleteCalls.push({ type: url.searchParams.get('type'), name: url.searchParams.get('name') });
    if (url.searchParams.get('name') === 'alpha.webp') return req.respond(json({ code: 'MEDIA_IN_USE', error: '该资源仍被 1 处引用，未删除', usedBy: ['post:HealthCN2030'] }, 409));
    return req.respond(json({ ok: true, deleted: url.searchParams.get('name'), pushed: false }));
  }
  if (path === '/api/media/archive' && req.method() === 'POST') {
    try { archiveCalls.push(new URLSearchParams(req.postData() || '').get('name')); } catch { archiveCalls.push(''); }
    return req.respond(json({ ok: true, archived: 'beta.webp', pushed: false }));
  }
  if (path === '/api/posts' && req.method() === 'GET') return req.respond(json(posts));
  if (path === '/api/gallery' && req.method() === 'GET') return req.respond(json([]));
  if (path.startsWith('/api/posts/') && req.method() === 'GET') {
    const slug = decodeURIComponent(path.slice('/api/posts/'.length));
    const p = posts.find((x) => x.slug === slug) || {};
    return req.respond(json({ ...p, contentHash: 'a'.repeat(64), content: '# 正文', cover: '' }));
  }
  if (path.startsWith('/api/posts/') && req.method() === 'PUT') {
    try { putBody = new URLSearchParams(req.postData() || ''); } catch { putBody = null; }
    return req.respond(json({ success: true, contentHash: 'b'.repeat(64) }));
  }
  if (path === '/api/upload' && req.method() === 'POST') {
    uploadCalls += 1;
    if (failNextUpload) { failNextUpload = false; return req.respond(json({ error: '模拟上传失败' }, 500)); }
    return req.respond(json({ success: true, url: 'https://cdn.example.com/image/uploaded.webp', originalUrl: 'https://cdn.example.com/image/original/uploaded.webp', type: 'image', pushed: false }, 201));
  }
  if (path === '/api/upload/selfcheck') {
    return req.respond(json({
      ok: false,
      checks: [
        { id: 'repo_dir', label: '图库仓库目录存在', ok: true, detail: 'D:\\blog-images', hint: '' },
        { id: 'image_dir', label: '图片目录可写', ok: false, detail: 'D:\\blog-images\\image（EPERM）', hint: '目录被占用 / 无权限 / 磁盘满：检查安全软件或磁盘空间' },
        { id: 'sharp', label: 'sharp 转码可用', ok: true, detail: 'sharp 0.35.3 · webp 44B', hint: '' },
      ],
      counts: { images: 2, audios: 1 },
      lastError: { stage: 'multer', code: 'UPLOAD_REJECTED', message: 'Unexpected field', detail: '' },
      limits: { uploadMaxBytes: 52428800 },
      config: { imgRepoDir: 'D:\\blog-images', imageDir: 'D:\\blog-images\\image', port: 4322 },
      durationMs: 12,
    }));
  }
  if (path === '/api/sync/status') return req.respond(json({ ok: true, state: 'clean', stateLabel: '工作区干净', branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirtyCount: 0, dirty: false, files: [], autoPull: false }));
  return req.respond(json({ ok: true }));
});

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList .post-item', { timeout: 15000 });

  // 进入媒体模式
  await page.click('.mode-tab[data-mode="media"]');
  await page.waitForSelector('#mediaGrid .media-card', { timeout: 10000 });
  check('媒体模式渲染网格', (await page.$$('#mediaGrid .media-card')).length === 3, await page.$$eval('#mediaGrid .media-card', (e) => e.length));
  const sidebar = await page.$eval('#postList', (el) => el.textContent);
  check('侧栏显示媒体统计', sidebar.includes('图片 2') && sidebar.includes('已引用 1'), sidebar.replace(/\s+/g, ' ').trim());

  // 筛选
  await page.select('#fMediaType', 'audio');
  await sleep(250);
  check('按类型筛选音频', (await page.$$('#mediaGrid .media-card')).length === 1);
  await page.select('#fMediaType', 'image');
  await sleep(250);
  await page.select('#fMediaUsage', 'unused');
  await sleep(250);
  check('筛选未引用资源', (await page.$$('#mediaGrid .media-card')).length === 1);
  await page.select('#fMediaType', 'all');
  await page.select('#fMediaUsage', 'all');
  await page.type('#fMediaSearch', 'alpha');
  await sleep(250);
  check('按文件名搜索', (await page.$$('#mediaGrid .media-card')).length === 1);
  await page.$eval('#fMediaSearch', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(250);

  // 复制 CDN
  await page.evaluate(() => document.querySelector('#mediaGrid [data-maction="copy"]').click());
  await sleep(200);
  const clip = await page.evaluate(() => window.__clipboard);
  check('复制 CDN 地址', clip.some((t) => t.includes('/image/')), JSON.stringify(clip));

  // 引用查看
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#mediaGrid .media-card')].find((c) => c.dataset.name === 'alpha.webp');
    card.querySelector('[data-maction="usage"]').click();
  });
  await page.waitForFunction(() => document.querySelector('#mediaUsageModal')?.style.display === 'flex', { timeout: 5000 });
  const usageText = await page.$eval('#mediaUsageList', (el) => el.textContent);
  check('引用弹窗显示文章标题', usageText.includes('关于健康中国2030战略'), usageText);
  await page.click('#mediaUsageClose');
  await sleep(200);

  // 删除被引用资源 → 409
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#mediaGrid .media-card')].find((c) => c.dataset.name === 'alpha.webp');
    card.querySelector('[data-maction="delete"]').click();
  });
  await sleep(400);
  check('删除被引用资源被拒绝', deleteCalls.some((c) => c.name === 'alpha.webp') && (await page.$eval('#mediaUsageModal', (el) => el.style.display)) === 'flex');
  await page.click('#mediaUsageClose');
  await sleep(200);

  // 删除未引用资源
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#mediaGrid .media-card')].find((c) => c.dataset.name === 'beta.webp');
    card.querySelector('[data-maction="delete"]').click();
  });
  await sleep(400);
  check('删除未引用资源成功', deleteCalls.some((c) => c.name === 'beta.webp'));

  // 归档
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#mediaGrid .media-card')].find((c) => c.dataset.name === 'song.mp3');
    card.querySelector('[data-maction="archive"]').click();
  });
  await sleep(400);
  check('归档音频发出请求', archiveCalls.includes('song.mp3'), JSON.stringify(archiveCalls));

  // 上传队列
  await page.waitForSelector('#fMediaUpload', { timeout: 5000 });
  const input = await page.$('#fMediaUpload');
  await input.uploadFile(pngPath);
  await page.waitForFunction(() => document.querySelectorAll('#mediaQueue .media-task').length > 0, { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('#mediaQueue .media-task.failed'), { timeout: 8000 });
  check('上传队列完成任务', uploadCalls === 1, `uploads=${uploadCalls}`);
  const queueText = await page.$eval('#mediaQueue', (el) => el.textContent);
  check('上传队列显示完成状态', queueText.includes('完成'), queueText.replace(/\s+/g, ' ').trim());

  // 上传失败 → 单项重试
  failNextUpload = true;
  const input2 = await page.$('#fMediaUpload');
  await input2.uploadFile(pngPath);
  await page.waitForFunction(() => document.querySelectorAll('#mediaQueue .media-task.failed').length > 0, { timeout: 8000 });
  const failText = await page.$eval('#mediaQueue', (el) => el.textContent);
  check('上传失败显示失败原因', failText.includes('失败'), failText.replace(/\s+/g, ' ').trim().slice(0, 80));
  await page.click('#mediaQueue [data-mtask="retry"]');
  await page.waitForFunction(() => document.querySelectorAll('#mediaQueue .media-task.failed').length === 0, { timeout: 10000 });
  check('单项重试后成功', uploadCalls >= 3, `uploads=${uploadCalls}`);

  // 目标文章 + 插入正文
  await page.select('#fMediaTargetPost', 'HealthCN2030');
  await sleep(150);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#mediaGrid .media-card')].find((c) => c.dataset.name === 'alpha.webp');
    card.querySelector('[data-maction="insert"]').click();
  });
  await sleep(500);
  check('插入正文携带媒体 URL', putBody && (putBody.get('content') || '').includes('/image/alpha.webp'), putBody ? putBody.get('content') : 'no put');

  // 设为封面
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#mediaGrid .media-card')].find((c) => c.dataset.name === 'alpha.webp');
    card.querySelector('[data-maction="cover"]').click();
  });
  await sleep(500);
  check('设为封面写入 cover', putBody && putBody.get('cover') === 'https://cdn.example.com/image/alpha.webp', putBody ? putBody.get('cover') : 'no put');

  // 选择器：画廊
  await page.click('.mode-tab[data-mode="gallery"]');
  await page.waitForSelector('#btnNew', { timeout: 8000 });
  await page.click('#btnNew');
  await page.waitForSelector('#btnGalleryMedia', { timeout: 8000 });
  await page.click('#btnGalleryMedia');
  await page.waitForSelector('#mediaPickerModal[style*="flex"]', { timeout: 8000 });
  await page.waitForSelector('#mediaPickerGrid .media-card', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('#mediaPickerGrid .media-card').click());
  await sleep(300);
  check('画廊选择器回填 src', (await page.$eval('#fSrc', (el) => el.value)).includes('/image/'), await page.$eval('#fSrc', (el) => el.value));
  check('选择器关闭', (await page.$eval('#mediaPickerModal', (el) => el.style.display)) === 'none');

  // 上传自检弹窗：阻塞项 + 建议 + 上次失败原因
  await page.click('.mode-tab[data-mode="media"]');
  await page.waitForSelector('#btnMediaSelfCheck', { timeout: 8000 });
  await page.click('#btnMediaSelfCheck');
  await page.waitForFunction(() => window.__uploadSelfCheck, { timeout: 8000 });
  await sleep(200);
  const scSummary = await page.$eval('#uploadSelfCheckSummary', (el) => el.textContent.trim());
  check('自检汇总提示阻塞项', scSummary.includes('存在阻塞项'), scSummary);
  const scRows = await page.$$eval('.selfcheck-row', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check('自检渲染所有检查项', scRows.length === 3, String(scRows.length));
  const scHint = await page.$eval('#uploadSelfCheckList', (el) => el.textContent);
  check('自检给出可执行建议', scHint.includes('目录被占用'), scHint.replace(/\s+/g, ' ').trim().slice(0, 80));
  check('自检展示上次上传失败原因', scHint.includes('Unexpected field'), scHint.replace(/\s+/g, ' ').trim().slice(0, 120));
  const scCfg = await page.$eval('#uploadSelfCheckConfig', (el) => el.textContent);
  check('自检展示环境配置', scCfg.includes('imgRepoDir'), scCfg.slice(0, 60).replace(/\s+/g, ' '));
  await page.click('#uploadSelfCheckClose');

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
