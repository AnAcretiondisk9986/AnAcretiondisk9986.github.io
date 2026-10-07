/**
 * 浏览器级管理面板冒烟测试运行器。
 *
 * 行为：
 * 1. 探测 http://localhost:4322/admin 是否已在运行；未运行则自行以 ADMIN_NO_OPEN=1 启动。
 * 2. 依次运行 sync-center-e2e.mjs 与 post-list-e2e.mjs（均拦截 /api，不写文件、不推送）。
 * 3. 若由本脚本启动服务，结束后关闭。
 *
 * 用法：node scripts/run-admin-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:4322/admin';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

function runNode(script, args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}

let server = null;
let startedServer = false;

try {
  if (await isUp()) {
    console.log('检测到管理面板已在运行，直接复用。\n');
  } else {
    console.log('未检测到管理面板，正在启动（ADMIN_NO_OPEN=1）…');
    server = spawn(process.execPath, [join(ROOT, 'admin-server.mjs')], {
      cwd: ROOT,
      env: { ...process.env, ADMIN_NO_OPEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    startedServer = true;
    server.stdout.on('data', () => {});
    server.stderr.on('data', () => {});
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !(await isUp())) await sleep(300);
    if (!(await isUp())) throw new Error('管理面板启动超时');
    console.log('管理面板已启动。\n');
  }

  let failures = 0;
  for (const script of ['sync-center-e2e.mjs', 'post-list-e2e.mjs', 'post-form-e2e.mjs', 'editor-e2e.mjs', 'media-library-e2e.mjs', 'preflight-e2e.mjs', 'quality-e2e.mjs', 'verify-admin-core.mjs']) {
    console.log(`\n──────── ${script} ────────`);
    const code = await runNode(join(ROOT, 'scripts', script));
    if (code !== 0) failures += 1;
  }

  console.log(failures === 0 ? '\n=== 浏览器冒烟全部通过 ===' : `\n=== ${failures} 组浏览器冒烟失败 ===`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.error('运行失败：' + err.message);
  process.exitCode = 1;
} finally {
  if (startedServer && server) {
    server.kill();
    await sleep(300);
  }
}
