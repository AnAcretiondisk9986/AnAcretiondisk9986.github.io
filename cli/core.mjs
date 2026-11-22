/**
 * 博客 CLI 的核心逻辑（不依赖 Express，不依赖浏览器）。
 *
 * 与管理面板共用同一套文件约定，两者可以混用：
 *   文章      src/content/blog/<slug>.md
 *   修订快照  .admin-revisions/<slug>/<时间戳>.md（每篇最多 20 份）
 *   JSON 数据 src/data/{gallery,about,frontend,private-access}.json（expectedHash 校验 + 备份）
 * git、JSON 存储、原子写入直接复用 admin/ 下的模块，保证两个入口的行为一致。
 */
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { slug as githubSlug } from 'github-slugger';
import sharp from 'sharp';
import decodeHeic from 'heic-decode';
import { atomicWriteFile, sha256 } from '../admin/atomic-file.mjs';
import { createGitService } from '../admin/git-service.mjs';
import { createJsonStore, InvalidDataError, VersionConflictError } from '../admin/json-store.mjs';
import { getHeicOrientation } from '../admin/heic-exif.mjs';

// 与管理服务一致：关闭 libvips 操作缓存，避免 Windows 上文件句柄占用导致 EBUSY
sharp.cache(false);

export class CliError extends Error {
  constructor(message, { exitCode = 1, detail = '' } = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

export const ACCESS_LEVELS = ['public', 'authorized', 'admin'];
export const CONTENT_PUSH_PATHS = [
  'src/content/blog/',
  'src/data/daily.json',
  'src/data/gallery.json',
  'src/data/about.json',
  'src/data/frontend.json',
  'src/data/schedule.json',
  'src/data/categories.json',
  'src/data/projects.json',
  'src/data/report.json',
  'src/data/academics.json',
  'src/data/exams.json',
];
export const FULL_PUSH_PATHS = ['.', ':(exclude)reasonix.toml'];
export const IMG_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/';
const MAX_REVISIONS_PER_POST = 20;
const SLUG_RE = /^[a-z0-9\u4e00-\u9fff]([a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/i;
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.heif'];
const CONVERT_EXTS = ['.png', '.jpg', '.jpeg']; // 转 WebP，原图另存到 original/
const HEIC_EXTS = ['.heic', '.heif'];
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

// ── 路径（每次调用读取环境变量，便于测试隔离）──

function envOr(key, fallback) {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
}

export function getPaths() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(envOr('BLOG_REPO_DIR', join(here, '..')));
  return {
    repo,
    blog: resolve(envOr('ADMIN_BLOG_DIR', join(repo, 'src', 'content', 'blog'))),
    data: resolve(envOr('ADMIN_DATA_DIR', join(repo, 'src', 'data'))),
    backups: resolve(envOr('ADMIN_BACKUP_DIR', join(repo, '.admin-backups'))),
    revisions: resolve(envOr('ADMIN_REVISIONS_DIR', join(repo, '.admin-revisions'))),
    imgRepo: resolve(envOr('IMG_REPO_DIR', join(repo, '..', 'blog-images'))),
    siteOrigin: envOr('SITE_ORIGIN', 'https://blog.acretiondisk.top').replace(/\/$/, ''),
  };
}

// ── 通用小工具 ──

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD（面向国内用户：不用 UTC，避免凌晨发文被记到前一天） */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function validDate(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime());
}

function validDateTime(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return typeof v === 'string' && !Number.isNaN(new Date(v).getTime());
}

function safeDate(v) {
  if (!validDate(v)) return '';
  return (v instanceof Date ? v : new Date(v)).toISOString().split('T')[0];
}

function safeIso(v) {
  if (!validDateTime(v)) return '';
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

export function slugify(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/** 与 Astro 内容集合 id 的生成规则一致（github-slugger） */
export function astroIdFor(slug, data) {
  if (data && typeof data.slug === 'string' && data.slug) return data.slug;
  return String(slug).split('/').map((segment) => githubSlug(segment)).join('/').replace(/\/index$/, '');
}

export function excerptOf(content, max = 140) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*`_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ── frontmatter 读写 ──

/** 与管理服务的 yamlStr 规则一致：需要时加双引号并转义 */
export function yamlStr(s) {
  const str = String(s ?? '');
  if (/[":#{}[\]&*!|>'"@`,\n\r%?-]/.test(str) || str.includes('\\') || /^[-?]\s/.test(str)) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  if (/^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(str)) return `"${str}"`;
  return str || '""';
}

/** 把一个字段渲染为 frontmatter 行（数组用 YAML 列表） */
function renderField(key, value) {
  if (Array.isArray(value)) {
    if (!value.length) return [`${key}: []`];
    return [`${key}:`, ...value.map((v) => `  - ${yamlStr(v)}`)];
  }
  if (typeof value === 'boolean' || typeof value === 'number') return [`${key}: ${value}`];
  return [`${key}: ${yamlStr(value)}`];
}

function splitDocument(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(eol);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return { eol, head: lines.slice(1, end), body: lines.slice(end + 1) };
}

/** 找到某个 key 占用的行区间（key 行 + 紧随其后的缩进行，如列表项） */
function blockRange(head, key) {
  const start = head.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < head.length && /^\s/.test(head[end])) end += 1;
  return { start, end };
}

