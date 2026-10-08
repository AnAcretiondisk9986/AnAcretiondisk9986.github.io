// 首页 Hero 大标题排版回归
//
// 背景：首页标题是「欢迎来到Blog.Acretiondisk.top / 这是我的个人网站」这样的
// 中英混排文案，词间没有空格。若字号超过「标题可用宽 / 最长不可断片段宽度」，
// 拉丁串会横向溢出，被 .fusion-hero 的 overflow:hidden 裁掉（390px 下曾把
// 「.top」整段吃掉）；字距/行高过紧则会让中文字形相贴。
//
// 用法（与 verify-catalog-title.mjs 同套路）：
//   1) npm run build
//   2) headless Chrome 带 CDP：
//      chrome --headless=new --remote-debugging-port=9224 --user-data-dir=<临时目录>
//   3) node scripts/verify-hero-title.mjs
//   （脚本会自行启动 scripts/static-server.mjs，端口 8766）
import { spawn } from 'node:child_process';

const CDP_HTTP = 'http://127.0.0.1:9224';
const PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}/`;

async function newTab(url) {
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      ws,
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
    });
    ws.onerror = reject;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result.value;
}

// 页面内测量：逐字符还原真实断行 + 字号/字距/行高与裁切量
const MEASURE = `(() => {
  const h1 = document.querySelector('.fusion-hero h1');
  if (!h1) return { missing: true };
  const cs = getComputedStyle(h1);
  const box = h1.getBoundingClientRect();
  const linesOf = (el) => {
    const text = el.textContent;
    const node = el.firstChild;
    if (!node) return [];
    const lines = [];
    let lastTop = null;
    for (let i = 0; i < text.length; i++) {
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + 1);
      const rect = r.getBoundingClientRect();
      const top = Math.round(rect.top);
      if (lastTop === null || Math.abs(top - lastTop) > 2) {
        lines.push({ text: '', right: 0 });
        lastTop = top;
      }
      const cur = lines[lines.length - 1];
      cur.text += text[i];
      cur.right = Math.max(cur.right, rect.right);
    }
    return lines.map((l) => ({ text: l.text, right: +l.right.toFixed(2) }));
  };
  const span = h1.querySelector('span');
  const em = h1.querySelector('em');
  const lines = [...linesOf(span), ...linesOf(em)];
  const fontSize = parseFloat(cs.fontSize);
  const lineHeight = parseFloat(cs.lineHeight);
  const letterSpacing = parseFloat(cs.letterSpacing) || 0;
  const tokens = (span.textContent.match(/[0-9A-Za-z][0-9A-Za-z._-]*/g) || []).sort((a, b) => b.length - a.length);
  const longestToken = tokens[0] || '';
  // token 是否完整出现在某一行（词内断行检测）；若断行则必须断在 '.' 之后
  const tokenWhole = longestToken ? lines.some((l) => l.text.includes(longestToken)) : true;
  const dotSafeBreak = longestToken
    ? lines.some((l) => l.text.endsWith('.') && longestToken.startsWith(l.text.replace(/^.*?([0-9A-Za-z._-]+)$/, '$1')))
    : true;
  return {
    missing: false,
    lineCount: lines.length,
    lines: lines.map((l) => l.text),
    fontSize, lineHeight, letterSpacing,
    lineHeightRatio: +(lineHeight / fontSize).toFixed(3),
    letterSpacingRatio: +(Math.abs(letterSpacing) / fontSize).toFixed(4),
    boxRight: +box.right.toFixed(2),
    boxWidth: +box.width.toFixed(1),
    maxLineRight: +Math.max(...lines.map((l) => l.right)).toFixed(2),
    overflowPx: +(Math.max(...lines.map((l) => l.right)) - box.right).toFixed(2),
    longestToken, tokenWhole, dotSafeBreak,
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    theme: document.documentElement.dataset.visualTheme,
  };
})()`;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function assertViewport(label, m) {
  check(`[${label}] 标题未被 hero 裁切（最右缘在标题盒内）`, m.overflowPx <= 0.5, `溢出 ${m.overflowPx}px / 标题盒宽 ${m.boxWidth}px`);
  check(`[${label}] 长词「${m.longestToken}」未被词内折断`, m.tokenWhole || m.dotSafeBreak,
    m.tokenWhole ? '整串完整' : (m.dotSafeBreak ? '断在点号后' : '词内断裂'));
  check(`[${label}] 行高不粘连（≥1.05）`, m.lineHeightRatio >= 1.05, `line-height/font-size = ${m.lineHeightRatio}`);
  check(`[${label}] 字距未被过度压缩（|ls| ≤ 0.03em）`, m.letterSpacingRatio <= 0.03, `${m.letterSpacing}px @ ${m.fontSize}px`);
  check(`[${label}] 文档无横向溢出`, m.docOverflowX <= 1, `${m.docOverflowX}px`);
}

async function main() {
  const server = spawn(process.execPath, ['scripts/static-server.mjs', 'dist', String(PORT)], { stdio: 'ignore' });
  server.on('error', () => {});
  await sleep(700);

  let tab;
  try {
    tab = await newTab(BASE);
  } catch (e) {
    console.error('无法连接 CDP（' + CDP_HTTP + '）。请先启动 headless Chrome：');
    console.error('  chrome --headless=new --remote-debugging-port=9224 --user-data-dir=<临时目录>');
    server.kill();
    process.exit(2);
  }
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');

  const viewports = [1920, 1600, 1440, 1180, 1000, 900, 820, 721, 720, 600, 430, 390, 360];
  for (const w of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await evalJs(cdp, `location.reload(); true`).catch(() => {});
    await sleep(900);
    await evalJs(cdp, `document.fonts.ready.then(() => true)`).catch(() => {});
    await sleep(250);
    const m = await evalJs(cdp, MEASURE);
    if (m.missing) { check(`[${w}px] 首页存在 .fusion-hero h1`, false); continue; }
    assertViewport(`${w}px`, m);
    console.log(`      ${m.lineCount} 行：${m.lines.map((l) => `「${l}」`).join(' / ')}`);
  }

  // 五个视觉主题一致性（字号与换行结构应完全一致）
  const themeSig = [];
  for (const theme of ['cyanotype', 'still', 'fluid', 'minimal', 'trace']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evalJs(cdp, `location.reload(); true`).catch(() => {});
    await sleep(900);
    await evalJs(cdp, `document.documentElement.dataset.visualTheme = ${JSON.stringify(theme)}; true`);
    await sleep(300);
    const m = await evalJs(cdp, MEASURE);
    themeSig.push({ theme, fontSize: m.fontSize, lineCount: m.lineCount, overflowPx: m.overflowPx });
    check(`[主题 ${theme}] 标题未裁切`, m.overflowPx <= 0.5, `溢出 ${m.overflowPx}px，${m.lineCount} 行 @ ${m.fontSize}px`);
  }
  const sig = themeSig[0];
  check('五套视觉主题标题排版一致', themeSig.every((t) => t.fontSize === sig.fontSize && t.lineCount === sig.lineCount),
    themeSig.map((t) => `${t.theme}:${t.fontSize}px/${t.lineCount}行`).join(' | '));

  await cdp.send('Page.close').catch(() => {});
  server.kill();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败:', e); process.exit(1); });
