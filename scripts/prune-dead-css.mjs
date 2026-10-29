// 删除死 CSS：选择器里引用的类名 / ID 在源码与构建产物中都不存在的规则
//
// 判定是静态的：从 src/**/*.{astro,ts,js,md,json}、public/**/*.html 与 dist/**/*.{html,js}
// 收集所有出现过的标识符（\w- 片段），某个复合选择器只要有一个类名或 ID 不在其中，就判为死。
// 选择器列表里只删死的那几项；全部都死才删整条规则。没有类名 / ID 的选择器（元素、属性）一律保留。
//
// 用法：
//   node scripts/prune-dead-css.mjs src/styles/global.css [...]          # 只报告
//   node scripts/prune-dead-css.mjs --write src/styles/global.css [...]  # 原地改写
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => !a.startsWith('--'));

async function* walk(dir, exts) {
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'node_modules') yield* walk(p, exts); }
    else if (exts.includes(extname(d.name))) yield p;
  }
}

const corpus = new Set();
const sources = [
  [join(ROOT, 'src'), ['.astro', '.ts', '.js', '.mjs', '.md', '.json']],
  [join(ROOT, 'public'), ['.html']],
  [join(ROOT, 'dist'), ['.html', '.js']],
];
for (const [dir, exts] of sources) {
  for await (const f of walk(dir, exts)) {
    if (f.includes(`${join('src', 'styles')}`)) continue;
    for (const m of (await readFile(f, 'utf8')).matchAll(/[A-Za-z_][\w-]*/g)) corpus.add(m[0]);
  }
}

// 类名 / ID：去掉 :not(...) / :is(...) / :where(...) / :has(...) 内部再提取，
// 因为这些伪类里的类名不存在时选择器仍可能命中
const refs = (sel) => {
  let s = sel;
  for (let i = 0; i < 5; i++) s = s.replace(/:(not|is|where|has)\([^()]*\)/g, '');
  return [...s.matchAll(/[.#]([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
};
const alive = (sel) => refs(sel).every((n) => corpus.has(n));

for (const file of files) {
  const css = await readFile(file, 'utf8');
  const root = postcss.parse(css);
  let droppedRules = 0, droppedSelectors = 0;
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    const keep = rule.selectors.filter(alive);
    if (keep.length === 0) { droppedRules++; droppedSelectors += rule.selectors.length; rule.remove(); }
    else if (keep.length < rule.selectors.length) { droppedSelectors += rule.selectors.length - keep.length; rule.selectors = keep; }
  });
  // 清掉删空的 @media / @supports
  let changed = true;
  while (changed) {
    changed = false;
    root.walkAtRules((at) => {
      if (/^(media|supports|container)$/.test(at.name) && (!at.nodes || at.nodes.length === 0)) { at.remove(); changed = true; }
    });
  }
  // 删掉没有被任何 animation 引用的 @keyframes
  const out = root.toString();
  const used = new Set([...out.matchAll(/animation(?:-name)?\s*:([^;}]+)/g)].flatMap((m) => m[1].split(/[\s,]+/)));
  let droppedKf = 0;
  root.walkAtRules(/keyframes$/, (at) => { if (!used.has(at.params.trim())) { droppedKf++; at.remove(); } });
  const result = root.toString().replace(/\n{3,}/g, '\n\n');
  console.log(`${file}: ${css.length} → ${result.length} bytes · 删规则 ${droppedRules} · 删选择器 ${droppedSelectors} · 删 keyframes ${droppedKf}`);
  if (write) await writeFile(file, result);
}
