/**
 * 帧渲染（纯函数）：给定状态与终端尺寸，输出逐行文本。
 * 每行都严格补齐到终端宽度，宽字符（中文）不会导致边框错位。
 */
import { displayWidth, fit, padEnd, truncate, wrapText } from '../format.mjs';
import {
  STATE_LABELS, TAB_LABELS, TABS, currentPost, visiblePosts,
} from './state.mjs';

const STYLES = {
  title: '\u001b[1;36m',
  bold: '\u001b[1m',
  reverse: '\u001b[7m',
  dim: '\u001b[2m',
  sep: '\u001b[2m',
  error: '\u001b[31m',
  warn: '\u001b[33m',
  ok: '\u001b[32m',
  accent: '\u001b[36m',
};

function line(left, right, cols) {
  const rw = displayWidth(right);
  if (!right) return fit(left, cols);
  if (rw >= cols) return truncate(right, cols);
  return padEnd(truncate(left, cols - rw - 1), cols - rw) + right;
}

function windowStart(cursor, total, size) {
  if (total <= size) return 0;
  const half = Math.floor(size / 2);
  return Math.max(0, Math.min(Math.max(0, cursor - half), total - size));
}

function emptyLines(count) {
  return Array.from({ length: count }, () => '');
}

// ── 标题栏 ──

function titleBar(state, cols) {
  const tabs = TABS.map((t) => (state.tab === t ? `[${TAB_LABELS[t]}]` : ` ${TAB_LABELS[t]} `)).join('');
  const { posts, gallery, sync } = state;
  const parts = [`${visiblePosts(state).length}/${posts.length} 篇`, `${gallery.length} 图`];
  if (sync) {
    parts.push(sync.branch || '—');
    if (sync.ahead || sync.behind) parts.push(`↑${sync.ahead || 0}↓${sync.behind || 0}`);
  }
  if (state.busy) parts.push('处理中…');
  return { text: line(` ACR·BLOG  ${tabs}`, parts.join(' · '), cols), style: 'title' };
}

// ── 文章列表 ──

function postListLines(state, width, height) {
  const list = visiblePosts(state);
  const out = [];
  out.push({ text: fit('状态    权限        日期        标题', width), style: 'dim' });
  if (!list.length) {
    out.push({ text: fit(state.posts.length ? '（当前筛选没有匹配的文章）' : '（还没有文章，按 n 新建）', width), style: 'dim' });
    return [...out, ...emptyLines(Math.max(0, height - out.length)).map((t) => ({ text: fit(t, width) }))];
  }
  const size = Math.max(1, height - 1);
  const start = windowStart(state.cursor.posts, list.length, size);
  for (let i = start; i < Math.min(list.length, start + size); i += 1) {
    const p = list[i];
    const cell = [
      padEnd(STATE_LABELS[p.state] ?? p.state, 6),
      padEnd(p.access, 10),
      padEnd(p.pubDate || '—', 11),
      p.title,
    ].join(' ');
    out.push({ text: fit(cell, width), style: i === state.cursor.posts ? 'reverse' : null });
  }
  while (out.length < height) out.push({ text: fit('', width) });
  return out.slice(0, height);
}

function postDetailLines(state, width, height) {
  const post = currentPost(state);
  const out = [];
  const push = (text, style = null) => out.push({ text, style });
  if (!post) {
    push('');
    push('未选中文章', 'dim');
    return out.map((l) => ({ ...l, text: fit(l.text, width) })).slice(0, height);
  }
  push(''); // 空一行，使标题与列表第一行对齐（首行是表头）
  push(truncate(post.title, width), 'bold');
  push(`${STATE_LABELS[post.state] ?? post.state} · ${post.access}`);
  push(`${post.pubDate || '未设置日期'}${post.dayIndex ? ` · 序号 ${post.dayIndex}` : ''}`);
  if (post.scheduledAt) push(`定时：${post.scheduledAt.slice(0, 16).replace('T', ' ')}`);
  push('');
  if (post.tags.length) push(`标签：${post.tags.join(', ')}`);
  if (post.description) {
    for (const l of wrapText(post.description, width)) push(l);
    push('');
  }
  const excerpt = post.excerpt || '（无摘要）';
  for (const l of wrapText(excerpt, width)) push(l, 'dim');
  push('');
  if (post.state === 'published') push(truncate(`https://blog.acretiondisk.top/blog/${post.astroId}/`, width), 'dim');
  push(truncate(post.slug, width), 'dim');

  const fitted = out.slice(0, height).map((l) => ({ text: fit(l.text, width), style: l.style }));
  while (fitted.length < height) fitted.push({ text: fit('', width) });
  return fitted;
}

