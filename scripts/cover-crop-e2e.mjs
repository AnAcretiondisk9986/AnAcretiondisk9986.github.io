import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 运行前需安装: npm i --no-save --package-lock=false puppeteer-core
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const tmp = mkdtempSync(join(tmpdir(), 'cover-crop-'));
const PNG = join(tmp, 'crop-test.png');
const BAD = join(tmp, 'bad.png');
await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 190, g: 90, b: 60 } } }).png().toFile(PNG);
writeFileSync(BAD, 'not an image'); // 浏览器无法解码 → 模拟 HEIC 回退路径

let failures = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failures++;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

// 拦截上传接口，避免真实 git push 到图片仓库
let uploadCount = 0;
const uploadedUrls = [];
await page.setRequestInterception(true);
page.on('request', req => {
  if (req.url().endsWith('/api/upload') && req.method() === 'POST') {
    uploadCount++;
    const url = `https://cdn.example.com/image/upload${uploadCount}.webp`;
    uploadedUrls.push(url);
    req.respond({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, url, originalUrl: '', pushed: true }),
    });
  } else {
    req.continue();
  }
});

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));

const sleep = ms => new Promise(r => setTimeout(r, ms));

const waitCropReady = async () => {
  for (let i = 0; i < 30; i++) {
    const st = await page.evaluate(() => ({
      hidden: document.querySelector('#cropLoading').hidden,
      modal: document.querySelector('#coverCropModal').style.display,
      uploads: document.querySelector('#fCover').value,
    }));
    if (st.hidden) return st;
    await sleep(500);
  }
  const st = await page.evaluate(() => ({
    hidden: document.querySelector('#cropLoading').hidden,
    modal: document.querySelector('#coverCropModal').style.display,
    err: window.__err || [],
  }));
  throw new Error('裁剪图片加载超时: ' + JSON.stringify(st));
};

await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
await page.waitForSelector('#btnNew');
await page.click('#btnNew');
await page.waitForSelector('#btnCoverUpload');

// 封面选择器：点击封面按钮（设置 target=cover）→ 向 fileInput 注入文件触发 change
const pickCoverFile = async () => {
  await page.click('#btnCoverUpload');
  await sleep(100);
  const inputEl = await page.$('#fileInput');
  await inputEl.uploadFile(PNG);
  await waitCropReady();
};

// ── 场景 1：上传 → 裁剪 → 确认 ──
await pickCoverFile();
check('上传后打开裁剪对话框', await page.$eval('#coverCropModal', el => el.style.display === 'flex'));
check('上传请求已发出(1)', uploadCount === 1);
check('裁剪图已加载', await page.$eval('#cropImg', img => img.naturalWidth === 640 && img.naturalHeight === 360));

let sel = await page.evaluate(() => {
  const c = document.querySelector('#cropSel');
  return { w: parseFloat(c.style.width), h: parseFloat(c.style.height) };
});
const selRatio = sel.w / sel.h;
// 测试图为 640×360(16:9 > 16:10) → 初始选区应为水平裁切后的 16:10：w=576(原图)×scale，h=360×scale
check('初始选区为 16:10', Math.abs(selRatio - 1.6) < 0.01, `w=${Math.round(sel.w)} h=${Math.round(sel.h)} ratio=${selRatio.toFixed(3)}`);
check('初始选区未超出整图', sel.w < 640 * 1.3, `w=${Math.round(sel.w)}`);

// 拖动选区移动（垂直方向已占满整图，只能水平移动）
const selBox = await page.$eval('#cropSel', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(selBox.x + selBox.w / 2, selBox.y + selBox.h / 2);
await page.mouse.down();
await page.mouse.move(selBox.x + selBox.w / 2 - 60, selBox.y + selBox.h / 2 - 40, { steps: 5 });
await page.mouse.up();
const sel2 = await page.$eval('#cropSel', el => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y) };
});
check('拖动移动选区', sel2.x < selBox.x - 30, `(${selBox.x},${selBox.y})->(${sel2.x},${sel2.y})`);

