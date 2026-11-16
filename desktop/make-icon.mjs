/**
 * 生成桌面应用的 Windows 图标（desktop/icon.ico）。
 * 用仓库存放的 favicon/logo 作为源，输出多个尺寸的 PNG 负载型 ICO（Vista+ 支持）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'desktop', 'icon.ico');
const SOURCE = ['public/logo.webp', 'public/logo-primary.webp', 'public/favicon.png', 'public/favicon.svg']
  .map((p) => join(REPO, p))
  .find(existsSync);

if (!SOURCE) {
  console.error('找不到可用的图标源（public/logo*.webp 或 favicon）');
  process.exit(1);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const images = [];
for (const size of SIZES) {
  const png = await sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  images.push({ size, png });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = [];
for (const img of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // 0 表示 256
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
  entry.writeUInt8(0, 2); // 调色板数
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(img.png.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += img.png.length;
}

writeFileSync(OUT, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
console.log(`图标已生成：${OUT}（源 ${SOURCE.replace(REPO, '.')}，尺寸 ${SIZES.join('/')}）`);
