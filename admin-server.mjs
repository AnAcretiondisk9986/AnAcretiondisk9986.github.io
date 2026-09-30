import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import decodeHeic from 'heic-decode';
import { getHeicOrientation } from './admin/heic-exif.mjs';
import { readdir, readFile, writeFile, unlink, mkdir, access as fileAccess, copyFile, stat as statFile, rename } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join, dirname, extname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import matter from 'gray-matter';
import { slug as githubSlug } from 'github-slugger';
import { atomicWriteFile, sha256 } from './admin/atomic-file.mjs';
import { createGitService, GitCommandError, redactSecrets } from './admin/git-service.mjs';
import { createJsonStore, InvalidDataError, parseExpectedHash, VersionConflictError } from './admin/json-store.mjs';
import { parseFile as parseAudioMeta } from 'music-metadata';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 内容 / 数据目录支持环境变量覆盖（自动化测试使用隔离目录，不触碰真实数据）
const BLOG_DIR = process.env.ADMIN_BLOG_DIR ? resolve(process.env.ADMIN_BLOG_DIR) : resolve(__dirname, 'src', 'content', 'blog');
const DATA_DIR = process.env.ADMIN_DATA_DIR ? resolve(process.env.ADMIN_DATA_DIR) : resolve(__dirname, 'src', 'data');
// 图片仓库：与博客仓库平级的 blog-images，图片上传后经 jsDelivr CDN 外链引用
// IMG_REPO_DIR 支持环境变量覆盖（测试隔离用）
const IMG_REPO_DIR = process.env.IMG_REPO_DIR ? resolve(process.env.IMG_REPO_DIR) : resolve(__dirname, '..', 'blog-images');
const IMAGE_DIR = resolve(IMG_REPO_DIR, 'image');
const AUDIO_DIR = resolve(IMG_REPO_DIR, 'audio');
const ORIGINAL_DIR = resolve(IMAGE_DIR, 'original');
const THUMB_DIR = resolve(IMAGE_DIR, 'thumb');
const IMG_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/';
const AUDIO_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/audio/';
const GALLERY_JSON = resolve(DATA_DIR, 'gallery.json');
const ABOUT_JSON = resolve(DATA_DIR, 'about.json');
const FRONTEND_JSON = resolve(DATA_DIR, 'frontend.json');
const PORT = parseInt(process.env.PORT, 10) || 4322;
const TOKEN_FILE = resolve(__dirname, '.admin-token');
const ADMIN_HTML = resolve(__dirname, 'admin', 'index.html');
const PRIVATE_ACCESS_FILE = resolve(DATA_DIR, 'private-access.json');
// 公开站点地址（用于生成文章公开链接与分享短链）
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://blog.acretiondisk.top').replace(/\/$/, '');
const DEFAULT_PRIVATE_PASSWORD = process.env.PRIVATE_ARTICLE_PASSWORD || 'AnAcretiondisk';
// JSON 配置写入前的轮换备份目录（已在 .gitignore 中忽略）
const BACKUP_DIR = process.env.ADMIN_BACKUP_DIR ? resolve(process.env.ADMIN_BACKUP_DIR) : resolve(__dirname, '.admin-backups');
// 文章修订历史目录（每次保存前快照上一版）
const REVISIONS_DIR = process.env.ADMIN_REVISIONS_DIR ? resolve(process.env.ADMIN_REVISIONS_DIR) : resolve(__dirname, '.admin-revisions');
const MAX_REVISIONS_PER_POST = 20;

// ── JSON 配置存储（原子写入 + 结构校验 + 备份 + contentHash 冲突检测）──
function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidDataError(`${label} 必须是 JSON 对象`);
  return value;
}

function validateGalleryData(value) {
  if (!Array.isArray(value)) throw new InvalidDataError('画廊数据必须是数组');
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidDataError(`画廊第 ${index + 1} 项不是对象`);
    if (typeof item.id !== 'string' || !item.id) throw new InvalidDataError(`画廊第 ${index + 1} 项缺少 id`);
    if (typeof item.src !== 'string' || !item.src) throw new InvalidDataError(`画廊第 ${index + 1} 项缺少 src`);
    if (typeof item.title !== 'string' || !item.title) throw new InvalidDataError(`画廊第 ${index + 1} 项缺少 title`);
  });
  return value;
}

function validatePrivateAccessData(value) {
  requirePlainObject(value, '访问控制数据');
  if (typeof value.passwordHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.passwordHash)) {
    throw new InvalidDataError('访问控制数据缺少合法的 passwordHash');
  }
  return value;
}

const galleryStore = createJsonStore({ filePath: GALLERY_JSON, label: 'gallery', readDefault: () => [], validate: validateGalleryData, backupDir: BACKUP_DIR });
const aboutStore = createJsonStore({ filePath: ABOUT_JSON, label: 'about', readDefault: () => ({}), validate: (value) => requirePlainObject(value, '关于页数据'), backupDir: BACKUP_DIR });
const frontendStore = createJsonStore({ filePath: FRONTEND_JSON, label: 'frontend', readDefault: () => ({}), validate: (value) => requirePlainObject(value, '前端定制数据'), backupDir: BACKUP_DIR });
const privateAccessStore = createJsonStore({ filePath: PRIVATE_ACCESS_FILE, label: 'private-access', readDefault: () => ({}), validate: validatePrivateAccessData, backupDir: BACKUP_DIR });

/** 校验请求携带的 expectedHash，返回 null 表示通过（无冲突需要传递的值在 eh 中）*/
function readExpectedHash(res, raw, { required = true } = {}) {
  const eh = parseExpectedHash(raw);
  if (eh.missing) {
    if (!required) return { ok: true, hash: null };
    res.status(428).json({ code: 'VERSION_REQUIRED', error: '缺少配置版本信息，请刷新页面后重新保存' });
    return { ok: false };
  }
  if (eh.invalid) {
    res.status(400).json({ code: 'VERSION_INVALID', error: '配置版本信息格式不正确' });
    return { ok: false };
  }
  return { ok: true, hash: eh.hash };
}

/** JSON 配置存储错误 → HTTP 响应 */
function respondStoreError(res, err, label) {
  if (err instanceof VersionConflictError) {
    return res.status(409).json({ code: 'VERSION_CONFLICT', error: err.message, currentHash: err.currentHash });
  }
  if (err instanceof InvalidDataError) {
    return res.status(400).json({ code: 'INVALID_DATA', error: err.message });
  }
  console.error(`${label} Error:`, err.message);
  return res.status(500).json({ error: '服务器内部错误' });
}

// ── 发布中心：Git 服务实例与推送范围 ──
// 博客仓库（内容推送、全量推送、拉取）
const blogGit = createGitService({ cwd: __dirname });
// 图片仓库（上传时提交并推送）
const imageGit = createGitService({ cwd: IMG_REPO_DIR });
// 内容推送范围：仅文章 / 画廊 / 关于 / 前端定制数据
const CONTENT_PUSH_PATHS = ['src/content/blog/', 'src/data/gallery.json', 'src/data/about.json', 'src/data/frontend.json'];
// 全量推送范围：除 reasonix.toml（本机配置，不提交）外的全部改动
const FULL_PUSH_PATHS = ['.', ':(exclude)reasonix.toml'];

/** Git 命令异常 → HTTP 可用的错误对象（保留友好文案并附带 detail） */
function toHttpError(err, fallbackStatus = 500) {
  if (err instanceof GitCommandError) {
    err.status = err.status || fallbackStatus;
    err.errorCode = err.errorCode || 'GIT_COMMAND_FAILED';
    err.detail = err.detail || err.stderr || err.stdout || '';
  }
  return err;
}

/** 由 git status 结果推导同步状态（同步状态机：clean/dirty/ahead/behind/diverged）*/
function deriveSyncState(info) {
  if (!info) return 'unknown';
  if (info.unmerged > 0) return 'diverged';
  if (info.ahead > 0 && info.behind > 0) return 'diverged';
  if (info.behind > 0) return 'behind';
  if (info.ahead > 0) return 'ahead';
  if (info.dirtyCount > 0) return 'dirty';
  return 'clean';
}

const SYNC_STATE_LABELS = {
  unknown: '状态未知',
  clean: '工作区干净',
  dirty: '有未提交的修改',
  ahead: '有未推送的提交',
  behind: '远端有新的提交',
  diverged: '本地与远端已分叉',
  syncing: '同步中',
  'sync-error': '同步检查失败',
};

/** 组装同步状态响应体 */
async function collectSyncStatus({ fetch = false } = {}) {
  let fetchError = null;
  if (fetch) {
    try {
      await blogGit.fetchRemote({ timeoutMs: 45000 });
    } catch (err) {
      fetchError = err.message;
    }
  }
  const info = await blogGit.status();
  const state = fetchError && !info.hasUpstream ? 'sync-error' : deriveSyncState(info);
  return {
    ok: true,
    state,
    stateLabel: SYNC_STATE_LABELS[state] || state,
    branch: info.branch,
    upstream: info.upstream,
    hasUpstream: info.hasUpstream,
    ahead: info.ahead,
    behind: info.behind,
    dirty: !info.clean,
    dirtyCount: info.dirtyCount,
    unmerged: info.unmerged,
    files: info.files.slice(0, 100),
    fetched: fetch,
    fetchError,
    checkedAt: new Date().toISOString(),
    autoPull: process.env.ADMIN_AUTO_PULL === '1',
  };
}

