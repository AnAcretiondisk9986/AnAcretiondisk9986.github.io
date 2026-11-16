/**
 * 管理服务的进程控制（Electron 主进程使用，也可脱离 Electron 测试）。
 * 职责：挑端口 → 拉起 admin-server.mjs → 等待 /admin 可访问 → 退出时关闭。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';

/** 端口是否可用（能成功监听即视为空闲） */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/** 让系统分配一个空闲端口 */
export function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 优先使用期望端口，被占用时退回系统分配 */
export async function pickPort(preferred) {
  if (preferred && await isPortFree(preferred)) return preferred;
  return freePort();
}

/** 轮询一个 http 地址直到返回 2xx */
export function waitForHttp(url, { timeoutMs = 25000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode);
          return;
        }
        retry(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy(new Error('timeout')));
    };
    const retry = (err) => {
      if (Date.now() > deadline) {
        reject(new Error(`等待服务就绪超时：${url}（${err?.message || 'no response'}）`));
        return;
      }
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}

/**
 * 拉起管理服务并等待就绪。
 * @returns {Promise<{port:number, child:import('node:child_process').ChildProcess, stop:()=>void, url:string}>}
 */
export async function startAdminServer({
  repoDir,
  port,
  env = {},
  log = () => {},
  nodePath = process.env.npm_node_execpath || process.env.BLOG_NODE || 'node',
  timeoutMs = 25000,
} = {}) {
  const script = join(repoDir, 'admin-server.mjs');
  const child = spawn(nodePath, [script], {
    cwd: repoDir,
    env: {
      ...process.env,
      // 不要在服务端自己打开浏览器：这是桌面应用，不是浏览器流程
      ADMIN_NO_OPEN: '1',
      PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => log(chunk.trimEnd()));
  child.stderr?.on('data', (chunk) => log(chunk.trimEnd()));

  // spawn 失败（找不到 node、cwd 不存在）与「刚启动就退出」都归为启动失败
  const failed = new Promise((_, reject) => {
    child.once('error', (err) => reject(new Error(`启动管理服务失败（${nodePath}）：${err.message}`)));    child.once('exit', (code, signal) => reject(new Error(`管理服务启动后立即退出（code=${code} signal=${signal}）`)));
  });
  failed.catch(() => {}); // 避免竞速结束后产生未处理的拒绝

  const url = `http://127.0.0.1:${port}/admin`;
  try {
    await Promise.race([waitForHttp(url, { timeoutMs }), failed]);
  } catch (err) {
    try { child.kill(); } catch { /* 忽略 */ }
    throw err;
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { child.kill(); } catch { /* 忽略 */ }
  };

  return { port, child, stop, url };
}
