// 一次性迁移脚本：把 public/image/ 全部图片压缩为 WebP，输出到图片仓库工作目录
// （../blog-images/image/），并生成旧路径 -> jsDelivr 外链 的映射 JSON。
//
// 用法：node scripts/migrate-images.mjs
// 产物：
//   ../blog-images/image/<原名>.webp     压缩后的图片（png/jpg/jpeg 转 WebP；其余格式原样复制）
//   scripts/.migrate-map.json            旧路径(/image/xxx) -> 新外链 映射，供替换引用用

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'public', 'image');
const OUT_DIR = path.join(ROOT, '..', 'blog-images', 'image');
const MAP_FILE = path.join(ROOT, 'scripts', '.migrate-map.json');

const QUALITY = 78;
const MAX_WIDTH = 1920;
const CONVERT_EXT = new Set(['.png', '.jpg', '.jpeg']);
const GITHUB_USER = 'AnAcretiondisk9986';
const IMG_REPO = 'blog-images';
const CDN_PREFIX = `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${IMG_REPO}@main/image/`;

let total = 0, converted = 0, copied = 0, skipped = 0;
const map = {};

async function main() {
  const files = (await fs.readdir(SRC_DIR)).filter((f) => !f.startsWith('.'));
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    const stat = await fs.stat(srcPath);
    if (!stat.isFile()) continue;
    total++;

    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, ext);

    if (CONVERT_EXT.has(ext)) {
      const outName = `${base}.webp`;
      const outPath = path.join(OUT_DIR, outName);
      let pipeline = sharp(srcPath);
      const meta = await pipeline.metadata();
      if (meta.width && meta.width > MAX_WIDTH) {
        pipeline = pipeline.resize({ width: MAX_WIDTH });
      }
      await pipeline.webp({ quality: QUALITY }).toFile(outPath);
      converted++;
      map[`/image/${file}`] = `${CDN_PREFIX}${encodeURIComponent(outName)}`;
    } else {
      // gif / webp / svg 等：原样复制，保留原扩展名
      await fs.copyFile(srcPath, path.join(OUT_DIR, file));
      copied++;
      map[`/image/${file}`] = `${CDN_PREFIX}${encodeURIComponent(file)}`;
    }
  }

  await fs.writeFile(MAP_FILE, JSON.stringify(map, null, 2));
  const outSize = await dirSize(OUT_DIR);
  console.log(`完成：共 ${total} 张 → 转换 ${converted}、原样复制 ${copied}、跳过 ${skipped}`);
  console.log(`图片仓库目录：${OUT_DIR}（总大小 ${(outSize / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`映射表已写入：${MAP_FILE}`);
}

async function dirSize(dir) {
  let size = 0;
  for (const f of await fs.readdir(dir)) {
    size += (await fs.stat(path.join(dir, f))).size;
  }
  return size;
}

main().catch((err) => {
  console.error('迁移失败：', err);
  process.exit(1);
});