function postsBody(state, cols, height) {
  const showDetail = cols >= 92;
  if (!showDetail) return postListLines(state, cols, height);
  const listWidth = Math.max(38, Math.floor(cols * 0.56));
  const detailWidth = cols - listWidth - 1;
  const left = postListLines(state, listWidth, height);
  const right = postDetailLines(state, detailWidth, height);
  return Array.from({ length: height }, (_, i) => {
    const l = left[i] ?? { text: '' };
    const r = right[i] ?? { text: '' };
    return {
      text: `${fit(l.text, listWidth)}│${r.text}`,
      style: l.style ?? null,
    };
  });
}

// ── 画廊 / 站点 / 同步 ──

function galleryBody(state, cols, height) {
  const out = [];
  out.push({ text: fit('日期        标题                                   图片', cols), style: 'dim' });
  if (!state.gallery.length) {
    out.push({ text: fit('（画廊为空，按 a 添加）', cols), style: 'dim' });
  } else {
    const size = Math.max(1, height - 1);
    const start = windowStart(state.cursor.gallery, state.gallery.length, size);
    for (let i = start; i < Math.min(state.gallery.length, start + size); i += 1) {
      const item = state.gallery[i];
      const cell = `${padEnd(item.date || '—', 11)} ${padEnd(item.title || '', 36)} ${item.src || ''}`;
      out.push({ text: fit(cell, cols), style: i === state.cursor.gallery ? 'reverse' : null });
    }
  }
  while (out.length < height) out.push({ text: fit('', cols) });
  return out.slice(0, height);
}

function siteBody(state, cols, height) {
  const out = [];
  out.push({ text: fit('Enter 编辑（保存前自动备份，校验失败会另存草稿）', cols), style: 'dim' });
  out.push({ text: fit('', cols) });
  state.site.forEach((entry, i) => {
    const label = `${entry.label}（${entry.file}）`;
    out.push({ text: fit(`  ${label}`, cols), style: i === state.cursor.site ? 'reverse' : null });
  });
  const meta = state.siteMeta ?? {};
  out.push({ text: fit('', cols) });
  for (const entry of state.site) {
    const info = meta[entry.name];
    if (info) out.push({ text: fit(`  ${entry.name}: ${info}`, cols), style: 'dim' });
  }
  while (out.length < height) out.push({ text: fit('', cols) });
  return out.slice(0, height);
}

function syncBody(state, cols, height) {
  const out = [];
  const sync = state.sync;
  if (!sync) {
    out.push({ text: fit('（同步状态未知，按 r 刷新）', cols), style: 'dim' });
  } else {
    out.push({ text: fit(`分支：${sync.branch || '未知'}${sync.upstream ? `（远端 ${sync.upstream}）` : '（未设置上游）'}`, cols) });
    out.push({ text: fit(`领先 ${sync.ahead ?? 0} / 落后 ${sync.behind ?? 0}${sync.clean ? ' · 工作区干净' : ` · ${sync.dirtyCount ?? sync.files?.length ?? 0} 个未提交改动`}`, cols) });
    out.push({ text: fit('', cols) });
    if (sync.files?.length) {
      out.push({ text: fit('未提交的改动：', cols), style: 'dim' });
      const room = Math.max(1, height - out.length);
      for (const f of sync.files.slice(0, room)) {
        out.push({ text: fit(`  ${String(f.code || '').padEnd(2)} ${f.path}`, cols) });
      }
      if (sync.files.length > room) out.push({ text: fit(`  ……另有 ${sync.files.length - room} 个`, cols), style: 'dim' });
    } else {
      out.push({ text: fit('没有未提交的改动。', cols), style: 'dim' });
    }
  }
  while (out.length < height) out.push({ text: fit('', cols) });
  return out.slice(0, height);
}