function replaceKey(head, key, value) {
  const range = blockRange(head, key);
  const block = value === null || value === undefined ? [] : renderField(key, value);
  if (range) return [...head.slice(0, range.start), ...block, ...head.slice(range.end)];
  return block.length ? [...head, ...block] : head;
}

/**
 * 只改动 frontmatter 中指定的字段，正文与其他行原样保留（不经过 YAML 重写，diff 最小）。
 * updates 的值为 null/undefined 时删除该字段。
 */
export function setFrontmatter(raw, updates) {
  const doc = splitDocument(raw);
  if (!doc) throw new CliError('文章缺少 frontmatter（需以 --- 开头、以 --- 结束）');
  let head = doc.head;
  for (const [key, value] of Object.entries(updates)) head = replaceKey(head, key, value);
  return ['---', ...head, '---', ...doc.body].join(doc.eol);
}

// ── 字段规则（blog set 使用）──

const FIELD_RULES = {
  title: { type: 'string', required: true },
  description: { type: 'string' },
  cover: { type: 'string', emptyDeletes: true },
  pubDate: { type: 'date', required: true },
  updatedDate: { type: 'date', emptyDeletes: true },
  dayIndex: { type: 'int', emptyDeletes: true },
  tags: { type: 'list' },
  categories: { type: 'list' },
  draft: { type: 'bool' },
  archived: { type: 'bool' },
  access: { type: 'enum', values: ACCESS_LEVELS },
  scheduledAt: { type: 'datetime', emptyDeletes: true },
};

/** 把 ["key=value", ...] 规范化为 setFrontmatter 的 updates 对象（校验失败抛 CliError） */
export function normalizeFieldUpdates(pairs) {
  const updates = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new CliError(`字段格式应为 key=value：${pair}`);
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    const rule = FIELD_RULES[key];
    if (!rule) throw new CliError(`不支持的字段：${key}（可用：${Object.keys(FIELD_RULES).join(', ')}）`);
    if (raw === '') {
      if (rule.required) throw new CliError(`${key} 不能为空`);
      updates[key] = rule.emptyDeletes ? null : rule.type === 'list' ? [] : '';
      continue;
    }
    switch (rule.type) {
      case 'string':
        updates[key] = raw;
        break;
      case 'date':
        if (!validDate(raw)) throw new CliError(`${key} 需为 YYYY-MM-DD`);
        updates[key] = raw.slice(0, 10);
        break;
      case 'datetime':
        if (!validDateTime(raw)) throw new CliError(`${key} 不是合法时间（可用 2026-08-04T09:00:00+08:00）`);
        updates[key] = safeIso(raw);
        break;
      case 'int': {
        if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new CliError(`${key} 需为 ≥1 的整数`);
        updates[key] = Number(raw);
        break;
      }
      case 'bool':
        if (!['true', 'false'].includes(raw.toLowerCase())) throw new CliError(`${key} 只能是 true 或 false`);
        updates[key] = raw.toLowerCase() === 'true';
        break;
      case 'enum':
        if (!rule.values.includes(raw)) throw new CliError(`${key} 只能是 ${rule.values.join(' / ')}`);
        updates[key] = raw;
        break;
      case 'list':
        updates[key] = raw.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        break;
      default:
        throw new CliError(`内部错误：未知字段类型 ${rule.type}`);
    }
  }
  return updates;
}