/** 未设置 ADMIN_TOKEN 时：首次启动生成随机口令并持久化到 .admin-token，之后复用（重启后口令不变） */
async function loadAdminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const existing = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (existing) return existing;
  } catch { /* 首次启动，生成新口令 */ }
  const generated = randomBytes(32).toString('hex');
  try {
    await writeFile(TOKEN_FILE, `${generated}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn(`[warn] 无法写入口令文件 ${TOKEN_FILE}: ${err.message}，本次使用临时随机口令`);
  }
  return generated;
}

const ADMIN_TOKEN = await loadAdminToken();
const MAX_REMOTE_BYTES = 35 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// ── 集中配置：上传 / 请求 / 远程 / 超时 / 并发限制（UI 中展示）──
const LIMITS = {
  uploadMaxBytes: MAX_REMOTE_BYTES,
  remoteMaxBytes: MAX_REMOTE_BYTES,
  gitTimeoutMs: 60000,
  remoteFetchTimeoutMs: 30000,
  uploadConcurrency: 2,
  mediaBackups: 10,
};

// ── 结构化日志（JSON 行 + 敏感信息脱敏）──
function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  const sink = level === 'error' ? console.error : console.log;
  sink(redactSecrets(line));
}

const STATUS_ERROR_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  428: 'PRECONDITION_REQUIRED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  504: 'GATEWAY_TIMEOUT',
};

// ── Auth middleware ──
function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: '未授权' });
}

const app = express();
app.use(express.urlencoded({ extended: true }));

// ── requestId：每次请求生成短 id，写入响应头并在错误响应中回传，便于追踪一次操作 ──
app.use((req, res, next) => {
  req.requestId = randomBytes(8).toString('hex');
  res.setHeader('x-request-id', req.requestId);
  next();
});

// ── API 访问日志（结构化、脱敏）──
app.use('/api', (req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logEvent(res.statusCode >= 500 ? 'error' : 'info', 'api_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
});

// ── 统一错误响应：为所有错误补上 code 与 requestId（成功响应保持原结构以兼容现有前端）──
app.use('/api', (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) {
      const source = body && typeof body === 'object' && !Array.isArray(body) ? body : { error: String(body ?? '请求失败') };
      const normalized = { ...source };
      if (!normalized.code) normalized.code = STATUS_ERROR_CODES[res.statusCode] || 'API_ERROR';
      if (!normalized.error) normalized.error = normalized.message || '请求失败';
      if (!normalized.requestId) normalized.requestId = req.requestId;
      return originalJson(normalized);
    }
    return originalJson(body);
  };
  next();
});

// ── 同步操作日志（内存环形缓冲，仅记录发布中心相关动作）──
const MAX_OPERATION_LOG = 50;
const operationLog = [];
function recordOperation({ requestId = '', action, status, message = '', detail = '', durationMs = 0, meta } = {}) {
  const entry = {
    id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    time: new Date().toISOString(),
    requestId,
    action,
    status,
    message,
    detail: redactSecrets(String(detail || '')).slice(0, 2000),
    durationMs,
    ...(meta ? { meta } : {}),
  };
  operationLog.unshift(entry);
  if (operationLog.length > MAX_OPERATION_LOG) operationLog.length = MAX_OPERATION_LOG;
  return entry;
}

function safeLink(raw, { allowEmpty = true } = {}) {
  const value = String(raw ?? '').trim();
  if (!value) return allowEmpty ? '' : null;
  if ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('#') || value.startsWith('?')) {
    return value;
  }
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

async function assertPublicUrl(raw) {
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https 链接');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('不允许访问本机地址');
  }
  const addresses = isIP(hostname)
    ? [hostname]
    : (await dnsLookup(hostname, { all: true })).map(({ address }) => address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('不允许访问内网地址');
  return parsed;
}

async function fetchPublic(raw, init = {}) {
  let current = String(raw);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const parsed = await assertPublicUrl(current);
    const response = await fetch(parsed, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === MAX_REDIRECTS) throw new Error('远程地址重定向次数过多');
    await response.body?.cancel();
    current = new URL(location, parsed).href;
  }
  throw new Error('远程地址重定向失败');
}

async function readLimitedBuffer(response, maxBytes = MAX_REMOTE_BYTES) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('远程文件超过大小限制');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('下载文件超过大小限制');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** 保存一篇文章的修订快照（覆盖前调用），保留最近 MAX_REVISIONS_PER_POST 份 */
async function savePostRevision(slug, raw) {
  try {
    const safe = basename(slug);
    if (!safe || safe !== slug) return;
    const dir = join(REVISIONS_DIR, safe);
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(3).toString('hex')}.md`;
    await writeFile(join(dir, name), raw, 'utf8');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    for (const extra of files.slice(0, Math.max(0, files.length - MAX_REVISIONS_PER_POST))) {
      await unlink(join(dir, extra)).catch(() => {});
    }
  } catch (err) {
    logEvent('error', 'save_revision_failed', { slug, detail: err.message });
  }
}

