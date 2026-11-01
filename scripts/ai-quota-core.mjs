// AI 额度查询核心：六个上游的取数与归一化。
// 数据契约唯一权威：docs/ai-quota-contract.md。
// 这个文件必须保持「零 Node 依赖」：本地 admin-server 直接 import，Cloudflare Worker 由 wrangler 打包同一个文件，
// 两边因此不会各写一份逻辑而慢慢跑偏（此前的教训：worker 里少了一次 GLM 资源包改动）。
// 密钥永不进入返回值、日志或错误信息。

const DEFAULT_TTL_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const TOOLCODE_RETRY_DELAY_MS = 300;

const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/usage';
const YUNDU_URL = 'https://gd.yundu.lol/v1/usage';
const TOOLCODE_URLS = ['https://toolcode.cc/v1/usage', 'https://toolcode.top/v1/usage'];
const TAFFCLOUD_BASE = 'https://api.taffcloud.xyz';
const DEEPSEEK_URL = 'https://api.deepseek.com/user/balance';
// 智谱两条域名：境外出口（Cloudflare 等）访问 open.bigmodel.cn 的 /api/biz|monitor 会被 WAF 回 405，
// 同一账号在 bigmodel.cn 上正常；国内直连两者都通。按顺序试，403/405/451 时换下一个。
const GLM_HOSTS = ['https://bigmodel.cn', 'https://open.bigmodel.cn'];
const GLM_BALANCE_PATH = '/api/biz/account/query-customer-account-report';
const GLM_PLAN_PATH = '/api/monitor/usage/quota/limit';
const GLM_TOKEN_PACKAGES_PATH = '/api/biz/tokenAccounts/list/my?pageNum=1&pageSize=100';

// new-api 内部 quota 单位：1 美元 = 500000（面板 /api/user/self 的 quota / used_quota）
const NEW_API_QUOTA_PER_USD = 500_000;

const OPENCODE_WINDOW_LABELS = { rolling: '滚动 5 小时', weekly: '每周', monthly: '每月' };
const GLM_WINDOW_LABELS = { session: '会话', weekly: '每周', monthly: '每月', daily: '每日', rolling: '滚动窗口' };

const YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const PROVIDER_DEFS = [
  { id: 'opencode-go', label: 'OpenCode GO', group: 'subscription', load: loadOpencodeGo },
  { id: 'yundu', label: '云渡', group: 'relay', load: loadYundu },
  { id: 'toolcode', label: 'ToolCode', group: 'relay', load: loadToolcode },
  { id: 'taffcloud', label: 'TaffCloud', group: 'relay', load: loadTaffcloud },
  { id: 'deepseek', label: 'DeepSeek', group: 'platform', load: loadDeepseek },
  { id: 'glm', label: '智谱 GLM', group: 'platform', load: loadGlm },
];

// ── 基础工具 ────────────────────────────────────────────────────────────────

class QuotaError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'QuotaError';
    this.kind = kind;
  }
}

function str(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercent(value) {
  const n = num(value);
  if (n == null) return null;
  return Math.min(100, Math.max(0, n));
}

function isoOrNull(value) {
  if (value == null || value === '') return null;
  let ms = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    ms = value > 1e12 ? value : value * 1000;
  } else {
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{10,13}$/.test(text)) {
      const n = Number(text);
      ms = text.length === 13 ? n : n * 1000;
    } else {
      const parsed = Date.parse(text);
      ms = Number.isNaN(parsed) ? null : parsed;
    }
  }
  if (ms == null || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ymdInShanghai(ms) {
  try {
    return YMD_FORMATTER.format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function httpError(status) {
  if (status === 401 || status === 403) return new QuotaError('auth', 'API Key 无效或已失效');
  if (status === 429) return new QuotaError('upstream', '上游限流，请稍后再试');
  if (status === 0) return new QuotaError('network', '无法连接上游服务');
  if (status >= 500) return new QuotaError('upstream', `上游服务异常（HTTP ${status}）`);
  return new QuotaError('upstream', `上游返回异常（HTTP ${status}）`);
}

function transportError(err, timeoutMs) {
  const name = err && err.name;
  const message = String((err && err.message) || err || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out|aborted/i.test(message)) {
    return new QuotaError('timeout', `上游响应超时（${Math.round(timeoutMs / 1000)} 秒）`);
  }
  return new QuotaError('network', '无法连接上游服务');
}

function makeSignal(timeoutMs) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(timeoutMs);
    }
  } catch {
    // 运行时不支持 AbortSignal.timeout 时退化为无超时信号
  }
  return undefined;
}

