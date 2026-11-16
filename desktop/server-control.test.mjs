/**
 * 桌面外壳的进程控制测试：端口挑选、就绪探测、真实拉起管理服务。
 * 运行：npm run test:desktop
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, isPortFree, pickPort, startAdminServer, waitForHttp } from './server-control.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function listen(handler) {
  return new Promise((resolveSrv) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolveSrv(srv));
  });
}

describe('端口挑选', () => {
  test('端口空闲时返回期望端口', async () => {
    const port = await freePort();
    assert.equal(await isPortFree(port), true);
    assert.equal(await pickPort(port), port);
  });

  test('端口被占用时改选其他端口', async () => {
    const srv = await listen((_req, res) => res.end('x'));
    const busy = srv.address().port;
    try {
      assert.equal(await isPortFree(busy), false);
      const picked = await pickPort(busy);
      assert.notEqual(picked, busy);
      assert.equal(await isPortFree(picked), true);
    } finally {
      srv.close();
    }
  });
});

describe('就绪探测', () => {
  test('服务可用时立即通过', async () => {
    const srv = await listen((_req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      assert.equal(await waitForHttp(`http://127.0.0.1:${srv.address().port}/`), 200);
    } finally {
      srv.close();
    }
  });

  test('始终无响应时超时报错', async () => {
    const port = await freePort();
    await assert.rejects(
      () => waitForHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 600, intervalMs: 100 }),
      /超时/,
    );
  });

  test('返回非 2xx 时继续重试直到超时', async () => {
    const srv = await listen((_req, res) => { res.writeHead(503); res.end(); });
    try {
      await assert.rejects(
        () => waitForHttp(`http://127.0.0.1:${srv.address().port}/`, { timeoutMs: 600, intervalMs: 100 }),
        /超时/,
      );
    } finally {
      srv.close();
    }
  });
});

describe('拉起管理服务', () => {
  test('真实启动 admin-server，/admin 可访问且注入口令', async () => {
    const port = await freePort();
    const token = 'desktop-test-token';
    const logs = [];
    const server = await startAdminServer({
      repoDir: REPO,
      port,
      env: { ADMIN_TOKEN: token, ADMIN_AUTO_PULL: '0' },
      log: (line) => logs.push(line),
      timeoutMs: 40000,
    });
    try {
      assert.equal(server.url, `http://127.0.0.1:${port}/admin`);
      const html = await new Promise((resolveHtml, reject) => {
        http.get(server.url, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolveHtml(body));
        }).on('error', reject);
      });
      assert.match(html, /ACR—ADMIN/, '应返回管理面板页面');
      assert.match(html, new RegExp(`window\\.__ADMIN_TOKEN__ = "${token}"`), '应注入当前口令');
    } finally {
      server.stop();
    }

    // 关闭后端口应被释放
    const deadline = Date.now() + 10000;
    let freed = false;
    while (Date.now() < deadline) {
      freed = await isPortFree(port);
      if (freed) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(freed, true, '停止后应释放端口');
  });

  test('脚本不存在时给出明确错误', async () => {
    await assert.rejects(
      () => startAdminServer({ repoDir: resolve(REPO, 'no-such-dir'), port: 1, timeoutMs: 3000 }),
      /启动后立即退出|超时|失败/,
    );
  });
});