/** 列出文章的修订快照（新→旧） */
async function listPostRevisions(slug) {
  const safe = basename(slug);
  if (!safe || safe !== slug) return [];
  const dir = join(REVISIONS_DIR, safe);
  const files = await readdir(dir).catch(() => []);
  const out = [];
  for (const name of files) {
    if (!name.endsWith('.md')) continue;
    const st = await statFile(join(dir, name)).catch(() => null);
    if (!st) continue;
    out.push({ id: name, savedAt: st.mtime.toISOString(), size: st.size });
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function readPostRevision(slug, id) {
  const safeSlug = basename(slug);
  const safeId = basename(id);
  if (!safeSlug || safeSlug !== slug || !safeId || safeId !== id || !safeId.endsWith('.md')) return null;
  const raw = await readFile(join(REVISIONS_DIR, safeSlug, safeId), 'utf8').catch(() => null);
  if (raw === null) return null;
  const { data, content } = matter(raw);
  return { id: safeId, raw, contentHash: sha256(raw), data, body: content };
}

// ── Slug validation ──
const SLUG_RE = /^[a-z0-9\u4e00-\u9fff]([a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/i;

function validateSlug(raw) {
  const slug = raw?.toString().trim() || '';
  if (!SLUG_RE.test(slug)) return null;
  const filePath = resolve(join(BLOG_DIR, `${slug}.md`));
  if (!filePath.startsWith(BLOG_DIR + '\\') && !filePath.startsWith(BLOG_DIR + '/')) return null;
  return { slug, filePath };
}

// ── YAML-safe string escaping ──
function yamlStr(s) {
  const str = String(s || '');
  // If the string contains special chars, wrap in double quotes with escaping
  if (/[":#{}[\]&*!|>'"@`,\n\r%?-]/.test(str) || str.includes('\\') || /^[-?]\s/.test(str)) {
    return '"' + str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r') + '"';
  }
  // If string looks like a number, boolean, null etc, quote it
  if (/^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(str)) {
    return `"${str}"`;
  }
  return str || '""';
}

// ── Safe date formatting ──
function safeDate(val, fallback = '') {
  if (!val) return fallback;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return fallback;
  return d.toISOString().split('T')[0];
}

/** ISO 时间（用于定时发布）；无效时返回空串 */
function safeIso(val, fallback = '') {
  if (!val) return fallback;
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? fallback : d.toISOString();
}

/** 是否处于「定时等待」状态 */
function isScheduledFuture(post) {
  if (!post.scheduledAt) return false;
  const t = new Date(post.scheduledAt).getTime();
  return Number.isFinite(t) && t > Date.now();
}

// ── Day index helpers（同一天内的发表顺序，1 = 当天第一篇）──

/** Astro 内容集合 id：默认对文件名按 github-slugger 生成（与 src/pages/s/[id].astro 保持一致）*/
function astroIdFor(slug, data) {
  if (data && typeof data.slug === 'string' && data.slug) return data.slug;
  return String(slug).split('/').map((segment) => githubSlug(segment)).join('/').replace(/\/index$/, '');
}

/** 分享短码：sha256 前 8 位 hex 转 base36（与 src/lib/shortlink.ts 一致）*/
function shortIdForAstroId(id) {
  return parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16).toString(36);
}

/** 正文摘要（搜索用，去掉 Markdown 语法噪声）*/
function excerptOf(content, max = 140) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*`_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 为文章补充公开链接信息；draft 与 access=admin 的文章没有线上页面 */
function withPublicInfo(post, { id, content } = {}) {
  const astroId = id || astroIdFor(post.slug);
  const published = !post.draft && !post.archived && post.access !== 'admin' && !isScheduledFuture(post);
  return {
    ...post,
    astroId,
    hasPublicPage: published,
    publicUrl: published ? `${SITE_ORIGIN}/blog/${encodeURI(astroId)}/` : '',
    shortUrl: published ? `${SITE_ORIGIN}/s/${shortIdForAstroId(astroId)}` : '',
    ...(content === undefined ? {} : { excerpt: excerptOf(content) }),
  };
}

async function readPosts() {
  const files = await readdir(BLOG_DIR);
  const posts = [];
  for (const file of files) {
    if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
    const filePath = join(BLOG_DIR, file);
    const raw = await readFile(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const slug = file.replace(/\.(md|mdx)$/, '');
    let updatedAt = '';
    try {
      const stat = await statFile(filePath);
      updatedAt = stat.mtime.toISOString();
    } catch { /* 忽略 mtime 读取失败 */ }
    posts.push({
      slug,
      contentHash: sha256(raw),
      title: data.title || slug,
      description: data.description || '',
      cover: data.cover || '',
      pubDate: safeDate(data.pubDate),
      tags: data.tags || [],
      draft: data.draft ?? false,
      access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
      archived: data.archived ?? false,
      scheduledAt: safeIso(data.scheduledAt),
      dayIndex: data.dayIndex || undefined,
      updatedAt,
      excerpt: excerptOf(content),
      astroId: astroIdFor(slug, data),
    });
  }
  return posts;
}

function privatePasswordHash(password) {
  return createHash('sha256').update(String(password)).digest('hex');
}

async function readPrivateAccess() {
  try {
    const { data } = await privateAccessStore.read();
    if (data && typeof data.passwordHash === 'string' && /^[a-f0-9]{64}$/i.test(data.passwordHash)) return data;
  } catch { /* 重建默认口令 */ }
  const next = { passwordHash: privatePasswordHash(DEFAULT_PRIVATE_PASSWORD) };
  await mkdir(dirname(PRIVATE_ACCESS_FILE), { recursive: true });
  await privateAccessStore.write(next, { expectedHash: null });
  return next;
}

function parseDayIndex(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function nextDayIndex(posts, date) {
  return posts
    .filter(p => p.pubDate === date)
    .reduce((max, p) => Math.max(max, p.dayIndex || 0), 0) + 1;
}

function nextGalleryDayIndex(items, date) {
  return items
    .filter(i => i.date === date)
    .reduce((max, i) => Math.max(max, i.dayIndex || 0), 0) + 1;
}

// ── Multer: image-only upload ──
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/heic', 'image/heif', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a'];
// URL 导入支持的图片扩展名（与 MIME 校验互补；CDN/图床对 HEIC 等常返回 application/octet-stream）
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.heif'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      const dir = String(file.mimetype).startsWith('audio/') ? AUDIO_DIR : IMAGE_DIR;
      try {
        mkdir(dir, { recursive: true }).then(() => cb(null, dir), err => cb(err));
      } catch (err) { cb(err); }
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
        .substring(0, 60);
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${safeName}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    // Chrome/Edge 等浏览器不识别 HEIC，会以 application/octet-stream（或空 MIME）上传：
    // 仅对 heic/heif 按扩展名兜底放行（heic/heif 有 decodeHeic 内容校验；png/jpg 等仍要求标准 MIME）
    const genericOk = (file.mimetype === 'application/octet-stream' || file.mimetype === '')
      && ['.heic', '.heif'].includes(extname(file.originalname).toLowerCase());
    if (ALLOWED_MIME.includes(file.mimetype) || genericOk) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PNG / JPEG / GIF / WebP / SVG / HEIC 图片与 MP3 / FLAC / OGG / WAV / M4A 音频'), false);
    }
  },
  limits: { fileSize: LIMITS.uploadMaxBytes },
});

// ── API Routes ──

// Serialize article mutations so version checks and writes cannot race each other.
let postWriteQueue = Promise.resolve();
function withPostWriteLock(operation) {
  const result = postWriteQueue.then(operation, operation);
  postWriteQueue = result.catch(() => {});
  return result;
}

function buildPostMarkdown(body, allPosts, { excludeSlug = '' } = {}) {
  const title = body.title || '';
  const description = body.description || '';
  const cover = body.cover || '';
  const pubDate = body.pubDate || new Date().toISOString().split('T')[0];
  const tags = String(body.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
  const relevantPosts = excludeSlug ? allPosts.filter(p => p.slug !== excludeSlug) : allPosts;
  const dayIndex = parseDayIndex(body.dayIndex);
  const fm = [
    '---',
    `title: ${yamlStr(title)}`,
    `description: ${yamlStr(description)}`,
    `pubDate: ${yamlStr(pubDate)}`,
    `dayIndex: ${dayIndex ?? nextDayIndex(relevantPosts, pubDate)}`,
  ];
  if (cover.trim()) fm.push(`cover: ${yamlStr(cover.trim())}`);
  if (tags.length) {
    fm.push('tags:');
    tags.forEach(tag => fm.push(`  - ${yamlStr(tag)}`));
  }
  fm.push(`draft: ${body.draft === 'true'}`);
  fm.push(`access: ${['public', 'authorized', 'admin'].includes(body.access) ? body.access : 'public'}`);
  if (body.archived === 'true') fm.push('archived: true');
  const scheduledAt = safeIso(body.scheduledAt);
  if (scheduledAt) fm.push(`scheduledAt: ${yamlStr(scheduledAt)}`);
  fm.push('---', '', body.content || '');
  return fm.join('\n');
}

// Auth for all API routes
app.use('/api', auth);

// List / create posts
app.route('/api/posts')
  .get(async (_req, res) => {
    try {
      const posts = await readPosts();
      posts.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || (b.dayIndex || 0) - (a.dayIndex || 0) || b.slug.localeCompare(a.slug));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json(posts.map((post) => withPublicInfo(post)));
    } catch (err) {
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .post(upload.none(), async (req, res) => withPostWriteLock(async () => {
    try {
      const { title } = req.body;
      const candidate = (req.body.slug
        || (title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
        || 'untitled');
      const checked = validateSlug(candidate);
      if (!checked) return res.status(400).json({ error: 'Slug 包含无效字符或路径非法' });

      try {
        await fileAccess(checked.filePath);
        return res.status(409).json({ code: 'SLUG_EXISTS', error: `Slug「${checked.slug}」已存在，请更换` });
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }

      const allPosts = await readPosts();
      const markdown = buildPostMarkdown(req.body, allPosts);
      await atomicWriteFile(checked.filePath, markdown);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(201).json({ success: true, slug: checked.slug, contentHash: sha256(markdown) });
    } catch (err) {
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  }));

// Get / update / delete single post
app.route('/api/posts/:slug')
  .get(async (req, res) => {
    try {
      const checked = validateSlug(req.params.slug);
      if (!checked) return res.status(400).json({ error: '无效的 Slug' });
      const raw = await readFile(checked.filePath, 'utf-8');
      const { data, content } = matter(raw);
      let updatedAt = '';
      try {
        updatedAt = (await statFile(checked.filePath)).mtime.toISOString();
      } catch { /* 忽略 mtime 读取失败 */ }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json(withPublicInfo({
        slug: checked.slug,
        contentHash: sha256(raw),
        title: data.title || '',
        description: data.description || '',
        cover: data.cover || '',
        pubDate: safeDate(data.pubDate),
        dayIndex: data.dayIndex || undefined,
        tags: data.tags || [],
        draft: data.draft ?? false,
        access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
        archived: data.archived ?? false,
        scheduledAt: safeIso(data.scheduledAt),
        content: content.trim(),
        updatedAt,
      }, { id: astroIdFor(checked.slug, data), content: content.trim() }));
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: '文章不存在' });
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .put(upload.none(), async (req, res) => withPostWriteLock(async () => {
    try {
      const oldChecked = validateSlug(req.params.slug);
      if (!oldChecked) return res.status(400).json({ error: '无效的 Slug' });

      const expectedHash = String(req.body.expectedHash || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        return res.status(428).json({ code: 'VERSION_REQUIRED', error: '缺少文章版本信息，请重新加载文章后再保存' });
      }
      const currentRaw = await readFile(oldChecked.filePath, 'utf-8');
      const currentHash = sha256(currentRaw);
      if (expectedHash !== currentHash) {
        return res.status(409).json({
          code: 'VERSION_CONFLICT',
          error: '文章已在其他位置发生更改。当前编辑内容已保留，请先确认如何处理。',
          currentHash,
        });
      }

      const { slug: newSlug } = req.body;
      const finalSlug = newSlug || req.params.slug;
      const newChecked = validateSlug(finalSlug);
      if (!newChecked) return res.status(400).json({ error: '新 Slug 包含无效字符或路径非法' });

      const allPosts = await readPosts();
      const markdown = buildPostMarkdown(req.body, allPosts, { excludeSlug: oldChecked.slug });

      // Windows/macOS 文件系统不区分大小写：仅大小写不同的 slug 指向同一文件。
      const caseInsensitiveFS = process.platform === 'win32' || process.platform === 'darwin';
      const sameFile = caseInsensitiveFS
        ? newChecked.filePath.toLowerCase() === oldChecked.filePath.toLowerCase()
        : newChecked.filePath === oldChecked.filePath;

      if (!sameFile) {
        // 目标 slug 已被另一篇文章占用时拒绝，避免覆盖已有文件。
        try {
          await fileAccess(newChecked.filePath);
          return res.status(409).json({ code: 'SLUG_EXISTS', error: `Slug「${newChecked.slug}」已存在，请更换` });
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        await savePostRevision(oldChecked.slug, currentRaw);
        await atomicWriteFile(newChecked.filePath, markdown);
        await unlink(oldChecked.filePath);
      } else {
        await savePostRevision(oldChecked.slug, currentRaw);
        await atomicWriteFile(oldChecked.filePath, markdown);
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, slug: newChecked.slug, contentHash: sha256(markdown) });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: '文章不存在' });
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  }))
  .delete(async (req, res) => withPostWriteLock(async () => {
    try {
      const checked = validateSlug(req.params.slug);
      if (!checked) return res.status(400).json({ error: '无效的 Slug' });
      const raw = await readFile(checked.filePath, 'utf-8');
      await savePostRevision(checked.slug, raw);
      await unlink(checked.filePath);
      res.json({ success: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: '文章不存在' });
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  }));

// 修订历史：列表 / 单份内容（恢复由前端 GET 内容后走 PUT 完成，保留版本冲突检查）
app.get('/api/posts/:slug/revisions', async (req, res) => {
  try {
    const checked = validateSlug(req.params.slug);
    if (!checked) return res.status(400).json({ error: '无效的 Slug' });
    const revisions = await listPostRevisions(checked.slug);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ok: true, requestId: req.requestId, revisions });
  } catch (err) {
    console.error('Revisions Error:', err.message);
    res.status(500).json({ error: '读取修订历史失败' });
  }
});

app.get('/api/posts/:slug/revisions/:id', async (req, res) => {
  try {
    const checked = validateSlug(req.params.slug);
    if (!checked) return res.status(400).json({ error: '无效的 Slug' });
    const rev = await readPostRevision(checked.slug, req.params.id);
    if (!rev) return res.status(404).json({ error: '修订不存在' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ok: true, requestId: req.requestId, id: rev.id, contentHash: rev.contentHash, content: String(rev.body || '').trim(), data: rev.data });
  } catch (err) {
    console.error('Revision Error:', err.message);
    res.status(500).json({ error: '读取修订失败' });
  }
});

// 管理员级文章的访问口令（仅管理面板可读写，文章页只拿构建时生成的哈希）
app.route('/api/private-access')
  .get(async (_req, res) => {
    try {
      const settings = await readPrivateAccess();
      const { contentHash } = await privateAccessStore.read();
      res.json({ configured: Boolean(settings.passwordHash), contentHash: contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Private access');
    }
  })
  .put(upload.none(), async (req, res) => {
    const password = String(req.body.password || '');
    if (password.length < 4 || password.length > 200) return res.status(400).json({ error: '密码长度需为 4-200 个字符' });
    const hashCheck = readExpectedHash(res, req.body.expectedHash);
    if (!hashCheck.ok) return;
    try {
      await mkdir(dirname(PRIVATE_ACCESS_FILE), { recursive: true });
      const written = await privateAccessStore.write({ passwordHash: privatePasswordHash(password) }, { expectedHash: hashCheck.hash });
      res.json({ success: true, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Private access');
    }
  });

// 把已写入 IMAGE_DIR 的图片文件转成 WebP（png/jpg/jpeg 直接转；heic/heif 先用 libheif(wasm) 解码再转），
// 同时生成 480px 画廊缩略图到 image/thumb/（gallery 页列表/轮播用，点开才加载大图）；
// 返回最终文件名；其余格式原样保留（缩略图仍尽力生成，失败不阻断上传）
async function saveImageFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const base = filePath.slice(0, -ext.length);
  const outPath = `${base}.webp`;
  let finalPath = filePath;
  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    await sharp(filePath).webp({ quality: 78 }).toFile(outPath);
    await unlink(filePath).catch(() => {});
    finalPath = outPath;
  } else if (['.heic', '.heif'].includes(ext)) {
    // sharp 预编译的 libvips 缺少 libde265（HEVC 解码器），iPhone 的 HEIC 需先用 libheif 解出像素再转码。
    // decodeHeic.all 在解码前即可读取尺寸：先验宽高再解码，避免超大图先整张解码进内存造成 OOM
    const buf = await readFile(filePath);
    const images = await decodeHeic.all({ buffer: buf });
    try {
      const { width, height } = images[0];
      if (width * height > 100_000_000) {
        throw new Error('图片尺寸过大（超过 1 亿像素），无法处理');
      }
      const { width: w, height: h, data } = await images[0].decode();
      // heic-decode 只输出原始像素(无 EXIF):iPhone 竖拍照片需按 EXIF Orientation 旋转,否则横置 90°
      const orientation = getHeicOrientation(buf) ?? 1;
      let pipeline = sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } });
      if (orientation === 2) pipeline = pipeline.flop();
      else if (orientation === 3) pipeline = pipeline.rotate(180);
      else if (orientation === 4) pipeline = pipeline.flip();
      else if (orientation === 5) pipeline = pipeline.rotate(270).flop();
      else if (orientation === 6) pipeline = pipeline.rotate(90);
      else if (orientation === 7) pipeline = pipeline.rotate(90).flop();
      else if (orientation === 8) pipeline = pipeline.rotate(270);
      await pipeline.webp({ quality: 78 }).toFile(outPath);
      await unlink(filePath).catch(() => {});
      finalPath = outPath;
    } finally {
      images.dispose();
    }
  }
  // 生成画廊缩略图（480px webp → image/thumb/<base>.webp）；失败仅记日志，不阻断上传
  try {
    await mkdir(THUMB_DIR, { recursive: true });
    const thumbName = `${basename(finalPath, extname(finalPath))}.webp`;
    await sharp(finalPath)
      .resize({ width: 480, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(join(THUMB_DIR, thumbName));
  } catch (e) {
    console.error('Thumbnail generation failed:', filePath, e.message);
  }
  return basename(finalPath);
}

// 归档原图到 image/original/（仅转码格式 png/jpg/jpeg/heic/heif 才有归档必要；gif/svg/webp 原样保留，主图即原图）。
// 返回归档后的文件名（不含目录），或 null 表示无需归档。
async function archiveOriginal(filePath, name) {
  const ext = extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.heic', '.heif'].includes(ext)) return null;
  await mkdir(ORIGINAL_DIR, { recursive: true });
  const dest = join(ORIGINAL_DIR, name);
  await copyFile(filePath, dest);
  return name;
}

// 解析音频元数据（歌名 / 歌手 / 封面）：解析失败返回空字段，不阻断上传
async function extractAudioMeta(filePath) {
  try {
    const { common } = await parseAudioMeta(filePath, { duration: false });
    const out = { title: '', artist: '', coverUrl: '' };
    if (common.title) out.title = String(common.title).trim().slice(0, 120);
    if (common.artist) out.artist = String(common.artist).trim().slice(0, 120);
    const pic = Array.isArray(common.picture) ? common.picture[0] : null;
    if (pic && pic.data && pic.data.length > 0) {
      // 封面转 WebP 存到图片仓库 image/ 目录（与图片同仓库，随同一次 push 推送）
      const coverName = `${Date.now()}_cover.webp`;
      await mkdir(IMAGE_DIR, { recursive: true });
      await sharp(pic.data)
        .resize({ width: 600, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(join(IMAGE_DIR, coverName));
      out.coverUrl = `${IMG_BASE_URL}${coverName}`;
    }
    return out;
  } catch (e) {
    // 解析失败不阻断上传；打印原因便于排查（如非标准编码标签）
    console.error('Audio meta parse failed:', filePath, e.message);
    return { title: '', artist: '', coverUrl: '' };
  }
}

// 预热 jsDelivr 缓存：上传的文件首次访问会 301 到 raw.githubusercontent.com 拉取，境内访问 raw 不稳定，
// 上传成功后主动请求一次，让链接立即可用。waitMs > 0 时最多等待该毫秒数（预热成功即提前返回），
// 使上传响应返回时 CDN 大概率已就绪、管理面板预览立即可见；失败/超时仅记日志，不影响上传结果。
// 超时（waitMs 或 90s）即 abort 底层 fetch，避免后台连接悬挂。
async function warmJsDelivr(url, waitMs = 0) {
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), waitMs > 0 ? waitMs : 90000);
  const p = fetch(url, { redirect: 'follow', signal: ctrl.signal })
    .then(r => {
      if (!r.ok) console.error('jsDelivr warm failed:', url, r.status);
      else console.log('jsDelivr warmed:', url);
    })
    .catch(e => {
      if (e.name !== 'AbortError') console.error('jsDelivr warm error:', url, e.message);
    });
  if (waitMs > 0) {
    await Promise.race([p, new Promise(r => setTimeout(r, waitMs))]).finally(() => clearTimeout(abortTimer));
  } else {
    p.finally(() => clearTimeout(abortTimer));
  }
}

// 推送图片仓库（有变更才推），失败时给出友好错误
async function pushImageRepo({ requestId = '' } = {}) {
  const startedAt = Date.now();
  try {
    const result = await imageGit.commitAndPush({
      paths: ['.'],
      message: '通过管理面板更新图片',
    });
    recordOperation({
      requestId,
      action: 'push-image-repo',
      status: result.pushed ? 'success' : 'skipped',
      message: result.pushed ? '图片仓库已推送' : '图片仓库没有需要推送的更改',
      durationMs: Date.now() - startedAt,
    });
    return { pushed: Boolean(result.pushed), preview: result.preview };
  } catch (err) {
    recordOperation({
      requestId,
      action: 'push-image-repo',
      status: 'error',
      message: err.message,
      detail: err.stderr || '',
      durationMs: Date.now() - startedAt,
    });
    const httpErr = toHttpError(err);
    throw httpErr;
  }
}

// Image upload
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('Upload Error:', err.message);
      if (err.message && err.message.includes('仅支持')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: '上传失败' });
    }
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    let filesSaved = false; // 转码/归档是否已成功落库（推送失败时保留文件，不清理）
    try {
      const isAudio = String(req.file.mimetype).startsWith('audio/');
      let filename, origName = null, title = '', artist = '', coverUrl = '';
      if (isAudio) {
        // 音频：原样保留（不做转码），落库到 audio/ 目录，并尝试解析歌名 / 歌手 / 封面
        filename = basename(req.file.path);
        const meta = await extractAudioMeta(req.file.path);
        title = meta.title;
        artist = meta.artist;
        coverUrl = meta.coverUrl;
      } else {
        origName = await archiveOriginal(req.file.path, basename(req.file.path));
        filename = await saveImageFile(req.file.path);
      }
      filesSaved = true;
      const push = await pushImageRepo();
      const base = isAudio ? AUDIO_BASE_URL : IMG_BASE_URL;
      const publicUrl = `${base}${encodeURIComponent(filename)}`;
      // 上传成功后预热 jsDelivr 缓存（等待最多 8 秒，让 CDN 就绪后返回，管理面板预览立即可见）
      await warmJsDelivr(publicUrl, 8000);
      res.status(201).json({
        success: true,
        url: publicUrl,
        originalUrl: origName ? `${IMG_BASE_URL}original/${encodeURIComponent(origName)}` : '',
        pushed: push.pushed,
        type: isAudio ? 'audio' : 'image',
        title,
        artist,
        coverUrl,
      });
    } catch (e) {
      console.error('Upload Error:', e.message);
      // 转码/归档失败时清理已写入的文件（含半成品 webp），避免残留被 git add -A 推送到公开图片仓库；
      // 仅推送失败（filesSaved=true）则保留文件，供用户稍后重新推送
      if (!filesSaved) {
        try {
          if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
            const ext = extname(req.file.path);
            const base = req.file.path.slice(0, -ext.length);
            await unlink(`${base}.webp`).catch(() => {});
            await unlink(join(THUMB_DIR, `${basename(base)}.webp`)).catch(() => {});
          }
          if (req.file?.filename) await unlink(join(ORIGINAL_DIR, req.file.filename)).catch(() => {});
        } catch { /* 忽略清理错误 */ }
      }
      res.status(e.status || 500).json({ error: e.message, detail: e.detail });
    }
  });
});

// 探测音频外链是否可播放（HEAD 优先，不可用则 GET Range 前 2KB 校验 Content-Type / 音频魔数）
// 网易云歌曲页链接自动映射到官方外链直链端点再探测
app.get('/api/audio-probe', async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).json({ error: '缺少 url 参数' });
    let parsed;
    try {
      parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad proto');
    } catch {
      return res.status(400).json({ error: '无效的 URL（仅支持 http/https）' });
    }
    const idMatch = raw.match(/music\.163\.com\/song[?/]id=(\d+)/i);
    const probeUrl = idMatch ? `https://music.163.com/song/media/outer/url?id=${idMatch[1]}.mp3` : raw;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    let ok = false, contentType = '', size = 0, note = '';
    // 1) HEAD 探测
    try {
      const r = await fetchPublic(probeUrl, { method: 'HEAD', signal: AbortSignal.timeout(15000), headers });
      contentType = r.headers.get('content-type') || '';
      size = Number(r.headers.get('content-length')) || 0;
      ok = r.ok && (contentType.startsWith('audio/') || contentType.includes('mpeg') || contentType.includes('octet-stream'));
      if (ok && idMatch) note = '网易云歌曲：经官方外链直链播放';
    } catch { /* HEAD 不可用，走 GET Range */ }
    // 2) GET Range 前 2KB，按 Content-Type 与音频魔数兜底
    if (!ok) {
      try {
        const r = await fetchPublic(probeUrl, { signal: AbortSignal.timeout(15000), headers: { ...headers, Range: 'bytes=0-2047' } });
        contentType = r.headers.get('content-type') || '';
        size = Number(r.headers.get('content-length')) || 0;
        ok = r.status === 206 || r.ok;
        if (ok && !contentType.startsWith('audio/')) {
          const head = (await readLimitedBuffer(r, 2048)).subarray(0, 12).toString('latin1');
          ok = head.startsWith('ID3') || head.startsWith('fLaC') || head.startsWith('OggS')
            || head.startsWith('RIFF') || head.startsWith('ftyp') || head.startsWith('\u0000\u0000\u0000');
        }
      } catch { ok = false; }
    }
    res.json({ ok, url: probeUrl, contentType: contentType.split(';')[0].trim(), size, note });
  } catch (e) {
    res.status(500).json({ error: '探测失败', detail: e.message });
  }
});