// ── 文章：读取 / 汇总 ──

export function postState(data, now = Date.now()) {
  if (data.archived === true) return 'archived';
  if (data.draft === true) return 'draft';
  if (data.access === 'admin') return 'private';
  if (data.scheduledAt && validDateTime(data.scheduledAt) && new Date(data.scheduledAt).getTime() > now) return 'scheduled';
  return 'published';
}

function parseSafely(raw) {
  try {
    return matter(raw);
  } catch {
    return { data: {}, content: '' };
  }
}

export function summarize(slug, raw, mtime) {
  const { data, content } = parseSafely(raw);
  return {
    slug,
    astroId: astroIdFor(slug, data),
    title: String(data.title || slug),
    description: String(data.description || ''),
    pubDate: safeDate(data.pubDate),
    dayIndex: Number.isInteger(data.dayIndex) ? data.dayIndex : null,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
    draft: data.draft === true,
    archived: data.archived === true,
    access: ACCESS_LEVELS.includes(data.access) ? data.access : 'public',
    scheduledAt: safeIso(data.scheduledAt),
    cover: data.cover ? String(data.cover) : '',
    state: postState(data),
    excerpt: excerptOf(content),
    updatedAt: mtime ? mtime.toISOString() : '',
  };
}

export function postPath(slug, p = getPaths()) {
  const s = String(slug ?? '').trim();
  if (!SLUG_RE.test(s)) throw new CliError(`slug 含非法字符：${s}（仅允许字母、数字、中文与连字符）`);
  const file = resolve(join(p.blog, `${s}.md`));
  if (!file.startsWith(p.blog + sep)) throw new CliError('slug 路径非法');
  return file;
}

