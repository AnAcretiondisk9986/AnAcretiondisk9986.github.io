// 对比 README 更新日志、git tag、GitHub Releases 三者，找出缺失项。
// 用法：node scripts/check-changelog.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // 项目根
process.chdir(ROOT); // git / gh 命令需要以仓库根为工作目录，便于从任意位置调用

const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

// 1) README 中的版本章节（形如 `## 3.7.0（2026-10-15）`）
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const readmeVersions = [];
for (const line of readme.split(/\r?\n/)) {
  const m = /^##\s+(?:v)?([0-9][0-9A-Za-z.\-]*)(?:（|\()?/.exec(line);
  if (m && /^\d+\.\d+/.test(m[1])) readmeVersions.push(m[1]);
}

// 2) git tags
const tags = new Set(run('git tag').split(/\r?\n/).filter(Boolean).map((t) => t.replace(/^v/, '')));

// 3) GitHub Releases
const releasesRaw = run('gh release list --limit 200');
const releaseVersions = new Set();
for (const line of releasesRaw.split(/\r?\n/)) {
  const m = /(v?[0-9][0-9A-Za-z.\-]*)\t/.exec(line) || /\t(v?[0-9][0-9A-Za-z.\-]*)\t/.exec(line);
  if (m) releaseVersions.add(m[1].replace(/^v/, ''));
}
// 兜底：从行内任一处 vX.Y.Z 抓取
for (const line of releasesRaw.split(/\r?\n/)) {
  for (const m of line.matchAll(/\bv([0-9]+\.[0-9]+[0-9A-Za-z.\-]*)\b/g)) releaseVersions.add(m[1]);
}

console.log(`README 版本章节 : ${readmeVersions.length}`);
console.log(`git tag        : ${tags.size}`);
console.log(`GitHub Release : ${releaseVersions.size}\n`);

const missingRelease = readmeVersions.filter((v) => !releaseVersions.has(v));
const missingTag = readmeVersions.filter((v) => !tags.has(v));

console.log('=== README 有、但 GitHub Release 缺失 ===');
for (const v of missingRelease) {
  console.log(`  v${v.padEnd(12)} tag=${tags.has(v) ? '有' : '缺'}`);
}
console.log('\n=== README 有、但 git tag 缺失 ===');
console.log('  ' + (missingTag.map((v) => 'v' + v).join(', ') || '(无)'));

console.log('\n=== 仅有 tag、README 无章节 ===');
console.log('  ' + ([...tags].filter((v) => !readmeVersions.includes(v)).map((v) => 'v' + v).join(', ') || '(无)'));