// URL import (download external image to local)
app.post('/api/import-url', async (req, res) => {
  let filePath = null;
  let filesSaved = false; // 转码/归档是否已成功落库（推送失败时保留文件，不清理）
  try {
    const { url, referer } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '请提供图片 URL' });
    }

    let parsed;
    try {
      parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: '仅支持 http/https 链接' });
      }
    } catch {
      return res.status(400).json({ error: '无效的 URL' });
    }

    const fetchHeaders = {};
    if (referer && typeof referer === 'string') {
      fetchHeaders.Referer = referer.trim();
    }

    const remote = await fetchPublic(url.trim(), {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(30000),
    });

    if (!remote.ok) {
      return res.status(502).json({ error: `远程服务器返回 ${remote.status}` });
    }

    const contentType = (remote.headers.get('content-type') || '').split(';')[0].trim();
    if (!ALLOWED_MIME.includes(contentType)) {
      // CDN/图床常把图片返回为 application/octet-stream（或缺失 Content-Type）：
      // 仅 heic/heif 按扩展名兜底放行（有 libheif 解码内容校验）；svg/gif/webp 等仍要求标准 MIME，避免未校验内容落库
      const urlExt = extname(parsed.pathname).toLowerCase();
      const isGeneric = contentType === 'application/octet-stream' || contentType === '';
      if (!(isGeneric && ['.heic', '.heif'].includes(urlExt))) {
        return res.status(400).json({ error: `远程文件不是支持的图片格式（${contentType || '未知'}）` });
      }
    }

    const contentLength = parseInt(remote.headers.get('content-length') || '0', 10);
    if (contentLength > LIMITS.remoteMaxBytes) {
      return res.status(400).json({ error: `远程文件超过 ${Math.round(LIMITS.remoteMaxBytes / 1024 / 1024)}MB 限制` });
    }

    const buffer = await readLimitedBuffer(remote);
    if (buffer.length > LIMITS.remoteMaxBytes) {
      return res.status(400).json({ error: `下载文件超过 ${Math.round(LIMITS.remoteMaxBytes / 1024 / 1024)}MB 限制` });
    }

    // Generate safe filename
    const urlPath = new URL(remote.url || url.trim()).pathname;
    const rawName = urlPath.split('/').pop() || 'import';
    const safeName = rawName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
      .substring(0, 60);
    const ext = extname(rawName).toLowerCase();
    const finalExt = IMAGE_EXTS.includes(ext) ? ext : '.jpg';
    const filename = `${safeName}_${Date.now()}${finalExt}`;

    await mkdir(IMAGE_DIR, { recursive: true });
    filePath = join(IMAGE_DIR, filename);
    await writeFile(filePath, buffer);
    const origName = await archiveOriginal(filePath, filename);
    const savedName = await saveImageFile(filePath);
    filesSaved = true;
    const push = await pushImageRepo();

    const publicUrl = `${IMG_BASE_URL}${encodeURIComponent(savedName)}`;
    // 预热 jsDelivr 缓存（等待最多 8 秒），让导入成功后管理面板预览立即可见
    await warmJsDelivr(publicUrl, 8000);

    res.status(201).json({
      success: true,
      url: publicUrl,
      originalUrl: origName ? `${IMG_BASE_URL}original/${encodeURIComponent(origName)}` : '',
      pushed: push.pushed,
    });
  } catch (err) {
    // 下载/转码/归档失败时清理已写入的文件（含半成品 webp），避免残留被推送到公开图片仓库；
    // 仅推送失败（filesSaved=true）则保留文件，供用户稍后重新推送
    if (filePath && !filesSaved) {
      await unlink(filePath).catch(() => {});
      const ext = extname(filePath);
      await unlink(`${filePath.slice(0, -ext.length)}.webp`).catch(() => {});
      await unlink(join(ORIGINAL_DIR, basename(filePath))).catch(() => {});
    }
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return res.status(504).json({ error: '下载超时（30 秒）' });
    }
    console.error('Import URL Error:', err.message);
    res.status(500).json({ error: '导入失败' });
  }
});