export async function listPostFiles(p = getPaths()) {
  const entries = await readdir(p.blog, { withFileTypes: true }).catch((err) => {
    if (err.code === 'ENOENT') throw new CliError(`文章目录不存在：${p.blog}（请检查 BLOG_REPO_DIR）`);
    throw err;
  });
  return entries
    .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
    .map((e) => ({ slug: e.name.replace(/\.mdx?$/, ''), file: join(p.blog, e.name) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listPosts(p = getPaths()) {
  const out = [];
  for (const f of await listPostFiles(p)) {
    const [raw, st] = await Promise.all([readFile(f.file, 'utf8'), stat(f.file)]);
    out.push(summarize(f.slug, raw, st.mtime));
  }
  return out;
}

export async function readPost(slug, p = getPaths()) {
  const file = postPath(slug, p);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new CliError(`文章不存在：${slug}`);
    throw err;
  }
  return { slug, file, raw, hash: sha256(raw), ...parseSafely(raw) };
}

// ── 修订快照（与管理面板共用目录与命名规则）──

export async function snapshotPost(slug, raw, p = getPaths()) {
  postPath(slug, p); // 复用 slug 校验，防止路径穿越
  const dir = join(p.revisions, slug);
  await mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${randomBytes(3).toString('hex')}.md`;
  await writeFile(join(dir, id), raw, 'utf8');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  for (const extra of files.slice(0, Math.max(0, files.length - MAX_REVISIONS_PER_POST))) {
    await unlink(join(dir, extra)).catch(() => {});
  }
  return id;
}

export async function listRevisions(slug, p = getPaths()) {
  postPath(slug, p); // 复用 slug 校验，防止路径穿越
  const dir = join(p.revisions, slug);
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const f of files) {
    const st = await stat(join(dir, f));
    out.push({ id: f, savedAt: st.mtime.toISOString(), size: st.size });
  }
  return out.sort((a, b) => Number(b.id.split('-')[0]) - Number(a.id.split('-')[0]));
}

export async function readRevision(slug, id, p = getPaths()) {
  postPath(slug, p);
  if (basename(id) !== id || !id.endsWith('.md')) throw new CliError(`修订 ID 非法：${id}`);
  try {
    return await readFile(join(p.revisions, slug, id), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new CliError(`修订不存在：${slug} / ${id}（用 blog history ${slug} 查看）`);
    throw err;
  }
}

// ── 文章写入 ──

/** 写入文章：若提供 previousRaw，先把旧版本存为快照，再原子替换 */
export async function writePost(slug, raw, { previousRaw = null, p = getPaths() } = {}) {
  if (previousRaw !== null) await snapshotPost(slug, previousRaw, p);
  await atomicWriteFile(postPath(slug, p), raw);
}

function nextDayIndex(posts, date) {
  return posts.filter((x) => x.pubDate === date).reduce((max, x) => Math.max(max, x.dayIndex || 0), 0) + 1;
}

export async function createPost({ title, slug, description = '', tags = [], access = 'public', draft = false, pubDate, cover = '', p = getPaths() }) {
  if (!title || !String(title).trim()) throw new CliError('标题不能为空');
  if (access && !ACCESS_LEVELS.includes(access)) throw new CliError(`access 只能是 ${ACCESS_LEVELS.join(' / ')}`);
  const finalSlug = slug ? String(slug).trim() : slugify(title);
  const file = postPath(finalSlug, p);
  if (await exists(file)) throw new CliError(`slug「${finalSlug}」已存在，请用 --slug 换一个`);
  const date = pubDate || localDate();
  if (!validDate(date)) throw new CliError('--date 需为 YYYY-MM-DD');
  const posts = await listPosts(p);
  const lines = [
    '---',
    ...renderField('title', String(title).trim()),
    ...renderField('description', description),
    ...renderField('pubDate', date.slice(0, 10)),
    ...renderField('dayIndex', nextDayIndex(posts, date.slice(0, 10))),
  ];
  if (cover) lines.push(...renderField('cover', cover));
  lines.push(...renderField('tags', tags), ...renderField('draft', draft === true), ...renderField('access', access || 'public'));
  lines.push('---', '');
  const raw = lines.join('\n');
  await atomicWriteFile(file, raw);
  return { slug: finalSlug, file };
}

export async function updatePost(slug, updates, p = getPaths()) {
  const post = await readPost(slug, p);
  const next = setFrontmatter(post.raw, updates);
  if (next === post.raw) return { changed: false };
  await writePost(slug, next, { previousRaw: post.raw, p });
  return { changed: true };
}

export async function renamePost(slug, newSlug, p = getPaths()) {
  const target = postPath(newSlug, p);
  const post = await readPost(slug, p);
  if (await exists(target)) throw new CliError(`slug「${newSlug}」已存在`);
  await snapshotPost(slug, post.raw, p);
  await atomicWriteFile(target, post.raw);
  await unlink(post.file);
}

export async function removePost(slug, p = getPaths()) {
  const post = await readPost(slug, p);
  const id = await snapshotPost(slug, post.raw, p);
  await unlink(post.file);
  return id;
}

// ── 校验 ──

/** 单篇文章的校验（与 src/content.config.ts 的 schema 保持一致） */
export function checkRaw(slug, raw) {
  const issues = [];
  const add = (level, message) => issues.push({ level, message });
  const { data } = parseSafely(raw);
  if (!raw.startsWith('---')) add('error', '缺少 frontmatter（文件需以 --- 开头）');
  if (typeof data.title !== 'string' || !data.title.trim()) add('error', 'title 缺失或为空');
  if (typeof data.description !== 'string') add('error', 'description 缺失（没有描述可写 description: ""）');
  if (!validDate(data.pubDate)) add('error', 'pubDate 缺失或格式非法');
  if (data.access !== undefined && !ACCESS_LEVELS.includes(data.access)) add('error', `access 必须是 ${ACCESS_LEVELS.join(' / ')}`);
  if (data.tags !== undefined && !(Array.isArray(data.tags) && data.tags.every((t) => typeof t === 'string'))) add('error', 'tags 必须是字符串列表');
  if (data.dayIndex !== undefined && !(Number.isInteger(data.dayIndex) && data.dayIndex >= 1)) add('error', 'dayIndex 必须是 ≥1 的整数');
  for (const key of ['draft', 'archived']) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') add('error', `${key} 必须是 true 或 false`);
  }
  if (data.scheduledAt !== undefined && !validDateTime(data.scheduledAt)) add('error', 'scheduledAt 不是合法时间');
  if (data.updatedDate !== undefined && !validDate(data.updatedDate)) add('error', 'updatedDate 格式非法');
  if (!SLUG_RE.test(slug)) add('warn', '文件名不符合管理规则（仅字母、数字、中文与连字符），无法通过 CLI 编辑');
  return issues;
}

/** 全库校验：单篇规则 + 页面地址冲突 + 同日序号冲突 */
export async function checkAll(p = getPaths()) {
  const out = [];
  const seenIds = new Map();
  const seenDayKeys = new Map();
  for (const f of await listPostFiles(p)) {
    const raw = await readFile(f.file, 'utf8');
    for (const issue of checkRaw(f.slug, raw)) out.push({ ...issue, slug: f.slug });
    const { data } = parseSafely(raw);
    const id = astroIdFor(f.slug, data);
    if (seenIds.has(id)) {
      out.push({ level: 'error', slug: f.slug, message: `与「${seenIds.get(id)}」生成相同的页面地址 ${id}` });
    } else {
      seenIds.set(id, f.slug);
    }
    if (validDate(data.pubDate) && Number.isInteger(data.dayIndex)) {
      const key = `${safeDate(data.pubDate)}#${data.dayIndex}`;
      if (seenDayKeys.has(key)) {
        out.push({ level: 'warn', slug: f.slug, message: `与「${seenDayKeys.get(key)}」同日序号冲突（${key}）` });
      } else {
        seenDayKeys.set(key, f.slug);
      }
    }
  }
  return out;
}

// ── JSON 数据（画廊 / 关于 / 外观 / 访问控制）──

function validateGallery(value) {
  if (!Array.isArray(value)) throw new InvalidDataError('画廊数据必须是数组');
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidDataError(`画廊第 ${index + 1} 项不是对象`);
    for (const key of ['id', 'src', 'title']) {
      if (typeof item[key] !== 'string' || !item[key]) throw new InvalidDataError(`画廊第 ${index + 1} 项缺少 ${key}`);
    }
  });
  return value;
}

