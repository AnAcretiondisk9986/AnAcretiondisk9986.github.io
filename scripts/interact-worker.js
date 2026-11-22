/**
 * 轻量跨访客互动服务（Cloudflare Worker + KV 脚手架）。
 * ----------------------------------------------------------------------------
 * 提供两项能力：
 *   1. 「03 日常」真实跨访客共鸣点赞计数：
 *      - GET  /api/interact/daily?ids=id1,id2,...  -> { ok: true, counts: { id1: 3, ... } }
 *      - POST /api/interact/daily/:id/like         -> body { action: 'like' | 'unlike' }
 *   2. 文章与日常的轻量纯文字留言：
 *      - GET    /api/interact/comments?target=/blog/xxx/  -> { ok: true, comments: [...] }
 *      - POST   /api/interact/comments                    -> { target, nick, body, website }
 *      - DELETE /api/interact/comments?target=...&id=...  -> 需 Authorization: Bearer <ADMIN_SECRET>
 *
 * KV 绑定名称：INTERACT_KV（部署配置见 deploy/interact-worker/wrangler.toml）。
 * 也支持在单元测试中传入内存 KV mock 对象调用 handleInteractRequest()。
 */

const DEFAULT_ALLOWED_ORIGIN = 'https://blog.acretiondisk.top';
const MAX_COMMENT_LEN = 300;
const MAX_NICK_LEN = 30;
const MAX_COMMENTS_PER_TARGET = 120;
const RATE_WINDOW_MS = 10_000;

const ipCooldown = new Map();

function corsHeaders(request, env) {
  const origin = request?.headers?.get?.('Origin') || '';
  const allowed = String(env?.ALLOWED_ORIGIN || env?.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGIN)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin = origin && allowed.includes(origin) ? origin : (allowed[0] || DEFAULT_ALLOWED_ORIGIN);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResp(body, status, cors, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...cors,
    },
  });
}

function normalizeTarget(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 240) return '';
  if (!/^(\/blog\/|\/daily\/#|daily:|post:)/.test(s) && !s.startsWith('/')) return '';
  return s.replace(/[\r\n\t]/g, '');
}

function normalizeMomentId(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 80 || !/^[A-Za-z0-9_-]+$/.test(s)) return '';
  return s;
}

