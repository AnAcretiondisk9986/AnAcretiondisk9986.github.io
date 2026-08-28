// 批量生成画廊缩略图：扫描本地图片仓库 image/ 下的主图（webp/jfif/jpg/png），
// 输出 480px 宽、quality 70 的 webp 到 image/thumb/（文件名与主图同名，扩展名统一 .webp）。
// 用法: node scripts/gen-thumbs.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const THUMB_WIDTH = 480;
const THUMB_QUALITY = 70;
const IMAGE_EXT = /\.(webp|jfif|jpg|jpeg|png)$/i;

const imgRepo = process.argv[2] || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '..', 'blog-images');
const imageDir = path.join(imgRepo, 'image');
const thumbDir = path.join(imageDir, 'thumb');
const force = process.argv.includes('--force');

if (!fs.existsSync(imageDir)) {
  console.error(`图片仓库目录不存在: ${imageDir}`);
  process.exit(1);
}
fs.mkdirSync(thumbDir, { recursive: true });

const files = fs.readdirSync(imageDir).filter((f) => IMAGE_EXT.test(f));
console.log(`发现 ${files.length} 个主图文件`);

let ok = 0, skip = 0, fail = 0;
for (const f of files) {
  const src = path.join(imageDir, f);
  const outName = `${path.parse(f).name}.webp`;
  const out = path.join(thumbDir, outName);
  if (!force && fs.existsSync(out)) { skip++; continue; }
  try {
    await sharp(src)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(out);
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    ok++;
    if (ok <= 5 || force) console.log(`  ✓ ${outName} (${kb} KB)`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${f}: ${e.message}`);
  }
}
const total = (fs.readdirSync(thumbDir).length);
console.log(`完成: 新生成 ${ok}, 已存在跳过 ${skip}, 失败 ${fail}; thumb 目录现有 ${total} 个文件`);
