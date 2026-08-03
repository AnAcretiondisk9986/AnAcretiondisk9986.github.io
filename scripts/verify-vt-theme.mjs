// VT 导航后昼夜按钮与主题保持的实测脚本
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

async function clickTheme(cdp) {
  // 返回点击前后 data-theme(startViewTransition 异步更新,等待后读取)
  return evalJs(cdp, `(async () => {
    const b = document.querySelector('.theme-toggle');
    if (!b) return { ok: false, reason: '按钮不存在' };
    const before = document.documentElement.dataset.theme;
    b.click();
    await new Promise((r) => setTimeout(r, 400));
    const after = document.documentElement.dataset.theme;
    return { ok: before !== after, before, after, stored: localStorage.getItem('theme') };
  })()`);
}

async function main() {
  const tab = await newTab('about:blank');
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  const results = [];
  const log = (msg) => { console.log(msg); results.push(msg); };

  // ── 1. 整页加载首页,预置暗色主题,点击按钮 ──
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8766/' });
  await sleep(1500);
  await evalJs(cdp, `localStorage.setItem('theme', 'dark'); document.documentElement.dataset.theme = 'dark';`);
  const r1 = await clickTheme(cdp); // dark -> light
  log(`[首页 整页加载] 点击按钮: ${JSON.stringify(r1)}`);

  // ── 2. VT 导航到 /blog/(点击链接,走 ClientRouter)──
  await evalJs(cdp, `localStorage.setItem('theme', 'dark'); document.documentElement.dataset.theme = 'dark';`);
  await evalJs(cdp, `document.querySelector('a[href="/blog/"]').click()`);
  await sleep(2500);
  const path = await evalJs(cdp, `location.pathname`);
  const themeAfterNav = await evalJs(cdp, `document.documentElement.dataset.theme`);
  log(`[VT 导航到 /blog/] pathname=${path}, 导航后 data-theme=${themeAfterNav} (期望 dark)`);

  // ── 3. VT 导航后点击昼夜按钮(核心验证)──
  const r3 = await clickTheme(cdp);
  log(`[VT 导航后点击按钮] ${JSON.stringify(r3)}`);

  // ── 4. 再点一次,验证双向切换 ──
  const r4 = await clickTheme(cdp);
  log(`[再次点击] ${JSON.stringify(r4)}`);

  // ── 5. VT 导航回首页,排序按钮应仍可用 ──
  await evalJs(cdp, `document.querySelector('a[href="/"]').click()`);
  await sleep(2500);
  const sortWorks = await evalJs(cdp, `(() => {
    const btn = document.querySelector('[data-order-sort="oldest"]');
    if (!btn) return { ok: false, reason: '排序按钮不存在' };
    const before = document.querySelector('[data-order-status]').textContent;
    btn.click();
    const after = document.querySelector('[data-order-status]').textContent;
    return { ok: before !== after, before, after };
  })()`);
  log(`[VT 导航回首页后排序按钮] ${JSON.stringify(sortWorks)}`);

  // ── 6. VT 导航到图志页,按钮验证 ──
  await evalJs(cdp, `document.querySelector('a[href="/gallery/"]').click()`);
  await sleep(2500);
  const r6 = await clickTheme(cdp);
  log(`[VT 导航到 /gallery/ 后点击按钮] ${JSON.stringify(r6)}`);

  const failed = results.filter((r) => r.includes('"ok":false') || (r.includes('期望') && !r.includes('dark')));
  console.log('==========================');
  console.log(failed.length ? '❌ 仍有失败项' : '✅ 全部通过');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('测试失败:', e); process.exit(1); });