/** 上游取数：只读取 text 再自行 JSON.parse，方便把解析失败归为 upstream 而不是抛异常。 */
async function requestJson(ctx, url, headers) {
  let res;
  try {
    res = await ctx.fetch(url, { headers, signal: makeSignal(ctx.timeoutMs) });
  } catch (err) {
    throw transportError(err, ctx.timeoutMs);
  }
  let text = '';
  try {
    text = typeof res.text === 'function' ? await res.text() : '';
  } catch (err) {
    throw transportError(err, ctx.timeoutMs);
  }
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const status = Number(res.status) || 0;
  const ok = typeof res.ok === 'boolean' ? res.ok : status >= 200 && status < 300;
  return { status, ok, json };
}

export function baseProvider(def, { status = 'ok', message = null, updatedAt = null } = {}) {
  return {
    id: def.id,
    label: def.label,
    group: def.group,
    status,
    message,
    updatedAt,
    currency: null,
    balance: null,
    quota: null,
    windows: null,
    usage: null,
    series: null,
    meta: {},
  };
}

async function runProvider(def, ctx, entry) {
  try {
    const patch = await def.load(ctx, entry && typeof entry === 'object' ? entry : {});
    return {
      ...baseProvider(def, { updatedAt: ctx.isoNow }),
      ...patch,
      id: def.id,
      label: def.label,
      group: def.group,
      status: patch.status || 'ok',
      message: patch.message == null ? null : patch.message,
      updatedAt: ctx.isoNow,
      meta: patch.meta && typeof patch.meta === 'object' ? patch.meta : {},
    };
  } catch (err) {
    const kind = err instanceof QuotaError ? err.kind : 'upstream';
    const message = err instanceof QuotaError ? err.message : '上游返回内容无法解析';
    return baseProvider(def, { status: kind, message, updatedAt: ctx.isoNow });
  }
}

// ── 钱包型上游（云渡 / ToolCode 共用同一套 /v1/usage 结构）─────────────────

function tokenCounts(source) {
  if (!source || typeof source !== 'object') return null;
  const input = num(source.input_tokens);
  const output = num(source.output_tokens);
  const cacheRead = num(source.cache_read_tokens);
  const total = num(source.total_tokens);
  if (input == null && output == null && cacheRead == null && total == null) return null;
  return { input, output, cacheRead, total };
}

/** 网关按模型给出的用量里最长的那条（上游已按花费/请求降序），只带可公开展示的字段。 */
function topModelOf(models) {
  if (!Array.isArray(models) || !models.length) return null;
  const first = models[0];
  if (!first || typeof first !== 'object') return null;
  return {
    name: str(first.model),
    requests: num(first.requests),
    totalTokens: num(first.total_tokens),
    cost: num(first.actual_cost) != null ? num(first.actual_cost) : num(first.cost),
  };
}

function walletPatch(json) {
  const balance = num(json.balance);
  const rawDaily = Array.isArray(json.daily_usage) ? json.daily_usage : [];
  const points = rawDaily
    .map((day) => ({
      date: str(day && day.date),
      // 按日成本优先取 actual_cost（真实扣费），没有才退回落 cost（标价）
      cost: num(day && day.actual_cost) != null ? num(day.actual_cost) : num(day && day.cost),
      requests: num(day && day.requests),
    }))
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  const usageDoc = json.usage && typeof json.usage === 'object' ? json.usage : {};
  const today = usageDoc.today && typeof usageDoc.today === 'object' ? usageDoc.today : null;
  const total = usageDoc.total && typeof usageDoc.total === 'object' ? usageDoc.total : null;
  const latest = points.length ? points[points.length - 1] : null;

  const todayCost = today
    ? num(today.actual_cost) != null
      ? num(today.actual_cost)
      : num(today.cost)
    : latest
      ? latest.cost
      : null;
  const totalCost = total ? (num(total.actual_cost) != null ? num(total.actual_cost) : num(total.cost)) : null;

  const usage = {
    todayRequests: today ? num(today.requests) : latest ? latest.requests : null,
    todayCost,
    // 上游没有给累计时保持 null，不用可见区间求和冒充总额
    totalCost,
    isValid: typeof json.isValid === 'boolean' ? json.isValid : null,
    mode: str(json.mode),
    // 这两家网关的 /v1/usage 同时给了 token 口径，能读到就别浪费
    todayTokens: tokenCounts(today),
    totalTokens: total ? num(total.total_tokens) : null,
  };

  const meta = {
    planName: str(json.planName),
    upstreamRemaining: num(json.remaining),
    unit: str(json.unit),
    dailyPoints: points.length,
    modelCount: Array.isArray(json.model_stats) ? json.model_stats.length : null,
    topModel: topModelOf(json.model_stats),
  };

  return {
    currency: 'USD',
    balance,
    quota: null,
    windows: null,
    usage,
    series: points.length ? points : null,
    meta,
  };
}

