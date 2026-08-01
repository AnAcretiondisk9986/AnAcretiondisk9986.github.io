// 一次性迁移脚本：按 scripts/.migrate-map.json 把博客中的 /image/xxx 引用
// 替换为 jsDelivr 外链（md 文章、src/data/*.json）。
// 用法：node scripts/replace-image-refs.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MAP_FILE = path.join(ROOT, 'scripts', '.migrate-map.json');
const TARGETS = [
  path.join(ROOT, 'src', 'content', 'blog'),
  path.join(ROOT, 'src', 'data', 'about.json'),
  path.join(ROOT, 'src', 'data', 'gallery.json'),
];

const map = JSON.parse(await fs.readFile(MAP_FILE, 'utf8'));
// 长 key 优先，避免前缀误伤
const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);

async function walk(dir) {
  const out = [];
  for (const f of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...await walk(p));
    else if (/\.(md|json)$/.test(f.name)) out.push(p);
  }
  return out;
}

let totalReplaced = 0;
for (const file of [...await walk(TARGETS[0]), ...TARGETS.slice(1)]) {
  let text = await fs.readFile(file, 'utf8');
  let count = 0;
  for (const [oldPath, newUrl] of entries) {
    let idx;
    while ((idx = text.indexOf(oldPath)) !== -1) {
      text = text.slice(0, idx) + newUrl + text.slice(idx + oldPath.length);
      count++;
    }
  }
  if (count > 0) {
    await fs.writeFile(file, text);
    totalReplaced += count;
    console.log(`${path.relative(ROOT, file)}: 替换 ${count} 处`);
  }
}
console.log(`总计替换 ${totalReplaced} 处引用`);
