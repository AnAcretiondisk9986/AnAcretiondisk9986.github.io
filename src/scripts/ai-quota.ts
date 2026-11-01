/**
 * ai-quota.ts — /ai-quota/ 的取数、渲染与轮询
 * ----------------------------------------------------------------------------
 * 数据口径只认 docs/ai-quota-contract.md：
 *   · 页面请求 data-endpoint（默认 /api/ai-quota），服务端持钥回源，浏览器不接触任何密钥；
 *   · 字段缺失一律 null，页面上显示 ——，绝不回落成 0 或编造数字；
 *   · 渲染只用 textContent / DOM API，上游字符串永远不进 innerHTML。
 *
 * 行为：
 *   1. 首次进入先读 sessionStorage['ai-quota:v1']（20s 内直接渲染），随后无条件回源；
 *   2. 每 pollSeconds 轮询；标签页隐藏时停表，回到前台立刻补一次；
 *   3. 手动刷新走 ?force=1，同一秒内重复点击只发一次；单次请求 12s 超时；
 *   4. 倒计时（窗口重置 / 下次刷新）每秒走一格，重置时刻超过 24h 改显日期。
 *
 * 与 Astro View Transitions 的约定：
 *   · 初始化只挂在 astro:page-load（首次直载与站内跳转都会触发）；
 *   · astro:before-swap / pagehide 统一 teardown，清掉定时器与在途请求；
 *   · 重复 init 幂等：每次先 teardown 再重建，模块级 runtime 只保留一份。
 */

/* ───────────────────────── 契约类型（只做注解，不引入额外构建步骤） ───────────────────────── */

type ProviderStatus = 'ok' | 'missing-key' | 'auth' | 'network' | 'timeout' | 'upstream' | 'config-error';

/** 卡片可呈现的状态：契约状态 + 本页自用的 loading / absent / offline */
type CardState = ProviderStatus | 'loading' | 'absent' | 'offline';

interface QuotaShape {
  unlimited?: boolean | null;
  limit?: number | null;
  used?: number | null;
  remaining?: number | null;
}

interface QuotaWindow {
  key?: string | null;
  label?: string | null;
  percent?: number | null;
  resetsAt?: string | null;
  status?: string | null;
}

interface TokenCounts {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  total?: number | null;
}

interface UsageShape {
  todayRequests?: number | null;
  todayCost?: number | null;
  totalCost?: number | null;
  isValid?: boolean | null;
  mode?: string | null;
  /** 云渡 / ToolCode 的 /v1/usage 直接给了今日 token 口径 */
  todayTokens?: TokenCounts | null;
  totalTokens?: number | null;
  totalRequests?: number | null;
}

interface ProviderAccount {
  label?: string | null;
  used?: number | null;
  unlimited?: boolean | null;
  remaining?: number | null;
  error?: string | null;
}

interface SeriesPoint {
  date?: string | null;
  cost?: number | null;
  requests?: number | null;
}

interface ProviderShape {
  id?: string;
  label?: string;
  group?: string;
  status?: ProviderStatus | string;
  message?: string | null;
  updatedAt?: string | null;
  currency?: 'USD' | 'CNY' | string | null;
  balance?: number | null;
  quota?: QuotaShape | null;
  windows?: QuotaWindow[] | null;
  usage?: UsageShape | null;
  series?: SeriesPoint[] | null;
  /** new-api 这类按令牌记账的上游：一个服务多把 key 各算各的 */
  accounts?: ProviderAccount[] | null;
  meta?: Record<string, unknown> | null;
}

interface QuotaPayload {
  ok?: boolean;
  generatedAt?: string | null;
  cacheSeconds?: number | null;
  providers?: ProviderShape[];
}

interface Runtime {
  root: HTMLElement;
  endpoint: string;
  pollMs: number;
  auto: boolean;
  nextAt: number;
  timer: number | null;
  ticker: number | null;
  controller: AbortController | null;
  requestSeq: number;
  lastForceSecond: number;
}

/* ───────────────────────── 常量与格式化器 ───────────────────────── */