async function readJsonKv(kv, key, fallback) {
  if (!kv) return fallback;
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonKv(kv, key, value) {
  if (!kv) return;
  await kv.put(key, JSON.stringify(value));
}

function checkRateLimit(request, now = Date.now()) {
  const ip = request?.headers?.get?.('CF-Connecting-IP')
    || request?.headers?.get?.('X-Forwarded-For')
    || 'anon';
  const last = ipCooldown.get(ip) || 0;
  if (now - last < 1500) return false;
  ipCooldown.set(ip, now);
  if (ipCooldown.size > 2000) {
    for (const [k, ts] of ipCooldown.entries()) {
      if (now - ts > RATE_WINDOW_MS) ipCooldown.delete(k);
    }
  }
  return true;
}

export async function handleInteractRequest(request, env = {}) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const kv = env.INTERACT_KV;
  if (!kv) {
    return jsonResp({ ok: false, error: 'INTERACT_KV 未绑定，请先在 wrangler.toml 配置 KV 命名空间' }, 503, cors);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/interact/, '') || '/';

  if (path === '/health' && request.method === 'GET') {
    return jsonResp({ ok: true, mode: 'kv' }, 200, cors);
  }

  // ── 1. 日常共鸣计数（批量读取 / 点赞切换）──
  if (path === '/daily' && request.method === 'GET') {
    const ids = String(url.searchParams.get('ids') || '')
      .split(',')
      .map(normalizeMomentId)
      .filter(Boolean)
      .slice(0, 200);
    const map = await readJsonKv(kv, 'daily:likes', {});
    const counts = {};
    for (const id of ids) {
      const n = Number(map[id] || 0);
      if (n > 0) counts[id] = n;
    }
    return jsonResp({ ok: true, counts }, 200, cors, 'public, max-age=15');
  }

  const likeMatch = path.match(/^\/daily\/([^/]+)\/like$/);
  if (likeMatch && request.method === 'POST') {
    const id = normalizeMomentId(decodeURIComponent(likeMatch[1]));
    if (!id) return jsonResp({ ok: false, error: '无效的日常 ID' }, 400, cors);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const action = body?.action === 'unlike' ? 'unlike' : 'like';

    const map = await readJsonKv(kv, 'daily:likes', {});
    const cur = Math.max(0, Number(map[id] || 0));
    const next = action === 'unlike' ? Math.max(0, cur - 1) : cur + 1;
    if (next > 0) map[id] = next;
    else delete map[id];
    await writeJsonKv(kv, 'daily:likes', map);
    return jsonResp({ ok: true, id, count: next }, 200, cors);
  }

  // ── 2. 轻量留言（读取 / 发表 / 管理删除）──
  if (path === '/comments' && request.method === 'GET') {
    const target = normalizeTarget(url.searchParams.get('target'));
    if (!target) return jsonResp({ ok: false, error: '缺少有效 target' }, 400, cors);
    const list = await readJsonKv(kv, `comments:${target}`, []);
    return jsonResp({ ok: true, target, comments: Array.isArray(list) ? list : [] }, 200, cors);
  }

  if (path === '/comments' && request.method === 'POST') {
    if (!checkRateLimit(request)) {
      return jsonResp({ ok: false, error: '发送过于频繁，请稍后再试' }, 429, cors);
    }
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    if (String(body?.website || '').trim()) {
      // 蜜罐拦截垃圾提交，静默成功返回
      return jsonResp({ ok: true, comment: null }, 200, cors);
    }
    const target = normalizeTarget(body?.target);
    const text = String(body?.body || '').replace(/\r\n?/g, '\n').trim();
    const nick = String(body?.nick || body?.author || '').trim().slice(0, MAX_NICK_LEN) || '匿名观测者';
    if (!target) return jsonResp({ ok: false, error: '目标路径无效' }, 400, cors);
    if (!text) return jsonResp({ ok: false, error: '留言内容不能为空' }, 400, cors);
    if (text.length > MAX_COMMENT_LEN) {
      return jsonResp({ ok: false, error: `留言不能超过 ${MAX_COMMENT_LEN} 字` }, 400, cors);
    }

    const kvKey = `comments:${target}`;
    const existing = await readJsonKv(kv, kvKey, []);
    const list = Array.isArray(existing) ? existing : [];
    const comment = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      nick,
      body: text,
      createdAt: new Date().toISOString(),
    };
    const nextList = [comment, ...list].slice(0, MAX_COMMENTS_PER_TARGET);
    await writeJsonKv(kv, kvKey, nextList);
    return jsonResp({ ok: true, target, comment, total: nextList.length }, 201, cors);
  }

  if (path === '/comments' && request.method === 'DELETE') {
    const expected = String(env.ADMIN_SECRET || '').trim();
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!expected || token !== expected) {
      return jsonResp({ ok: false, error: '未授权删除操作' }, 401, cors);
    }
    const target = normalizeTarget(url.searchParams.get('target'));
    const id = String(url.searchParams.get('id') || '').trim();
    if (!target || !id) return jsonResp({ ok: false, error: '缺少 target 或 id' }, 400, cors);
    const kvKey = `comments:${target}`;
    const existing = await readJsonKv(kv, kvKey, []);
    const nextList = (Array.isArray(existing) ? existing : []).filter((c) => c.id !== id);
    await writeJsonKv(kv, kvKey, nextList);
    return jsonResp({ ok: true, target, remaining: nextList.length }, 200, cors);
  }

  return jsonResp({ ok: false, error: '未知互动接口' }, 404, cors);
}

export default {
  fetch: handleInteractRequest,
};