// Git push（内容推送：仅文章/图片/画廊数据；全量推送：全部改动含代码，排除 reasonix.toml）
async function pushGitChanges({ paths, commitMsg, requestId = '' }) {
  const startedAt = Date.now();
  try {
    const result = await blogGit.commitAndPush({ paths, message: commitMsg });
    recordOperation({
      requestId,
      action: commitMsg.includes('全量') ? 'push-full' : 'push-content',
      status: result.pushed ? 'success' : 'skipped',
      message: result.message,
      durationMs: Date.now() - startedAt,
      meta: { fileCount: result.preview?.fileCount || 0 },
    });
    return {
      success: true,
      message: result.message,
      detail: result.detail,
      preview: result.preview,
    };
  } catch (err) {
    const httpErr = toHttpError(err);
    recordOperation({
      requestId,
      action: commitMsg.includes('全量') ? 'push-full' : 'push-content',
      status: 'error',
      message: httpErr.message,
      detail: httpErr.detail || '',
      durationMs: Date.now() - startedAt,
      meta: { fileCount: httpErr.preview?.fileCount || 0 },
    });
    throw httpErr;
  }
}

// 内容推送：仅文章 / 画廊数据（图片已在上传时推送到图片仓库）
app.post('/api/push', async (req, res) => {
  try {
    const result = await pushGitChanges({
      paths: CONTENT_PUSH_PATHS,
      commitMsg: '通过管理面板更新博客',
      requestId: req.requestId,
    });
    // 顺带把图片仓库未推送的变更（如上次推送失败遗留）也推掉，不影响博客推送结果
    try {
      const imgPush = await pushImageRepo({ requestId: req.requestId });
      if (imgPush.pushed) result.imageRepoPushed = true;
    } catch (imgErr) {
      result.imageRepoWarning = imgErr.message;
    }
    res.json({ ok: true, requestId: req.requestId, ...result });
  } catch (err) {
    console.error('Push Error:', err.message);
    respondSyncError(res, req, err, 'PUSH_FAILED');
  }
});

// 全量推送：所有改动（含页面代码 / 管理面板等），排除 reasonix.toml
app.post('/api/push-full', async (req, res) => {
  try {
    const result = await pushGitChanges({
      paths: FULL_PUSH_PATHS,
      commitMsg: '通过管理面板全量推送',
      requestId: req.requestId,
    });
    res.json({ ok: true, requestId: req.requestId, ...result });
  } catch (err) {
    console.error('Push Full Error:', err.message);
    respondSyncError(res, req, err, 'PUSH_FULL_FAILED');
  }
});

