#!/usr/bin/env node
/**
 * localize-images.mjs — 把文章/gallery 里的 jsDelivr 图片搬成本地静态资源
 * ----------------------------------------------------------------------------
 * 背景：全站几百张正文图挂在 cdn.jsdelivr.net 上，国内冷缓存要回源 GitHub，
 *      经常 1–3 s 才出图，而且和本站不同源、吃不到自己的缓存规则。
 *
 * 做法：
 *   1. 扫 src/**（md / json / astro / ts）里的 blog-images@main/image/... 引用；
 *   2. 缺哪张下哪张（raw.githubusercontent.com），sharp 压到长边 1600 / webp q80；
 *      顺带生成 480px 缩略图（卡片封面用，原来仓库里只有 16 张，其余一直 404 回退）；
 *   3. 写 public/images/ext/，维护 scripts/lib/image-map.json；
 *   4. 已存在的直接跳过 —— 构建期跑一遍只补新增，CI 上几乎零成本。
 *
 * 纪律：
 *   · 单张失败只记 warning，绝不阻塞构建（postbuild 会保留原始 URL）；
 *   · image/original/ 是大图（供“查看原图”点击），保持远端不搬；
 *   · 只做等比缩放 + 格式转换，不裁剪、不加滤镜。
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const REPO = 'AnAcretiondisk9986/blog-images';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const EXT_DIR = 'public/images/ext';
const MAP_FILE = 'scripts/lib/image-map.json';
const MAX_EDGE = 1600;
const THUMB_EDGE = 480;
const QUALITY = 80;
const CONCURRENCY = 6;
const TIMEOUT_MS = 60_000;

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

function collectUrls(text) {
  const urls = new Set();
  const re = /https:\/\/cdn\.jsdelivr\.net\/gh\/AnAcretiondisk9986\/blog-images@main\/(image\/[^\s"'<>)\]]+)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/[`,;.)]+$/, '');
    if (!raw || raw.includes('/image/original/')) continue; // 原图不搬
    if (/[<>&]/.test(raw) || /\/xxx\./i.test(raw)) continue; // 文档里的占位示例
    urls.add(`https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/${raw}`);
  }
  return urls;
}

function localPathFor(url) {
  const path = url.split('@main/')[1]; // image/xxx.webp
  const rel = path.replace(/^image\//, '').replace(/\.[^./]+$/, '.webp');
  return `/images/ext/${rel}`;
}

async function exists(p) {
  try {
    const st = await stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'dsh-localize' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function sharpOf() {
  const { default: sharp } = await import('sharp');
  return sharp;
}

async function encode(sharp, buffer) {
  const image = sharp(buffer, { failOn: 'none', animated: false }).rotate();
  const full = image
    .clone()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 4 });
  const thumb = image
    .clone()
    .resize({ width: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 });
  return { full: await full.toBuffer(), thumb: await thumb.toBuffer() };
}

const thumbAbsFor = (abs) => join('public/images/ext/thumb', abs.split(/[\\/]/).pop());

async function main() {
  const files = await walk('src');
  const urls = new Set();
  for (const file of files) {
    if (!/\.(md|mdx|json|astro|ts|js|mjs)$/i.test(file)) continue;
    const text = await readFile(file, 'utf8');
    if (!text.includes('blog-images@main/')) continue;
    for (const u of collectUrls(text)) urls.add(u);
  }

  const list = [...urls].sort();
  let map = {};
  try {
    map = JSON.parse(await readFile(MAP_FILE, 'utf8'));
  } catch {
    map = {};
  }

  const todo = [];
  const thumbTodo = [];
  for (const url of list) {
    const local = localPathFor(url);
    const abs = join('public', local.replace(/^\//, ''));
    const hasFull = await exists(abs);
    if (hasFull) map[url] = local;
    else todo.push({ url, local, abs });
    if (hasFull && !local.includes('/thumb/') && !(await exists(thumbAbsFor(abs)))) {
      thumbTodo.push(abs);
    }
  }

  console.log(`[images] 引用 ${list.length} 张：已有 ${list.length - todo.length}，待下载 ${todo.length}，待补缩略图 ${thumbTodo.length}`);

  const sharp = await sharpOf();
  let done = 0;
  let failed = 0;
  let bytes = 0;
  const queue = [...todo];

  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        const path = job.url.split('@main/')[1];
        const source = RAW + path.split('/').map(encodeURIComponent).join('/');
        const buffer = await download(source);
        const { full, thumb } = await encode(sharp, buffer);
        await mkdir(dirname(job.abs), { recursive: true });
        await writeFile(job.abs, full);
        if (!job.local.includes('/thumb/')) {
          await mkdir(dirname(thumbAbsFor(job.abs)), { recursive: true });
          await writeFile(thumbAbsFor(job.abs), thumb);
        }
        map[job.url] = job.local;
        bytes += full.length;
        done += 1;
        if (done % 20 === 0 || done === todo.length) {
          process.stdout.write(`\r[images] ${done}/${todo.length} 完成，失败 ${failed}，累计 ${(bytes / 1048576).toFixed(1)}MB   `);
        }
      } catch (error) {
        failed += 1;
        console.warn(`\n[images] 跳过 ${job.url.split('/').pop()?.slice(0, 60)}：${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length || 1) }, worker));

  // 已有原图但缺缩略图的：直接读本地文件补，不再联网
  let thumbDone = 0;
  const thumbQueue = [...thumbTodo];
  async function thumbWorker() {
    for (;;) {
      const abs = thumbQueue.shift();
      if (!abs) return;
      try {
        const buffer = await readFile(abs);
        const { thumb } = await encode(sharp, buffer);
        const target = thumbAbsFor(abs);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, thumb);
        thumbDone += 1;
      } catch (error) {
        console.warn(`\n[images] 缩略图失败 ${abs.split(/[\\/]/).pop()}：${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, thumbQueue.length || 1) }, thumbWorker));
  if (thumbDone) console.log(`[images] 补缩略图 ${thumbDone} 张`);

  const verified = {};
  for (const [url, local] of Object.entries(map)) {
    if (await exists(join('public', local.replace(/^\//, '')))) verified[url] = local;
  }

  await mkdir(dirname(MAP_FILE), { recursive: true });
  await writeFile(MAP_FILE, `${JSON.stringify(verified, null, 2)}\n`, 'utf8');
  console.log(`[images] 映射 ${Object.keys(verified).length} 条 → ${MAP_FILE}`);
}

main().catch((error) => {
  console.warn('[images] 本地化失败，继续构建：', error?.message || error);
  process.exit(0);
});