async function loadOpencodeGo(ctx, entry) {
  const key = str(entry.apiKey);
  if (!key) return { status: 'missing-key', message: '未配置 OpenCode GO API Key' };

  const res = await requestJson(ctx, OPENCODE_URL, {
    Authorization: `Bearer ${key}`,
    'x-opencode-session': ctx.uuid(),
    accept: 'application/json',
  });
  if (!res.ok) throw httpError(res.status);
  if (!res.json) throw new QuotaError('upstream', '上游返回内容无法解析');

  const usageDoc = res.json.usage;
  if (!usageDoc || typeof usageDoc !== 'object') throw new QuotaError('upstream', '上游未返回用量窗口');

  const windows = [];
  for (const windowKey of ['rolling', 'weekly', 'monthly']) {
    const raw = usageDoc[windowKey];
    if (!raw || typeof raw !== 'object') continue;
    windows.push({
      key: windowKey,
      label: OPENCODE_WINDOW_LABELS[windowKey] || windowKey,
      percent: clampPercent(raw.percent),
      resetsAt: isoOrNull(raw.resetsAt),
      status: str(raw.status) || 'unknown',
    });
  }
  if (!windows.length) throw new QuotaError('upstream', '上游未返回用量窗口');

  return {
    windows,
    meta: { plan: 'go', windowCount: windows.length },
  };
}

async function loadYundu(ctx, entry) {
  const key = str(entry.apiKey);
  if (!key) return { status: 'missing-key', message: '未配置云渡 API Key' };

  const res = await requestJson(ctx, YUNDU_URL, {
    Authorization: `Bearer ${key}`,
    accept: 'application/json',
  });
  if (!res.ok) throw httpError(res.status);
  if (!res.json) throw new QuotaError('upstream', '上游返回内容无法解析');

  const patch = walletPatch(res.json);
  return { ...patch, meta: { ...patch.meta, host: 'gd.yundu.lol' } };
}

async function loadToolcode(ctx, entry) {
  const key = str(entry.apiKey);
  if (!key) return { status: 'missing-key', message: '未配置 ToolCode API Key' };

  let lastError = null;
  for (let hostIndex = 0; hostIndex < TOOLCODE_URLS.length; hostIndex += 1) {
    const url = TOOLCODE_URLS[hostIndex];
    // 该网关偶发首包 401（边缘缓存），.cc 上多试一次；.top 只试一次
    const attempts = hostIndex === 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0 && ctx.retryDelayMs > 0) {
        await new Promise((done) => setTimeout(done, ctx.retryDelayMs));
      }
      let res;
      try {
        res = await requestJson(ctx, url, {
          Authorization: `Bearer ${key}`,
          accept: 'application/json',
        });
      } catch (err) {
        lastError = err;
        break; // 传输层失败直接换下一个域名
      }
      if (res.ok && res.json) {
        const patch = walletPatch(res.json);
        const retried = attempt > 0 || hostIndex > 0;
        return { ...patch, meta: { ...patch.meta, host: new URL(url).host, retried } };
      }
      lastError = res.ok ? new QuotaError('upstream', '上游返回内容无法解析') : httpError(res.status);
    }
  }
  throw lastError || new QuotaError('upstream', 'ToolCode 上游均不可用');
}

// ── TaffCloud（new-api）：面板 token 优先，否则回落 OpenAI 兼容计费 ────────

/** 令牌脱敏：只留后 4 位，够人认出是哪一把，又不会把密钥写进页面。 */
function maskKey(key) {
  const raw = str(key);
  if (!raw) return '未命名令牌';
  const tail = raw.slice(-4);
  return `…${tail}`;
}

