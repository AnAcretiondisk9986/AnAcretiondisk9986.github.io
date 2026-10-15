// 从 README 更新日志提取指定版本章节，生成 GitHub Release 的 notes。
// 用法：node scripts/make-releases.mjs            → dry-run，只打印提取结果
//       node scripts/make-releases.mjs --create   → 实际调用 gh release create
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // 项目根
const NOTES_DIR = join(ROOT, '.perf', 'releases');
process.chdir(ROOT); // git / gh 命令需要以仓库根为工作目录，便于从任意位置调用

const CREATE = process.argv.includes('--create');
// 缺失 Release 的版本。
// 注意：v3.3.1 **不在此列** —— README 3.3.1 章节明确写着该版本的 Release 已因
// 「全站背景图」功能回滚而主动撤销，缺失是刻意为之，不应擅自补建。
const VERSIONS = ['v1.0.0', 'v1.1.0', 'v3.5.3', 'v3.6.0', 'v3.6.1', 'v3.6.2', 'v3.7.0'];
const LATEST = 'v3.7.0';
// 少数章节没有 ### 小标题，标题需手动指定
const TITLE_OVERRIDE = { 'v1.0.0': 'v1.0.0: Astro 静态博客初始化' };

const lines = readFileSync(join(ROOT, 'README.md'), 'utf8').split(/\r?\n/);
const headingRe = /^##\s+v?([0-9][0-9A-Za-z.\-]*)（/;
// 章节的真正边界是「任意二级标题」，否则 v1.0.0 会把后面的「## 快速使用」一并吞掉
const anyH2Re = /^##\s+/;

// 收集所有版本章节的起止行
const starts = [];
for (let i = 0; i < lines.length; i++) {
  const m = headingRe.exec(lines[i]);
  if (m) starts.push({ version: 'v' + m[1], line: i });
}
const sectionOf = new Map();
starts.forEach((s, idx) => {
  let end = lines.length;
  for (let i = s.line + 1; i < lines.length; i++) {
    if (anyH2Re.test(lines[i])) { end = i; break; }
  }
  sectionOf.set(s.version, { body: lines.slice(s.line + 1, end) });
});

mkdirSync(NOTES_DIR, { recursive: true });

const summary = [];
for (const v of VERSIONS) {
  const sec = sectionOf.get(v);
  if (!sec) { console.log(`✖ ${v}: README 中找不到章节`); continue; }

  // 去掉尾部的分隔线与空行
  const body = [...sec.body];
  while (body.length && (body[body.length - 1].trim() === '' || body[body.length - 1].trim() === '---')) body.pop();

  // 标题取第一个 ### 小标题（去掉 emoji 与首尾空白）；无小标题时用手动映射
  const firstH3 = body.find((l) => /^###\s/.test(l)) || '';
  const titleText = firstH3.replace(/^###\s+/, '').replace(/^[\p{Emoji}\uFE0F\u200D\s]+/u, '').trim();
  const title = TITLE_OVERRIDE[v] || (titleText ? `${v}: ${titleText}` : v);

  const notes = body.join('\n').trim() + '\n';
  writeFileSync(join(NOTES_DIR, `${v}.md`), notes, 'utf8');
  summary.push({ v, title, bytes: notes.length, lines: body.length });
  console.log(`${v.padEnd(8)} ${String(notes.length).padStart(5)}B  ${body.length} 行  → ${title}`);
}

console.log('');
if (!CREATE) {
  console.log('干跑模式：notes 已写入 .perf/releases/，加 --create 才会真正创建 Release。');
} else {
  // 预取已有 Release，便于安全重跑（脚本可重复执行）
  const existing = new Set(
    execFileSync('gh', ['release', 'list', '--limit', '200'], { encoding: 'utf8' })
      .split('\n').map((l) => l.split('\t')[2]).filter(Boolean),
  );
  for (const s of summary) {
    if (existing.has(s.v)) { console.log(`↷ ${s.v} 已存在，跳过`); continue; }
    const args = ['release', 'create', s.v, '--title', s.title, '--notes-file', join(NOTES_DIR, `${s.v}.md`)];
    // --latest=false 是必须的：gh 默认会把新创建的 Release 标为 latest，
    // 补建历史版本时会抢走 v3.7.0 的 Latest 标记。
    args.push(s.v === LATEST ? '--latest' : '--latest=false');
    try {
      // 用 execFileSync 直接传参数数组，避免中文标题里的空格/冒号被 shell 二次解析
      execFileSync('gh', args, { stdio: 'pipe', encoding: 'utf8' });
      console.log(`✔ 已创建 Release ${s.v}`);
    } catch (err) {
      console.log(`✖ ${s.v} 创建失败: ${(err.stderr || err.message || '').toString().slice(0, 300)}`);
    }
  }
}
