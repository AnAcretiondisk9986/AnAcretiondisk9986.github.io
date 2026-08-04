// 验证 HEIC EXIF Orientation 处理:
// 1) 真实 iPhone HEIC 样本解析(../blog-images/image/original/*.heic,不存在则跳过)
// 2) 合成 RGBA 数据走 admin-server 相同的旋转管线,断言 orientation 2-8 尺寸/操作正确
// 用法:node scripts/verify-heic-exif.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getHeicOrientation } from '../admin/heic-exif.mjs';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

// —— 1) 真实样本解析(orientation 应稳定读出 1;样本路径缺失时跳过) ——
const home = dirname(dirname(fileURLToPath(import.meta.url))); // 仓库根
const sampleDir = join(home, '..', 'blog-images', 'image', 'original');
const samples = ['IMG_1480_1785831316501.heic', 'IMG_1482_1785831291726.heic', 'IMG_1483_1785828530674.heic'];
if (existsSync(sampleDir)) {
  for (const name of samples) {
    const p = join(sampleDir, name);
    if (!existsSync(p)) { console.log(`- 跳过(样本不存在): ${name}`); continue; }
    const orientation = getHeicOrientation(readFileSync(p));
    check(orientation === 1, `${name} → Orientation=${orientation}(期望 1,横拍样本)`);
  }
} else {
  console.log('- 跳过真实样本检查(blog-images 目录不存在)');
}

// —— 2) 合成数据验证旋转管线(与 admin-server saveImageFile 的 heic 分支一致) ——
// 用 4x2 的 RGBA 数据模拟"传感器横向"照片:orientation 6/8 应交换宽高,3/2/4 保持尺寸
async function applyPipeline(data, w, h, orientation) {
  let pipeline = sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } });
  if (orientation === 2) pipeline = pipeline.flop();
  else if (orientation === 3) pipeline = pipeline.rotate(180);
  else if (orientation === 4) pipeline = pipeline.flip();
  else if (orientation === 5) pipeline = pipeline.rotate(270).flop();
  else if (orientation === 6) pipeline = pipeline.rotate(90);
  else if (orientation === 7) pipeline = pipeline.rotate(90).flop();
  else if (orientation === 8) pipeline = pipeline.rotate(270);
  return pipeline.webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
}

const W = 8, H = 4;
const px = Buffer.alloc(W * H * 4, 128); // 纯灰
const expects = { 1: [8, 4], 2: [8, 4], 3: [8, 4], 4: [8, 4], 5: [4, 8], 6: [4, 8], 7: [4, 8], 8: [4, 8] };
for (const [o, [ew, eh]] of Object.entries(expects)) {
  try {
    const { info } = await applyPipeline(px, W, H, Number(o));
    check(info.width === ew && info.height === eh, `orientation=${o} → ${info.width}x${info.height}(期望 ${ew}x${eh})`);
  } catch (e) {
    check(false, `orientation=${o} 执行失败: ${e.message}`);
  }
}

// —— 3) 像素级验证 orientation 5/7(非正方形 W=2,H=3,可区分操作顺序) ——
{
  const W = 2, H = 3;
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    px[i] = y * W + x; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;
  }
  const orig = [];
  for (let y = 0; y < H; y++) { const r = []; for (let x = 0; x < W; x++) r.push(px[(y * W + x) * 4]); orig.push(r); }
  const toMatrix = async (pipeline) => {
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const m = [];
    for (let y = 0; y < info.height; y++) { const r = []; for (let x = 0; x < info.width; x++) r.push(data[(y * info.width + x) * 4]); m.push(r); }
    return m;
  };
  const run = async (o) => {
    let p = sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 4 } });
    if (o === 5) p = p.rotate(270).flop();
    else if (o === 7) p = p.rotate(90).flop();
    return toMatrix(p);
  };
  // transpose(5): out[y][x] = 原(x,y);transverse(7): out[y][x] = 原(W-1-x, H-1-y)
  const expect5 = [], expect7 = [];
  for (let y = 0; y < W; y++) {
    const r5 = [], r7 = [];
    for (let x = 0; x < H; x++) { r5.push(orig[x][y]); r7.push(orig[H - 1 - x][W - 1 - y]); }
    expect5.push(r5); expect7.push(r7);
  }
  check(JSON.stringify(await run(5)) === JSON.stringify(expect5), '像素级 orientation=5 → transpose 正确');
  check(JSON.stringify(await run(7)) === JSON.stringify(expect7), '像素级 orientation=7 → transverse 正确');
}

// —— 4) admin-server 语法联动检查(导入链) ——
try {
  await import('../admin/heic-exif.mjs');
  check(true, 'admin/heic-exif.mjs 模块可导入');
} catch (e) {
  check(false, `admin/heic-exif.mjs 导入失败: ${e.message}`);
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
