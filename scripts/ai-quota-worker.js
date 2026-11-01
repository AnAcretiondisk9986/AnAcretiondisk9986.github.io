// AI 额度查询代理（Cloudflare Worker）—— 静态站线上取数用。
// 取数与归一化在 scripts/ai-quota-core.mjs：worker 与本地 admin-server 打包同一份代码，
// 数据契约见 docs/ai-quota-contract.md。
//
// 部署（wrangler 会把 core 一起打包，不需要额外步骤）：
//   npx wrangler login
//   cat .ai-quota.keys.json | npx wrangler secret put AI_QUOTA_KEYS_JSON --config deploy/ai-quota-worker/wrangler.toml
//   npx wrangler deploy --config deploy/ai-quota-worker/wrangler.toml
//
// 密钥两种来源，任选其一：
//   a) env.AI_QUOTA_KEYS_JSON —— 与 .ai-quota.keys.json 同结构的 JSON 字符串（推荐，一次配齐）；
//   b) 分项 env.OPENCODE_GO_API_KEY / YUNDU_API_KEY / TOOLCODE_API_KEY /
//      TAFFCLOUD_API_KEY / TAFFCLOUD_ACCESS_TOKEN / TAFFCLOUD_USER_ID / DEEPSEEK_API_KEY / GLM_API_KEY。
//
// env.ALLOWED_ORIGIN 支持逗号分隔的多个来源（默认只放 https://blog.acretiondisk.top；
// 本地联调时可追加 http://127.0.0.1:4321）。

import { baseProvider, collectProviders, PROVIDER_DEFS } from './ai-quota-core.mjs';

const DEFAULT_ALLOWED_ORIGIN = 'https://blog.acretiondisk.top';
const DEFAULT_TTL_MS = 30_000;

/** 30s 模块级缓存：Worker 实例复用时不再回源，force=1 绕过。 */
let cache = null;
let inflight = null;

function parseKeys(env) {
  const raw = env && env.AI_QUOTA_KEYS_JSON ? String(env.AI_QUOTA_KEYS_JSON) : '';
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI_QUOTA_KEYS_JSON 必须是 JSON 对象');
    }
    return parsed;
  }
  return {
    'opencode-go': { apiKey: env.OPENCODE_GO_API_KEY || '' },
    yundu: { apiKey: env.YUNDU_API_KEY || '' },
    toolcode: { apiKey: env.TOOLCODE_API_KEY || '' },
    taffcloud: {
      apiKey: env.TAFFCLOUD_API_KEY || '',
      accessToken: env.TAFFCLOUD_ACCESS_TOKEN || '',
      userId: env.TAFFCLOUD_USER_ID || '',
    },
    deepseek: { apiKey: env.DEEPSEEK_API_KEY || '' },
    glm: { apiKey: env.GLM_API_KEY || '' },
  };
}

async function collect(env) {
  const generatedAt = new Date().toISOString();
  let keys = null;
  try {
    keys = parseKeys(env);
  } catch {
    return {
      ok: false,
      generatedAt,
      cacheSeconds: Math.round(DEFAULT_TTL_MS / 1000),
      providers: PROVIDER_DEFS.map((def) =>
        baseProvider(def, { status: 'config-error', message: '密钥读取失败或格式错误', updatedAt: generatedAt }),
      ),
    };
  }

  const providers = await collectProviders({
    fetch: (...args) => fetch(...args),
    keys,
    nowMs: Date.now(),
    uuid: () => crypto.randomUUID(),
  });

  return { ok: true, generatedAt, cacheSeconds: Math.round(DEFAULT_TTL_MS / 1000), providers };
}

async function readAll(env, { force = false } = {}) {
  const at = Date.now();
  if (!force && cache && at - cache.at < DEFAULT_TTL_MS) return cache.payload;
  if (!force && inflight) return inflight;

  const task = collect(env);
  inflight = task;
  try {
    const payload = await task;
    if (payload.ok) cache = { at: Date.now(), payload };
    return payload;
  } finally {
    if (inflight === task) inflight = null;
  }
}

// ── HTTP 入口 ──────────────────────────────────────────────────────────────

function corsHeaders(env, request) {
  const raw = (env && env.ALLOWED_ORIGIN) || DEFAULT_ALLOWED_ORIGIN;
  const list = String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origin = request && request.headers ? request.headers.get('Origin') : null;
  const allow = origin && list.includes(origin) ? origin : list[0] || DEFAULT_ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(payload, env, request, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(env, request),
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (request.method !== 'GET') {
      return jsonResponse({ ok: false, error: '只支持 GET /api/ai-quota' }, env, request, 405);
    }

    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    try {
      const payload = await readAll(env, { force });
      return jsonResponse(payload, env, request);
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      return jsonResponse(
        {
          ok: false,
          generatedAt: new Date().toISOString(),
          cacheSeconds: Math.round(DEFAULT_TTL_MS / 1000),
          providers: [],
          error: `额度查询服务异常：${message}`,
        },
        env,
        request,
      );
    }
  },
};
