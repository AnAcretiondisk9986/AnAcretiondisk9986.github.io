import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failures++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });

// 拦截上传与保存，避免真实 git push / 写文件
let uploadCount = 0, savedBody = null;
await page.setRequestInterception(true);
page.on('request', req => {
  const u = req.url();
  if (u.endsWith('/api/upload') && req.method() === 'POST') {
    uploadCount++;
    req.respond({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ success: true, url: `https://cdn.example.com/img/${uploadCount}.webp`, pushed: true }) });
  } else if (u.endsWith('/api/posts') && req.method() === 'POST') {
    try { savedBody = new URLSearchParams(req.postData() || ''); } catch(e) {}
    req.respond({ status: 201, contentType: 'application/json', body: JSON.stringify({ slug: 'test-post' }) });
  } else req.continue();
});

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.text().includes('COLOR_DBG')) console.log('页面:', m.text()); if (m.type() === 'error' && !m.text().includes('Failed to load resource')) pageErrors.push('console: ' + m.text()); });
page.on('dialog', d => d.dismiss()); // 模式切换确认框：headless 下自动取消

await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
await page.click('#btnNew');
await page.waitForSelector('.toastui-editor-defaultUI', { timeout: 15000 });
check('TOAST UI 编辑器渲染', true);

// ── 场景 1: Markdown 模式 + 标准解析(HTML 内 Markdown) ──
const md = '这是**加粗**文字。\n\n<span style="color: red">**红色粗体**</span>\n\n![测试图](https://cdn.example.com/x.png)';
await page.evaluate(mdText => { editor.setMarkdown(mdText); }, md);
await sleep(800);
const previewHtml = await page.evaluate(() => {
  const pv = document.querySelector('.toastui-editor-md-preview .toastui-editor-contents') ||
             document.querySelector('.toastui-editor-contents');
  return pv ? pv.innerHTML : '';
});
console.log('预览内容:', previewHtml.slice(0, 400));
check('预览渲染 <strong>', /<strong[^>]*>加粗<\/strong>/.test(previewHtml), previewHtml.slice(0, 120));
check('span 内 Markdown 按标准解析(strong)', /<span[^>]*style="color:[^"]*"[^>]*>[\s\S]*?<strong[^>]*>红色粗体<\/strong>/.test(previewHtml), previewHtml.match(/<span[^>]*>.*?红色粗体<\/strong>/)?.slice(0, 90) || '无');
check('markdown 图片渲染', /<img[^>]*x\.png/.test(previewHtml), (previewHtml.match(/<img[^>]*>/) || ['无'])[0].slice(0, 90));

// ── 场景 2: 颜色按钮(富文本模式真实交互:选中文字 → 点颜色) ──
await page.evaluate(() => { editor.setMarkdown('待着色文字测试'); });
await sleep(800);
await page.click('#viewSwitch button[data-view="wysiwyg"]');
await sleep(800);
const wwBox = await page.evaluate(() => {
  const el = document.querySelector('.toastui-editor-ww-container');
  const r = el.getBoundingClientRect();
  return { x: r.x + 50, y: r.y + 30 };
});
await page.mouse.click(wwBox.x, wwBox.y);
await sleep(300);
await page.keyboard.down('Control');
await page.keyboard.press('KeyA');
await page.keyboard.up('Control');
await sleep(300);
const selText = await page.evaluate(() => (window.getSelection() || {}).toString() || '');
check('富文本全选生效', selText.length > 0, selText);
const btnInfo = await page.evaluate(() => {
  const b = document.querySelector('[data-fmt="color"][data-color="#c06050"]');
  if (!b) return { exists: false };
  const r = b.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { exists: true, onclickType: typeof b.onclick, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, topEl: top ? top.className.toString().slice(0, 60) : '' };
});
console.log('按钮诊断:', JSON.stringify(btnInfo));
await page.click('[data-fmt="color"][data-color="#c06050"]');
await sleep(800);
const colorDiag = await page.evaluate(() => {
  const sel = window.getSelection();
  return {
    md: editor.getMarkdown().slice(0, 200),
    html: editor.getHTML().slice(0, 200),
    mode: document.querySelector('#viewSwitch button.active')?.dataset.view,
    selAfter: sel ? sel.toString() : '',
    activeEl: document.activeElement ? document.activeElement.className.toString().slice(0, 60) : '',
  };
});
check('颜色命令生成 span 样式', /<span[^>]*color[^>]*>[\s\S]*<\/span>/.test(colorDiag.md), JSON.stringify(colorDiag));
await page.click('#viewSwitch button[data-view="split"]');
await sleep(500);