async function taffcloudAccount(ctx, key) {
  const today = ctx.ymd;
  const start = `${today.slice(0, 8)}01`;
  const headers = { Authorization: `Bearer ${key}`, accept: 'application/json' };

  const [sub, usg] = await Promise.all([
    requestJson(ctx, `${TAFFCLOUD_BASE}/v1/dashboard/billing/subscription`, headers),
    requestJson(ctx, `${TAFFCLOUD_BASE}/v1/dashboard/billing/usage?start_date=${start}&end_date=${today}`, headers),
  ]);
  if (!sub.ok) throw httpError(sub.status);
  if (!usg.ok) throw httpError(usg.status);
  if (!sub.json || !usg.json) throw new QuotaError('upstream', '上游返回内容无法解析');

  const hardLimit = num(sub.json.hard_limit_usd);
  const totalUsageCents = num(usg.json.total_usage);
  const used = totalUsageCents == null ? null : totalUsageCents / 100;
  const unlimited = hardLimit != null && hardLimit >= 1e8;

  return {
    label: maskKey(key),
    used,
    unlimited,
    remaining: !unlimited && hardLimit != null && used != null ? hardLimit - used : null,
    hardLimitUsd: hardLimit,
    totalUsageCents,
  };
}

async function loadTaffcloud(ctx, entry) {
  const accessToken = str(entry.accessToken);
  const userId = str(entry.userId);
  // 这个站（new-api）的用量是按「单个令牌」记账的：多把 key 各算各的，
  // 所以配置里支持 apiKeys 数组，卡片按令牌分列，再给一个合计。
  const keys = (
    Array.isArray(entry.apiKeys) ? entry.apiKeys : entry.apiKey ? [entry.apiKey] : []
  )
    .map((item) => str(item))
    .filter(Boolean);

  if (!keys.length && !accessToken) return { status: 'missing-key', message: '未配置 TaffCloud API Key' };

  let panelError = null;
  if (accessToken) {
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      if (userId) headers['New-Api-User'] = userId;
      const res = await requestJson(ctx, `${TAFFCLOUD_BASE}/api/user/self`, headers);
      if (!res.ok) throw httpError(res.status);
      const data = res.json && res.json.data;
      if (res.json && res.json.success === false) throw new QuotaError('auth', 'TaffCloud 面板令牌无效或已过期');
      if (!data || typeof data !== 'object') throw new QuotaError('upstream', '上游未返回账号额度');

      const quotaRaw = num(data.quota);
      const usedRaw = num(data.used_quota);
      const remaining = quotaRaw == null ? null : quotaRaw / NEW_API_QUOTA_PER_USD;
      const used = usedRaw == null ? null : usedRaw / NEW_API_QUOTA_PER_USD;
      const limit = remaining != null && used != null ? remaining + used : null;

      return {
        currency: 'USD',
        balance: remaining,
        quota: { unlimited: false, limit, used, remaining },
        usage: { todayRequests: null, todayCost: null, totalCost: used },
        meta: {
          mode: 'panel',
          quotaRaw,
          usedQuotaRaw: usedRaw,
          quotaPerUsd: NEW_API_QUOTA_PER_USD,
        },
      };
    } catch (err) {
      panelError = err;
    }
  }

  if (!keys.length) throw panelError || new QuotaError('upstream', '上游均不可用');

  const settled = await Promise.allSettled(keys.map((key) => taffcloudAccount(ctx, key)));
  const accounts = settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    return {
      label: maskKey(keys[index]),
      used: null,
      unlimited: null,
      remaining: null,
      error: entry.reason && entry.reason.message ? entry.reason.message : '令牌查询失败',
    };
  });

  const okAccounts = accounts.filter((item) => !item.error);
  if (!okAccounts.length) {
    throw new QuotaError('upstream', accounts[0] && accounts[0].error ? accounts[0].error : '所有令牌查询失败');
  }

  const usedValues = okAccounts.map((item) => item.used).filter((value) => num(value) != null);
  const usedSum = usedValues.length ? usedValues.reduce((sum, value) => sum + value, 0) : null;
  const unlimited = okAccounts.every((item) => item.unlimited);

  return {
    currency: 'USD',
    balance: null,
    quota: { unlimited, limit: null, used: usedSum, remaining: null },
    usage: { todayRequests: null, todayCost: null, totalCost: usedSum },
    accounts,
    meta: {
      mode: 'billing',
      usageScope: 'cumulative-per-key',
      keyCount: accounts.length,
      okCount: okAccounts.length,
      ...(panelError && panelError.message ? { panelError: panelError.message } : {}),
    },
  };
}

