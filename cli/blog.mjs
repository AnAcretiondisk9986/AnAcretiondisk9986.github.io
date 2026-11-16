#!/usr/bin/env node
/**
 * 博客命令行管理工具：替代浏览器管理面板的全部日常操作。
 * 用法：node cli/blog.mjs help   （或 npm run blog -- help）
 */
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { GitCommandError } from '../admin/git-service.mjs';
import { displayWidth, padEnd } from './format.mjs';
import {
  CONTENT_PUSH_PATHS, FULL_PUSH_PATHS, CliError, SYNC_LABELS,
  blogGit, checkAll, createPost, dataStore, deriveSyncState, editDataFile, editPost,
  excerptOf, galleryAdd, galleryRemove, getPaths, importImage, imageGit, listPosts, listRevisions,
  normalizeFieldUpdates, readPost, readRevision, removePost, renamePost, setPrivatePassword,
  updatePost, warmCdn, writePost,
} from './core.mjs';

// ── 参数解析 ──

const BOOL_FLAGS = new Set([
  'yes', 'draft', 'edit', 'full', 'no-push', 'no-warm', 'no-images', 'json', 'help', 'fetch', 'force', 'password-stdin',
]);
const SHORT_FLAGS = { h: 'help', y: 'yes', e: 'edit', q: 'q' };

export function parseArgv(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      if (BOOL_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new CliError(`--${key} 需要一个值`, { exitCode: 2 });
      flags[key] = next;
      i += 1;
    } else if (arg.startsWith('-') && arg.length === 2 && SHORT_FLAGS[arg[1]]) {
      const key = SHORT_FLAGS[arg[1]];
      if (BOOL_FLAGS.has(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined) throw new CliError(`-${arg[1]} 需要一个值`, { exitCode: 2 });
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

// ── 输出工具 ──

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ''))));
  const line = (cells) => cells.map((c, i) => padEnd(c ?? '', widths[i])).join('  ').trimEnd();
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

const STATE_LABELS = { published: '已发布', draft: '草稿', scheduled: '定时', archived: '归档', private: '私密' };

