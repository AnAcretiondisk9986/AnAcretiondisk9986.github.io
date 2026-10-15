#!/usr/bin/env node
/**
 * 清理图片仓库中「未被任何引用指向」的文件。
 *
 * 判定依据：文章正文（src/content/blog/*.md）+ src/data/{gallery,about,frontend}.json
 * 中出现的 `/image/...` 路径。三处易误判点已在匹配时处理：
 *   1. original 字段的 URL 带 `original/` 前缀，而目录里只有文件名 → 同时记录完整路径与文件名；
 *   2. thumb 是 `<原图basename>.webp`，与原图 `.jpg/.png` 扩展名不同 → 额外按「去扩展名主名」匹配；
 *   3. `image/original/` 是**原图归档**目录，其存在意义就是留档，默认**不参与清理**。
 *
 * 用法：
 *   node scripts/clean-orphan-images.mjs --dry-run   # 只列清单
 *   node scripts/clean-orphan-images.mjs --delete    # 实际删除
 */
import { readdirSync, readFileSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOG = fileURLToPath(new URL('..', import.meta.url));
const IMG_REPO = process.env.BLOG_IMAGES_DIR || 'C:/Users/AnAcretiondisk/Documents/blog-images';
const IMG = join(IMG_REPO, 'image');

const DELETE = process.argv.includes('--delete');

const byName = new Set();
const byStem = new Set();
const add = (u) => {
  if (!u) return;
  for (const m of String(u).matchAll(/\/image\/([^)"'\s]+)/g)) {
    let p = m[1];
    try { p = decodeURIComponent(p); } catch { /* 保留原串 */ }
    const name = p.split('/').pop();
    byName.add(name);
    byStem.add(name.replace(/\.[^.]+$/, ''));
  }
};

const blogDir = join(BLOG, 'src/content/blog');
for (const f of readdirSync(blogDir)) {
  if (/\.(md|mdx)$/i.test(f)) add(readFileSync(join(blogDir, f), 'utf8'));
}
for (const rel of ['src/data/gallery.json', 'src/data/about.json', 'src/data/frontend.json']) {
  const p = join(BLOG, rel);
  if (existsSync(p)) add(readFileSync(p, 'utf8'));
}

const collect = (dir, isUsed) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isFile() && !isUsed(f))
    .map((f) => ({ path: join(dir, f), size: statSync(join(dir, f)).size }));
};

const targets = [
  ...collect(IMG, (f) => byName.has(f)),
  ...collect(join(IMG, 'thumb'), (f) => byStem.has(f.replace(/\.[^.]+$/, ''))),
];

const totalMB = (targets.reduce((s, t) => s + t.size, 0) / 1048576).toFixed(1);
console.log(`引用索引：文件名 ${byName.size} / 主名 ${byStem.size}`);
console.log(`待清理：${targets.length} 个文件 / ${totalMB}MB${DELETE ? '' : '（dry-run）'}`);

if (!DELETE) {
  targets.sort((a, b) => b.size - a.size).forEach((t, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${(t.size / 1024).toFixed(1).padStart(8)}KB  ${t.path.replace(IMG_REPO + '/', '').replace(/\\/g, '/')}`);
  });
  console.log('\n加 --delete 才会真正删除。');
} else {
  let removed = 0;
  for (const t of targets) {
    try { unlinkSync(t.path); removed += 1; } catch (err) { console.warn(`删除失败 ${t.path}: ${err.message}`); }
  }
  console.log(`已删除 ${removed}/${targets.length} 个文件，释放约 ${totalMB}MB`);
}
