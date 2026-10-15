#!/usr/bin/env node
/**
 * 图片资源优化脚本（可重复运行）。
 *
 * 两类处理：
 *  A. 同路径替换：站点图标类资源（引用方不变），只降尺寸/质量。
 *  B. 转 WebP 新文件：文章正文大图，产出 .webp 后需同步更新 Markdown 引用
 *     （引用更新由 scripts/rewrite-image-refs.mjs 完成）。
 *
 * 用法：
 *   node scripts/optimize-images.mjs --dry-run   # 只报告预估，不写文件
 *   node scripts/optimize-images.mjs             # 执行
 */
import sharp from 'sharp';
import { stat, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const DRY = process.argv.includes('--dry-run');

/** A. 引用不变，原地替换 */
const INPLACE = [
  // 页头/页脚 48×48 显示 → 96×96 足够 2x 清晰（原 512×512 / 51.9KB）
  { file: 'public/logo-primary.webp', kind: 'webp', quality: 88, resize: { width: 96, height: 96, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } } },
  // CSS content 替换用暗色版，同样 48×48 显示（原 512×512 / 75.9KB）
  { file: 'public/logo-primary-dark.webp', kind: 'webp', quality: 88, resize: { width: 96, height: 96, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } } },
  // 档案印章：最大显示 400×400，保留 512 边长但降低质量（原 69.2KB）
  { file: 'public/logo.webp', kind: 'webp', quality: 76 },
  // favicon：128×128 → 64×64（浏览器标签实际 16–32px 渲染）
  { file: 'public/favicon.png', kind: 'png', resize: { width: 64, height: 64, fit: 'contain' } },
  { file: 'public/favicon-dark.png', kind: 'png', resize: { width: 64, height: 64, fit: 'contain' } },
];

/** B. 产出新的 .webp 文件（文章正文大图） */
const CONVERT = [
  { file: 'public/images/anatomy-question-screenshot.png', out: 'public/images/anatomy-question-screenshot.webp', quality: 82 },
  // 2560px 宽远超正文显示宽度（约 800px），收到 1600 仍有 2x 余量
  { file: 'public/images/pideck-answer-screenshot.png', out: 'public/images/pideck-answer-screenshot.webp', quality: 82, resize: { width: 1600 } },
  { file: 'public/images/医学扩招-中国新闻网-2026-09-14.jpg', out: 'public/images/医学扩招-中国新闻网-2026-09-14.webp', quality: 78 },
  { file: 'public/images/bili-screenshot/options.png', out: 'public/images/bili-screenshot/options.webp', quality: 84 },
  { file: 'public/images/bili-screenshot/commit-history.png', out: 'public/images/bili-screenshot/commit-history.webp', quality: 84 },
];

const kb = (n) => (n / 1024).toFixed(1);

async function sizeOf(rel) {
  try { return (await stat(join(ROOT, rel))).size; } catch { return null; }
}

async function run() {
  const rows = [];
  const pendingWrites = []; // { path, buf }：全部算完再落盘，避免半途失败留下不一致状态
  let before = 0, after = 0;

  for (const t of INPLACE) {
    const src = join(ROOT, t.file);
    const prevSize = await sizeOf(t.file);
    if (prevSize === null) { rows.push({ file: t.file, note: '缺失，跳过' }); continue; }
    // 先读入内存：Windows 上 libvips 会对源文件持有句柄，直接覆写同一路径会 UNKNOWN 错误
    const input = await readFile(src);
    let pipe = sharp(input);
    if (t.resize) pipe = pipe.resize(t.resize);
    const buf = t.kind === 'png'
      ? await pipe.png({ compressionLevel: 9, palette: true, effort: 7 }).toBuffer()
      : await pipe.webp({ quality: t.quality, effort: 6 }).toBuffer();
    const meta = await sharp(buf).metadata();
    if (buf.length < prevSize) pendingWrites.push({ path: src, buf });
    before += prevSize; after += buf.length;
    rows.push({ file: t.file, from: prevSize, to: buf.length, dims: `${meta.width}x${meta.height}`, mode: 'replace', kept: buf.length >= prevSize });
  }

  for (const t of CONVERT) {
    const prevSize = await sizeOf(t.file);
    if (prevSize === null) { rows.push({ file: t.file, note: '缺失，跳过' }); continue; }
    const input = await readFile(join(ROOT, t.file));
    let pipe = sharp(input);
    if (t.resize) pipe = pipe.resize(t.resize);
    const buf = await pipe.webp({ quality: t.quality, effort: 6 }).toBuffer();
    const meta = await sharp(buf).metadata();
    pendingWrites.push({ path: join(ROOT, t.out), buf });
    before += prevSize; after += buf.length;
    rows.push({ file: t.file, out: t.out, from: prevSize, to: buf.length, dims: `${meta.width}x${meta.height}`, mode: 'convert' });
  }

  if (!DRY) for (const w of pendingWrites) await writeFile(w.path, w.buf);

  console.log(`\n=== 图片优化${DRY ? '（dry-run，未写入）' : ''} ===\n`);
  console.log('mode     原KB     新KB     降幅     尺寸        文件');
  for (const r of rows) {
    if (r.note) { console.log(`skip     ${''.padEnd(8)} ${''.padEnd(8)} ${''.padEnd(8)} ${''.padEnd(11)} ${r.file} (${r.note})`); continue; }
    const drop = ((1 - r.to / r.from) * 100).toFixed(1);
    const kept = r.kept ? '  [新版更大，保留原文件]' : '';
    console.log(
      `${r.mode.padEnd(9)}${kb(r.from).padStart(7)}  ${kb(r.to).padStart(7)}  ${(drop + '%').padStart(7)}  ${r.dims.padEnd(11)} ${r.file}${r.out ? ' → ' + r.out : ''}${kept}`,
    );
  }
  console.log(`\n合计：${kb(before)}KB → ${kb(after)}KB（省 ${kb(before - after)}KB，${((1 - after / before) * 100).toFixed(1)}%）`);
  if (DRY) console.log('\n这是预估结果，去掉 --dry-run 才会真正写入。');
}

run().catch((e) => { console.error(e); process.exit(1); });