function validateObject(label) {
  return (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidDataError(`${label} 必须是 JSON 对象`);
    return value;
  };
}

const DATA_FILES = {
  gallery: { file: 'gallery.json', readDefault: () => [], validate: validateGallery },
  about: { file: 'about.json', readDefault: () => ({}), validate: validateObject('关于页数据') },
  frontend: { file: 'frontend.json', readDefault: () => ({}), validate: validateObject('前端定制数据') },
};

export function dataStore(name, p = getPaths()) {
  const spec = DATA_FILES[name];
  if (!spec) throw new CliError(`未知数据：${name}（可选 ${Object.keys(DATA_FILES).join(' / ')}）`);
  return createJsonStore({
    filePath: join(p.data, spec.file),
    label: name,
    readDefault: spec.readDefault,
    validate: spec.validate,
    backupDir: p.backups,
  });
}

export function storeError(err) {
  if (err instanceof VersionConflictError) return new CliError('数据已被其他地方修改（例如管理面板），请重新执行本命令。');
  if (err instanceof InvalidDataError) return new CliError(`结构校验失败：${err.message}`);
  return err;
}

export async function galleryAdd({ src, title, alt = '', caption = '', date, dayIndex, sourceUrl = '', sourceTitle = '', original = '', p = getPaths() }) {
  const store = dataStore('gallery', p);
  const { data, contentHash } = await store.read();
  const items = Array.isArray(data) ? data : [];
  const finalDate = date || localDate();
  const item = {
    id: `独立-${Date.now()}`,
    src,
    alt,
    title,
    caption,
    date: finalDate,
    dayIndex: Number.isInteger(dayIndex) ? dayIndex : items.filter((i) => i.date === finalDate).reduce((m, i) => Math.max(m, i.dayIndex || 0), 0) + 1,
  };
  if (sourceUrl) {
    if (!/^https?:\/\//.test(sourceUrl)) throw new CliError('--source 必须是 http(s) 链接');
    item.sourceUrl = sourceUrl;
  }
  if (sourceTitle) item.sourceTitle = sourceTitle;
  if (original) item.original = original;
  items.unshift(item);
  try {
    await store.write(items, { expectedHash: contentHash });
  } catch (err) {
    throw storeError(err);
  }
  return item;
}

export async function galleryRemove(id, p = getPaths()) {
  const store = dataStore('gallery', p);
  const { data, contentHash } = await store.read();
  const items = Array.isArray(data) ? data : [];
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) throw new CliError(`画廊中没有 id 为 ${id} 的图片`);
  const [removed] = items.splice(idx, 1);
  try {
    await store.write(items, { expectedHash: contentHash });
  } catch (err) {
    throw storeError(err);
  }
  return removed;
}

