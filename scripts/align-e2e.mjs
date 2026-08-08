import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failures++;
};

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('dialog', d => d.accept()); // 模式切换确认框:接受

await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
await page.click('#btnNew');
await page.waitForSelector('.toastui-editor-defaultUI', { timeout: 15000 });
await page.evaluate(() => {
  editor.setMarkdown('第一行文字\n第二行居中候选\n第三行文字');
});
await sleep(800);

// 聚焦编辑区并用 API 把光标定位到第二行(offset=第一行长度+1)
const box = await page.evaluate(() => {
  const r = document.querySelector('.toastui-editor-md-container').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + 60 };
});
await page.mouse.click(box.x, box.y);
await sleep(300);
const cursorSet = await page.evaluate(() => {
  try {
    editor.setSelection([2, 0], [2, 0]); // MdPos = [line, col]，1-based 行
    return { ok: true, sel: JSON.stringify(editor.getSelection()) };
  } catch(e) { return { ok: false, err: String(e) }; }
});
console.log('光标定位:', JSON.stringify(cursorSet));
await sleep(300);

// 点居中
await page.click('[data-align="center"]');
await sleep(800);
const md1 = await page.evaluate(() => editor.getMarkdown());
check('居中包裹 div', /<div style="text-align: center">第二行居中候选<\/div>/.test(md1), md1);

// 再点居右(重复点击应剥除旧 div；先重新定位光标到第二行)
await page.evaluate(() => { editor.setSelection([2, 0], [2, 0]); });
await sleep(200);
await page.click('[data-align="right"]');
await sleep(800);
const md2 = await page.evaluate(() => editor.getMarkdown());
check('重复点击切换对齐(剥旧 div)', /<div style="text-align: right">第二行居中候选<\/div>/.test(md2) && !md2.includes('text-align: center'), md2);

// 富文本模式点击 → 自动切回源码(光标随模式切换保留在第二行)
await page.click('#viewSwitch button[data-view="wysiwyg"]');
await sleep(800);
await page.click('[data-align="left"]');
await sleep(800);
const md3 = await page.evaluate(() => {
  const act = document.querySelector('#viewSwitch button.active');
  return { md: editor.getMarkdown(), view: act ? act.dataset.view : '' };
});
check('富文本点击自动切回源码', md3.view === 'edit', md3.view);
check('切回后执行了居左包裹', /<div style="text-align: left">[^<]*文字<\/div>/.test(md3.md), md3.md.slice(0, 100));

// 空段落包裹(光标在末尾空行)
await page.evaluate(() => { editor.setMarkdown('第一段\n\n第三段'); });
await sleep(600);
await page.mouse.click(box.x, box.y + 100);
await sleep(300);
await page.keyboard.down('Control');
await page.keyboard.press('End');
await page.keyboard.up('Control');
await sleep(150);
await page.click('[data-align="center"]');
await sleep(600);
const md4 = await page.evaluate(() => editor.getMarkdown());
check('空段落包裹不报错', md4.includes('text-align: center'), md4);

check('无页面错误', errs.length === 0, errs.join(' | ').slice(0, 200));
await browser.close();
console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
