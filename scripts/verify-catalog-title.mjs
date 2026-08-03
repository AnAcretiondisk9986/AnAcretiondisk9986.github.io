// 验证文章列表：序号纯数字（无「文章/FOLIO」小字）+ 标题自适应字号
// 用法：先启动 scripts/static-server.mjs dist 8766 与 headless Chrome (CDP 9224)
const CDP_HTTP = 'http://127.0.0.1:9224';

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

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function verifyIndex(cdp, layout) {
  const seq = await evalJs(cdp, `(() => {
    const entries = [...document.querySelectorAll('.catalog-entry')];
    return {
      count: entries.length,
      seqs: entries.map((e) => e.querySelector('.catalog-index span')?.textContent.trim()),
      smalls: entries.map((e) => !!e.querySelector('.catalog-index small')),
    };
  })()`);
  check(`[${layout}] 序号为 01/02/03 格式`, seq.count > 0 && seq.seqs.every((s, i) => s === String(i + 1).padStart(2, '0')), JSON.stringify(seq.seqs.slice(0, 5)) + '…');
  check(`[${layout}] 序号下无「文章/FOLIO」小字`, seq.smalls.every((s) => !s));

  // ① 字体就绪后：真实标题全部完整展示（允许有内联微调）
  //    窄屏横栏内容列极窄（~130px），触达 12px 下限的极端长标题允许截断（物理边界）
  const real = await evalJs(cdp, `(() => {
    const h2s = [...document.querySelectorAll('.catalog-entry .catalog-content h2')];
    const entries = h2s.map((h) => ({
      fs: parseFloat(getComputedStyle(h).fontSize),
      inline: h.style.fontSize,
      fit: h.scrollHeight <= h.clientHeight + 1,
      atFloor: h.style.fontSize !== '' && parseFloat(getComputedStyle(h).fontSize) <= 12.01,
    }));
    const clipped = entries.filter((e) => !e.fit);
    return {
      clippedAllAtFloor: clipped.length > 0 && clipped.every((e) => e.atFloor),
      clippedCount: clipped.length,
      shrunk: entries.filter((e) => e.inline).map((e) => e.fs),
      heights: h2s.map((h) => h.getBoundingClientRect().height),
    };
  })()`);
  check(`[${layout}] 标题完整展示（或已达下限的物理边界）`, real.clippedCount === 0 || real.clippedAllAtFloor, real.clippedCount ? `${real.clippedCount} 条触达下限截断` : '全部完整');
  check(`[${layout}] 标题区容器高度统一`, real.heights.every((h) => Math.abs(h - real.heights[0]) < 1), `${real.heights[0]}px`);

  // ② 注入超长标题 → resize → 字号微调且完整展示
  //    窄屏横栏物理空间有限，注入长度按列宽自适应（恰好超出 2 行，又能在下限内放下）
  const fit = await evalJs(cdp, `(async () => {
    const h2s = [...document.querySelectorAll('.catalog-entry .catalog-content h2')];
    const target = h2s.find((h) => h.style.fontSize === '') || h2s[1];
    const base = parseFloat(getComputedStyle(target).fontSize);
    const lineH = getComputedStyle(target).lineHeight;
    const perLine = Math.floor(target.clientWidth / base) + 1; // 每行字数
    const longTitle = '标'.repeat(perLine * 2 + 3); // 超出 2 行容量，缩小后放得下
    target.textContent = longTitle;
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 500));
    const now = parseFloat(getComputedStyle(target).fontSize);
    const fits = target.scrollHeight <= target.clientHeight + 1;
    return { base, now, fits, shrink: base - now, len: perLine * 2 + 3 };
  })()`);
  check(`[${layout}] 长标题字号被微调 (${fit.base}px → ${fit.now}px)`, fit.shrink >= 0.5 && fit.fits, `缩小 ${fit.shrink.toFixed(2)}px (${fit.len} 字)`);
}

async function main() {
  const tab = await newTab('http://127.0.0.1:8766/');
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evalJs(cdp, `localStorage.removeItem('blog-layout'); location.reload(); true`);
  await sleep(1500);
  // 等待字体加载完成（避免 fallback 字体中间态干扰测量）
  await evalJs(cdp, `document.fonts.ready.then(() => true)`);
  await sleep(1000);

  const layout0 = await evalJs(cdp, `document.querySelector('[data-catalog-list]').dataset.catalogLayout`);
  check('初始布局为 rows', layout0 === 'rows', layout0);
  await verifyIndex(cdp, 'rows');

  await evalJs(cdp, `document.querySelector('[data-catalog-view="cards"]').click()`);
  await sleep(800);
  await verifyIndex(cdp, 'cards');

  // 窄视口（390px）rows + cards
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  await evalJs(cdp, `document.querySelector('[data-catalog-view="rows"]').click()`);
  await sleep(800);
  await verifyIndex(cdp, '390px rows');
  await evalJs(cdp, `document.querySelector('[data-catalog-view="cards"]').click()`);
  await sleep(800);
  await verifyIndex(cdp, '390px cards');
  const overflow = await evalJs(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`);
  check('[390px] 窄屏无横向溢出', !overflow);

  const tab2 = await newTab('http://127.0.0.1:8766/blog/');
  const cdp2 = await connect(tab2.webSocketDebuggerUrl);
  await cdp2.send('Page.enable');
  await sleep(1500);
  await evalJs(cdp2, `document.fonts.ready.then(() => true)`);
  await sleep(1000);
  const blogSeq = await evalJs(cdp2, `(() => {
    const entries = [...document.querySelectorAll('.catalog-entry')];
    return {
      seqs: entries.map((e) => e.querySelector('.catalog-index span')?.textContent.trim()),
      smalls: entries.map((e) => !!e.querySelector('.catalog-index small')),
    };
  })()`);
  check('/blog/ 序号格式正确', blogSeq.seqs.length > 0 && blogSeq.seqs.every((s, i) => s === String(i + 1).padStart(2, '0')), JSON.stringify(blogSeq.seqs.slice(0, 5)) + '…');
  check('/blog/ 无「文章/FOLIO」小字', blogSeq.smalls.every((s) => !s));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败:', e); process.exit(1); });