function requireArg(value, message) {
  if (value === undefined || value === null || value === '') throw new CliError(message, { exitCode: 2 });
  return value;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

/** 交互确认；非交互环境必须显式 --yes */
async function confirm(question, flags) {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) throw new CliError('非交互环境下请加 --yes 确认操作');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** 隐藏输入（TTY 下不回显；管道输入时读取第一行） */
function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    return new Promise((resolveRead, reject) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { buf += chunk; });
      process.stdin.on('error', reject);
      process.stdin.on('end', () => resolveRead(buf.split(/\r?\n/)[0] ?? ''));
    });
  }
  return new Promise((resolveRead, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          finish();
          reject(new CliError('已取消'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          finish();
          process.stdout.write('\n');
          resolveRead(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// ── 文章 ──

async function cmdLs(_args, flags) {
  const p = getPaths();
  let posts = await listPosts(p);
  if (flags.status) posts = posts.filter((x) => x.state === flags.status);
  if (flags.access) posts = posts.filter((x) => x.access === flags.access);
  if (flags.tag) posts = posts.filter((x) => x.tags.includes(flags.tag));
  if (flags.q) {
    const q = String(flags.q).toLowerCase();
    posts = posts.filter((x) => [x.slug, x.title, x.description, x.excerpt].some((s) => s.toLowerCase().includes(q)));
  }
  const sort = flags.sort || 'date';
  posts.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title, 'zh');
    if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
    return b.pubDate.localeCompare(a.pubDate) || (b.dayIndex ?? 0) - (a.dayIndex ?? 0) || b.slug.localeCompare(a.slug);
  });
  if (flags.json) return printJson(posts);
  printTable(
    ['状态', '权限', '日期', '序号', 'slug', '标题'],
    posts.map((x) => [STATE_LABELS[x.state] ?? x.state, x.access, x.pubDate, x.dayIndex ?? '', x.slug, x.title]),
  );
  console.log(`\n共 ${posts.length} 篇`);
}

function publicUrl(post, siteOrigin) {
  if (post.state !== 'published') return '';
  return `${siteOrigin}/blog/${encodeURI(post.astroId)}/`;
}

async function cmdShow(args, flags) {
  const slug = requireArg(args[0], '用法：blog show <slug>');
  const p = getPaths();
  const post = await readPost(slug, p);
  const summary = (await listPosts(p)).find((x) => x.slug === slug);
  const info = { ...summary, file: post.file, contentHash: post.hash, url: publicUrl(summary, p.siteOrigin) };
  if (flags.json) return printJson(info);
  console.log(`标题：${info.title}`);
  console.log(`slug：${info.slug}`);
  console.log(`状态：${STATE_LABELS[info.state] ?? info.state}    权限：${info.access}`);
  console.log(`发布日期：${info.pubDate || '（未设置）'}    序号：${info.dayIndex ?? '-'}`);
  if (info.scheduledAt) console.log(`定时发布：${info.scheduledAt}`);
  console.log(`标签：${info.tags.join(', ') || '（无）'}`);
  console.log(`描述：${info.description || '（无）'}`);
  if (info.cover) console.log(`封面：${info.cover}`);
  console.log(`线上地址：${info.url || '（未公开）'}`);
  console.log(`文件：${post.file}`);
  console.log(`版本哈希：${post.hash.slice(0, 12)}`);
  console.log(`\n摘要：${excerptOf(post.content, 200)}`);
}

async function cmdNew(args, flags) {
  const title = requireArg(args.join(' '), '用法：blog new "标题" [--slug ..] [--tags a,b] [--access ..] [--draft] [--cover URL] [--date YYYY-MM-DD] [--edit]');
  const tags = flags.tags ? String(flags.tags).split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];
  const created = await createPost({
    title,
    slug: flags.slug,
    tags,
    access: flags.access || 'public',
    draft: flags.draft === true,
    pubDate: flags.date,
    cover: flags.cover || '',
  });
  console.log(`已创建：${created.slug}`);
  console.log(`文件：${created.file}`);
  if (flags.edit) await cmdEdit([created.slug], {});
}

async function cmdEdit(args) {
  const slug = requireArg(args[0], '用法：blog edit <slug>');
  const result = await editPost(slug);
  if (result.conflictRevision) {
    throw new CliError(
      `文章在编辑期间被其他入口修改（如管理面板）。你的版本已保存为修订 ${result.conflictRevision}，`
      + `可用 blog restore ${slug} ${result.conflictRevision} 恢复后再手动合并。`,
    );
  }
  if (!result.changed) return console.log('内容未变化，未保存。');
  console.log('已保存（修改前的版本已存入修订历史）。');
  for (const w of result.warnings) console.log(`警告：${w}`);
}

async function cmdSet(args) {
  const slug = requireArg(args[0], '用法：blog set <slug> key=value ...');
  const pairs = args.slice(1);
  if (!pairs.length) throw new CliError('请至少给出一个 key=value');
  const updates = normalizeFieldUpdates(pairs);
  const result = await updatePost(slug, updates);
  console.log(result.changed ? `已更新：${Object.keys(updates).join(', ')}` : '没有实际变化。');
}

async function cmdMv(args) {
  const [slug, newSlug] = args;
  requireArg(slug, '用法：blog mv <slug> <新slug>');
  requireArg(newSlug, '用法：blog mv <slug> <新slug>');
  await renamePost(slug, newSlug);
  console.log(`已重命名：${slug} → ${newSlug}`);
  console.log('注意：线上地址会随之改变，旧链接将失效。');
}

async function cmdRm(args, flags) {
  const slug = requireArg(args[0], '用法：blog rm <slug> --yes');
  if (!flags.yes) {
    const ok = await confirm(`删除文章「${slug}」？（删除前会保存修订快照）`, flags);
    if (!ok) return console.log('已取消。');
  }
  const id = await removePost(slug);
  console.log(`已删除：${slug}（修订快照 ${id}，可用 blog history / restore 恢复）`);
}

async function cmdHistory(args, flags) {
  const slug = requireArg(args[0], '用法：blog history <slug>');
  const revisions = await listRevisions(slug);
  if (flags.json) return printJson(revisions);
  if (!revisions.length) return console.log('没有修订记录。');
  printTable(['修订 ID', '保存时间', '大小(字节)'], revisions.map((r) => [r.id, r.savedAt, r.size]));
}

async function cmdRestore(args, flags) {
  const [slug, id] = args;
  requireArg(slug, '用法：blog restore <slug> <修订ID>');
  requireArg(id, '用法：blog restore <slug> <修订ID>');
  const raw = await readRevision(slug, id);
  let current = null;
  try {
    current = (await readPost(slug)).raw;
  } catch {
    current = null; // 文章已删除：直接恢复
  }
  if (!flags.yes && !(await confirm(`用修订 ${id} 覆盖「${slug}」的当前版本？`, flags))) return console.log('已取消。');
  await writePost(slug, raw, { previousRaw: current });
  console.log(`已恢复：${slug} ← ${id}（覆盖前的版本已存入修订历史）`);
}

async function cmdCheck(_args, flags) {
  const issues = await checkAll();
  if (flags.json) return printJson(issues);
  if (!issues.length) return console.log('全部文章校验通过。');
  for (const i of issues) console.log(`${i.level === 'error' ? '错误' : '警告'}  ${i.slug}：${i.message}`);
  const errors = issues.filter((i) => i.level === 'error').length;
  console.log(`\n${errors} 个错误，${issues.length - errors} 个警告`);
  if (errors) process.exitCode = 1;
}

// ── 图片与画廊 ──

/** 导入图片；默认推送图片仓库并预热 CDN（与管理面板上传行为一致） */
async function importAndPublish(files, flags) {
  const results = [];
  for (const file of files) {
    const r = await importImage(file);
    results.push({ file, ...r });
  }
  if (!flags['no-push']) {
    const pushed = await imageGit().commitAndPush({ paths: ['.'], message: '通过博客 CLI 更新图片' });
    console.log(pushed.pushed ? '图片仓库已推送。' : `图片仓库：${pushed.message}`);
    if (pushed.pushed && !flags['no-warm']) {
      await Promise.all(results.map((r) => warmCdn(r.url)));
    }
  }
  return results;
}

async function cmdImg(args, flags) {
  if (!args.length) throw new CliError('用法：blog img <文件...> [--no-push] [--no-warm]', { exitCode: 2 });
  const results = await importAndPublish(args, flags);
  for (const r of results) {
    console.log(`${basename(r.file)} → ${r.url}`);
    if (r.originalUrl) console.log(`  原图：${r.originalUrl}`);
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function cmdGallery(args, flags) {
  const sub = args[0];
  if (sub === 'ls') {
    const { data } = await dataStore('gallery').read();
    const items = Array.isArray(data) ? data : [];
    if (flags.json) return printJson(items);
    printTable(['id', '日期', '标题', '图片'], items.map((i) => [i.id, i.date, i.title, String(i.src).slice(-40)]));
    return console.log(`\n共 ${items.length} 张`);
  }
  if (sub === 'add') {
    const source = requireArg(args[1], '用法：blog gallery add <文件或URL> --title "..."');
    const title = flags.title ? String(flags.title) : basename(source, extname(source));
    let src = source;
    let original = '';
    if (!isHttpUrl(source)) {
      const [r] = await importAndPublish([source], flags);
      src = r.url;
      original = r.originalUrl;
    }
    const dayIndex = flags['dayIndex'] !== undefined ? Number(flags['dayIndex']) : undefined;
    const item = await galleryAdd({
      src,
      title,
      alt: flags.alt ? String(flags.alt) : '',
      caption: flags.caption ? String(flags.caption) : '',
      date: flags.date,
      dayIndex,
      sourceUrl: flags.source ? String(flags.source) : '',
      sourceTitle: flags['source-title'] ? String(flags['source-title']) : '',
      original,
    });
    console.log(`已加入画廊：${item.id}（${item.title}）`);
    console.log('提示：执行 blog push 后上线。');
    return;
  }
  if (sub === 'rm') {
    const id = requireArg(args[1], '用法：blog gallery rm <id> --yes');
    if (!flags.yes && !(await confirm(`从画廊移除 ${id}？（图片文件保留在图片仓库）`, flags))) return console.log('已取消。');
    const removed = await galleryRemove(id);
    return console.log(`已从画廊移除：${removed.title}（图片文件仍保留在图片仓库）`);
  }
  throw new CliError('用法：blog gallery ls | add <文件或URL> | rm <id>', { exitCode: 2 });
}

// ── 站点数据 / 访问控制 ──

async function cmdData(args, flags) {
  const [sub, name] = args;
  if (sub === 'show') {
    requireArg(name, '用法：blog data show <about|frontend|gallery>');
    const { data } = await dataStore(name).read();
    return printJson(data);
  }
  if (sub === 'edit') {
    requireArg(name, '用法：blog data edit <about|frontend|gallery>');
    const result = await editDataFile(name);
    return console.log(result.changed ? `已保存 ${name}（修改前已备份到 .admin-backups）。` : '内容未变化。');
  }
  throw new CliError('用法：blog data show|edit <about|frontend|gallery>', { exitCode: 2 });
}

async function cmdAccess(args) {
  if (args[0] !== 'set') throw new CliError('用法：blog access set [--password-stdin]', { exitCode: 2 });
  const password = await readSecret('新的私密口令（4-200 字符，输入不回显）：');
  if (process.stdin.isTTY) {
    const again = await readSecret('再输入一次：');
    if (again !== password) throw new CliError('两次输入不一致，未修改');
  }
  await setPrivatePassword(password);
  console.log('私密文章口令已更新（仅存储哈希）。');
}

// ── 同步 ──

async function cmdStatus(_args, flags) {
  const git = blogGit();
  if (flags.fetch) await git.fetchRemote({ timeoutMs: 45000 });
  const info = await git.status();
  const state = deriveSyncState(info);
  if (flags.json) return printJson({ ...info, state });
  console.log(`分支：${info.branch || '未知'}${info.upstream ? `（远端 ${info.upstream}）` : '（未设置上游）'}`);
  console.log(`状态：${SYNC_LABELS[state] ?? state}`);
  console.log(`领先 ${info.ahead} / 落后 ${info.behind}`);
  if (info.files.length) {
    console.log(`\n未提交的改动（${info.files.length}）：`);
    for (const f of info.files.slice(0, 30)) console.log(`  ${f.code.padEnd(2)} ${f.path}`);
    if (info.files.length > 30) console.log(`  ……另有 ${info.files.length - 30} 个`);
  }
}

async function cmdPush(_args, flags) {
  const paths = flags.full ? FULL_PUSH_PATHS : CONTENT_PUSH_PATHS;
  const issues = await checkAll();
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) console.log(`${i.level === 'error' ? '错误' : '警告'}  ${i.slug}：${i.message}`);
  if (errors.length && !flags.force) {
    throw new CliError(`校验未通过（${errors.length} 个错误），已取消推送。确认无误可加 --force。`);
  }

  const git = blogGit();
  const preview = await git.previewCommit({ paths });
  if (preview.fileCount) {
    console.log(`将提交 ${preview.fileCount} 个文件（+${preview.insertions} -${preview.deletions}）：`);
    for (const f of preview.files.slice(0, 50)) console.log(`  ${f.status.padEnd(9)} ${f.path}`);
    if (preview.files.length > 50) console.log(`  ……另有 ${preview.files.length - 50} 个`);
    if (!(await confirm('确认提交并推送？', flags))) return console.log('已取消。');
    const result = await git.commitAndPush({
      paths,
      message: flags.full ? '通过博客 CLI 全量推送' : '通过博客 CLI 更新博客',
    });
    console.log(result.message);
  } else {
    console.log('博客没有需要提交的改动。');
    const info = await git.status();
    if (info.ahead > 0) {
      if (!(await confirm(`有 ${info.ahead} 个已提交但未推送的提交，是否推送？`, flags))) return;
      await git.run(['push', git.remote, info.branch]);
      console.log('已推送未推送的提交。');
    }
  }

  if (!flags['no-images']) {
    const img = await imageGit().commitAndPush({ paths: ['.'], message: '通过博客 CLI 更新图片' });
    console.log(img.pushed ? '图片仓库已推送。' : `图片仓库：${img.message}`);
  }
}

async function cmdPull() {
  const result = await blogGit().pullFastForward();
  console.log(result.message);
  if (result.status === 'skipped' && result.detail) console.log(result.detail);
}

// ── 帮助与分发 ──

const HELP = `博客命令行工具（替代浏览器管理面板）

交互界面
  blog ui                           打开终端交互界面（也可 npm run tui）

文章
  blog ls [--status draft|published|scheduled|archived|private] [--access public|authorized|admin]
          [--tag 标签] [-q 关键词] [--sort date|updated|title] [--json]
  blog show <slug> [--json]
  blog new "标题" [--slug 名称] [--tags a,b] [--access public] [--draft] [--cover URL] [--date YYYY-MM-DD] [--edit]
  blog edit <slug>                  用 $VISUAL / $EDITOR 编辑（保存前自动存修订）
  blog set <slug> key=value ...     修改字段；值留空则删除。可改字段：
                                    title description cover pubDate updatedDate dayIndex tags draft archived access scheduledAt
  blog mv <slug> <新slug>           重命名（线上地址会改变）
  blog rm <slug> [--yes]            删除（保留修订快照）
  blog history <slug>               查看修订快照
  blog restore <slug> <修订ID>      恢复到某个修订（当前版本先存为快照）
  blog check [--json]               校验全部文章

图片与画廊
  blog img <文件...> [--no-push] [--no-warm]   转 WebP、生成缩略图，推送图片仓库，输出 CDN 链接
  blog gallery ls [--json]
  blog gallery add <文件或URL> [--title ..] [--alt ..] [--caption ..] [--date ..] [--source URL] [--source-title ..]
  blog gallery rm <id> [--yes]

站点数据与访问控制
  blog data show <about|frontend|gallery>
  blog data edit <about|frontend|gallery>   编辑 JSON，校验后保存（自动备份，失败则另存草稿）
  blog access set [--password-stdin]        设置私密文章口令（输入不回显）

同步
  blog status [--fetch] [--json]    与远端的同步状态
  blog push [--full] [--yes] [--force] [--no-images]   校验 → 预览 → 确认 → 提交并推送
  blog pull                         快进拉取（有未提交改动或分叉时跳过）

环境变量
  BLOG_REPO_DIR   博客仓库目录（默认本项目）
  EDITOR / VISUAL 编辑器（Windows 默认 notepad；GUI 编辑器请带等待参数，如 "code --wait"）
  IMG_REPO_DIR    图片仓库目录（默认 ../blog-images）
  其余 ADMIN_* / SITE_ORIGIN 与管理服务相同
`;

const COMMANDS = {
  ls: cmdLs,
  list: cmdLs,
  show: cmdShow,
  new: cmdNew,
  edit: cmdEdit,
  set: cmdSet,
  mv: cmdMv,
  rm: cmdRm,
  history: cmdHistory,
  restore: cmdRestore,
  check: cmdCheck,
  img: cmdImg,
  gallery: cmdGallery,
  data: cmdData,
  access: cmdAccess,
  status: cmdStatus,
  push: cmdPush,
  pull: cmdPull,
};

async function main(argv) {
  const { positional, flags } = parseArgv(argv);
  const [command, ...rest] = positional;
  if (command === 'ui') {
    const { main: runTui } = await import('./tui.mjs');
    return runTui();
  }
  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return 0;
  }
  const handler = COMMANDS[command];
  if (!handler) throw new CliError(`未知命令：${command}（运行 blog help 查看用法）`, { exitCode: 2 });
  await handler(rest, flags);
  return process.exitCode ?? 0;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      if (err instanceof CliError) {
        console.error(`错误：${err.message}`);
        if (err.detail) console.error(err.detail);
        process.exitCode = err.exitCode ?? 1;
      } else if (err instanceof GitCommandError) {
        console.error(`Git 操作失败：${err.message}`);
        const detail = err.detail || err.stderr;
        if (detail) console.error(String(detail).trim());
        process.exitCode = 1;
      } else {
        console.error(`未预期的错误：${err.message}`);
        process.exitCode = 1;
      }
    });
}

export { main };
