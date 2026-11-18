/**
 * PC Word 级富文本编辑器（Tiptap）冒烟测试：
 * 初始化、Ribbon 工具栏、三视图切换、Word 排版格式（居中/高亮/下划线/缩进/Callout/表格/公式）、
 * 查找替换、粘贴图片上传、视频/音乐/书签插入与保存提交。
 *
 * 前置：管理面板已运行（默认 http://localhost:4322/admin，可通过 ADMIN_URL 覆盖）。拦截 /api/，不写文件。
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = process.env.ADMIN_URL || 'http://localhost:4322/admin';
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
  if (path === '/api/link-meta') return req.respond(json({ ok: true, url: 'https://example.com', title: '示例网页', description: '示例描述' }));
  return req.respond(json({ ok: true }));
});

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#postList .post-item', { timeout: 15000 });
  await page.click('#btnNew');
  await page.waitForSelector('[data-editor-ready="1"]', { timeout: 15000 });
  await sleep(300);

  check('Word 级 Tiptap 编辑器初始化成功', Boolean(await page.$('.acr-prosemirror')));
  check('Word 双行 Ribbon 工具栏已渲染', (await page.$$('#wordRibbon .btn')).length >= 20);

  // 专注模式 / 大纲 / 打字机
  await page.click('#btnFocusMode');
  await sleep(200);
  check('专注模式隐藏侧栏', await page.$eval('body', (el) => el.classList.contains('focus-mode')));
  await page.click('#btnFocusMode');
  await sleep(200);
  check('退出专注模式', !(await page.$eval('body', (el) => el.classList.contains('focus-mode'))));

  await page.click('#btnOutline');
  await sleep(200);
  check('大纲面板可展开', !(await page.$eval('#acrOutlinePane', (el) => el.hidden)));
  await page.click('#btnOutline');

  await page.click('#btnTypewriter');
  await sleep(150);
  check('打字机模式可开启', await page.$eval('#btnTypewriter', (el) => el.classList.contains('primary')));
  await page.click('#btnTypewriter');

  // Word 富排版与历史混写加载保真
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
    '正文含 <mark>高亮</mark> 与 <u>下划线</u> 与 $E=mc^2$。',
  ].join('\n');
  await page.evaluate((text) => window.editor.setMarkdown(text), md);
  await sleep(350);
  const srcBack = await page.evaluate(() => window.editor.getMarkdown());
  check(
    'Rich HTML 与公式双向保真',
    srcBack.includes('text-align: center')
      && srcBack.includes('video-embed')
      && srcBack.includes('song-player')
      && srcBack.includes('<mark>')
      && srcBack.includes('<u>')
      && srcBack.includes('data-tex="E=mc^2"'),
    srcBack.slice(0, 140).replace(/\n/g, ' '),
  );

  // 查找与替换
  await page.click('#btnFindReplace');
  await sleep(150);
  await page.type('#fFindQuery', '开头段落');
  await sleep(150);
  check('查找栏命中计数', (await page.$eval('#findCount', (el) => el.textContent)) === '1/1');
  await page.type('#fReplaceQuery', '起始段落');
  await page.click('#btnReplaceAll');
  await sleep(200);
  check('全部替换更新正文', (await page.evaluate(() => window.editor.getMarkdown())).includes('起始段落'));
  await page.click('#btnFindClose');

  // 三视图切换：wysiwyg / sv / source
  await page.click('#viewSwitch [data-view="sv"]');
  await sleep(250);
  check('切换到分屏模式显示源码与实时预览', !(await page.$eval('#acrSourcePane', (el) => el.hidden)) && !(await page.$eval('#acrPreviewPane', (el) => el.hidden)));
  await page.click('#viewSwitch [data-view="source"]');
  await sleep(200);
  check('切换到源码模式隐藏实时预览', !(await page.$eval('#acrSourcePane', (el) => el.hidden)) && (await page.$eval('#acrPreviewPane', (el) => el.hidden)));
  await page.click('#viewSwitch [data-view="wysiwyg"]');
  await sleep(250);
  check('切回所见即所得模式', !(await page.$eval('#acrWysiwygPane', (el) => el.hidden)));

  // 粘贴图片上传后插入正文
  await page.evaluate(() => {
    const file = new File([new Uint8Array([1, 2, 3])], 'paste-test.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('.acr-prosemirror');
    target.focus();
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  });
  await page.waitForFunction(() => (window.editor.getMarkdown() || '').includes('pasted.webp'), { timeout: 10000 });
  check('粘贴图片上传后插入正文', (await page.evaluate(() => window.editor.getMarkdown())).includes('pasted.webp'));

  // 插入视频 / 音乐 / 书签卡片
  await page.click('#btnInsertVideo');
  await sleep(200);
  await page.type('#fVideoInput', 'https://www.bilibili.com/video/BV1GJ411x7h7');
  await page.click('#btnVideoInsert');
  await sleep(300);
  check('插入视频写入 video-embed', (await page.evaluate(() => window.editor.getMarkdown())).includes('video-embed'));

  await page.click('#btnInsertMusic');
  await sleep(200);
  await page.type('#fMusicSrc', 'https://cdn.example.com/audio/test.mp3');
  await page.click('#btnMusicInsert');
  await sleep(300);
  check('插入音乐写入 song-player', (await page.evaluate(() => window.editor.getMarkdown())).includes('song-player'));

  await page.click('#btnInsertBookmark');
  await sleep(200);
  await page.type('#fBookmarkUrl', 'https://example.com');
  await page.click('#btnBookmarkFetch');
  await sleep(300);
  await page.click('#btnBookmarkInsert');
  await sleep(300);
  check('插入网页书签卡片写入 hz-bookmark', (await page.evaluate(() => window.editor.getMarkdown())).includes('hz-bookmark'));

  // 保存提交
  await page.type('#fTitle', '编辑器冒烟');
  await page.click('#btnSave');
  await sleep(700);
  check('保存提交完整 Markdown 源码', Boolean(savedBody) && (savedBody.get('content') || '').includes('video-embed') && (savedBody.get('content') || '').includes('song-player'), savedBody ? 'ok' : 'no save');

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('测试流程未抛异常', false, err.stack || err.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