async function loadDeepseek(ctx, entry) {
  const key = str(entry.apiKey);
  if (!key) return { status: 'missing-key', message: '未配置 DeepSeek API Key' };

  const res = await requestJson(ctx, DEEPSEEK_URL, {
    Authorization: `Bearer ${key}`,
    accept: 'application/json',
  });
  if (!res.ok) throw httpError(res.status);
  if (!res.json) throw new QuotaError('upstream', '上游返回内容无法解析');

  const infos = Array.isArray(res.json.balance_infos) ? res.json.balance_infos : [];
  const first = infos[0];
  if (!first || typeof first !== 'object') throw new QuotaError('upstream', '上游未返回余额信息');

  const currency = str(first.currency);
  const normalizedCurrency = currency === 'USD' || currency === 'CNY' ? currency : null;

  return {
    currency: normalizedCurrency,
    balance: num(first.total_balance),
    usage: {
      todayRequests: null,
      todayCost: null,
      totalCost: null,
      isValid: typeof res.json.is_available === 'boolean' ? res.json.is_available : null,
      mode: null,
    },
    meta: {
      grantedBalance: num(first.granted_balance),
      toppedUpBalance: num(first.topped_up_balance),
      upstreamCurrency: currency,
    },
  };
}

// ── 智谱 GLM（中国站：Authorization 放裸 key，业务错误是 200 + body.code）────

/** 智谱双域名回退：见 GLM_HOSTS 注释。返回最后一个响应，由调用方判定。 */
async function glmRequest(ctx, path, headers) {
  let last = null;
  for (const host of GLM_HOSTS) {
    const startedAt = Date.now();
    const res = await requestJson(ctx, `${host}${path}`, headers);
    if (res.ok) return res;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ai-quota] glm', new URL(host).host, path, res.status, `${Date.now() - startedAt}ms`);
    }
    last = res;
    if (![403, 405, 451].includes(res.status)) return res;
  }
  return last;
}

function glmBusinessError(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.success === false) return str(json.msg) || '上游返回业务错误';
  const code = json.code;
  if (code !== undefined && code !== null && code !== '') {
    const n = Number(String(code).trim());
    if (Number.isFinite(n) ? n !== 0 && n !== 200 : true) return str(json.msg) || '上游返回业务错误';
  }
  return null;
}

function glmWindows(limits) {
  if (!Array.isArray(limits)) return null;
  const windows = [];
  for (let index = 0; index < limits.length; index += 1) {
    const item = limits[index];
    if (!item || typeof item !== 'object') continue;
    const type = str(item.type);
    windows.push({
      key: type || `limit-${index + 1}`,
      label: (type && GLM_WINDOW_LABELS[type]) || type || `限额 ${index + 1}`,
      percent: clampPercent(item.percentage != null ? item.percentage : item.percent),
      resetsAt: isoOrNull(item.nextResetTime != null ? item.nextResetTime : item.resetsAt != null ? item.resetsAt : item.resetTime),
      status: str(item.status) || 'active',
    });
  }
  return windows.length ? windows : null;
}

/** 智谱资源包：只统计还有余量且未过期的包，列表按剩余量降序取前 5 个。 */
function glmTokenPackages(doc) {
  const rows = doc && Array.isArray(doc.rows) ? doc.rows : [];
  const nowMs = Date.now();
  const items = [];
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const balance = num(row.tokenBalance);
    if (balance == null || balance <= 0) continue;
    const expiry = str(row.packageExpirationTime || row.expirationTime);
    if (expiry) {
      const at = Date.parse(expiry.replace(' ', 'T'));
      if (Number.isFinite(at) && at < nowMs) continue;
    }
    total += balance;
    items.push({ name: str(row.resourcePackageName), balance, expiresAt: isoOrNull(expiry) });
  }
  items.sort((a, b) => b.balance - a.balance);
  return { total: total > 0 ? total : null, items: items.slice(0, 5) };
}