const HELP_LINES = [
  '快捷键',
  '',
  '  ↑ ↓ / j k      上下移动          g / G          首行 / 末行',
  '  PgUp / PgDn    翻页              Tab / ⇧Tab     切换标签页',
  '  Enter / e      用 $EDITOR 编辑    n              新建文章',
  '  d              切换草稿          A              切换归档',
  '  o              循环访问权限      x              删除（需确认）',
  '  s              循环状态筛选      f              循环权限筛选',
  '  /              搜索（Enter 应用，Esc 取消）',
  '  P              提交并推送        U              快进拉取',
  '  r              重新载入          ?              关闭本帮助',
  '  q              退出',
  '',
  '编辑器：可通过 EDITOR / VISUAL 指定；GUI 编辑器请带等待参数，如 set EDITOR=code --wait',
];

function helpBody(state, cols, height) {
  const out = HELP_LINES.map((l) => ({ text: fit(l, cols), style: l === '快捷键' ? 'bold' : null }));
  while (out.length < height) out.push({ text: fit('', cols) });
  return out.slice(0, height);
}

// ── 底部 ──

function messageLine(state, cols) {
  if (state.prompt) {
    const p = state.prompt;
    if (p.kind === 'confirm') return { text: fit(` ${p.label}  (y/N)`, cols), style: 'warn' };
    const shown = p.mask ? '*'.repeat([...p.value].length) : p.value;
    return { text: fit(` ${p.label}${shown}_`, cols), style: 'accent' };
  }
  const style = state.messageKind === 'error' ? 'error' : state.messageKind === 'ok' ? 'ok' : null;
  const text = state.message || (state.busy ? '处理中…' : '');
  return { text: fit(text ? ` ${text}` : '', cols), style };
}

const HINTS = {
  posts: ' ↑↓ 选择  Enter 编辑  n 新建  d 草稿  A 归档  o 权限  x 删除  s/f 筛选  / 搜索  P 推送  U 拉取  ? 帮助  q 退出',
  gallery: ' ↑↓ 选择  a 添加  x 移除  Tab 切换  P 推送  U 拉取  ? 帮助  q 退出',
  site: ' ↑↓ 选择  Enter 编辑  Tab 切换  P 推送  U 拉取  ? 帮助  q 退出',
  sync: ' r 刷新  P 推送  U 拉取  Tab 切换  ? 帮助  q 退出',
};

function hintLine(state, cols) {
  if (state.help) return { text: fit(' 任意键关闭帮助', cols), style: 'dim' };
  if (state.prompt) {
    return { text: fit(state.prompt.kind === 'confirm' ? ' y 确认  n/Esc 取消' : ' Enter 确认  Esc 取消', cols), style: 'dim' };
  }
  return { text: fit(HINTS[state.tab] ?? '', cols), style: 'dim' };
}

// ── 组装 ──

export function render(state) {
  const cols = Math.max(20, state.size.cols | 0);
  const rows = Math.max(8, state.size.rows | 0);
  const bodyHeight = rows - 4;
  const bodyWidth = cols;

  let body;
  if (state.help) body = helpBody(state, bodyWidth, bodyHeight);
  else if (state.tab === 'posts') body = postsBody(state, bodyWidth, bodyHeight);
  else if (state.tab === 'gallery') body = galleryBody(state, bodyWidth, bodyHeight);
  else if (state.tab === 'site') body = siteBody(state, bodyWidth, bodyHeight);
  else body = syncBody(state, bodyWidth, bodyHeight);

  const lines = [
    titleBar(state, cols),
    { text: '─'.repeat(cols), style: 'sep' },
    ...body,
    { text: '─'.repeat(cols), style: 'sep' },
    messageLine(state, cols),
    hintLine(state, cols),
  ];
  return lines.slice(0, rows);
}

/** 把帧转成带样式的终端输出（清屏到行尾，避免残留） */
export function frameToAnsi(lines) {
  const body = lines.map((l) => {
    const code = l.style ? STYLES[l.style] : '';
    return code ? `${code}${l.text}\u001b[0m` : l.text;
  }).join('\r\n');
  return `\u001b[H${body}\u001b[J`;
}

export { STYLES };