/** 编辑 JSON 数据：返回 { changed, savedTo? }；校验失败时把编辑内容另存，避免丢失 */
export async function editDataFile(name, p = getPaths()) {
  const store = dataStore(name, p);
  const { data, contentHash } = await store.read();
  const initial = `${JSON.stringify(data, null, 2)}\n`;
  const edited = await editText(initial, `${name}.json`);
  if (edited === initial) return { changed: false };
  const saveUnsaved = async (reason) => {
    await mkdir(p.backups, { recursive: true });
    const savedTo = join(p.backups, `unsaved-${name}-${Date.now()}.json`);
    await writeFile(savedTo, edited, 'utf8');
    throw new CliError(`${reason}（你的修改未写入，已保存到 ${savedTo}）`);
  };
  let parsed;
  try {
    parsed = JSON.parse(edited);
  } catch (err) {
    return saveUnsaved(`JSON 解析失败：${err.message}`);
  }
  try {
    await store.write(parsed, { expectedHash: contentHash });
  } catch (err) {
    if (err instanceof VersionConflictError) return saveUnsaved('数据已被其他地方修改');
    if (err instanceof InvalidDataError) return saveUnsaved(`结构校验失败：${err.message}`);
    throw err;
  }
  return { changed: true };
}

/** 设置私密文章口令（与前端校验的 SHA-256 哈希格式一致） */
export async function setPrivatePassword(password, p = getPaths()) {
  if (password.length < 4 || password.length > 200) throw new CliError('密码长度需为 4-200 个字符');
  const store = createJsonStore({
    filePath: join(p.data, 'private-access.json'),
    label: 'private-access',
    readDefault: () => ({}),
    validate: (v) => {
      if (!v || typeof v !== 'object' || typeof v.passwordHash !== 'string' || !/^[a-f0-9]{64}$/i.test(v.passwordHash)) {
        throw new InvalidDataError('访问控制数据缺少合法的 passwordHash');
      }
      return v;
    },
    backupDir: p.backups,
  });
  const { contentHash } = await store.read();
  try {
    await store.write({ passwordHash: sha256(password) }, { expectedHash: contentHash });
  } catch (err) {
    throw storeError(err);
  }
}

// ── 图片 ──

function applyOrientation(pipeline, orientation) {
  switch (orientation) {
    case 2: return pipeline.flop();
    case 3: return pipeline.rotate(180);
    case 4: return pipeline.flip();
    case 5: return pipeline.rotate(270).flop();
    case 6: return pipeline.rotate(90);
    case 7: return pipeline.rotate(90).flop();
    case 8: return pipeline.rotate(270);
    default: return pipeline;
  }
}

async function convertHeic(src, out) {
  const buf = await readFile(src);
  const images = await decodeHeic.all({ buffer: buf });
  try {
    const { width, height } = images[0];
    if (width * height > 100_000_000) throw new CliError('图片尺寸过大（超过 1 亿像素）');
    const { width: w, height: h, data } = await images[0].decode();
    const orientation = getHeicOrientation(buf) ?? 1;
    const pipeline = applyOrientation(sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } }), orientation);
    await pipeline.webp({ quality: 78 }).toFile(out);
  } finally {
    images.dispose();
  }
}

/**
 * 把本地图片导入图片仓库（与管理面板上传流程一致）：
 * png/jpg/heic 转 WebP 并把原图归档到 image/original/；gif/svg/webp 原样保留；
 * 并生成 480px 缩略图到 image/thumb/。返回 CDN 地址（推送后才可访问）。
 */
