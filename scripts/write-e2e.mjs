/**
 * 手机端发文助手（/write/）浏览器端冒烟测试：
 * 启动 astro preview 静态预览服务，以 390x844 移动端视口打开 /write/，
 * 拦截 api.github.com 请求，测试配置 PAT、移动编辑与源码互切、相册选图压缩上传、元数据与一键发布上线。
 */
import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + String(extra).slice(0, 140) + ']' : ''));
  if (!cond) failures += 1;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const staticSrv = http.createServer(async (req, res) => {
  const cleanPath = (req.url || '/').split('?')[0];
  let target = resolve(DIST, `.${cleanPath}`);
  if (!target.startsWith(DIST)) { res.statusCode = 403; res.end(); return; }
  try {
    const st = await stat(target).catch(() => null);
    if (st?.isDirectory()) target = join(target, 'index.html');
    const data = await readFile(target);
    res.setHeader('Content-Type', MIME[extname(target).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise((r) => staticSrv.listen(0, '127.0.0.1', r));
const port = staticSrv.address().port;

const tmp = await mkdtemp(join(tmpdir(), 'write-e2e-'));
// 2x2 PNG fixture
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQzwAEjDAGggAAI3gD/QG3z/UAAAAASUVORK5CYII=',
  'base64',
);
const photoPath = join(tmp, 'mobile-shot.png');
await writeFile(photoPath, PNG_BYTES);

let uploadedImgName = '';
let committedPostPath = '';
let committedPostContent = '';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (d) => d.accept());

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('https://api.github.com/')) return req.continue();
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers });

    if (url.includes('/contents/src/content/blog') && req.method() === 'GET') {
      return req.respond({ status: 200, headers, body: JSON.stringify([{ name: 'hello.md', type: 'file', sha: 'sha1' }]) });
    }
    if (url.includes('/blog-images/contents/image/') && req.method() === 'PUT') {
      uploadedImgName = decodeURIComponent(url.split('/').pop() || '');
      return req.respond({ status: 201, headers, body: JSON.stringify({ content: { name: uploadedImgName, sha: 'imgsha1' } }) });
    }
    if (url.includes('/contents/src/content/blog/') && req.method() === 'PUT') {
      committedPostPath = decodeURIComponent(url.split('/contents/')[1]);
      const payload = JSON.parse(req.postData() || '{}');
      committedPostContent = Buffer.from(payload.content || '', 'base64').toString('utf8');
      return req.respond({ status: 201, headers, body: JSON.stringify({ content: { sha: 'postsha2' } }) });
    }
    if (url.includes('/actions/runs')) {
      return req.respond({ status: 200, headers, body: JSON.stringify({ workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'https://github.com' }] }) });
    }
    return req.respond({ status: 200, headers, body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${port}/write/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.mw-prosemirror', { timeout: 15000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('390px 手机端无横向溢出', overflow <= 1, `overflow=${overflow}`);
  check('手机端键盘吸顶工具条已渲染', (await page.$$('#mwAccessoryBar .mw-tool-btn')).length >= 10);

  // 配置 PAT
  await page.click('#btnMwSettings');
  await sleep(150);
  await page.type('#mwPatInput', 'github_pat_mock_token');
  await page.click('#btnMwSavePat');
  await sleep(300);
  check('PAT 配置保存并校验通过', await page.$eval('#mwSettingsSheet', (el) => el.hidden));

  // 输入标题与正文排版
  await page.type('#mwTitle', '手机端测试博文');
  await page.click('.mw-prosemirror');
  await page.keyboard.type('手机上直接打字非常跟手。');
  await page.click('[data-mcmd="center"]');
  await sleep(150);

  // 上传手机照片（经 Canvas 压缩后上传）
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 8000 }),
    page.click('#btnMwPhoto'),
  ]);
  await chooser.accept([photoPath]);
  await sleep(900);
  check('手机选图经压缩上传到 blog-images', Boolean(uploadedImgName) && /\.(webp|jpg)$/i.test(uploadedImgName), uploadedImgName);

  // 切换源码模式查看生成结果
  await page.click('[data-mcmd="source"]');
  await sleep(200);
  const srcVal = await page.$eval('#mwSourceInput', (el) => el.value);
  check('所见即所得切换至源码模式保留居中与图片链接', srcVal.includes('text-align: center') && srcVal.includes('cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/'), srcVal);

  // 切回所见即所得
  await page.click('[data-mcmd="source"]');
  await sleep(200);

  // 打开元数据抽屉设置标签与权限
  await page.click('#mwMetaSummary');
  await sleep(150);
  await page.type('#mwTags', '手机写作, PWA');
  await page.select('#mwAccess', 'authorized');
  await page.click('#mwMetaSheet [data-close-sheet]');
  await sleep(150);

  // 点击发布
  await page.click('#btnMwPublish');
  await sleep(500);
  check('一键提交发布到 GitHub blog 目录', committedPostPath.startsWith('src/content/blog/'), committedPostPath);
  check('提交文件包含完整 frontmatter 与正文', committedPostContent.includes('title: "手机端测试博文"') && committedPostContent.includes('access: authorized') && committedPostContent.includes('blog-images'), committedPostContent.slice(0, 140));
  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
  staticSrv.close();
  await sleep(150);
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
