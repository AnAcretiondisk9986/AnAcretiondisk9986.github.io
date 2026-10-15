#!/usr/bin/env node
/**
 * 主题变量块的特异性归一化。
 *
 * 背景：视觉主题样式从「随主 CSS 一起打包」改为「独立 <link> 按需加载」后，
 * 主题样式表的**加载顺序**排到了 Astro 打包出的主样式表（含 tokens.css）之前。
 * 于是 tokens.css 里的 `:root[data-theme='dark'] { --paper: … }` 与主题文件里的
 * `:root[data-visual-theme='x'] { --paper: … }` 特异性相同（都是 0,2,0），
 * 后加载的 tokens 反而获胜 —— 表现为「切主题后底色/文字色不再变化」。
 *
 * 修法：把主题文件中**纯 :root 选择器块**的 `:root` 提升为 `:root:root`
 * （特异性 0,2,0 → 0,3,0），使其稳定压过 tokens 的默认与暗色默认值，
 * 与「主题文件排在最后」时的原始层叠结果一致。
 *
 * 只处理「选择器仅由 :root + 属性选择器组成」的块，**不触碰**任何后代选择器
 * （如 `:root[data-visual-theme='x'] .foo`），以免改变主题与 fusion-theme.css
 * 之间的覆盖关系。幂等，可重复运行。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['cyanotype-theme.css', 'minimal-theme.css', 'liquid-theme.css'];

// 纯 :root 选择器块：选择器只含 :root 与 [...]（可跨多行、逗号分隔），随后紧跟 {
const ROOT_ONLY_BLOCK = /(^|\n)([ \t]*(?::root(?:\[[^\]]*\])*[ \t]*,[ \t]*\n)*[ \t]*:root(?:\[[^\]]*\])*[ \t]*\{)/g;

let total = 0;
for (const name of FILES) {
  const path = join(ROOT, 'public', 'themes', name);
  const src = readFileSync(path, 'utf8');
  let count = 0;
  const next = src.replace(ROOT_ONLY_BLOCK, (_m, lead, block) => {
    const upgraded = block.replace(/:root/g, ':root:root');
    if (upgraded !== block) count += 1;
    return lead + upgraded;
  });
  if (next !== src) writeFileSync(path, next, 'utf8');
  console.log(`${name}: 提升 ${count} 个变量块`);
  total += count;
}
console.log(`\n合计 ${total} 个块（幂等：重复运行不会重复提升）`);