// ── 发布中心：同步状态 / 预览 / 操作日志 ──

/** 统一的发布中心错误响应（含错误码、详情与 requestId） */
function respondSyncError(res, req, err, fallbackCode) {
  const httpErr = toHttpError(err);
  res.status(httpErr.status || 500).json({
    ok: false,
    success: false,
    code: httpErr.errorCode || fallbackCode,
    error: httpErr.message,
    detail: httpErr.detail,
    requestId: req.requestId,
  });
}

// 只读同步状态：默认只读本地引用，?fetch=1 时才访问远端
app.get('/api/sync/status', async (req, res) => {
  const wantFetch = req.query.fetch === '1' || req.query.fetch === 'true';
  try {
    const status = await collectSyncStatus({ fetch: wantFetch });
    res.json({ ...status, requestId: req.requestId });
  } catch (err) {
    console.error('Sync Status Error:', err.message);
    recordOperation({ requestId: req.requestId, action: 'sync-status', status: 'error', message: err.message });
    const httpErr = toHttpError(err);
    res.status(httpErr.status || 500).json({
      ok: false,
      state: 'sync-error',
      stateLabel: SYNC_STATE_LABELS['sync-error'],
      code: httpErr.errorCode || 'SYNC_STATUS_FAILED',
      error: httpErr.message,
      detail: httpErr.detail,
      requestId: req.requestId,
      checkedAt: new Date().toISOString(),
    });
  }
});

// 推送前预览：kind=content（内容推送）| full（全量推送）
app.get('/api/sync/preview', async (req, res) => {
  const kind = req.query.kind === 'full' ? 'full' : 'content';
  const paths = kind === 'full' ? FULL_PUSH_PATHS : CONTENT_PUSH_PATHS;
  try {
    const [preview, info] = await Promise.all([
      blogGit.previewCommit({ paths }),
      blogGit.status(),
    ]);
    res.json({
      ok: true,
      requestId: req.requestId,
      kind,
      kindLabel: kind === 'full' ? '全量推送' : '内容推送',
      paths,
      preview,
      state: deriveSyncState(info),
      stateLabel: SYNC_STATE_LABELS[deriveSyncState(info)] || '',
      ahead: info.ahead,
      behind: info.behind,
      hasUpstream: info.hasUpstream,
      branch: info.branch,
      upstream: info.upstream,
    });
  } catch (err) {
    console.error('Sync Preview Error:', err.message);
    respondSyncError(res, req, err, 'SYNC_PREVIEW_FAILED');
  }
});

// 拉取前预览：远端待拉取提交数与影响范围（本地引用，不访问远端）
app.get('/api/sync/pull-preview', async (req, res) => {
  try {
    const preview = await blogGit.previewPull();
    const info = await blogGit.status();
    res.json({ ok: true, requestId: req.requestId, ...preview, dirty: !info.clean, dirtyCount: info.dirtyCount });
  } catch (err) {
    console.error('Sync Pull Preview Error:', err.message);
    respondSyncError(res, req, err, 'SYNC_PULL_PREVIEW_FAILED');
  }
});

// 最近操作日志（发布中心）
app.get('/api/operations', (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  res.json({ ok: true, requestId: req.requestId, operations: operationLog.slice(0, limit) });
});

// ── Git sync（拉取远端内容）──
// 安全同步策略：仅当「远端领先、本地无未推送提交、工作区干净」可快进时才拉取；
// 其余情况（本地领先 / 分叉 / 工作区有未提交更改）跳过并给出原因，避免覆盖未推送内容或制造冲突。
// 返回 { status: 'up-to-date' | 'pulled' | 'skipped', message, ahead, behind, ... }
async function syncFromRemote({ requestId = '' } = {}) {
  const startedAt = Date.now();
  try {
    const result = await blogGit.pullFastForward();
    recordOperation({
      requestId,
      action: 'pull',
      status: result.status === 'pulled' ? 'success' : 'skipped',
      message: result.message,
      durationMs: Date.now() - startedAt,
      meta: { ahead: result.ahead, behind: result.behind, reason: result.reason },
    });
    return result;
  } catch (err) {
    const message = /无法连接远端/.test(err.message) ? '无法连接远端（网络问题），请稍后重试' : err.message;
    recordOperation({
      requestId,
      action: 'pull',
      status: 'error',
      message,
      detail: err.stderr || err.message,
      durationMs: Date.now() - startedAt,
    });
    const httpErr = toHttpError(err);
    httpErr.message = message;
    throw httpErr;
  }
}

// 手动拉取远端内容（管理面板按钮触发）
app.post('/api/pull', async (req, res) => {
  try {
    const result = await syncFromRemote({ requestId: req.requestId });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ok: true, success: true, requestId: req.requestId, ...result });
  } catch (err) {
    console.error('Pull Error:', err.message);
    respondSyncError(res, req, err, 'PULL_FAILED');
  }
});

// 启动时只检查同步状态，不自动拉取；需要自动拉取时显式设置 ADMIN_AUTO_PULL=1（不阻塞面板启动）
async function autoSyncOnStart() {
  const autoPull = process.env.ADMIN_AUTO_PULL === '1';
  try {
    const info = await blogGit.status();
    const state = deriveSyncState(info);
    console.log(`   [同步检查] ${SYNC_STATE_LABELS[state] || state}（分支 ${info.branch || '未知'}，未提交 ${info.dirtyCount}，领先 ${info.ahead}，落后 ${info.behind}）`);
    if (autoPull) {
      const result = await blogGit.pullFastForward();
      recordOperation({ action: 'auto-pull', status: result.status === 'pulled' ? 'success' : 'skipped', message: result.message });
      console.log(`   [自动拉取] ${result.message}`);
    } else {
      console.log('   [同步检查] 已跳过自动拉取（需要自动拉取时设置 ADMIN_AUTO_PULL=1）；可在「发布中心」手动拉取');
    }
  } catch (err) {
    console.log(`   [同步检查] 无法读取工作区状态：${err.message}`);
  }
}

// ── Gallery API ──

// Helper: read/write gallery.json
async function readGallery() {
  try {
    const { data } = await galleryStore.read();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof InvalidDataError) throw err;
    return [];
  }
}

async function writeGallery(items, { expectedHash = null } = {}) {
  return galleryStore.write(items, { expectedHash });
}

// List / create gallery items
app.route('/api/gallery')
  .get(async (_req, res) => {
    try {
      const { data, contentHash } = await galleryStore.read();
      res.setHeader('x-content-hash', contentHash || '');
      res.json(Array.isArray(data) ? data : []);
    } catch (err) {
      respondStoreError(res, err, 'Gallery API');
    }
  })
  .post(upload.none(), async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.body.expectedHash);
      if (!hashCheck.ok) return;
      const { src, alt, title, caption, date, dayIndex, sourceUrl, sourceTitle, original } = req.body;
      if (!src || !title) {
        return res.status(400).json({ error: 'src 和 title 为必填字段' });
      }
      const id = `独立-${Date.now()}`;
      const items = await readGallery();
      const finalDate = safeDate(date, (new Date()).toISOString().split('T')[0]);
      const di = parseDayIndex(dayIndex);
      const item = {
        id,
        src: src.trim(),
        alt: (alt || '').trim(),
        title: title.trim(),
        caption: (caption || '').trim(),
        date: finalDate,
        dayIndex: di ?? nextGalleryDayIndex(items, finalDate),
      };
      const sourceLink = sourceUrl == null ? '' : safeLink(sourceUrl);
      if (sourceLink === null) return res.status(400).json({ error: 'Invalid source URL' });
      if (sourceLink) item.sourceUrl = sourceLink;
      if (sourceTitle) item.sourceTitle = sourceTitle.trim();
      if (original) item.original = original.trim();
      items.unshift(item);
      const written = await writeGallery(items, { expectedHash: hashCheck.hash });
      res.status(201).json({ success: true, item, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Gallery API');
    }
  });

// Get / update / delete single gallery item
app.route('/api/gallery/:id')
  .get(async (req, res) => {
    try {
      const items = await readGallery();
      const item = items.find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ error: '图像不存在' });
      res.json(item);
    } catch (err) {
      respondStoreError(res, err, 'Gallery API');
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.body.expectedHash);
      if (!hashCheck.ok) return;
      const items = await readGallery();
      const idx = items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '图像不存在' });

      const { src, alt, title, caption, date, dayIndex, sourceUrl, sourceTitle, original } = req.body;
      if (!src || !title) {
        return res.status(400).json({ error: 'src 和 title 为必填字段' });
      }

      const sourceLink = sourceUrl == null ? '' : safeLink(sourceUrl);
      if (sourceLink === null) return res.status(400).json({ error: 'Invalid source URL' });
      const finalDate = safeDate(date, items[idx].date);
      const others = items.filter((_, i) => i !== idx);
      const di = parseDayIndex(dayIndex);
      items[idx] = {
        ...items[idx],
        src: src.trim(),
        alt: (alt || '').trim(),
        title: title.trim(),
        caption: (caption || '').trim(),
        date: finalDate,
        dayIndex: di ?? nextGalleryDayIndex(others, finalDate),
        sourceUrl: sourceLink || undefined,
        sourceTitle: (sourceTitle || '').trim() || undefined,
        original: (original || '').trim() || undefined,
      };
      const written = await writeGallery(items, { expectedHash: hashCheck.hash });
      res.json({ success: true, item: items[idx], contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Gallery API');
    }
  })
  .delete(async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.query.expectedHash);
      if (!hashCheck.ok) return;
      const items = await readGallery();
      const idx = items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '图像不存在' });
      items.splice(idx, 1);
      const written = await writeGallery(items, { expectedHash: hashCheck.hash });
      res.json({ success: true, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Gallery API');
    }
  });

