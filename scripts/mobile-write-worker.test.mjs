import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../scripts/mobile-write-worker.js';

const baseEnv = {
  GITHUB_TOKEN: 'ghp_test_secret_token',
  WRITE_PASSWORD: 'my-strong-mobile-pass',
  ALLOWED_ORIGIN: 'https://blog.acretiondisk.top,http://127.0.0.1:4321',
};

test('mobile-write-worker /health reports configured status and CORS', async () => {
  const res = await worker.fetch(
    new Request('https://w.example.com/health', { headers: { Origin: 'https://blog.acretiondisk.top' } }),
    baseEnv,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://blog.acretiondisk.top');
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.configured, true);
});

test('mobile-write-worker /auth rejects wrong password and issues verifiable bearer token', async () => {
  const bad = await worker.fetch(
    new Request('https://w.example.com/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    }),
    baseEnv,
  );
  assert.equal(bad.status, 401);

  const ok = await worker.fetch(
    new Request('https://w.example.com/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: baseEnv.WRITE_PASSWORD }),
    }),
    baseEnv,
  );
  assert.equal(ok.status, 200);
  const auth = await ok.json();
  assert.ok(auth.token && auth.token.includes('.'));

  // 未授权访问代理拒绝 401
  const unauth = await worker.fetch(
    new Request('https://w.example.com/gh/repos/AnAcretiondisk9986/AnAcretiondisk9986.github.io/contents/src/content/blog'),
    baseEnv,
  );
  assert.equal(unauth.status, 401);

  // 非白名单仓库路径拒绝 403
  const forbidden = await worker.fetch(
    new Request('https://w.example.com/gh/repos/other/repo/contents/README.md', {
      headers: { Authorization: `Bearer ${auth.token}` },
    }),
    baseEnv,
  );
  assert.equal(forbidden.status, 403);

  // 白名单路径向 GitHub 转发且注入服务端 GITHUB_TOKEN
  const origFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedAuth = '';
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedAuth = init?.headers?.Authorization || '';
    return new Response(JSON.stringify([{ name: 'demo.md', type: 'file' }]), { status: 200 });
  };
  try {
    const proxied = await worker.fetch(
      new Request('https://w.example.com/api/write/gh/repos/AnAcretiondisk9986/AnAcretiondisk9986.github.io/contents/src/content/blog', {
        headers: { Authorization: `Bearer ${auth.token}` },
      }),
      baseEnv,
    );
    assert.equal(proxied.status, 200);
    assert.equal(capturedUrl, 'https://api.github.com/repos/AnAcretiondisk9986/AnAcretiondisk9986.github.io/contents/src/content/blog');
    assert.equal(capturedAuth, `Bearer ${baseEnv.GITHUB_TOKEN}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});