async function loadGlm(ctx, entry) {
  const key = str(entry.apiKey);
  if (!key) return { status: 'missing-key', message: '未配置智谱 GLM API Key' };

  // 中国站按裸 key 鉴权（不加 Bearer）
  const headers = { Authorization: key, accept: 'application/json' };
  const [balRes, planRes, packRes] = await Promise.allSettled([
    glmRequest(ctx, GLM_BALANCE_PATH, headers),
    glmRequest(ctx, GLM_PLAN_PATH, headers),
    glmRequest(ctx, GLM_TOKEN_PACKAGES_PATH, headers),
  ]);

  const errors = [];
  let planMissing = false;

  /**
   * 计划接口对没订阅 Coding Plan 的账号回 `{code:500,msg:"当前用户不存在coding plan"}`：
   * 这是"没有套餐"，不是鉴权失败，不能判成 auth。
   */
  const inspect = (settled, { allowNoPlan = false } = {}) => {
    if (settled.status === 'rejected') {
      errors.push(settled.reason);
      return null;
    }
    const res = settled.value;
    if (!res.ok) {
      errors.push(httpError(res.status));
      return null;
    }
    if (!res.json) {
      errors.push(new QuotaError('upstream', '上游返回内容无法解析'));
      return null;
    }
    const businessError = glmBusinessError(res.json);
    if (businessError) {
      if (allowNoPlan && /coding\s*plan/i.test(businessError)) {
        planMissing = true;
        return null;
      }
      throw new QuotaError('auth', businessError);
    }
    return res.json;
  };

  const balanceDoc = inspect(balRes);
  const planDoc = inspect(planRes, { allowNoPlan: true });
  const packDoc = inspect(packRes);
  if (!balanceDoc && !planDoc && !packDoc) throw errors[0] || new QuotaError('upstream', '上游均不可用');

  const data = balanceDoc && balanceDoc.data && typeof balanceDoc.data === 'object' ? balanceDoc.data : null;
  const planData = planDoc && planDoc.data && typeof planDoc.data === 'object' ? planDoc.data : null;
  const windows = glmWindows(planData && planData.limits);
  const packages = glmTokenPackages(packDoc);

  const available = data
    ? num(data.availableBalance) != null
      ? num(data.availableBalance)
      : num(data.balance)
    : null;
  const todaySpend = data ? num(data.todaySpendAmount) : null;

  const messages = [];
  if (!balanceDoc) messages.push('余额接口不可用');
  if (planMissing) messages.push('未开通 Coding Plan');
  if (!packDoc) messages.push('资源包接口不可用');

  return {
    status: 'ok',
    message: messages.length ? messages.join('；') : null,
    currency: 'CNY',
    balance: available,
    quota: null,
    windows,
    usage: {
      todayRequests: null,
      todayCost: todaySpend,
      totalCost: data ? num(data.totalSpendAmount) : null,
      isValid: null,
      mode: null,
      todayTokens: null,
      totalTokens: packages.total,
    },
    series: null,
    meta: {
      rechargeAmount: data ? num(data.rechargeAmount) : null,
      totalSpendAmount: data ? num(data.totalSpendAmount) : null,
      giveAmount: data ? num(data.giveAmount) : null,
      frozenBalance: data ? num(data.frozenBalance) : null,
      planAvailable: Boolean(planData) && !planMissing,
      tokenBalanceTotal: packages.total,
      tokenPackages: packages.items,
      rawLimits: planData && Array.isArray(planData.limits) ? planData.limits : null,
      ...(errors.length ? { partialError: errors[0].message } : {}),
    },
  };
}

// ── 对外唯一入口 ────────────────────────────────────────────────────────────

/**
 * 并发查询六家上游，返回契约里的 provider 数组（顺序与 PROVIDER_DEFS 一致）。
 * 任一上游失败只影响自己：runProvider 内部已把异常收敛成 status/message。
 * @param {object} options
 * @param {Function} options.fetch   fetch 兼容实现（Worker 与 Node 共用）
 * @param {object} options.keys      .ai-quota.keys.json 内容
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retryDelayMs]
 * @param {number} [options.nowMs]
 * @param {Function} [options.uuid]  仅 OpenCode GO 需要 x-opencode-session
 * @returns {Promise<Array<object>>}
 */
export async function collectProviders(options = {}) {
  const {
    fetch: fetchImpl,
    keys = {},
    timeoutMs = UPSTREAM_TIMEOUT_MS,
    retryDelayMs = TOOLCODE_RETRY_DELAY_MS,
    nowMs = Date.now(),
    uuid = () => '00000000-0000-4000-8000-000000000000',
  } = options;

  const ctx = {
    fetch: fetchImpl,
    timeoutMs,
    retryDelayMs,
    uuid,
    isoNow: new Date(nowMs).toISOString(),
    ymd: ymdInShanghai(nowMs),
  };

  const settled = await Promise.allSettled(PROVIDER_DEFS.map((def) => runProvider(def, ctx, keys[def.id])));
  return settled.map((entry, index) =>
    entry.status === 'fulfilled'
      ? entry.value
      : baseProvider(PROVIDER_DEFS[index], { status: 'upstream', message: '查询失败', updatedAt: ctx.isoNow }),
  );
}

export { PROVIDER_DEFS, UPSTREAM_TIMEOUT_MS, TOOLCODE_RETRY_DELAY_MS };