const CACHE_KEY = 'ai-quota:v1';
const CACHE_TTL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 12_000;
const DAY_MS = 86_400_000;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 金额：USD 用 en-US（$8.05），CNY 用 zh-CN（¥13.16），其余币种退化为「数字 + 代码」 */
const moneyFormatters: Record<string, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  CNY: new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};
const numberFormatter = new Intl.NumberFormat('zh-CN');
const percentFormatter = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 整页连接状态 → 控制条文案 */
const CONN_LABEL: Record<string, string> = {
  pending: '待连接',
  live: '已连接',
  offline: '未连接',
  empty: '已连接（无密钥）',
};

/** 卡片失败状态的固定文案：标题 + 一句可执行的说明 */
const STATE_COPY: Record<string, { chip: string; title: string; note: string }> = {
  'missing-key': {
    chip: '待填入 API Key',
    title: '待填入 API Key',
    note:
      '服务端没有读到这枚密钥。把 Key 填进项目根目录 .ai-quota.keys.json 的对应条目（模板见 .ai-quota.keys.example.json），' +
      '本地重启 npm run admin；线上用 wrangler secret 写入同样键名后重新部署。',
  },
  auth: {
    chip: 'Key 失效',
    title: 'API Key 失效',
    note: '上游拒绝了这枚密钥：可能已过期、被撤销或权限不足。换一枚新的 Key，重启查询服务后这里会自动恢复。',
  },
  network: {
    chip: '连不上上游',
    title: '连不上上游',
    note: '查询代理到上游的连接失败（DNS、TLS 或网络不可达）。下一次轮询会自动重试，不需要手动操作。',
  },
  timeout: {
    chip: '上游超时',
    title: '上游响应超时',
    note: '上游在超时时间内没有返回。数字暂时留空，等下一次轮询再取。',
  },
  upstream: {
    chip: '上游异常',
    title: '上游返回异常',
    note: '上游有响应，但返回结构不符合预期，通常是接口改版。需要更新服务端的取数逻辑。',
  },
  'config-error': {
    chip: '配置有误',
    title: '查询配置有误',
    note: '服务端这一项配置不完整（例如缺 userId 或 access token），补齐后重启查询服务即可。',
  },
  absent: {
    chip: '未返回',
    title: '查询代理没有返回这项服务',
    note: '响应里没有这个 id 的条目，可能是代理版本较旧或该项被跳过。',
  },
  offline: {
    chip: '未取到',
    title: '未取到读数',
    note: '查询代理未连接，这张卡片先留空；连上后会自动填回。',
  },
  loading: {
    chip: '读取中',
    title: '读取中',
    note: '正在向查询代理取数。',
  },
};

/* ───────────────────────── 模块级状态（单实例） ───────────────────────── */

let runtime: Runtime | null = null;
let booted = false;

/* ───────────────────────── 小工具 ───────────────────────── */

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 金额：null 显示 ——，不显示 0 */
function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (!isNumber(value)) return '—';
  const formatter = currency ? moneyFormatters[currency] : undefined;
  if (formatter) return formatter.format(value);
  const plain = numberFormatter.format(value);
  return currency ? `${plain} ${currency}` : plain;
}

function formatCount(value: number | null | undefined): string {
  return isNumber(value) ? numberFormatter.format(value) : '—';
}

/** token 量级：卡片上只要可比的粗读数，精确值让上游页面去查 */
function formatTokens(value: number | null | undefined): string {
  if (!isNumber(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  if (abs < 1e6) return `${(value / 1e3).toFixed(abs < 1e4 ? 2 : 1)}K`;
  if (abs < 1e9) return `${(value / 1e6).toFixed(2)}M`;
  return `${(value / 1e9).toFixed(2)}B`;
}

/** 百分比：上游给 0..100，这里截断后再交给 Intl 做 percent 格式化 */
function clampPercent(value: number | null | undefined): number | null {
  if (!isNumber(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function qs<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof text === 'string') node.textContent = text;
  return node;
}

/** 从 meta 里按候选键名取第一个有限数字（契约只规定 meta 可放公开事实，键名随后端实现） */
function pickMetaNumber(meta: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!meta || typeof meta !== 'object') return null;
  for (const key of keys) {
    const value = meta[key];
    if (isNumber(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

/** 倒计时：>24h 显示日期，否则 HH:MM:SS */
function formatCountdown(target: string | null | undefined, now: number): string {
  if (!target) return '—';
  const time = Date.parse(target);
  if (!Number.isFinite(time)) return '—';
  const left = time - now;
  if (left <= 0) return '已重置';
  if (left > DAY_MS) return dateFormatter.format(new Date(time));
  const total = Math.floor(left / 1000);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  return Number.isFinite(time) ? clockFormatter.format(new Date(time)) : '—';
}

/* ───────────────────────── 缓存 ───────────────────────── */

function readCache(): QuotaPayload | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; payload?: QuotaPayload };
    if (!parsed || !isNumber(parsed.savedAt) || !parsed.payload) return null;
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.payload.providers)) return null;
    return parsed.payload;
  } catch {
    // 隐私模式 / 禁用存储：直接当没有缓存，不影响回源
    return null;
  }
}

function writeCache(payload: QuotaPayload): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    /* 存不进去就算了，页面照常工作 */
  }
}