// 拖手柄缩放：右下角向左上拖 → 显示宽度变小且保持 16:10
const handleBox = await page.$eval('#cropHandle', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
await page.mouse.move(handleBox.x + 6, handleBox.y + 6);
await page.mouse.down();
await page.mouse.move(handleBox.x + 6 - 100, handleBox.y + 6 - 60, { steps: 5 });
await page.mouse.up();
const sel3 = await page.evaluate(() => {
  const el = document.querySelector('#cropSel');
  const w = parseFloat(el.style.width), h = parseFloat(el.style.height);
  return { w: Math.round(w), h: Math.round(h), ratio: (w / h).toFixed(4) };
});
check('手柄缩放选区(变小)', sel3.w < selBox.w, `w=${sel3.w} < ${Math.round(selBox.w)}`);
check('缩放保持 16:10', Math.abs(sel3.ratio - 1.6) < 0.01, `ratio=${sel3.ratio}`);

// 滚轮放大
const viewBox = await page.$eval('#cropView', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(viewBox.x + viewBox.w / 2, viewBox.y + viewBox.h / 2);
await page.mouse.wheel({ deltaY: -120 });
await sleep(150);
const scaleAfterWheel = await page.evaluate(() => document.querySelector('#cropImg').style.width);
check('滚轮缩放图片', parseInt(scaleAfterWheel) > 640, `img width=${scaleAfterWheel}`);

// 确认裁剪 → 二次上传 → fCover 回填 + 对话框关闭
await page.click('#btnCropConfirm');
await page.waitForFunction(() => document.querySelector('#coverCropModal').style.display === 'none', { timeout: 15000 });
await sleep(300);
check('裁剪图已二次上传(2)', uploadCount === 2, `uploads=${uploadCount}`);
const coverVal = await page.$eval('#fCover', el => el.value);
check('封面字段为裁剪图 URL', coverVal === uploadedUrls[1], coverVal);
check('场景1无页面错误', pageErrors.length === 0, pageErrors.join('; '));

// ── 场景 2：使用原图 ──
await pickCoverFile();
await page.click('#btnCropOriginal');
await sleep(300);
const coverVal2 = await page.$eval('#fCover', el => el.value);
check('「使用原图」回填原上传 URL', coverVal2 === uploadedUrls[2], coverVal2);
check('使用原图未产生额外上传(3)', uploadCount === 3, `uploads=${uploadCount}`);

// ── 场景 3：取消 ──
await pickCoverFile();
await page.click('#btnCropCancel');
await sleep(200);
const coverVal3 = await page.$eval('#fCover', el => el.value);
const modalHidden = await page.$eval('#coverCropModal', el => el.style.display === 'none');
check('「取消」关闭对话框且封面不变', modalHidden && coverVal3 === coverVal2, coverVal3);

check('全程无页面错误', pageErrors.length === 0, pageErrors.join('; '));
check('上传总数符合预期(4)', uploadCount === 4, `uploads=${uploadCount}`);

// ── 场景 4：本地无法解码（如 HEIC）→ 自动回退服务器图；服务器图也失败 → 直接落地上传结果 ──
await page.click('#btnCoverUpload');
await sleep(100);
const inputEl4 = await page.$('#fileInput');
await inputEl4.uploadFile(BAD);
await sleep(4000); // 等待 本地解码失败 → 回退 cdn.example.com（不可达）→ 二次失败 → 落地
const coverVal4 = await page.$eval('#fCover', el => el.value);
const modalHidden4 = await page.$eval('#coverCropModal', el => el.style.display === 'none');
check('无法解码时回退使用上传结果', modalHidden4 && coverVal4 === uploadedUrls[4], coverVal4);
check('回退路径上传总数(5)', uploadCount === 5, `uploads=${uploadCount}`);
check('回退路径无页面错误', pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
