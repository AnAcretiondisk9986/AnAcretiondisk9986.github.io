#!/usr/bin/env node
/**
 * ai-quota-snapshot.mjs — /ai-quota/ 的构建期快照
 * ----------------------------------------------------------------------------
 * 为什么需要它：页面本身是静态站（GitHub Pages），额度数据要等浏览器打到
 * Cloudflare Worker 才回来。国内直连 workers.dev 经常 3–15s 甚至直接卡死，
 * 于是「打开页面 → 六张卡全是骨架 → 等十几秒」就是现在这副样子。
 *
 * 做法：构建时在 CI 里先抓一份，写进 public/quota/snapshot.json；
 *      页面构建时把这份 JSON 内联进 HTML（见 src/pages/ai-quota.astro），
 *      浏览器一拿到 HTML 就能画出上一份读数，随后再由前端静默回源覆盖。
 *
 * 纪律：
 *   · 抓不到就沿用旧快照、退出码 0 —— 构建绝不能因为 API 抽风而失败；
 *   · 只做原样搬运，不改字段、不补 0，契约（docs/ai-quota-contract.md）说了算；
 *   · 快照带 savedAt，前端据此标注「快照 · 时间」，不会冒充实时数据。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUT_FILE = resolve('public/quota/snapshot.json');
const TIMEOUT_MS = 12_000;

/** 依次尝试：显式环境变量 → 站点 endpoint → Worker 默认地址 */
const CANDIDATES = [
  process.env.AI_QUOTA_SNAPSHOT_ENDPOINT,
  process.env.PUBLIC_AI_QUOTA_ENDPOINT,
  'https://ai-quota.anacretiondisk.workers.dev/api/ai-quota',
].filter((value) => typeof value === 'string' && /^https?:\/\//i.test(value));

async function grab(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new Error(`content-type ${contentType || '(空)'}`);
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.providers)) {
      throw new Error('响应不是契约形状（缺 providers 数组）');
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function readExisting() {
  try {
    const raw = await readFile(OUT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.payload ? parsed : null;
  } catch {
    return null;
  }
}

let fresh = null;
for (const url of CANDIDATES) {
  try {
    const payload = await grab(url);
    fresh = { savedAt: new Date().toISOString(), endpoint: url, payload };
    console.log(`[ai-quota] 快照已更新：${payload.providers.length} 个服务 ← ${url}`);
    break;
  } catch (error) {
    console.warn(`[ai-quota] 抓取失败 ${url}：${error instanceof Error ? error.message : error}`);
  }
}

if (!fresh) {
  const previous = await readExisting();
  console.warn(
    previous
      ? '[ai-quota] 本轮抓取全部失败，沿用上一份快照，构建继续'
      : '[ai-quota] 没有历史快照，页面将退化为纯骨架（仍然构建通过）',
  );
  process.exit(0);
}

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, `${JSON.stringify(fresh)}\n`, 'utf8');
console.log(`[ai-quota] 写入 ${OUT_FILE}`);
