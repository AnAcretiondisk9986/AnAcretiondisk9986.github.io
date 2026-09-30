/**
 * 编辑器（Vditor）冒烟测试：初始化、四种视图切换、原始 HTML 保真、视频/音乐插入。
 *
 * 前置：管理面板已在 http://localhost:4322 运行。测试拦截 /api/，不写文件。
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

const post = {
  slug: 'EditorSmoke', title: '编辑器冒烟', description: '', pubDate: '2026-09-30', dayIndex: 1,
  tags: [], draft: false, access: 'public', archived: false, excerpt: '', astroId: 'editorsmoke',
  hasPublicPage: true, publicUrl: 'https://blog.acretiondisk.top/blog/editorsmoke/', shortUrl: 'https://blog.acretiondisk.top/s/abc',
};

let savedBody = null;

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
  if (path === '/api/posts' && req.method() === 'GET') return req.respond(json([post]));
  if (path === '/api/posts' && req.method() === 'POST') {
    try { savedBody = new URLSearchParams(req.postData() || ''); } catch { savedBody = null; }
    return req.respond(json({ success: true, slug: 'EditorSmoke', contentHash: 'b'.repeat(64) }));
  }
  if (path.startsWith('/api/posts/') && req.method() === 'GET') return req.respond(json({ ...post, contentHash: 'a'.repeat(64), content: '# 标题\n\n正文', cover: '' }));
  if (path === '/api/sync/status') return req.respond(json({ ok: true, state: 'clean', stateLabel: '工作区干净', branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirtyCount: 0, dirty: false, files: [] }));
  if (path === '/api/upload' && req.method() === 'POST') return req.respond(json({ success: true, url: 'https://cdn.example.com/image/pasted.webp' }, 201));
  return req.respond(json({ ok: true }));
});

try {
  await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList .post-item', { timeout: 15000 });
  await page.click('#btnNew');
  await page.waitForSelector('.vditor', { timeout: 15000 });
  await page.waitForFunction(() => window.vditor && window.vditor.vditor && window.vditor.vditor.lute, { timeout: 15000 });
  await sleep(500);

  check('Vditor 初始化并进入即时渲染', (await page.evaluate(() => window.vditor.getCurrentMode())) === 'ir');
  check('内置工具栏已渲染', (await page.$$('#vditorEditor .vditor-toolbar__item')).length > 10);

  // 专注模式 / 大纲
  await page.click('#btnFocusMode');
  await sleep(300);
  check('专注模式隐藏侧栏', await page.$eval('body', (el) => el.classList.contains('focus-mode')));
  await page.click('#btnFocusMode');
  await sleep(300);
  check('退出专注模式', !(await page.$eval('body', (el) => el.classList.contains('focus-mode'))));
  check('大纲按钮存在', Boolean(await page.$('#btnOutline')));
  await page.click('#btnTypewriter');
  await sleep(250);
  check('打字机模式可开启', await page.$eval('#btnTypewriter', (el) => el.classList.contains('primary')));
  await page.click('#btnTypewriter');
  await sleep(250);
  check('打字机模式可关闭', !(await page.$eval('#btnTypewriter', (el) => el.classList.contains('primary'))));

  // 原始 HTML 保真：Vditor 以 Markdown 为事实来源，块级 HTML 不被改写
  const md = [
    '开头段落，确保渲染路径稳定。',
    '',
    '## 小标题',
    '',
    '<div style="text-align:center">居中段落</div>',
    '',
    '<div class="video-embed"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7"></iframe></div>',
    '',
    '<div class="song-player" data-src="https://cdn.example.com/audio/a.mp3" data-title="测试曲"><a href="https://cdn.example.com/audio/a.mp3">♪ 播放音频</a></div>',
    '',
    '正文含 <mark>高亮</mark> 与 <u>下划线</u>。',
  ].join('\n');
  await page.evaluate((text) => window.editor.setMarkdown(text), md);
  await page.waitForFunction(() => (window.editor.getMarkdown() || '').includes('song-player'), { timeout: 10000 });
  await sleep(500);
  const srcBack = await page.evaluate(() => window.editor.getMarkdown());
  check('Markdown 源码保持原样', srcBack.includes('<div style="text-align:center">') && srcBack.includes('song-player') && srcBack.includes('<mark>'), srcBack.slice(0, 80).replace(/\n/g, ' '));

  // 分屏模式可切换（预览渲染细节由 Vditor/Lute 处理，本地预览弹窗已单独覆盖）
  await page.click('#viewSwitch [data-view="sv"]');
  await page.waitForFunction(() => window.vditor.getCurrentMode() === 'sv', { timeout: 8000 });
  check('切换到分屏模式', (await page.evaluate(() => window.vditor.getCurrentMode())) === 'sv');
  await page.click('#viewSwitch [data-view="ir"]');
  await sleep(400);

  // 视图切换
  for (const [view, expected] of [['sv', 'sv'], ['wysiwyg', 'wysiwyg'], ['source', 'sv'], ['ir', 'ir']]) {
    await page.click(`#viewSwitch [data-view="${view}"]`);
    await sleep(500);
    check(`切换到「${view}」`, (await page.evaluate(() => window.vditor.getCurrentMode())) === expected);
  }
  await page.click('#viewSwitch [data-view="source"]');
  await sleep(400);
  check('源码模式隐藏预览', await page.$eval('#editorBody', (el) => el.classList.contains('acr-source-only')));
  await page.click('#viewSwitch [data-view="ir"]');
  await sleep(400);

  // 粘贴图片上传后应插入正文（Vditor 4 handler 契约回归防护）
  await page.evaluate(() => {
    const file = new File([new Uint8Array([1, 2, 3])], 'paste-test.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('#editorBody .vditor-ir .vditor-reset') || document.querySelector('.vditor-reset');
    target.focus();
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  });
  await page.waitForFunction(() => (window.editor.getMarkdown() || '').includes('pasted.webp'), { timeout: 12000 });
  check('粘贴图片上传后插入正文', (await page.evaluate(() => window.editor.getMarkdown())).includes('pasted.webp'));

  // 插入视频 / 音乐
  await page.click('#btnInsertVideo');
  await sleep(300);
  await page.type('#fVideoInput', 'https://www.bilibili.com/video/BV1GJ411x7h7');
  await page.click('#btnVideoInsert');
  await sleep(600);
  check('插入视频写入 video-embed', (await page.evaluate(() => window.editor.getMarkdown())).includes('video-embed'));

  await page.click('#btnInsertMusic');
  await sleep(300);
  await page.type('#fMusicSrc', 'https://cdn.example.com/audio/test.mp3');
  await page.click('#btnMusicInsert');
  await sleep(600);
  check('插入音乐写入 song-player', (await page.evaluate(() => window.editor.getMarkdown())).includes('song-player'));

  // 保存：提交 Markdown 源码
  await page.type('#fTitle', '编辑器冒烟');
  await page.click('#btnSave');
  await sleep(1000);
  check('保存提交 Markdown 源码', Boolean(savedBody) && (savedBody.get('content') || '').includes('video-embed') && (savedBody.get('content') || '').includes('song-player'), savedBody ? 'ok' : 'no save');

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
