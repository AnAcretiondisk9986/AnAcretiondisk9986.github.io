// AI 额度查询代理（本机侧）：读密钥文件 + 30s 缓存 + CLI。
// 取数与归一化在 scripts/ai-quota-core.mjs —— 同一份核心也被 Cloudflare Worker 打包使用，
// 两边逻辑只有一处。数据契约：docs/ai-quota-contract.md。
//
// 用法：
//   import { createQuotaService } from './scripts/ai-quota-proxy.mjs';
//   const service = createQuotaService();
//   const envelope = await service.readAll({ force: true });
//
//   node scripts/ai-quota-proxy.mjs            # 人类摘要 + 格式化 JSON
//   node scripts/ai-quota-proxy.mjs --json     # 只输出 JSON
//   node scripts/ai-quota-proxy.mjs --json --force

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  baseProvider,
  collectProviders,
  PROVIDER_DEFS,
  TOOLCODE_RETRY_DELAY_MS,
  UPSTREAM_TIMEOUT_MS,
} from './ai-quota-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_KEYS_FILE = resolve(PROJECT_ROOT, '.ai-quota.keys.json');
const DEFAULT_TTL_MS = 30_000;

// ── 服务工厂 ────────────────────────────────────────────────────────────────

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

export function createQuotaService(options = {}) {
  const {
    keysFile,
    fetchImpl,
    now = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    env = process.env,
    retryDelayMs = TOOLCODE_RETRY_DELAY_MS,
    timeoutMs = UPSTREAM_TIMEOUT_MS,
  } = options;

  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : (...args) => globalThis.fetch(...args);
  const cacheTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Number(ttlMs) : 0;

  let cache = null;
  let inflight = null;

  function nowMs() {
    const raw = typeof now === 'function' ? now() : Date.now();
    const value = raw instanceof Date ? raw.getTime() : Number(raw);
    return Number.isFinite(value) ? value : Date.now();
  }

  async function readKeys() {
    const fromEnv = env && env.AI_QUOTA_KEYS_FILE ? String(env.AI_QUOTA_KEYS_FILE) : '';
    const path = fromEnv ? resolve(fromEnv) : keysFile ? resolve(String(keysFile)) : DEFAULT_KEYS_FILE;
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('密钥文件必须是 JSON 对象');
    }
    return parsed;
  }

  async function collect() {
    const at = nowMs();
    const generatedAt = new Date(at).toISOString();

    let keys = null;
    try {
      keys = await readKeys();
    } catch {
      // 密钥文件读不到 / 不是合法 JSON：全部 provider 标 config-error，envelope ok:false
      return {
        ok: false,
        generatedAt,
        cacheSeconds: Math.round(cacheTtlMs / 1000),
        providers: PROVIDER_DEFS.map((def) =>
          baseProvider(def, { status: 'config-error', message: '密钥文件读取失败或格式错误', updatedAt: generatedAt }),
        ),
      };
    }

    const providers = await collectProviders({
      fetch: fetchFn,
      keys,
      timeoutMs,
      retryDelayMs,
      nowMs: at,
      uuid: () => randomUUID(),
    });

    return {
      ok: true,
      generatedAt,
      cacheSeconds: Math.round(cacheTtlMs / 1000),
      providers,
    };
  }

  async function readAll({ force = false } = {}) {
    const at = nowMs();
    if (!force && cacheTtlMs > 0 && cache && at - cache.at < cacheTtlMs) {
      return clonePayload(cache.payload);
    }
    if (!force && inflight) return clonePayload(await inflight);

    const task = collect();
    inflight = task;
    try {
      const payload = await task;
      // 只有真正读到密钥（ok:true）才缓存：密钥文件修好后不必等缓存过期
      if (payload.ok && cacheTtlMs > 0) cache = { at: nowMs(), payload };
      return clonePayload(payload);
    } finally {
      if (inflight === task) inflight = null;
    }
  }

  return { readAll, readKeys };
}

// ── CLI（联调用）───────────────────────────────────────────────────────────

function renderSummary(payload) {
  const lines = [
    `AI 额度快照  ${payload.generatedAt}  ok=${payload.ok}  缓存 ${payload.cacheSeconds}s`,
  ];
  for (const provider of payload.providers) {
    const bits = [`${provider.label}（${provider.id}）`, provider.status];
    if (provider.balance != null) bits.push(`${provider.currency || ''} ${provider.balance}`.trim());
    if (provider.quota) {
      if (provider.quota.unlimited) bits.push(`额度不限${provider.quota.used != null ? `，已用 ${provider.quota.used}` : ''}`);
      else if (provider.quota.remaining != null) bits.push(`剩余 ${provider.quota.remaining}`);
    }
    if (Array.isArray(provider.windows) && provider.windows.length) {
      bits.push(
        `窗口 ${provider.windows
          .map((w) => `${w.label} ${w.percent == null ? '—' : `${w.percent}%`}`)
          .join(' / ')}`,
      );
    }
    if (provider.usage && provider.usage.todayCost != null) bits.push(`今日 ${provider.usage.todayCost}`);
    if (provider.usage && provider.usage.totalCost != null) bits.push(`累计 ${provider.usage.totalCost}`);
    if (provider.usage && provider.usage.todayTokens && provider.usage.todayTokens.total != null) {
      bits.push(`今日 token ${provider.usage.todayTokens.total}`);
    }
    if (provider.message) bits.push(`说明：${provider.message}`);
    lines.push(`  · ${bits.join(' | ')}`);
  }
  return lines.join('\n');
}

async function main() {
  const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('-')));
  const service = createQuotaService({ env: process.env });
  const payload = await service.readAll({ force: flags.has('--force') });

  if (!flags.has('--json')) {
    process.stdout.write(`${renderSummary(payload)}\n\n`);
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`AI 额度查询失败：${message}\n`);
    process.exitCode = 1;
  });
}
