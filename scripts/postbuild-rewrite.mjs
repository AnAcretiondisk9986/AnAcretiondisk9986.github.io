#!/usr/bin/env node
/**
 * postbuild-rewrite.mjs — 构建产物里的图片链接本地化
 * ----------------------------------------------------------------------------
 * 在 astro build 之后跑：把
 *   https://cdn.jsdelivr.net/.../blog-images@main/image/x.webp
 * 换成 /images/ext/x.webp（文件确实存在才换，否则保持远端，绝不改出 404）。
 *
 * 为什么不按映射表查：卡片封面和 480px 缩略图是构建时由 thumbOf() 拼出来的
 * （image/x.webp → image/thumb/x.webp），源码里没有字面量，只能按「本地有没有」
 * 判断。映射表仍然保留，用来记录本轮搬了哪些图。
 *
 * 顺带两件小事：
 *   · 每篇文档第一张 <img> 标 fetchpriority="high"（首屏 LCP 优先）；
 *   · 其余 <img> 补 loading="lazy" decoding="async"（不抢首屏带宽）。
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const SITE = 'https://blog.acretiondisk.top';
const CDN_PREFIX = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/';

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
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const cache = new Map();

/** CDN 路径 → 本地路径；本地没有就返回 null */
async function resolveLocal(path) {
  if (cache.has(path)) return cache.get(path);
  const rel = path.replace(/^image\//, '').replace(/\.[^./]+$/, '.webp');
  const local = `/images/ext/${rel}`;
  let ok = false;
  try {
    ok = (await stat(join('public', local))).isFile();
  } catch {
    ok = false;
  }
  const value = ok ? local : null;
  cache.set(path, value);
  return value;
}

async function main() {
  const files = await walk(DIST);
  let touched = 0;
  let replaced = 0;
  let lazy = 0;

  for (const file of files) {
    let html = await readFile(file, 'utf8');
    if (!html.includes('cdn.jsdelivr.net') && !html.includes('<img')) continue;

    const before = html;
    let count = 0;

    // 1) meta 里的 og:image / twitter:image：需要站点绝对地址
    const metas = [...html.matchAll(/(<meta[^>]+content=")https:\/\/cdn\.jsdelivr\.net\/gh\/AnAcretiondisk9986\/blog-images@main\/(image\/[^"]+)(")/g)];
    for (const m of metas) {
      const local = await resolveLocal(m[2]);
      if (!local) continue;
      html = html.split(m[0]).join(`${m[1]}${SITE}${local}${m[3]}`);
      count += 1;
    }

    // 2) 正文图片与缩略图
    const matches = [...html.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/AnAcretiondisk9986\/blog-images@main\/(image\/[^\s"'<>)]+)/g)];
    const seen = new Set();
    for (const m of matches) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      const local = await resolveLocal(m[1]);
      if (!local) continue;
      const hits = html.split(m[0]).length - 1;
      html = html.split(m[0]).join(local);
      count += hits;
    }

    // 3) 加载策略
    let index = 0;
    html = html.replace(/<img\b[^>]*>/g, (tag) => {
      let next = tag;
      if (!/\bloading=/.test(next)) {
        if (index === 0 && !/\bfetchpriority=/.test(next)) {
          next = next.replace(/<img\b/, '<img fetchpriority="high"');
        } else {
          next = next.replace(/<img\b/, '<img loading="lazy"').replace(/<img\b/, '<img decoding="async"');
          lazy += 1;
        }
      }
      index += 1;
      return next;
    });

    if (html !== before) {
      await writeFile(file, html, 'utf8');
      touched += 1;
      replaced += count;
    }
  }

  console.log(`[rewrite] 改写 ${replaced} 处图片链接，涉及 ${touched} 个页面，补 lazy ${lazy} 次`);

  let left = 0;
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    left += (html.match(/cdn\.jsdelivr\.net\/gh\/AnAcretiondisk9986\/blog-images@main\/image\//g) || []).length;
  }
  console.log(`[rewrite] 剩余远端图片引用（原图等未本地化的）：${left}`);
}

main().catch((error) => {
  console.warn('[rewrite] 跳过：', error?.message || error);
  process.exit(0);
});