// ── 场景 3: 富文本模式切换 ──
await page.click('#viewSwitch button[data-view="wysiwyg"]');
await sleep(800);
const isWysiwyg = await page.evaluate(() => {
  const act = document.querySelector('#viewSwitch button.active');
  const ww = document.querySelector('.toastui-editor-ww-container');
  return {
    active: act ? act.dataset.view : '无',
    wwVisible: ww ? getComputedStyle(ww).display : '无容器',
    mdVisible: (() => { const m = document.querySelector('.toastui-editor-md-container'); return m ? getComputedStyle(m).display : '无'; })(),
  };
});
check('切换到富文本模式', isWysiwyg.active === 'wysiwyg', JSON.stringify(isWysiwyg));
await page.click('#viewSwitch button[data-view="split"]');
await sleep(800);
const backMd = await page.evaluate(() => {
  const act = document.querySelector('#viewSwitch button.active');
  return act && act.dataset.view === 'split';
});
check('切回分屏(源码)模式', backMd);

// ── 场景 4: 视频插入(自动切回源码模式) ──
await page.click('#viewSwitch button[data-view="wysiwyg"]');
await sleep(500);
await page.click('#btnInsertVideo');
await page.waitForSelector('#videoModal[style*="flex"]', { timeout: 3000 }).catch(() => {});
await page.type('#fVideoInput', 'https://www.bilibili.com/video/BV1GJ411x7h7');
await page.click('#btnVideoInsert');
await sleep(500);
const mdWithVideo = await page.evaluate(() => editor.getMarkdown());
check('视频插入 iframe 且已切回源码', mdWithVideo.includes('iframe') && mdWithVideo.includes('BV1GJ411x7h7'), mdWithVideo.slice(0, 100));
const modeAfterVideo = await page.evaluate(() => {
  const act = document.querySelector('#viewSwitch button.active');
  return act && act.dataset.view === 'wysiwyg' ? 'wysiwyg' : 'markdown';
});
check('插入后自动回到源码模式', modeAfterVideo === 'markdown', modeAfterVideo);

// ── 场景 5: 图片上传插入(走现有上传管线) ──
await page.click('#btnCoverUpload'); // 不行,这是封面;用 upload-area
await page.click('#uploadArea');
await sleep(100);
const inputEl = await page.$('#fileInput');
await inputEl.uploadFile('C:/Users/AnAcretiondisk/AppData/Local/Temp/crop-test.png');
await sleep(1500);
const mdWithImg = await page.evaluate(() => editor.getMarkdown());
check('图片上传后插入编辑器', mdWithImg.includes('https://cdn.example.com/img/1.webp'), 'includes=' + mdWithImg.includes('https://cdn.example.com/img/1.webp') + ' tail=' + mdWithImg.slice(-120));
check('上传请求发出', uploadCount >= 1, `uploads=${uploadCount}`);

// ── 场景 6: 保存(getMarkdown 提交) ──
await page.type('#fTitle', 'E2E 测试文章');
await page.click('#btnSave');
await sleep(1500);
check('保存请求发出且 content 为 Markdown', !!savedBody, savedBody ? savedBody.get('content')?.slice(0, 60) : '未拦截');
if (savedBody) {
  const c = savedBody.get('content') || '';
  check('保存内容含 markdown 语法', c.includes('**') || c.includes('!['), c.slice(0, 80));
}

check('全程无页面错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await browser.close();
console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
