/**
 * 手机端发文助手（/write/）Cloudflare Worker 鉴权与 GitHub API 代理。
 * ----------------------------------------------------------------------------
 * 作用：
 *   1. 将 GitHub PAT（GITHUB_TOKEN）安全保存在 Cloudflare Worker Secret 中，不在手机端留存；
 *   2. 手机端通过自设密码（WRITE_PASSWORD）换取 7 天有效期的 HMAC-SHA256 会话令牌；
 *   3. 严格限制仅代理博客正文目录、图床上传目录与 Actions 构建状态三个白名单路径；
 *   4. 同源或授权域 CORS 放行，兼顾国内访问 api.github.com 的稳定代理。
 *
 * 部署命令：
 *   npx wrangler secret put GITHUB_TOKEN --config deploy/mobile-write-worker/wrangler.toml
 *   npx wrangler secret put WRITE_PASSWORD --config deploy/mobile-write-worker/wrangler.toml
 *   npx wrangler deploy --config deploy/mobile-write-worker/wrangler.toml
 */

const BLOG_REPO = 'AnAcretiondisk9986/AnAcretiondisk9986.github.io';
const IMG_REPO = 'AnAcretiondisk9986/blog-images';
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

const ALLOWED_GH_PATHS = [
  new RegExp(`^/repos/${BLOG_REPO}/contents/src/content/blog(?:/[^?#]*)?(?:\\?.*)?$`),
  new RegExp(`^/repos/${BLOG_REPO}/contents/src/data/daily\\.json(?:\\?.*)?$`),
  new RegExp(`^/repos/${BLOG_REPO}/actions/runs(?:\\?.*)?$`),
  new RegExp(`^/repos/${IMG_REPO}/contents/(?:image|audio|video)/[^?#]+$`),
];

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || 'https://blog.acretiondisk.top')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResp(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getSigningKey(env) {
  const seed = env.SESSION_SECRET || `${env.WRITE_PASSWORD || ''}:${env.GITHUB_TOKEN || ''}`;
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toBase64Url(bytes) {
  let str = '';
  for (const b of new Uint8Array(bytes)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function issueToken(env) {
  const payload = JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, v: 1 });
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const key = await getSigningKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return { token: `${payloadB64}.${toBase64Url(sig)}`, expiresAt: Date.now() + TOKEN_TTL_MS };
}

async function verifyToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return false;
  try {
    const key = await getSigningKey(env);
    const sig = fromBase64Url(parts[1]);
    const ok = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(parts[0]));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    return Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/write/, '') || '/';

    if (path === '/health') {
      return jsonResp({ ok: true, configured: Boolean(env.GITHUB_TOKEN && env.WRITE_PASSWORD) }, 200, cors);
    }

    if (!env.GITHUB_TOKEN || !env.WRITE_PASSWORD) {
      return jsonResp({ error: 'Worker 尚未配置 GITHUB_TOKEN 或 WRITE_PASSWORD Secret' }, 503, cors);
    }

    if (path === '/auth' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { body = {}; }
      const expectedHash = await sha256Hex(String(env.WRITE_PASSWORD));
      const actualHash = await sha256Hex(String(body.password || ''));
      if (!timingSafeEqualStr(expectedHash, actualHash)) {
        return jsonResp({ error: '密码不正确' }, 401, cors);
      }
      const issued = await issueToken(env);
      return jsonResp({ ok: true, ...issued }, 200, cors);
    }

    // 其余代理请求需携带 Bearer Token
    const authHeader = request.headers.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!(await verifyToken(bearer, env))) {
      return jsonResp({ error: '登录已失效，请重新输入密码' }, 401, cors);
    }

    if (path.startsWith('/gh/')) {
      const ghPath = `${path.slice(3)}${url.search}`;
      if (!ALLOWED_GH_PATHS.some((re) => re.test(ghPath))) {
        return jsonResp({ error: '不允许访问该 GitHub API 路径' }, 403, cors);
      }
      const method = request.method.toUpperCase();
      if (!['GET', 'PUT', 'DELETE'].includes(method)) {
        return jsonResp({ error: '不支持的请求方法' }, 405, cors);
      }
      const upstream = await fetch(`https://api.github.com${ghPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'acretiondisk-mobile-write-worker/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: method !== 'GET' ? await request.text() : undefined,
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...cors,
        },
      });
    }

    return jsonResp({ error: 'Not Found' }, 404, cors);
  },
};
