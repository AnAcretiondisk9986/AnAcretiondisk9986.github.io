/**
 * 发布中心（同步状态卡 / 推送预览 / 拉取预览）浏览器冒烟测试。
 *
 * 前置：管理面板已在 http://localhost:4322 运行（npm run admin）。
 * 测试会拦截全部 /api/ 请求并返回固定夹具，不会执行任何真实 git 推送或拉取。
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failures += 1;
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify(body),
});

const pendingPreview = {
  files: [
    { path: 'src/content/blog/demo.md', status: 'modified', additions: 12, deletions: 3 },
    { path: 'src/data/gallery.json', status: 'modified', additions: 2, deletions: 0 },
  ],
  fileCount: 2,
  insertions: 14,
  deletions: 3,
  binary: 0,
};

let statusMode = 'clean';
let pushCount = 0;
let pullCount = 0;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.dismiss());

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = new URL(req.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return req.continue();

  if (path === '/api/posts') return req.respond(json([]));
  if (path === '/api/operations') {
    return req.respond(json({
      ok: true,
      operations: [
        { id: '1', time: new Date().toISOString(), requestId: 'abc123', action: 'pull', status: 'skipped', message: '本地领先远端 1 个提交（有未推送内容），无需拉取' },
      ],
    }));
  }
  if (path === '/api/sync/status') {
    if (statusMode === 'error') {
      return req.respond(json({ ok: false, state: 'sync-error', stateLabel: '同步检查失败', code: 'SYNC_STATUS_FAILED', error: '无法连接远端（网络或鉴权问题），请稍后重试', requestId: 'err123' }, 500));
    }
    return req.respond(json({
      ok: true,
      state: 'dirty',
      stateLabel: '有未提交的修改',
      branch: 'main',
      upstream: 'origin/main',
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      dirty: true,
      dirtyCount: 2,
      unmerged: 0,
      files: pendingPreview.files,
      fetched: url.searchParams.get('fetch') === '1',
      fetchError: null,
      checkedAt: new Date().toISOString(),
      autoPull: false,
      requestId: 'st123',
    }));
  }
  if (path === '/api/sync/preview') {
    const kind = url.searchParams.get('kind') === 'full' ? 'full' : 'content';
    return req.respond(json({
      ok: true,
      requestId: 'pv123',
      kind,
      kindLabel: kind === 'full' ? '全量推送' : '内容推送',
      preview: pendingPreview,
      state: 'dirty',
      stateLabel: '有未提交的修改',
      ahead: 0,
      behind: 0,
      hasUpstream: true,
      branch: 'main',
      upstream: 'origin/main',
    }));
  }
  if (path === '/api/sync/pull-preview') {
    return req.respond(json({
      ok: true,
      requestId: 'pp123',
      hasUpstream: true,
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 2,
      commits: ['a1b2c3d 通过管理面板更新博客', 'e4f5a6b 新增文章'],
      stat: ' 2 files changed, 10 insertions(+)',
      dirty: false,
      dirtyCount: 0,
    }));
  }
  if (path === '/api/push' && req.method() === 'POST') {
    pushCount += 1;
    return req.respond(json({ ok: true, success: true, requestId: 'push123', message: '推送成功，网站即将更新', preview: pendingPreview }));
  }
  if (path === '/api/push-full' && req.method() === 'POST') {
    pushCount += 1;
    return req.respond(json({ ok: true, success: true, requestId: 'pushfull123', message: '推送成功，网站即将更新', preview: pendingPreview }));
  }
  if (path === '/api/pull' && req.method() === 'POST') {
    pullCount += 1;
    return req.respond(json({ ok: true, success: true, requestId: 'pull123', status: 'pulled', message: '已从远端拉取 2 个提交并完成同步', ahead: 0, behind: 0 }));
  }
  return req.respond(json({ ok: true }));
});

const clickButtonByText = async (texts) => {
  const clicked = await page.evaluate((list) => {
    const buttons = [...document.querySelectorAll('#syncModalActions button')];
    const target = buttons.find((b) => list.some((t) => b.textContent.includes(t)));
    if (target) { target.click(); return target.textContent; }
    return null;
  }, texts);
  return clicked;
};

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#syncCard', { timeout: 10000 });
  await sleep(700);

  // 1. 状态卡渲染
  const cardState = await page.$eval('#syncState', (el) => el.textContent.trim());
  const cardMeta = await page.$eval('#syncMeta', (el) => el.textContent.trim());
  check('同步状态卡显示状态文案', cardState.includes('有未提交的修改'), cardState);
  check('同步状态卡显示分支与待提交数量', cardMeta.includes('main') && cardMeta.includes('2'), cardMeta);

  // 2. 点击「推送」打开预览，展示待提交文件（不立即推送）
  await page.click('#btnPush');
  await page.waitForFunction(() => document.querySelector('#syncModalBody')?.textContent.includes('将提交以下文件'), { timeout: 8000 });
  const previewText = await page.$eval('#syncModalBody', (el) => el.textContent);
  check('推送预览列出待提交文件', previewText.includes('src/content/blog/demo.md') && previewText.includes('src/data/gallery.json'));
  check('推送预览未直接触发推送', pushCount === 0, `push=${pushCount}`);

  // 3. 确认推送 → 调用接口并显示结果
  const confirmLabel = await clickButtonByText(['确认推送']);
  check('预览弹窗存在确认推送按钮', Boolean(confirmLabel), confirmLabel || '');
  await page.waitForFunction(() => document.querySelector('#syncModalBody')?.textContent.includes('推送成功'), { timeout: 8000 });
  check('确认后执行一次推送并显示结果', pushCount === 1, `push=${pushCount}`);

  // 4. 拉取预览
  await sleep(700);
  await page.evaluate(() => { document.querySelector('#syncModal').style.display = 'none'; });
  await page.click('#btnPull');
  await page.waitForFunction(() => document.querySelector('#syncModalBody')?.textContent.includes('远端待拉取'), { timeout: 8000 });
  const pullText = await page.$eval('#syncModalBody', (el) => el.textContent);
  check('拉取预览显示远端提交数', pullText.includes('2 个提交'), pullText.slice(0, 80));
  check('拉取预览未直接触发拉取', pullCount === 0, `pull=${pullCount}`);
  await clickButtonByText(['确认拉取']);
  await page.waitForFunction(() => document.querySelector('#syncModalBody')?.textContent.includes('拉取结果'), { timeout: 8000 });
  check('确认后执行一次拉取', pullCount === 1, `pull=${pullCount}`);

  // 5. 同步检查失败时状态卡进入 error 状态
  await sleep(700);
  await page.evaluate(() => { document.querySelector('#syncModal').style.display = 'none'; });
  statusMode = 'error';
  await page.click('#btnSyncRefresh');
  await page.waitForFunction(() => document.querySelector('#syncDot')?.dataset.state === 'sync-error', { timeout: 8000 });
  const errState = await page.$eval('#syncState', (el) => el.textContent.trim());
  check('同步检查失败时状态卡显示失败', errState.includes('失败'), errState);

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} catch (err) {
  check('测试流程未抛异常', false, err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
