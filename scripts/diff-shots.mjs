// 对比两组截图（perf-reports/shots/<a> 与 <b>）：逐像素统计差异比例
// 用法：node scripts/diff-shots.mjs before pruned
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [a, b] = process.argv.slice(2);
const dirA = join(ROOT, 'perf-reports', 'shots', a);
const dirB = join(ROOT, 'perf-reports', 'shots', b);
const rows = [];
for (const f of (await readdir(dirA)).filter((n) => n.endsWith('.png'))) {
  const [ia, ib] = await Promise.all([dirA, dirB].map((d) => sharp(join(d, f)).raw().ensureAlpha().toBuffer({ resolveWithObject: true }).catch(() => null)));
  if (!ia || !ib) { rows.push({ file: f, note: 'missing' }); continue; }
  if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) {
    rows.push({ file: f, note: `size ${ia.info.width}x${ia.info.height} → ${ib.info.width}x${ib.info.height}` });
    continue;
  }
  let diff = 0;
  for (let i = 0; i < ia.data.length; i += 4) {
    if (Math.abs(ia.data[i] - ib.data[i]) + Math.abs(ia.data[i + 1] - ib.data[i + 1]) + Math.abs(ia.data[i + 2] - ib.data[i + 2]) > 24) diff++;
  }
  const pct = (diff / (ia.info.width * ia.info.height)) * 100;
  if (pct > 0.05) rows.push({ file: f, note: `${pct.toFixed(2)}% px` });
}
console.log(rows.length ? rows.map((r) => `${r.file}: ${r.note}`).join('\n') : 'identical (≤0.05% px)');
