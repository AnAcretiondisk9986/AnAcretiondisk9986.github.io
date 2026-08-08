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
page.on('dialog', d => d.dismiss());

await page.goto('http://localhost:4322/admin', { waitUntil: 'networkidle0' });
await page.click('#btnNew');
await page.waitForSelector('.toastui-editor-defaultUI', { timeout: 15000 });

const md = [
  '<div class="video-embed"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7" title="测试" allowfullscreen loading="lazy"></iframe></div>',
  '',
  '<div class="song-player" data-src="https://cdn.example.com/music.mp3" data-title="测试歌曲" data-artist="歌手">♪ 播放音频</div>',
  '',
  '<div class="video-embed"><iframe src="https://music.163.com/outchain/player?type=2&id=123&height=66" frameborder="no"></iframe></div>',
].join('\n');
await page.evaluate(mdText => { editor.setMarkdown(mdText); }, md);
await sleep(1500);

const probe = await page.evaluate(() => {
  const pv = document.querySelector('.toastui-editor-md-preview .toastui-editor-contents');
  return {
    iframes: pv ? pv.querySelectorAll('iframe').length : -1,
    iframeSrcs: pv ? [...pv.querySelectorAll('iframe')].map(f => f.src.slice(0, 50)) : [],
    songs: pv ? pv.querySelectorAll('.song-player').length : -1,
    audios: pv ? pv.querySelectorAll('audio').length : -1,
    audioSrc: pv && pv.querySelector('audio') ? pv.querySelector('audio').src.slice(0, 60) : '',
    meta: pv && pv.querySelector('.music-embed-meta') ? pv.querySelector('.music-embed-meta').textContent : '',
  };
});
check('bilibili iframe 在预览中恢复', probe.iframes >= 2, `iframes=${probe.iframes}`);
check('iframe src 正确', probe.iframeSrcs[0].includes('bilibili'), probe.iframeSrcs.join('|'));
check('网易云 iframe 保留', probe.iframeSrcs[1].includes('music.163.com'), probe.iframeSrcs[1]);
check('song-player 渲染为播放条', probe.songs === 1 && probe.audios === 1, `songs=${probe.songs} audios=${probe.audios}`);
check('播放条元数据', probe.meta.includes('测试歌曲') && probe.meta.includes('歌手'), probe.meta);
check('audio src 正确', probe.audioSrc.includes('music.mp3'), probe.audioSrc);
check('无页面错误', errs.length === 0, errs.join(' | ').slice(0, 200));

// 危险属性过滤验证:onload 应被丢弃(轮询等待预览刷新)
await page.evaluate(() => {
  editor.setMarkdown('<iframe src="https://x.com/a" onload="alert(1)" srcdoc="<script>x</script>"></iframe>');
});
let safe = null;
for (let i = 0; i < 20; i++) {
  await sleep(400);
  safe = await page.evaluate(() => {
    const pv = document.querySelector('.toastui-editor-md-preview .toastui-editor-contents');
    const f = pv ? pv.querySelector('iframe') : null;
    return f ? { hasOnload: f.hasAttribute('onload'), hasSrcdoc: f.hasAttribute('srcdoc'), src: f.src } : null;
  });
  if (safe && safe.src.includes('x.com')) break;
}
check('危险属性被过滤', safe && !safe.hasOnload && !safe.hasSrcdoc && safe.src.includes('x.com'), JSON.stringify(safe));

await browser.close();
console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