// ── About page API ──

function cleanAboutStr(v, max = 5000) {
  return String(v ?? '').trim().slice(0, max);
}

// 身份表 / 兴趣列表条目清洗
function cleanAboutItems(arr, fields) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, 30)
    .map(it => {
      const out = {};
      fields.forEach(f => { out[f] = cleanAboutStr(it?.[f]); });
      return out;
    })
    .filter(it => Object.values(it).some(v => v !== ''));
}

// Read about.json（返回内容与 contentHash）
async function readAboutDoc() {
  const { data, contentHash } = await aboutStore.read();
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
    contentHash: contentHash || '',
  };
}

async function readAbout() {
  try {
    return (await readAboutDoc()).data;
  } catch {
    return {};
  }
}

// ── 网页标题解析（“我的项目”网址解析）──
const TITLE_FETCH_TIMEOUT = 8000;
const TITLE_MAX_BYTES = 512 * 1024;

function decodeHtmlEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', middot: '·', copy: '©', reg: '®', trade: '™' };
  const safeChar = (code) => {
    if (code === 0 || code > 0x10ffff) return '';
    try { return String.fromCodePoint(code); } catch { return ''; }
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, e) => named[e.toLowerCase()] ?? m);
}

/** 抓取网页 <title>；解析失败返回空串（复用 fetchPublic 的 SSRF 防护与重定向处理） */
async function fetchPageTitle(rawUrl) {
  try {
    const safe = safeLink(rawUrl, { allowEmpty: false });
    if (!safe) return '';
    const res = await fetchPublic(safe, {
      signal: AbortSignal.timeout(TITLE_FETCH_TIMEOUT),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlogAdmin/1.0; title-resolver)' },
    });
    if (!res.ok) return '';
    const contentType = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) return '';
    const buf = await readLimitedBuffer(res, TITLE_MAX_BYTES);
    if (!buf.length) return '';
    let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] || null;
    if (!charset) {
      const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'));
      if (m) charset = m[1];
    }
    let text;
    try {
      text = charset ? new TextDecoder(charset).decode(buf) : buf.toString('utf8');
    } catch {
      text = buf.toString('utf8');
    }
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    if (!m) return '';
    return decodeHtmlEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

/** 保存项目条目时：仅对 title 为空且有网址的条目自动解析（解析失败保持空，前端兜底显示裸网址） */
async function resolveProjectTitles(projects) {
  return Promise.all((projects || []).map(async (p) => {
    if (p.title || !p.url) return p;
    return { ...p, title: await fetchPageTitle(p.url) };
  }));
}

// urlencoded body 中数组以 JSON 字符串传输，统一解析
function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr : null;
    } catch { /* fallthrough */ }
  }
  return null;
}

app.route('/api/about')
  .get(async (_req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const doc = await readAboutDoc();
      res.json({ ...doc.data, contentHash: doc.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'About API');
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.body.expectedHash);
      if (!hashCheck.ok) return;
      const prev = await readAbout();
      const body = req.body || {};
      const identityArr = parseJsonArray(body.identity);
      const interestsArr = parseJsonArray(body.interests);
      const projectsArr = parseJsonArray(body.projects);
      const paragraphsArr = parseJsonArray(body.paragraphs);
      // 字符串字段：未提交（undefined/null）时保留旧值；提交空串则清空（如移除头像）
      const strField = (v, prevVal, max) => (v == null ? (prevVal || '') : cleanAboutStr(v, max));
      const next = {
        avatar: strField(body.avatar, prev.avatar || '', 1000),
        eyebrow: strField(body.eyebrow, prev.eyebrow || ''),
        title: strField(body.title, prev.title || ''),
        subtitle: strField(body.subtitle, prev.subtitle || ''),
        identity: identityArr ? cleanAboutItems(identityArr, ['label', 'value']) : (prev.identity || []),
        lead: strField(body.lead, prev.lead || ''),
        paragraphs: paragraphsArr
          ? paragraphsArr.slice(0, 30).map(s => cleanAboutStr(s)).filter(Boolean)
          : (prev.paragraphs || []),
        quoteLabel: strField(body.quoteLabel, prev.quoteLabel || ''),
        quoteText: strField(body.quoteText, prev.quoteText || ''),
        interestsTitle: strField(body.interestsTitle, prev.interestsTitle || ''),
        interests: interestsArr ? cleanAboutItems(interestsArr, ['index', 'name', 'note']) : (prev.interests || []),
        projectsTitle: strField(body.projectsTitle, prev.projectsTitle || ''),
        projects: projectsArr
          ? await resolveProjectTitles(cleanAboutItems(projectsArr, ['index', 'name', 'url', 'title']))
          : (prev.projects || []),
      };
      const written = await aboutStore.write(next, { expectedHash: hashCheck.hash });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, about: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'About API');
    }
  });

// 单行“解析标题”按钮：给定网址返回 <title>（解析失败返回空串）
app.post('/api/about/resolve-title', express.json(), async (req, res) => {
  try {
    const title = await fetchPageTitle(req.body?.url);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ success: true, title });
  } catch (err) {
    console.error('Resolve Title Error:', err.message);
    res.status(500).json({ error: '解析失败' });
  }
});

// ── Frontend customization API ──

const FRONTEND_DEFAULTS = {
  defaultVisualTheme: 'cyanotype',
  siteName: 'Acretiondisk',
  siteTagline: '记录想法与生活',
  heroEyebrow: 'PERSONAL ARCHIVE · 2026',
  heroTitleLine1: '在生活之中，',
  heroTitleLine2: '留存我的观察。',
  heroDescription: '医学、技术、艺术，以及日常生活里值得记住的片刻。',
  primaryCtaLabel: '浏览文章',
  primaryCtaHref: '/blog/',
  stillHeroImage: 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/_DSC0217_1785663966034.webp',
  stillHeroAlt: '云南夏日山野',
  stillImagePosition: 'center',
  fluidHeroImage: 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/a42a4e50333f93636b6bf41305ddfe88_1785630055301.webp',
  fluidHeroAlt: '清晨跑步时拍下的城市风景',
  fluidImagePosition: 'center',
  displayFont: 'noto-serif',
  stillAccent: '#c44136',
  fluidPrimary: '#1f6955',
  fluidSecondary: '#db5d4f',
  stillGlassOpacity: 0.84,
  fluidGlassOpacity: 0.8,
  heroOverlayOpacity: 0.34,
  glassBlur: 20,
  cardRadius: 8,
};

const VISUAL_THEMES = new Set(['cyanotype', 'still', 'fluid', 'minimal', 'trace']);
const IMAGE_POSITIONS = new Set(['center', 'center top', 'center bottom', 'left center', 'right center']);
const DISPLAY_FONTS = new Set(['noto-serif', 'noto-sans', 'kaiti', 'songti', 'sans']);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

async function readFrontendDoc() {
  const { data, contentHash } = await frontendStore.read();
  return {
    data: { ...FRONTEND_DEFAULTS, ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}) },
    contentHash: contentHash || '',
  };
}

async function readFrontend() {
  try {
    return (await readFrontendDoc()).data;
  } catch {
    return { ...FRONTEND_DEFAULTS };
  }
}