/* ───────────────────────── 取数 ───────────────────────── */

type FetchOutcome =
  | { kind: 'ok'; payload: QuotaPayload }
  | { kind: 'offline' }
  /** 代理在线、但没读到密钥：仍把响应体带上，好让控制条显示代理自己的 generatedAt */
  | { kind: 'empty'; payload: QuotaPayload };

async function request(endpoint: string, force: boolean): Promise<FetchOutcome> {
  // 新请求覆盖旧请求：先掐掉上一次，避免手动刷新与轮询撞在同一秒时堆两条连接
  runtime?.controller?.abort();
  const controller = new AbortController();
  if (runtime) runtime.controller = controller;
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = force ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}force=1` : endpoint;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });

    // 静态站没有这个路由时通常回 404 + HTML：一律当"代理未连接"，不去解析 HTML
    if (!response.ok) return { kind: 'offline' };
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) return { kind: 'offline' };

    const data = (await response.json()) as QuotaPayload;
    if (!data || typeof data !== 'object' || !Array.isArray(data.providers)) return { kind: 'offline' };
    // 契约：服务端读不到密钥文件时 ok:false。实现有两种形状——空 providers，或六个 provider
    // 全部 config-error；两者都归到整页的「读不到密钥」提示，免得六张卡片各说一遍同一件事。
    const keysUnreadable =
      data.ok === false &&
      (data.providers.length === 0 ||
        data.providers.every((item) => item && (item as { status?: string }).status === 'config-error'));
    if (keysUnreadable) return { kind: 'empty', payload: data };
    return { kind: 'ok', payload: data };
  } catch {
    // 网络失败 / 超时 abort / JSON 解析失败，全部落到"未连接"
    return { kind: 'offline' };
  } finally {
    window.clearTimeout(timeout);
    if (runtime && runtime.controller === controller) runtime.controller = null;
  }
}

async function refresh(force: boolean): Promise<void> {
  const state = runtime;
  if (!state) return;
  const token = ++state.requestSeq;
  setBusy(state.root, true);

  const outcome = await request(state.endpoint, force);

  // 页面已经切走，或已有更新的请求：这次结果直接丢弃
  if (!runtime || runtime !== state || token !== state.requestSeq) return;
  setBusy(state.root, false);

  if (outcome.kind === 'ok') {
    applyPayload(outcome.payload, 'live');
    writeCache(outcome.payload);
    setConn(state.root, 'live');
  } else if (outcome.kind === 'empty') {
    applyEmpty(state.root, outcome.payload);
    setConn(state.root, 'empty');
  } else {
    markAllOffline(state.root);
    setConn(state.root, 'offline');
  }

  schedule();
}

/* ───────────────────────── 轮询 / 可见性 ───────────────────────── */

function schedule(): void {
  const state = runtime;
  if (!state) return;
  if (state.timer) {
    window.clearTimeout(state.timer);
    state.timer = null;
  }
  if (!state.auto || document.visibilityState === 'hidden') {
    state.nextAt = 0;
    tick();
    return;
  }
  state.nextAt = Date.now() + state.pollMs;
  state.timer = window.setTimeout(() => {
    void refresh(false);
  }, state.pollMs);
  tick();
}

function setAuto(on: boolean): void {
  const state = runtime;
  if (!state) return;
  state.auto = on;
  const button = qs<HTMLButtonElement>(state.root, '[data-aq-auto]');
  if (button) {
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? '自动刷新：开' : '自动刷新：关';
  }
  schedule();
}

/** 每秒一格：窗口重置倒计时 + 下次自动刷新倒计时 */
function tick(): void {
  const state = runtime;
  if (!state) return;
  const now = Date.now();

  state.root.querySelectorAll<HTMLElement>('[data-countdown]').forEach((node) => {
    node.textContent = formatCountdown(node.dataset.countdown, now);
  });

  const nextNode = qs<HTMLElement>(state.root, '[data-aq-next]');
  if (nextNode) {
    if (!state.auto) nextNode.textContent = '已关闭';
    else if (document.visibilityState === 'hidden') nextNode.textContent = '已暂停';
    else if (!state.nextAt) nextNode.textContent = '—';
    else {
      const left = Math.max(0, state.nextAt - now);
      nextNode.textContent = `${pad(Math.floor(left / 60_000))}:${pad(Math.floor((left % 60_000) / 1000))}`;
    }
  }
}

function startTicker(root: HTMLElement): void {
  if (runtime?.ticker) window.clearInterval(runtime.ticker);
  const id = window.setInterval(tick, 1000);
  if (runtime && runtime.root === root) runtime.ticker = id;
}

/* ───────────────────────── 渲染：连接状态 ───────────────────────── */

function setConn(root: HTMLElement, mode: 'pending' | 'live' | 'offline' | 'empty'): void {
  root.dataset.conn = mode;
  const offline = qs<HTMLElement>(root, '[data-aq-offline]');
  const empty = qs<HTMLElement>(root, '[data-aq-empty]');
  if (offline) offline.hidden = mode !== 'offline';
  if (empty) empty.hidden = mode !== 'empty';
  const chip = qs<HTMLElement>(root, '[data-aq-conn]');
  if (chip) chip.textContent = CONN_LABEL[mode] || mode;
}

function setBusy(root: HTMLElement, busy: boolean): void {
  const button = qs<HTMLButtonElement>(root, '[data-aq-refresh]');
  if (button) {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  }
}

/* ───────────────────────── 渲染：单张卡片 ───────────────────────── */

function forEachCard(root: HTMLElement, run: (card: HTMLElement) => void): void {
  root.querySelectorAll<HTMLElement>('[data-aq-card]').forEach(run);
}

function clearDynamic(card: HTMLElement): void {
  const amount = qs<HTMLElement>(card, '[data-aq-amount]');
  const amountSub = qs<HTMLElement>(card, '[data-aq-amount-sub]');
  const amountWrap = qs<HTMLElement>(card, '[data-aq-amount-wrap]');
  const windows = qs<HTMLElement>(card, '[data-aq-windows]');
  const kv = qs<HTMLElement>(card, '[data-aq-kv]');
  const split = qs<HTMLElement>(card, '[data-aq-split]');
  const chart = qs<HTMLElement>(card, '[data-aq-chart]');
  const panel = qs<HTMLElement>(card, '[data-aq-panel]');
  const skeleton = qs<HTMLElement>(card, '[data-aq-skeleton]');
  const time = qs<HTMLElement>(card, '[data-aq-time]');

  // 先清数字再决定显示什么：失败时绝不残留上一轮读数
  if (amount) {
    amount.textContent = '—';
    amount.classList.remove('is-unlimited');
    amount.classList.remove('is-empty');
  }
  if (amountSub) amountSub.textContent = '';
  if (amountWrap) amountWrap.hidden = false;
  if (windows) {
    windows.replaceChildren();
    windows.hidden = true;
  }
  if (kv) {
    kv.replaceChildren();
    kv.hidden = true;
  }
  if (split) {
    split.replaceChildren();
    split.hidden = true;
  }
  if (chart) {
    const lines = qs<SVGGElement>(chart, '[data-aq-chart-lines]');
    if (lines) lines.replaceChildren();
    chart.hidden = true;
  }
  if (panel) {
    panel.hidden = true;
    const title = qs<HTMLElement>(panel, '[data-aq-panel-title]');
    const note = qs<HTMLElement>(panel, '[data-aq-panel-note]');
    if (title) title.textContent = '';
    if (note) note.textContent = '';
  }
  if (skeleton) skeleton.hidden = true;
  if (time) time.textContent = '—';
}

function setChip(card: HTMLElement, text: string): void {
  const chip = qs<HTMLElement>(card, '[data-aq-chip-text]');
  if (chip) chip.textContent = text;
}

/** 失败 / 缺数据：只显示状态说明，主数字整块收起 */
function renderUnavailable(card: HTMLElement, state: CardState, provider: ProviderShape | null): void {
  card.dataset.state = state;
  card.setAttribute('aria-busy', 'false');
  clearDynamic(card);

  const copy = STATE_COPY[state] || STATE_COPY.upstream;
  setChip(card, copy.chip);

  const amountWrap = qs<HTMLElement>(card, '[data-aq-amount-wrap]');
  if (amountWrap) amountWrap.hidden = true;

  const panel = qs<HTMLElement>(card, '[data-aq-panel]');
  if (panel) {
    panel.hidden = false;
    const title = qs<HTMLElement>(panel, '[data-aq-panel-title]');
    const note = qs<HTMLElement>(panel, '[data-aq-panel-note]');
    if (title) title.textContent = copy.title;
    if (note) note.textContent = provider?.message ? `${copy.note}（上游说明：${provider.message}）` : copy.note;
  }

  const time = qs<HTMLElement>(card, '[data-aq-time]');
  if (time) time.textContent = formatClock(provider?.updatedAt ?? null);
}

function renderWindows(card: HTMLElement, windows: QuotaWindow[] | null | undefined): void {
  const host = qs<HTMLElement>(card, '[data-aq-windows]');
  if (!host) return;
  if (!Array.isArray(windows) || windows.length === 0) {
    host.hidden = true;
    return;
  }

  host.replaceChildren();
  for (const item of windows) {
    const row = make('div', 'aq-window');

    const head = make('div', 'aq-window__head');
    head.append(make('span', 'aq-window__label', item.label || item.key || '窗口'));
    const percent = clampPercent(item.percent);
    head.append(make('b', 'aq-window__pct', percent === null ? '—' : percentFormatter.format(percent / 100)));
    row.append(head);

    const track = make('div', 'aq-window__track');
    const fill = make('i', 'aq-window__fill');
    if (percent === null) {
      // 百分比未知：轨道走斜纹占位，不画一根 0% 的实心条
      track.dataset.empty = 'true';
      fill.style.transform = 'scaleX(0)';
    } else {
      fill.style.transform = `scaleX(${percent / 100})`;
      if (percent >= 85) fill.dataset.level = 'high';
    }
    track.append(fill);
    row.append(track);

    const meta = make('p', 'aq-window__meta');
    meta.append(make('span', undefined, '重置'));
    const countdown = make('b', 'aq-window__countdown', formatCountdown(item.resetsAt, Date.now()));
    if (item.resetsAt) countdown.dataset.countdown = item.resetsAt;
    meta.append(countdown);
    row.append(meta);

    host.append(row);
  }
  host.hidden = false;
}

function renderKv(card: HTMLElement, rows: Array<[string, string]>): void {
  const host = qs<HTMLElement>(card, '[data-aq-kv]');
  if (!host) return;
  if (rows.length === 0) {
    host.hidden = true;
    return;
  }
  host.replaceChildren();
  for (const [label, value] of rows) {
    const row = make('div');
    row.append(make('dt', undefined, label));
    row.append(make('dd', undefined, value));
    host.append(row);
  }
  host.hidden = false;
}

function renderSplit(card: HTMLElement, rows: Array<[string, string]>): void {
  const host = qs<HTMLElement>(card, '[data-aq-split]');
  if (!host) return;
  if (rows.length === 0) {
    host.hidden = true;
    return;
  }
  host.replaceChildren();
  for (const [label, value] of rows) {
    const row = make('div');
    row.append(make('dt', undefined, label));
    row.append(make('dd', undefined, value));
    host.append(row);
  }
  host.hidden = false;
}

/** 近 14 天迷你折线：一条 polyline 对应一段连续有值的日子，缺口不连线 */
function renderSeries(card: HTMLElement, provider: ProviderShape): void {
  const figure = qs<HTMLElement>(card, '[data-aq-chart]');
  const lines = qs<SVGGElement>(card, '[data-aq-chart-lines]');
  const caption = qs<HTMLElement>(card, '[data-aq-chart-cap]');
  if (!figure || !lines) return;

  const raw = Array.isArray(provider.series) ? provider.series.filter((p) => p && typeof p.date === 'string') : [];
  const points = raw
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-14);

  const costs = points.map((point) => (isNumber(point.cost) ? point.cost : null));
  const requests = points.map((point) => (isNumber(point.requests) ? point.requests : null));
  const useCost = costs.some((value) => value !== null);
  const values = useCost ? costs : requests;

  if (points.length < 2 || !values.some((value) => value !== null)) {
    figure.hidden = true;
    return;
  }

  const max = values.reduce<number>((acc, value) => (value !== null && value > acc ? value : acc), 0);
  const scale = max > 0 ? max : 1;
  const width = 100;
  const baseline = 31;
  const height = 29;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const xOf = (index: number) => (points.length > 1 ? index * step : width / 2);
  const yOf = (value: number) => baseline - (value / scale) * height;

  lines.replaceChildren();
  let run: string[] = [];
  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('class', useCost ? 'aq-chart__line' : 'aq-chart__line aq-chart__line--requests');
    polyline.setAttribute('points', run.join(' '));
    polyline.setAttribute('vector-effect', 'non-scaling-stroke');
    lines.append(polyline);
    run = [];
  };
  values.forEach((value, index) => {
    if (value === null) {
      flush();
      return;
    }
    run.push(`${xOf(index).toFixed(2)},${yOf(value).toFixed(2)}`);
  });
  flush();

  const total = values.reduce<number>((acc, value) => (value !== null ? acc + value : acc), 0);
  if (caption) {
    caption.textContent = useCost
      ? `近 14 天花费 · 共 ${formatMoney(total, provider.currency ?? null)}`
      : `近 14 天请求 · 共 ${formatCount(total)} 次`;
  }
  const svg = qs<SVGSVGElement>(figure, 'svg');
  if (svg) {
    svg.setAttribute(
      'aria-label',
      useCost
        ? `近 ${points.length} 天花费折线，合计 ${formatMoney(total, provider.currency ?? null)}`
        : `近 ${points.length} 天请求折线，合计 ${formatCount(total)} 次`,
    );
  }
  figure.hidden = false;
}

function renderProvider(card: HTMLElement, provider: ProviderShape | null): void {
  if (!provider) {
    renderUnavailable(card, 'absent', null);
    return;
  }

  const status = (provider.status || 'upstream') as CardState;
  if (status !== 'ok') {
    renderUnavailable(card, status in STATE_COPY ? status : 'upstream', provider);
    return;
  }

  clearDynamic(card);
  card.dataset.state = 'ok';
  card.setAttribute('aria-busy', 'false');
  setChip(card, '正常');

  const group = card.dataset.group || '';
  const currency = provider.currency ?? null;
  const quota = provider.quota ?? null;
  const usage = provider.usage ?? null;

  /* — 主数字 — */
  const amount = qs<HTMLElement>(card, '[data-aq-amount]');
  const amountSub = qs<HTMLElement>(card, '[data-aq-amount-sub]');
  const amountLabel = qs<HTMLElement>(card, '[data-aq-amount-label]');

  let amountText = '—';
  let subText = '';

  if (quota?.unlimited) {
    amountText = '不限额度';
    if (amount) amount.classList.add('is-unlimited');
    if (isNumber(quota.used)) subText = `已用 ${formatMoney(quota.used, currency)}`;
  } else if (group === 'subscription') {
    amountText = formatMoney(quota?.limit ?? null, currency);
    if (isNumber(quota?.used)) subText = `已用 ${formatMoney(quota.used, currency)}`;
    else if (isNumber(quota?.remaining)) subText = `剩余 ${formatMoney(quota.remaining, currency)}`;
  } else {
    amountText = formatMoney(provider.balance ?? null, currency);
    // 余额之上再给一句已用：面板额度能读到时（TaffCloud），两个数合起来才是充值总额
    if (isNumber(quota?.used) && quota?.unlimited !== true) {
      subText = `已用 ${formatMoney(quota.used, currency)}`;
    } else if (isNumber(quota?.remaining) && quota.remaining !== provider.balance) {
      subText = `剩余 ${formatMoney(quota.remaining, currency)}`;
    }
  }

  if (amount) {
    amount.textContent = amountText;
    // 未知读数（——）用弱化的小号显示，避免在展示字号下被看成一条横线
    amount.classList.toggle('is-empty', amountText === '—');
  }
  if (amountSub) amountSub.textContent = subText;
  if (amountLabel) {
    amountLabel.textContent =
      quota?.unlimited ? '额度' : group === 'subscription' ? '总额度' : group === 'platform' ? '可用余额' : '余额';
  }

  /* 订阅制未必有"总额度"（OpenCode GO 只给三个窗口）：别在展示字号上摆一条空横线，
     直接让窗口段落当卡片主体；上游真给了 quota 时照常显示总额度与已用。 */
  const amountWrap = qs<HTMLElement>(card, '[data-aq-amount-wrap]');
  if (amountWrap) amountWrap.hidden = group === 'subscription' && !quota;

  /* — 订阅窗口（订阅制与 GLM 计划共用） — */
  renderWindows(card, provider.windows ?? null);

  /* — 用量键值行 — */
  const kvRows: Array<[string, string]> = [];
  if (usage) {
    if (isNumber(usage.todayCost)) kvRows.push(['今日花费', formatMoney(usage.todayCost, currency)]);
    if (isNumber(usage.todayRequests)) kvRows.push(['今日请求', `${formatCount(usage.todayRequests)} 次`]);
    // 只有云渡 / ToolCode 这一路网关会在 /v1/usage 里带 token 口径（含缓存命中）
    const tokens = usage.todayTokens;
    if (tokens && isNumber(tokens.total) && tokens.total > 0) {
      if (isNumber(tokens.total)) kvRows.push(['今日 Token', formatTokens(tokens.total)]);
      const parts: string[] = [];
      if (isNumber(tokens.input)) parts.push(`入 ${formatTokens(tokens.input)}`);
      if (isNumber(tokens.output)) parts.push(`出 ${formatTokens(tokens.output)}`);
      if (isNumber(tokens.cacheRead)) parts.push(`缓存 ${formatTokens(tokens.cacheRead)}`);
      if (parts.length) kvRows.push(['拆分', parts.join(' · ')]);
    }
    if (isNumber(usage.totalRequests)) kvRows.push(['请求总数', `${formatCount(usage.totalRequests)} 次`]);
    if (isNumber(usage.totalCost) && group !== 'platform' && !(Array.isArray(provider.accounts) && provider.accounts.length > 1)) {
      kvRows.push(['累计花费', formatMoney(usage.totalCost, currency)]);
    }
    // 按令牌记账的上游（TaffCloud）：一把 key 一行，合计已在上面
    const accounts = Array.isArray(provider.accounts) ? provider.accounts : [];
    for (const account of accounts) {
      if (!account) continue;
      const label = `令牌 ${account.label || '—'}`;
      if (isNumber(account.used)) kvRows.push([label, formatMoney(account.used, currency)]);
      else if (account.error) kvRows.push([label, '读取失败']);
    }
  }
  renderKv(card, kvRows);

  /* — 开放平台：赠送 / 充值 / 累计消费 — */
  const splitRows: Array<[string, string]> = [];
  if (group === 'platform') {
    const granted = pickMetaNumber(provider.meta, ['grantedBalance', 'granted_balance', 'granted']);
    const topped = pickMetaNumber(provider.meta, ['toppedUpBalance', 'topped_up_balance', 'toppedUp']);
    const recharge = pickMetaNumber(provider.meta, ['rechargeAmount', 'recharge_amount']);
    const spend = pickMetaNumber(provider.meta, ['totalSpendAmount', 'total_spend_amount', 'totalSpend']);
    if (granted !== null) splitRows.push(['赠送余额', formatMoney(granted, currency)]);
    if (topped !== null) splitRows.push(['充值余额', formatMoney(topped, currency)]);
    else if (recharge !== null) splitRows.push(['累计充值', formatMoney(recharge, currency)]);
    if (spend !== null) splitRows.push(['累计消费', formatMoney(spend, currency)]);
    // 智谱的资源包是 token 口径，和余额不是一回事，单列
    const packTokens = pickMetaNumber(provider.meta, ['tokenBalanceTotal']);
    if (packTokens !== null) splitRows.push(['资源包剩余', `${formatTokens(packTokens)} tokens`]);
  }
  renderSplit(card, splitRows);

  /* — 近 14 天折线（只有中转站卡片带图） — */
  if (group === 'relay') renderSeries(card, provider);

  const time = qs<HTMLElement>(card, '[data-aq-time]');
  if (time) time.textContent = formatClock(provider.updatedAt ?? null);
}

/* ───────────────────────── 渲染：整页 ───────────────────────── */

function applyPayload(payload: QuotaPayload, mode: 'live' | 'cache'): void {
  const state = runtime;
  if (!state) return;

  const byId = new Map<string, ProviderShape>();
  for (const item of payload.providers || []) {
    if (item && typeof item.id === 'string') byId.set(item.id, item);
  }
  forEachCard(state.root, (card) => renderProvider(card, byId.get(card.dataset.provider || '') ?? null));

  const updated = qs<HTMLElement>(state.root, '[data-aq-updated]');
  if (updated) {
    const clock = formatClock(payload.generatedAt ?? null);
    updated.textContent = mode === 'cache' ? `缓存 · ${clock}` : clock;
  }

  const connChip = qs<HTMLElement>(state.root, '[data-aq-conn]');
  if (connChip && mode === 'cache') connChip.textContent = '读取缓存';

  tick();
}

/** 契约里的 ok:false + 空 providers：代理在线但没读到密钥，逐卡按 missing-key 说明 */
function applyEmpty(root: HTMLElement, payload: QuotaPayload): void {
  forEachCard(root, (card) => renderUnavailable(card, 'missing-key', null));
  const updated = qs<HTMLElement>(root, '[data-aq-updated]');
  if (updated) updated.textContent = formatClock(payload.generatedAt ?? new Date().toISOString());
}

function markAllOffline(root: HTMLElement): void {
  forEachCard(root, (card) => renderUnavailable(card, 'offline', null));
}

/* ───────────────────────── 交互绑定 ───────────────────────── */

async function manualRefresh(): Promise<void> {
  const state = runtime;
  if (!state) return;
  // 同一秒内重复点击只发一次
  const second = Math.floor(Date.now() / 1000);
  if (second === state.lastForceSecond) return;
  state.lastForceSecond = second;
  await refresh(true);
}

function bind(root: HTMLElement): void {
  qs<HTMLButtonElement>(root, '[data-aq-refresh]')?.addEventListener('click', () => {
    void manualRefresh();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-aq-retry]').forEach((button) => {
    button.addEventListener('click', () => {
      void manualRefresh();
    });
  });
  qs<HTMLButtonElement>(root, '[data-aq-auto]')?.addEventListener('click', () => {
    if (!runtime) return;
    setAuto(!runtime.auto);
  });
}

/* ───────────────────────── 生命周期 ───────────────────────── */

function teardown(): void {
  const state = runtime;
  if (state) {
    state.requestSeq += 1; // 让在途请求的结果失效
    state.controller?.abort();
    state.controller = null;
    if (state.timer) window.clearTimeout(state.timer);
    if (state.ticker) window.clearInterval(state.ticker);
  }
  runtime = null;
  booted = false;
}

function init(): void {
  teardown();

  const root = qs<HTMLElement>(document, '[data-aq-page]');
  if (!root) return;

  const endpoint = (root.dataset.endpoint || '/api/ai-quota').trim() || '/api/ai-quota';
  const seconds = Number(root.dataset.pollSeconds);
  const pollMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;

  runtime = {
    root,
    endpoint,
    pollMs,
    auto: true,
    nextAt: 0,
    timer: null,
    ticker: null,
    controller: null,
    requestSeq: 0,
    lastForceSecond: 0,
  };
  booted = true;

  bind(root);
  setBusy(root, false);

  // 20s 内的缓存先铺屏，避免来回切换时闪一下骨架；随后仍然回源
  const cached = readCache();
  if (cached) applyPayload(cached, 'cache');

  startTicker(root);
  void refresh(false);
}

/* 初始化只挂在 astro:page-load：首次直载与每次 View Transitions 导航都会触发；
   离开时统一 teardown，防止往返几次后堆叠出多个定时器。 */
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', teardown);
window.addEventListener('pagehide', teardown);

/* document 级监听只注册一次（DOM 交换不会销毁 document），内部靠 runtime 判空 */
document.addEventListener('visibilitychange', () => {
  const state = runtime;
  if (!state || !booted) return;
  if (document.visibilityState === 'hidden') {
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    state.nextAt = 0;
    tick();
    return;
  }
  // 回到前台立即补一次，不等下一个轮询点
  void refresh(false);
});