export async function importImage(srcFile, p = getPaths()) {
  const abs = resolve(srcFile);
  const ext = extname(abs).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) throw new CliError(`不支持的图片格式：${ext || '无扩展名'}（支持 ${IMAGE_EXTS.join(' ')}）`);
  const st = await stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new CliError(`文件不存在：${srcFile}`);
  if (st.size > MAX_IMAGE_BYTES) throw new CliError('图片超过 50MB 上限');

  const safeName = basename(abs, extname(abs)).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').substring(0, 60) || 'image';
  const stamp = `${safeName}_${Date.now()}`;
  const imageDir = join(p.imgRepo, 'image');
  const originalDir = join(imageDir, 'original');
  const thumbDir = join(imageDir, 'thumb');
  await mkdir(imageDir, { recursive: true });
  await mkdir(thumbDir, { recursive: true });

  let originalName = '';
  if ([...CONVERT_EXTS, ...HEIC_EXTS].includes(ext)) {
    await mkdir(originalDir, { recursive: true });
    originalName = `${stamp}${ext}`;
    await copyFile(abs, join(originalDir, originalName));
  }

  let finalName;
  if (HEIC_EXTS.includes(ext)) {
    finalName = `${stamp}.webp`;
    await convertHeic(abs, join(imageDir, finalName));
  } else if (CONVERT_EXTS.includes(ext)) {
    finalName = `${stamp}.webp`;
    await sharp(abs).webp({ quality: 78 }).toFile(join(imageDir, finalName));
  } else {
    finalName = `${stamp}${ext}`;
    await copyFile(abs, join(imageDir, finalName));
  }

  try {
    await sharp(join(imageDir, finalName))
      .resize({ width: 480, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(join(thumbDir, `${stamp}.webp`));
  } catch {
    // 缩略图失败不阻断导入（与管理服务一致）
  }

  return {
    name: finalName,
    url: `${IMG_BASE_URL}${encodeURIComponent(finalName)}`,
    originalUrl: originalName ? `${IMG_BASE_URL}original/${encodeURIComponent(originalName)}` : '',
  };
}

/** 预热 jsDelivr 缓存；失败只忽略，不影响结果 */
export async function warmCdn(url, waitMs = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), waitMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    await res.body?.cancel();
  } catch {
    // 忽略
  } finally {
    clearTimeout(timer);
  }
}

// ── git ──

export function blogGit(p = getPaths()) {
  return createGitService({ cwd: p.repo });
}

export function imageGit(p = getPaths()) {
  return createGitService({ cwd: p.imgRepo });
}

export function deriveSyncState(info) {
  if (!info) return 'unknown';
  if (info.unmerged > 0) return 'diverged';
  if (info.ahead > 0 && info.behind > 0) return 'diverged';
  if (info.behind > 0) return 'behind';
  if (info.ahead > 0) return 'ahead';
  if (info.dirtyCount > 0) return 'dirty';
  return 'clean';
}

export const SYNC_LABELS = {
  unknown: '状态未知',
  clean: '工作区干净',
  dirty: '有未提交的修改',
  ahead: '有未推送的提交',
  behind: '远端有新的提交',
  diverged: '本地与远端已分叉',
};

// ── 外部编辑器 ──

function runEditor(file) {
  const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
  return new Promise((resolveRun, reject) => {
    const child = spawn(`${editor} "${file}"`, { stdio: 'inherit', shell: true });
    child.on('error', (err) => reject(new CliError(`无法启动编辑器「${editor}」：${err.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new CliError(`编辑器异常退出（代码 ${code}），修改未保存`));
    });
  });
}

/** 在临时副本上打开编辑器，返回编辑后的文本（原文件不会被直接修改） */
export async function editText(initialText, fileName) {
  const dir = await mkdtemp(join(tmpdir(), 'blog-cli-'));
  const tmp = join(dir, fileName);
  try {
    await writeFile(tmp, initialText, 'utf8');
    await runEditor(tmp);
    return await readFile(tmp, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 编辑文章：返回 { changed, conflictRevision?, warnings } */
export async function editPost(slug, p = getPaths()) {
  const post = await readPost(slug, p);
  const edited = await editText(post.raw, `${slug}.md`);
  if (edited === post.raw) return { changed: false, warnings: [] };
  const current = await readPost(slug, p);
  if (current.hash !== post.hash) {
    // 编辑期间文件被其他入口改过：不覆盖，把编辑结果存为修订，让用户自行合并
    const conflictRevision = await snapshotPost(slug, edited, p);
    return { changed: false, conflictRevision, warnings: [] };
  }
  const warnings = checkRaw(slug, edited).filter((i) => i.level === 'error').map((i) => i.message);
  await writePost(slug, edited, { previousRaw: post.raw, p });
  return { changed: true, warnings };
}