function cleanFrontendNumber(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

app.route('/api/frontend')
  .get(async (_req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const doc = await readFrontendDoc();
      res.json({ ...doc.data, contentHash: doc.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Frontend API');
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.body.expectedHash);
      if (!hashCheck.ok) return;
      const prev = await readFrontend();
      const body = req.body || {};
      const primaryCtaHref = body.primaryCtaHref == null ? prev.primaryCtaHref : safeLink(body.primaryCtaHref);
      if (primaryCtaHref === null) return res.status(400).json({ error: 'Invalid CTA URL' });
      const strField = (key, max = 1000) => body[key] == null
        ? prev[key]
        : cleanAboutStr(body[key], max);
      const enumField = (key, values) => values.has(body[key]) ? body[key] : prev[key];
      const colorField = (key) => HEX_COLOR_RE.test(body[key] || '') ? body[key].toLowerCase() : prev[key];
      const next = {
        defaultVisualTheme: enumField('defaultVisualTheme', VISUAL_THEMES),
        siteName: strField('siteName', 80),
        siteTagline: strField('siteTagline', 120),
        heroEyebrow: strField('heroEyebrow', 120),
        heroTitleLine1: strField('heroTitleLine1', 80),
        heroTitleLine2: strField('heroTitleLine2', 80),
        heroDescription: strField('heroDescription', 300),
        primaryCtaLabel: strField('primaryCtaLabel', 40),
        primaryCtaHref,
        stillHeroImage: strField('stillHeroImage', 2000),
        stillHeroAlt: strField('stillHeroAlt', 200),
        stillImagePosition: enumField('stillImagePosition', IMAGE_POSITIONS),
        fluidHeroImage: strField('fluidHeroImage', 2000),
        fluidHeroAlt: strField('fluidHeroAlt', 200),
        fluidImagePosition: enumField('fluidImagePosition', IMAGE_POSITIONS),
        displayFont: enumField('displayFont', DISPLAY_FONTS),
        stillAccent: colorField('stillAccent'),
        fluidPrimary: colorField('fluidPrimary'),
        fluidSecondary: colorField('fluidSecondary'),
        stillGlassOpacity: cleanFrontendNumber(body.stillGlassOpacity, prev.stillGlassOpacity, 0.15, 1),
        fluidGlassOpacity: cleanFrontendNumber(body.fluidGlassOpacity, prev.fluidGlassOpacity, 0.15, 1),
        heroOverlayOpacity: cleanFrontendNumber(body.heroOverlayOpacity, prev.heroOverlayOpacity, 0.18, 0.62),
        glassBlur: cleanFrontendNumber(body.glassBlur, prev.glassBlur, 10, 32),
        cardRadius: cleanFrontendNumber(body.cardRadius, prev.cardRadius, 2, 8),
      };
      const written = await frontendStore.write(next, { expectedHash: hashCheck.hash });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, frontend: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Frontend API');
    }
  });

// ── 集中配置：上传 / 请求 / 远程 / 超时 / 并发限制（发布中心与媒体库在 UI 中展示）──

// ── Media library API ──
const MEDIA_IMAGE_EXTS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.heic', '.heif', '.avif'];
const MEDIA_AUDIO_EXTS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac'];
const IMAGE_ARCHIVE_DIR = join(IMAGE_DIR, '_archive');
const AUDIO_ARCHIVE_DIR = join(AUDIO_DIR, '_archive');

async function listMediaFiles(dir, exts) {
  const names = await readdir(dir).catch(() => []);
  const out = [];
  for (const name of names) {
    if (!exts.includes(extname(name).toLowerCase())) continue;
    const full = join(dir, name);
    const st = await statFile(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    out.push({ name, size: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}

const mediaDimensionCache = new Map();
async function mediaDimensions(fullPath, cacheKey) {
  if (mediaDimensionCache.has(cacheKey)) return mediaDimensionCache.get(cacheKey);
  let dim = { width: 0, height: 0 };
  try {
    const meta = await sharp(fullPath).metadata();
    dim = { width: meta.width || 0, height: meta.height || 0 };
  } catch { /* 非图片或读取失败 */ }
  mediaDimensionCache.set(cacheKey, dim);
  return dim;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function fileNameFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const last = raw.split(/[?#]/)[0].split('/').pop() || '';
  try { return decodeURIComponent(last); } catch { return last; }
}

/** 扫描文章与画廊，返回 { 文件名: [引用者] } */
async function collectMediaUsage() {
  const usage = new Map();
  const mark = (name, owner) => {
    if (!name) return;
    if (!usage.has(name)) usage.set(name, new Set());
    usage.get(name).add(owner);
  };
  const files = (await readdir(BLOG_DIR).catch(() => [])).filter((f) => /\.(md|mdx)$/i.test(f));
  for (const file of files) {
    const slug = file.replace(/\.(md|mdx)$/i, '');
    const raw = await readFile(join(BLOG_DIR, file), 'utf8').catch(() => '');
    const cdnRe = /https?:\/\/[^\s)"'<>]*?\/(?:image|audio)\/([^)"'<>\s/]+)/g;
    let m;
    while ((m = cdnRe.exec(raw))) mark(fileNameFromUrl(m[1]), `post:${slug}`);
    const bareRe = /([A-Za-z0-9\u4e00-\u9fff_@.\-]+\.(?:webp|png|jpe?g|gif|svg|heic|heif|avif|mp3|flac|ogg|wav|m4a|aac))/gi;
    while ((m = bareRe.exec(raw))) mark(m[1], `post:${slug}`);
  }
  try {
    const { data } = await galleryStore.read();
    if (Array.isArray(data)) {
      for (const item of data) {
        for (const u of [item.src, item.original]) mark(fileNameFromUrl(u), `gallery:${item.id}`);
      }
    }
  } catch { /* 画廊读取失败时忽略 */ }
  const plain = {};
  for (const [name, owners] of usage) plain[name] = [...owners];
  return plain;
}

app.get('/api/media', async (req, res) => {
  try {
    const [imageFiles, audioFiles, usage] = await Promise.all([
      listMediaFiles(IMAGE_DIR, MEDIA_IMAGE_EXTS),
      listMediaFiles(AUDIO_DIR, MEDIA_AUDIO_EXTS),
      collectMediaUsage(),
    ]);
    const images = await mapWithConcurrency(imageFiles, 8, async (f) => {
      const dim = await mediaDimensions(join(IMAGE_DIR, f.name), `${f.name}:${f.mtime}`);
      return {
        type: 'image',
        name: f.name,
        size: f.size,
        mtime: f.mtime,
        width: dim.width,
        height: dim.height,
        url: `${IMG_BASE_URL}${encodeURIComponent(f.name)}`,
        originalUrl: `${IMG_BASE_URL}original/${encodeURIComponent(f.name)}`,
        usedBy: usage[f.name] || [],
      };
    });
    const audios = audioFiles.map((f) => ({
      type: 'audio',
      name: f.name,
      size: f.size,
      mtime: f.mtime,
      url: `${AUDIO_BASE_URL}${encodeURIComponent(f.name)}`,
      usedBy: usage[f.name] || [],
    }));
    images.sort((a, b) => b.mtime.localeCompare(a.mtime));
    audios.sort((a, b) => b.mtime.localeCompare(a.mtime));
    const withUsage = images.filter((i) => i.usedBy.length).length + audios.filter((a) => a.usedBy.length).length;
    res.json({
      ok: true,
      requestId: req.requestId,
      images,
      audios,
      generatedAt: new Date().toISOString(),
      limits: LIMITS,
      stats: { images: images.length, audios: audios.length, referenced: withUsage, orphan: images.length + audios.length - withUsage },
    });
  } catch (err) {
    console.error('Media API Error:', err.message);
    res.status(500).json({ error: '读取媒体库失败' });
  }
});

function resolveMediaTarget(type, name) {
  const raw = String(name || '');
  const safeName = basename(raw);
  if (!safeName || safeName !== raw) return null;
  const isImage = type === 'image';
  const dir = isImage ? IMAGE_DIR : type === 'audio' ? AUDIO_DIR : null;
  if (!dir) return null;
  const exts = isImage ? MEDIA_IMAGE_EXTS : MEDIA_AUDIO_EXTS;
  if (!exts.includes(extname(safeName).toLowerCase())) return null;
  return { dir, name: safeName, isImage };
}

app.delete('/api/media', async (req, res) => {
  try {
    const target = resolveMediaTarget(req.query.type, req.query.name);
    if (!target) return res.status(400).json({ error: '无效的媒体类型或文件名' });
    const usage = await collectMediaUsage();
    const usedBy = usage[target.name] || [];
    if (usedBy.length) {
      return res.status(409).json({ code: 'MEDIA_IN_USE', error: `该资源仍被 ${usedBy.length} 处引用，未删除`, usedBy });
    }
    await unlink(join(target.dir, target.name));
    if (target.isImage) {
      await unlink(join(THUMB_DIR, `${basename(target.name, extname(target.name))}.webp`)).catch(() => {});
      await unlink(join(ORIGINAL_DIR, target.name)).catch(() => {});
    }
    let pushed = false;
    try { pushed = (await pushImageRepo({ requestId: req.requestId })).pushed; } catch { /* 推送失败不影响本地删除 */ }
    res.json({ ok: true, deleted: target.name, pushed, requestId: req.requestId });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: '文件不存在' });
    console.error('Media Delete Error:', err.message);
    res.status(500).json({ error: '删除媒体失败' });
  }
});

app.post('/api/media/archive', upload.none(), async (req, res) => {
  try {
    const target = resolveMediaTarget(req.body.type, req.body.name);
    if (!target) return res.status(400).json({ error: '无效的媒体类型或文件名' });
    const archiveDir = target.isImage ? IMAGE_ARCHIVE_DIR : AUDIO_ARCHIVE_DIR;
    await mkdir(archiveDir, { recursive: true });
    await rename(join(target.dir, target.name), join(archiveDir, target.name));
    let pushed = false;
    try { pushed = (await pushImageRepo({ requestId: req.requestId })).pushed; } catch { /* ignore */ }
    res.json({ ok: true, archived: target.name, pushed, requestId: req.requestId });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: '文件不存在' });
    console.error('Media Archive Error:', err.message);
    res.status(500).json({ error: '归档媒体失败' });
  }
});

// 运行限制与健康检查（UI 显示当前限制）
app.get('/api/health', (req, res) => {
  res.json({ ok: true, requestId: req.requestId, limits: LIMITS, uploadDir: basename(IMG_REPO_DIR) });
});

// Static files from public/
app.use(express.static(join(__dirname, 'public')));

// Admin panel
app.get(['/admin', '/admin/', '/admin/index.html'], async (_req, res) => {
  try {
    const html = await readFile(ADMIN_HTML, 'utf8');
    const injected = html.replace("window.__ADMIN_TOKEN__ = '__ADMIN_TOKEN__';", `window.__ADMIN_TOKEN__ = ${JSON.stringify(ADMIN_TOKEN)};`);
    res.type('html').send(injected);
  } catch (err) {
    console.error('Admin panel error:', err.message);
    res.status(500).send('Admin panel unavailable');
  }
});
app.use('/admin', express.static(join(__dirname, 'admin')));

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/admin`;
  console.log(`\n📚 博客管理面板已启动: ${url}\n`);
  console.log(`   仅限本地使用 — 请勿暴露到公网`);
  if (!process.env.ADMIN_TOKEN) {
    console.log(`   管理口令：自动生成并保存于 ${TOKEN_FILE}（重启后保持不变）`);
  }
  console.log('');

  if (process.env.ADMIN_NO_OPEN !== '1') {
    const cmd = process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) console.log('   请手动打开浏览器访问上述地址');
    });
  }

  // 启动时自动比对本地与远端版本：有差异自动拉取同步，无差异忽略（不阻塞面板）
  autoSyncOnStart();
});
