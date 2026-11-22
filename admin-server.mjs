import express from 'express';
import multer from 'multer';
import sharp from 'sharp';

// Windows 长驻进程：关闭 libvips 操作缓存与文件句柄复用。
// 否则被 sharp 读过的图片会被进程持续占用，导致后续删除/覆盖报 EBUSY（Device or resource busy）。
// 说明：曾实测改为有界缓存 sharp.cache({ memory: 50, files: 0, items: 100 })，
// 对真实媒体库（431 张图，逐个 metadata 探测）耗时无可见收益（0.66~0.73ms/张，与关闭时同一噪声区间，
// 因为每次探测的文件都不同、无法命中操作缓存），而 files>0 会重新引入句柄占用风险，故保持关闭。
sharp.cache(false);
import decodeHeic from 'heic-decode';
import { getHeicOrientation } from './admin/heic-exif.mjs';
import { readdir, readFile, writeFile, unlink, mkdir, access as fileAccess, copyFile, stat as statFile, rename, statfs, rm } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join, dirname, extname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { brotliCompress, brotliCompressSync, gzip, gzipSync, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';
import matter from 'gray-matter';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
import { slug as githubSlug } from 'github-slugger';
import { atomicWriteFile, sha256 } from './admin/atomic-file.mjs';
import { createGitService, GitCommandError, redactSecrets } from './admin/git-service.mjs';
import { createJsonStore, InvalidDataError, parseExpectedHash, VersionConflictError } from './admin/json-store.mjs';
import { parseFile as parseAudioMeta } from 'music-metadata';
import { createQuotaService } from './scripts/ai-quota-proxy.mjs';
import { normalizeSchedulePayload } from './src/lib/schedule-core.mjs';
import { sanitizeDailyEntry, sortDailyItems } from './src/lib/daily-moments-grid.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 内容 / 数据目录支持环境变量覆盖（自动化测试使用隔离目录，不触碰真实数据）
const BLOG_DIR = process.env.ADMIN_BLOG_DIR ? resolve(process.env.ADMIN_BLOG_DIR) : resolve(__dirname, 'src', 'content', 'blog');
const DATA_DIR = process.env.ADMIN_DATA_DIR ? resolve(process.env.ADMIN_DATA_DIR) : resolve(__dirname, 'src', 'data');
// 图片仓库：与博客仓库平级的 blog-images，图片上传后经 jsDelivr CDN 外链引用
// IMG_REPO_DIR 支持环境变量覆盖（测试隔离用）
const IMG_REPO_DIR = process.env.IMG_REPO_DIR ? resolve(process.env.IMG_REPO_DIR) : resolve(__dirname, '..', 'blog-images');
const IMAGE_DIR = resolve(IMG_REPO_DIR, 'image');
const AUDIO_DIR = resolve(IMG_REPO_DIR, 'audio');
const VIDEO_DIR = resolve(IMG_REPO_DIR, 'video');
const FILE_DIR = resolve(IMG_REPO_DIR, 'file');
const ORIGINAL_DIR = resolve(IMAGE_DIR, 'original');
const THUMB_DIR = resolve(IMAGE_DIR, 'thumb');
const IMG_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/';
const AUDIO_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/audio/';
const VIDEO_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/video/';
const FILE_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/file/';
const GALLERY_JSON = resolve(DATA_DIR, 'gallery.json');
const DAILY_JSON = resolve(DATA_DIR, 'daily.json');
const ABOUT_JSON = resolve(DATA_DIR, 'about.json');
const FRONTEND_JSON = resolve(DATA_DIR, 'frontend.json');
const SCHEDULE_JSON = resolve(DATA_DIR, 'schedule.json');
const CATEGORIES_JSON = resolve(DATA_DIR, 'categories.json');
const PROJECTS_JSON = resolve(DATA_DIR, 'projects.json');
const REPORT_JSON = resolve(DATA_DIR, 'report.json');
const ACADEMICS_JSON = resolve(DATA_DIR, 'academics.json');
const EXAMS_JSON = resolve(DATA_DIR, 'exams.json');
const INTERACT_LOCAL_JSON = process.env.ADMIN_INTERACT_FILE
  ? resolve(process.env.ADMIN_INTERACT_FILE)
  : process.env.ADMIN_DATA_DIR
    ? resolve(DATA_DIR, '.interact-local.json')
    : resolve(__dirname, '.interact-local.json');
const PORT = parseInt(process.env.PORT, 10) || 4322;
const SERVER_STARTED_AT = new Date().toISOString();
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

const SCHEDULE_DEFAULT = {
  version: 2,
  timetables: [],
  activeId: null,
  favorites: [],
  slotHeight: 72,
  hideEmptyWeekends: false,
  updatedAt: 0,
};

function validateScheduleData(value) {
  const normalized = normalizeSchedulePayload(value);
  if (!normalized) throw new InvalidDataError('课表数据格式不正确');
  return normalized;
}

function validateDailyData(value) {
  if (!Array.isArray(value)) throw new InvalidDataError('日常数据必须是数组');
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidDataError(`日常第 ${index + 1} 项不是对象`);
    if (typeof item.id !== 'string' || !item.id) throw new InvalidDataError(`日常第 ${index + 1} 项缺少 id`);
    if (typeof item.createdAt !== 'string' || !item.createdAt) throw new InvalidDataError(`日常第 ${index + 1} 项缺少 createdAt`);
    if (item.images != null && !Array.isArray(item.images)) throw new InvalidDataError(`日常第 ${index + 1} 项 images 必须是数组`);
    if (Array.isArray(item.images) && item.images.length > 9) throw new InvalidDataError(`日常第 ${index + 1} 项图片不能超过 9 张`);
  });
  return value;
}

function validateCategoriesData(value) {
  if (!Array.isArray(value)) throw new InvalidDataError('文章分类必须是数组');
  const seenIds = new Set();
  const seenNames = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidDataError(`分类第 ${index + 1} 项不是对象`);
    const name = String(item.name || '').trim().slice(0, 40);
    if (!name) throw new InvalidDataError(`分类第 ${index + 1} 项缺少名称`);
    if (seenNames.has(name)) throw new InvalidDataError(`分类名称「${name}」重复`);
    const id = (String(item.id || `cat-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)) || `cat-${index + 1}`;
    if (id === 'uncategorized') throw new InvalidDataError('分类 id 不能使用保留值 uncategorized');
    if (seenIds.has(id)) throw new InvalidDataError(`分类 id「${id}」重复`);
    seenIds.add(id);
    seenNames.add(name);
    const color = /^#[0-9a-f]{6}$/i.test(String(item.color || '').trim()) ? String(item.color).trim() : '#ff5a1a';
    const order = Number.isFinite(Number(item.order)) ? Math.round(Number(item.order)) : index + 1;
    return {
      id,
      name,
      slug: String(item.slug || id).trim().slice(0, 48) || id,
      description: String(item.description || '').trim().slice(0, 200),
      color,
      order,
    };
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function validateProjectsData(value) {
  if (!Array.isArray(value)) throw new InvalidDataError('造物项目必须是数组');
  const seenIds = new Set();
  const validStatus = new Set(['active', 'maintaining', 'experiment', 'archived']);
  const validKind = new Set(['web', 'app', 'cli', 'extension', 'ai', 'other']);
  const cleanArr = (arr, max = 20, maxLen = 140) => [...new Set(
    (Array.isArray(arr) ? arr : String(arr || '').split(/[,，\n]/))
      .map((s) => String(s || '').trim().slice(0, maxLen))
      .filter(Boolean),
  )].slice(0, max);

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidDataError(`项目第 ${index + 1} 项不是对象`);
    const name = String(item.name || '').trim().slice(0, 80);
    if (!name) throw new InvalidDataError(`项目第 ${index + 1} 项缺少名称`);
    const id = (String(item.id || `proj-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)) || `proj-${index + 1}`;
    if (seenIds.has(id)) throw new InvalidDataError(`项目 id「${id}」重复`);
    seenIds.add(id);
    for (const urlField of ['repoUrl', 'demoUrl']) {
      const rawUrl = String(item[urlField] || '').trim();
      if (rawUrl && safeLink(rawUrl) === null) {
        throw new InvalidDataError(`项目「${name}」的 ${urlField} 链接不合法`);
      }
    }
    return {
      id,
      name,
      tagline: String(item.tagline || '').trim().slice(0, 140),
      description: String(item.description || '').trim().slice(0, 1200),
      status: validStatus.has(item.status) ? item.status : 'maintaining',
      kind: validKind.has(item.kind) ? item.kind : 'other',
      stack: cleanArr(item.stack, 12, 32),
      repoUrl: String(item.repoUrl || '').trim().slice(0, 500),
      demoUrl: String(item.demoUrl || '').trim().slice(0, 500),
      cover: String(item.cover || '').trim().slice(0, 500),
      featured: Boolean(item.featured),
      order: Number.isFinite(Number(item.order)) ? Math.round(Number(item.order)) : index + 1,
      postSlugs: cleanArr(item.postSlugs, 20, 140),
      postTags: cleanArr(item.postTags, 12, 40),
      highlights: cleanArr(item.highlights, 8, 120),
    };
  }).sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order);
}

function validateReportData(value) {
  requirePlainObject(value, '观测报告数据');
  const rawReports = Array.isArray(value.reports) ? value.reports : [];
  const seen = new Set();
  const reports = rawReports.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidDataError(`报告第 ${index + 1} 项不是对象`);
    const id = (String(item.id || `report-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)) || `report-${index + 1}`;
    if (seen.has(id)) throw new InvalidDataError(`报告 id「${id}」重复`);
    seen.add(id);
    const title = String(item.title || '').trim().slice(0, 120);
    if (!title) throw new InvalidDataError(`报告第 ${index + 1} 项缺少标题`);
    const milestones = (Array.isArray(item.milestones) ? item.milestones : []).slice(0, 30).map((m) => {
      if (!m || typeof m !== 'object') return null;
      const mt = String(m.title || '').trim().slice(0, 120);
      if (!mt) return null;
      const link = String(m.link || '').trim().slice(0, 400);
      if (link && safeLink(link) === null) throw new InvalidDataError(`里程碑「${mt}」链接不合法`);
      return {
        date: String(m.date || '').trim().slice(0, 32),
        title: mt,
        detail: String(m.detail || '').trim().slice(0, 320),
        ...(link ? { link } : {}),
      };
    }).filter(Boolean);
    const strArr = (arr) => [...new Set((Array.isArray(arr) ? arr : String(arr || '').split(/[,，]/)).map((s) => String(s || '').trim().slice(0, 140)).filter(Boolean))].slice(0, 20);
    return {
      id,
      title,
      subtitle: String(item.subtitle || '').trim().slice(0, 240),
      periodLabel: String(item.periodLabel || '').trim().slice(0, 60),
      dateStart: String(item.dateStart || '').trim().slice(0, 10),
      dateEnd: String(item.dateEnd || '').trim().slice(0, 10),
      summary: String(item.summary || '').trim().slice(0, 2000),
      keywords: strArr(item.keywords),
      milestones,
      featuredPosts: strArr(item.featuredPosts),
      featuredDailies: strArr(item.featuredDailies),
      outroQuote: String(item.outroQuote || '').trim().slice(0, 300),
      published: item.published !== false,
      order: Number.isFinite(Number(item.order)) ? Math.round(Number(item.order)) : index + 1,
    };
  }).sort((a, b) => a.order - b.order);
  const activeReportId = reports.some((r) => r.id === value.activeReportId) ? value.activeReportId : (reports[0]?.id || '');
  return { activeReportId, reports };
}

function validateAcademicsData(value) {
  requirePlainObject(value, '学业数据');
  if (!value.tracks || typeof value.tracks !== 'object') throw new InvalidDataError('学业数据缺少 tracks');
  if (!Array.isArray(value.semesters)) throw new InvalidDataError('学业数据 semesters 必须是数组');
  if (!Array.isArray(value.courses)) throw new InvalidDataError('学业数据 courses 必须是数组');
  const seenIds = new Set();
  const validStatus = new Set(['completed', 'active', 'planned']);
  const validTrack = new Set(['orig', 'clin']);
  const courses = value.courses.map((c, idx) => {
    if (!c || typeof c !== 'object') throw new InvalidDataError(`课程第 ${idx + 1} 项不是对象`);
    const id = String(c.id || '').trim();
    const name = String(c.name || '').trim();
    if (!id || !name) throw new InvalidDataError(`课程第 ${idx + 1} 项缺少 id 或名称`);
    if (seenIds.has(id)) throw new InvalidDataError(`课程 id「${id}」重复`);
    seenIds.add(id);
    const credits = Number(c.credits);
    const gpaRaw = c.gpa === '' || c.gpa === null || c.gpa === undefined ? null : Number(c.gpa);
    return {
      ...c,
      id,
      code: String(c.code || '').trim(),
      name,
      en: String(c.en || '').trim() || undefined,
      credits: Number.isFinite(credits) && credits >= 0 ? credits : 0,
      dept: String(c.dept || '').trim(),
      nature: String(c.nature || '').trim(),
      semesterId: String(c.semesterId || '').trim(),
      track: validTrack.has(c.track) ? c.track : 'clin',
      status: validStatus.has(c.status) ? c.status : 'planned',
      early: Boolean(c.early),
      earlyNote: String(c.earlyNote || '').trim() || undefined,
      recognizedNote: String(c.recognizedNote || '').trim() || undefined,
      grade: String(c.grade || '').trim(),
      gpa: gpaRaw !== null && Number.isFinite(gpaRaw) ? Number(gpaRaw.toFixed(2)) : null,
      note: String(c.note || '').trim(),
      posts: Array.isArray(c.posts) ? [...new Set(c.posts.map((s) => String(s || '').trim()).filter(Boolean))] : [],
      linkedIds: Array.isArray(c.linkedIds) ? [...new Set(c.linkedIds.map((s) => String(s || '').trim()).filter(Boolean))] : [],
    };
  });
  return {
    ...value,
    courses,
  };
}

function validateExamsData(value) {
  requirePlainObject(value, '考试日程数据');
  if (!Array.isArray(value.exams)) throw new InvalidDataError('考试日程 exams 必须是数组');
  const exams = value.exams.map((e, idx) => {
    if (!e || typeof e !== 'object') throw new InvalidDataError(`考试第 ${idx + 1} 项不是对象`);
    const course = String(e.course || '').trim();
    const date = String(e.date || '').trim();
    const start = String(e.start || '').trim();
    const end = String(e.end || '').trim();
    if (!course) throw new InvalidDataError(`考试第 ${idx + 1} 项缺少课程名`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InvalidDataError(`考试「${course}」日期须为 YYYY-MM-DD`);
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new InvalidDataError(`考试「${course}」时间须为 HH:MM`);
    const tag = String(e.tag || '').trim();
    return {
      year: String(e.year || value.year || '').trim(),
      term: Number.isFinite(Number(e.term)) ? Number(e.term) : (Number(value.term) || 1),
      course,
      date,
      start,
      end,
      room: String(e.room || '待公布').trim(),
      campus: String(e.campus || value.campus || '滨海校区').trim(),
      college: String(e.college || '').trim(),
      dept: String(e.dept || '').trim(),
      ...(tag ? { tag } : {}),
    };
  }).sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  return {
    year: String(value.year || '').trim(),
    term: Number.isFinite(Number(value.term)) ? Number(value.term) : 1,
    termLabel: String(value.termLabel || '').trim(),
    campus: String(value.campus || '滨海校区').trim(),
    sourceLabel: String(value.sourceLabel || '').trim(),
    exams,
  };
}

const galleryStore = createJsonStore({ filePath: GALLERY_JSON, label: 'gallery', readDefault: () => [], validate: validateGalleryData, backupDir: BACKUP_DIR });
const dailyStore = createJsonStore({ filePath: DAILY_JSON, label: 'daily', readDefault: () => [], validate: validateDailyData, backupDir: BACKUP_DIR });
const aboutStore = createJsonStore({ filePath: ABOUT_JSON, label: 'about', readDefault: () => ({}), validate: (value) => requirePlainObject(value, '关于页数据'), backupDir: BACKUP_DIR });
const frontendStore = createJsonStore({ filePath: FRONTEND_JSON, label: 'frontend', readDefault: () => ({}), validate: (value) => requirePlainObject(value, '前端定制数据'), backupDir: BACKUP_DIR });
const scheduleStore = createJsonStore({ filePath: SCHEDULE_JSON, label: 'schedule', readDefault: () => ({ ...SCHEDULE_DEFAULT }), validate: validateScheduleData, backupDir: BACKUP_DIR });
const privateAccessStore = createJsonStore({ filePath: PRIVATE_ACCESS_FILE, label: 'private-access', readDefault: () => ({}), validate: validatePrivateAccessData, backupDir: BACKUP_DIR });
const categoriesStore = createJsonStore({ filePath: CATEGORIES_JSON, label: 'categories', readDefault: () => [], validate: validateCategoriesData, backupDir: BACKUP_DIR });
const projectsStore = createJsonStore({ filePath: PROJECTS_JSON, label: 'projects', readDefault: () => [], validate: validateProjectsData, backupDir: BACKUP_DIR });
const reportStore = createJsonStore({ filePath: REPORT_JSON, label: 'report', readDefault: () => ({ activeReportId: '', reports: [] }), validate: validateReportData, backupDir: BACKUP_DIR });
const academicsStore = createJsonStore({ filePath: ACADEMICS_JSON, label: 'academics', readDefault: () => ({ meta: {}, tracks: { orig: {}, clin: {} }, transfer: { posts: [] }, tools: [], semesters: [], courses: [] }), validate: validateAcademicsData, backupDir: BACKUP_DIR });
const examsStore = createJsonStore({ filePath: EXAMS_JSON, label: 'exams', readDefault: () => ({ year: '', term: 1, termLabel: '', campus: '滨海校区', sourceLabel: '', exams: [] }), validate: validateExamsData, backupDir: BACKUP_DIR });

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
// ADMIN_REPO_ROOT：桌面版打包后代码在 app.asar 内，git 操作仍需指向真实仓库
const REPO_ROOT = process.env.ADMIN_REPO_ROOT ? resolve(process.env.ADMIN_REPO_ROOT) : __dirname;
const blogGit = createGitService({ cwd: REPO_ROOT });
// 图片仓库（上传时提交并推送；批量上传大文件夹时适当放宽超时）
const imageGit = createGitService({ cwd: IMG_REPO_DIR, timeout: 600_000 });
// 串行化博客仓库的写类 Git 操作（拉取 / 推送 / 启动自动同步），防止并发产生 index.lock 冲突
let blogGitLock = Promise.resolve();
function withBlogGitLock(operation) {
  const next = blogGitLock.then(operation, operation);
  blogGitLock = next.catch(() => {});
  return next;
}
// 隔离测试目录（ADMIN_DATA_DIR / ADMIN_BLOG_DIR）默认关闭启动自动拉取，避免烟测触网；
// 正常使用默认开启安全自动拉取，显式设置 ADMIN_AUTO_PULL=0 可关闭。
const IS_ISOLATED_DATA_MODE = Boolean(process.env.ADMIN_DATA_DIR || process.env.ADMIN_BLOG_DIR);
function isAutoPullEnabled() {
  if (process.env.ADMIN_AUTO_PULL === '0') return false;
  if (process.env.ADMIN_AUTO_PULL === '1') return true;
  return !IS_ISOLATED_DATA_MODE;
}
// 内容推送范围：文章 / 日常 / 画廊 / 关于 / 前端定制 / 日程 / 分类 / 造物 / 报告 / 学业 / 考试数据
const CONTENT_PUSH_PATHS = [
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
// 全量推送范围：除 reasonix.toml（本机配置，不提交）外的全部改动
const FULL_PUSH_PATHS = ['.', ':(exclude)reasonix.toml'];

/** Git 命令异常 → HTTP 可用的错误对象（保留友好文案并附带 detail / conflicts） */
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
    autoPull: isAutoPullEnabled(),
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
  // 上传输入上限：放宽至 512MB，支持大图与无限制批量上传
  uploadMaxBytes: 512 * 1024 * 1024,
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
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

// ── 响应压缩辅助（仅对 >=1KB 的 JSON/文本启用 br/gzip，零额外依赖）──
const COMPRESS_MIN_BYTES = 1024;
function negotiateEncoding(req) {
  if (req.method === 'HEAD') return null;
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (ae.includes('br')) return 'br';
  if (ae.includes('gzip')) return 'gzip';
  return null;
}

function compressBufferSync(buf, enc) {
  if (enc === 'br') {
    return brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
  }
  return gzipSync(buf, { level: 6 });
}

async function compressBufferAsync(buf, enc) {
  if (enc === 'br') {
    return brotliAsync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
  }
  return gzipAsync(buf, { level: 6 });
}

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

// ── 统一错误响应 + 大体积 JSON 压缩（为所有错误补上 code 与 requestId，对 >=1KB JSON 启用 br/gzip）──
app.use('/api', (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    let payload = body;
    if (res.statusCode >= 400) {
      const source = body && typeof body === 'object' && !Array.isArray(body) ? body : { error: String(body ?? '请求失败') };
      const normalized = { ...source };
      if (!normalized.code) normalized.code = STATUS_ERROR_CODES[res.statusCode] || 'API_ERROR';
      if (!normalized.error) normalized.error = normalized.message || '请求失败';
      if (!normalized.requestId) normalized.requestId = req.requestId;
      payload = normalized;
    }
    const enc = res.statusCode < 400 ? negotiateEncoding(req) : null;
    if (enc && !res.getHeader('Content-Encoding')) {
      try {
        const text = JSON.stringify(payload);
        if (text && Buffer.byteLength(text, 'utf8') >= COMPRESS_MIN_BYTES) {
          const compressed = compressBufferSync(Buffer.from(text, 'utf8'), enc);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Encoding', enc);
          res.vary('Accept-Encoding');
          return res.send(compressed);
        }
      } catch { /* 压缩失败自动退回普通 JSON */ }
    }
    return originalJson(payload);
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

/** 改名（更换 Slug）时将旧 slug 的修订历史目录迁移到新 slug */
async function migratePostRevisions(oldSlug, newSlug) {
  const safeOld = basename(oldSlug);
  const safeNew = basename(newSlug);
  if (!safeOld || safeOld !== oldSlug || !safeNew || safeNew !== newSlug || safeOld === safeNew) return;
  const oldDir = join(REVISIONS_DIR, safeOld);
  const newDir = join(REVISIONS_DIR, safeNew);
  try {
    await fileAccess(oldDir);
  } catch {
    return;
  }
  try {
    if (oldDir.toLowerCase() === newDir.toLowerCase()) {
      // 大小写不敏感文件系统上同目录改名（例如 Win/macOS 仅改大小写）：重命名目录即可
      if (oldDir !== newDir) {
        const tmpDir = `${newDir}.__tmp_${Date.now()}`;
        await rename(oldDir, tmpDir);
        await rename(tmpDir, newDir);
      }
      return;
    }
    await mkdir(newDir, { recursive: true });
    const files = (await readdir(oldDir).catch(() => [])).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      await rename(join(oldDir, f), join(newDir, f)).catch(() => {});
    }
    await rm(oldDir, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    logEvent('error', 'migrate_revisions_failed', { oldSlug, newSlug, detail: err.message });
  }
}

/** 列出文章的修订快照（新→旧） */
async function listPostRevisions(slug) {
  const safe = basename(slug);
  if (!safe || safe !== slug) return [];
  const dir = join(REVISIONS_DIR, safe);
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
  if (!files.length) return [];
  const entries = await mapWithConcurrency(files, 16, async (name) => {
    const st = await statFile(join(dir, name)).catch(() => null);
    if (!st) return null;
    return { id: name, savedAt: st.mtime.toISOString(), size: st.size };
  });
  return entries.filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
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

// ── 文章列表缓存 ──
// readPosts() 原先每次调用都要 readdir + 全量 readFile + gray-matter 解析 + sha256 + 摘要正则清洗，
// 面板每次刷新（文章列表 / 媒体库引用扫描）都重复付出这份 O(文章数) 的磁盘 IO。
// 这里按「文件名 → 该文件的解析结果 + mtimeMs/size」做缓存：
//   · readdir 结果作为候选集合，新增/删除/改名文件自然进出；
//   · 每个在列文件用 stat 的 mtimeMs + size 校验，不一致才重新读盘解析；
//   · 任何写入路径（新建/保存/删除/拉取/定时发布）都会改变 mtime 或 size，因此缓存必定失效。
// 返回数组与其元素均为副本（tags 也复制），避免调用方排序或改动影响缓存内容。
const postFileCache = new Map(); // 文件名 → { mtimeMs, size, post }
let postListEpoch = 0;            // 显式失效计数：写路径主动 +1，使 stat 校验之外也能兜底失效
let postListSnapshot = null;      // { epoch, dirMtimeMs, posts }
let readPostsInFlight = null;     // { epoch, promise } 合并并发请求

/** 显式失效文章列表缓存（写入 / 拉取等改变文章集合的操作后调用，立即生效）*/
function invalidatePostCache() {
  postListEpoch += 1;
  postListSnapshot = null;
  readPostsInFlight = null;
}

function normalizeStrList(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，]/)
      : [];
  return [...new Set(arr.map((s) => String(s ?? '').trim()).filter(Boolean))];
}

/** 把「已读到的原始 markdown」装成列表项（保持原有字段与顺序）*/
function buildPostEntry(slug, raw, data, content, updatedAt) {
  return {
    slug,
    contentHash: sha256(raw),
    title: data.title || slug,
    description: data.description || '',
    cover: data.cover || '',
    pubDate: safeDate(data.pubDate),
    updatedDate: safeDate(data.updatedDate) || undefined,
    tags: data.tags || [],
    categories: normalizeStrList(data.categories),
    draft: data.draft ?? false,
    access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
    archived: data.archived ?? false,
    scheduledAt: safeIso(data.scheduledAt),
    dayIndex: data.dayIndex || undefined,
    updatedAt,
    excerpt: excerptOf(content),
    astroId: astroIdFor(slug, data),
  };
}

/** 返回缓存条目的副本（含 tags/categories 数组），保证缓存不被外部改动污染 */
function clonePostEntry(post) {
  return {
    ...post,
    tags: Array.isArray(post.tags) ? post.tags.slice() : post.tags,
    categories: Array.isArray(post.categories) ? post.categories.slice() : [],
  };
}

async function readPostsUncached(epoch) {
  const files = await readdir(BLOG_DIR);
  const candidates = files.filter((file) => file.endsWith('.md') || file.endsWith('.mdx'));
  const reusable = postListSnapshot && postListSnapshot.epoch === epoch ? postListSnapshot.posts : null;

  // 并发 stat 全部候选文件：既加速热路径校验，又让冷路径先比对 mtime/size 再决定是否读盘解析
  const stats = await mapWithConcurrency(candidates, 16, async (file) => {
    const filePath = join(BLOG_DIR, file);
    const st = await statFile(filePath).catch(() => null);
    return { file, filePath, st };
  });

  if (reusable && candidates.length === reusable.length) {
    let allFresh = true;
    for (let i = 0; i < stats.length; i += 1) {
      const { file, st } = stats[i];
      const prev = reusable[i];
      if (!st || file !== prev.name || st.mtimeMs !== prev.mtimeMs || st.size !== prev.size) {
        allFresh = false;
        break;
      }
    }
    if (allFresh) return reusable;
  }

  // 增量解析：仅对 mtimeMs 或 size 变化的文件执行 readFile + gray-matter + sha256
  const nextEntries = await mapWithConcurrency(stats, 16, async ({ file, filePath, st }) => {
    const mtimeMs = st ? st.mtimeMs : 0;
    const size = st ? st.size : -1;
    const cached = postFileCache.get(file);
    if (cached && mtimeMs !== 0 && cached.mtimeMs === mtimeMs && cached.size === size) {
      return { name: file, mtimeMs, size, post: cached.post };
    }
    const raw = await readFile(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const slug = file.replace(/\.(md|mdx)$/, '');
    const updatedAt = st ? st.mtime.toISOString() : '';
    const finalSize = st ? st.size : Buffer.byteLength(raw, 'utf8');
    const post = buildPostEntry(slug, raw, data, content, updatedAt);
    postFileCache.set(file, { mtimeMs, size: finalSize, post });
    return { name: file, mtimeMs, size: finalSize, post };
  });

  // 清掉已不在目录中的文件条目，避免缓存随删除操作无限增长
  const currentNames = new Set(candidates);
  for (const name of postFileCache.keys()) {
    if (!currentNames.has(name)) postFileCache.delete(name);
  }
  if (postListEpoch === epoch) {
    postListSnapshot = { epoch, posts: nextEntries };
  }
  return nextEntries;
}

async function readPosts() {
  const epoch = postListEpoch;
  if (readPostsInFlight && readPostsInFlight.epoch === epoch) {
    const entries = await readPostsInFlight.promise;
    return entries.map((entry) => clonePostEntry(entry.post));
  }
  const promise = readPostsUncached(epoch).finally(() => {
    if (readPostsInFlight?.promise === promise) readPostsInFlight = null;
  });
  readPostsInFlight = { epoch, promise };
  const entries = await promise;
  return entries.map((entry) => clonePostEntry(entry.post));
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

// ── Multer: 统一媒体上传（图片 / 音频 / 视频 / 常见文档附件） ──
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/heic', 'image/heif', 'image/tiff'];
const AUDIO_MIME = ['audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a'];
const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
const FILE_MIME = [
  'application/pdf', 'application/zip', 'application/x-zip-compressed',
  'text/markdown', 'text/csv', 'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const ALLOWED_MIME = [...IMAGE_MIME, ...AUDIO_MIME, ...VIDEO_MIME, ...FILE_MIME];
// URL 导入支持的图片扩展名（与 MIME 校验互补；CDN/图床对 HEIC 等常返回 application/octet-stream）
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.avif', '.svg', '.heic', '.heif', '.tiff', '.tif'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.ogv'];
const FILE_EXTS = ['.pdf', '.zip', '.md', '.csv', '.json', '.docx', '.xlsx', '.pptx'];
const JSDELIVR_FILE_WARN_BYTES = 20 * 1024 * 1024;

function detectUploadKind(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = extname(file?.originalname || '').toLowerCase();
  if (mime.startsWith('audio/') || MEDIA_AUDIO_EXTS.includes(ext)) return 'audio';
  if (mime.startsWith('video/') || VIDEO_EXTS.includes(ext)) return 'video';
  if (FILE_MIME.includes(mime) || FILE_EXTS.includes(ext)) return 'file';
  return 'image';
}

let lastUploadTs = 0;
let uploadSeq = 0;
function nextUploadStamp() {
  const now = Date.now();
  if (now === lastUploadTs) {
    uploadSeq += 1;
    return `${now}-${uploadSeq}`;
  }
  lastUploadTs = now;
  uploadSeq = 0;
  return String(now);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      const kind = detectUploadKind(file);
      const dir = kind === 'audio' ? AUDIO_DIR : kind === 'video' ? VIDEO_DIR : kind === 'file' ? FILE_DIR : IMAGE_DIR;
      try {
        mkdir(dir, { recursive: true }).then(() => cb(null, dir), err => cb(err));
      } catch (err) { cb(err); }
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
        .substring(0, 60) || 'asset';
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${safeName}_${nextUploadStamp()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    const genericOk = (file.mimetype === 'application/octet-stream' || file.mimetype === '')
      && ['.heic', '.heif', '.avif', '.tiff', '.tif', ...VIDEO_EXTS, ...FILE_EXTS].includes(ext);
    if (ALLOWED_MIME.includes(file.mimetype) || genericOk) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片 / 音频 / MP4·WebM 视频 / PDF·Office·ZIP·TXT 等常见附件'), false);
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

const MANAGED_POST_KEYS = new Set([
  'title', 'description', 'pubDate', 'dayIndex', 'cover',
  'tags', 'categories', 'draft', 'access', 'archived', 'scheduledAt', 'updatedDate',
]);

function serializeExtraFrontmatterField(key, value) {
  if (value === undefined || value === null) return [];
  if (value instanceof Date) {
    const d = safeDate(value);
    return d ? [`${key}: ${yamlStr(d)}`] : [];
  }
  if (Array.isArray(value)) {
    if (!value.length) return [`${key}: []`];
    return [`${key}:`, ...value.map((item) => `  - ${yamlStr(item)}`)];
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return [`${key}: ${value}`];
  }
  if (typeof value === 'object') {
    return [`${key}: ${JSON.stringify(value)}`];
  }
  return [`${key}: ${yamlStr(value)}`];
}

function buildPostMarkdown(body, allPosts, { excludeSlug = '', existingData = null } = {}) {
  const title = body.title || '';
  const description = body.description || '';
  const cover = body.cover || '';
  const pubDate = body.pubDate || new Date().toISOString().split('T')[0];
  const tags = String(body.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
  const categories = body.categories !== undefined
    ? normalizeStrList(body.categories)
    : normalizeStrList(existingData?.categories);
  const relevantPosts = excludeSlug ? allPosts.filter(p => p.slug !== excludeSlug) : allPosts;
  const dayIndex = parseDayIndex(body.dayIndex);
  const fm = [
    '---',
    `title: ${yamlStr(title)}`,
    `description: ${yamlStr(description)}`,
    `pubDate: ${yamlStr(pubDate)}`,
    `dayIndex: ${dayIndex ?? nextDayIndex(relevantPosts, pubDate)}`,
  ];
  const updatedDate = body.updatedDate !== undefined
    ? safeDate(body.updatedDate)
    : safeDate(existingData?.updatedDate);
  if (updatedDate) fm.push(`updatedDate: ${yamlStr(updatedDate)}`);
  if (cover.trim()) fm.push(`cover: ${yamlStr(cover.trim())}`);
  if (tags.length) {
    fm.push('tags:');
    tags.forEach(tag => fm.push(`  - ${yamlStr(tag)}`));
  }
  if (categories.length) {
    fm.push('categories:');
    categories.forEach(cat => fm.push(`  - ${yamlStr(cat)}`));
  }
  fm.push(`draft: ${body.draft === 'true'}`);
  fm.push(`access: ${['public', 'authorized', 'admin'].includes(body.access) ? body.access : 'public'}`);
  if (body.archived === 'true') fm.push('archived: true');
  const scheduledAt = safeIso(body.scheduledAt);
  if (scheduledAt) fm.push(`scheduledAt: ${yamlStr(scheduledAt)}`);
  if (existingData && typeof existingData === 'object') {
    for (const [key, value] of Object.entries(existingData)) {
      if (MANAGED_POST_KEYS.has(key)) continue;
      if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
      fm.push(...serializeExtraFrontmatterField(key, value));
    }
  }
  fm.push('---', '', body.content || '');
  return fm.join('\n');
}

// ── AI 额度查询代理：公开只读接口 ──
// 必须注册在 app.use('/api', auth) 之前才有匿名访问权限；契约见 docs/ai-quota-contract.md。
// 恒 200 + Cache-Control: no-store；服务端持钥访问上游，密钥不出服务端。本地同源，不开 CORS。
const aiQuotaService = createQuotaService({ env: process.env });
app.get('/api/ai-quota', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/json');
  try {
    const payload = await aiQuotaService.readAll({ force: req.query.force === '1' });
    res.json(payload);
  } catch (err) {
    console.error('AI quota proxy error:', err && err.message ? err.message : err);
    res.json({
      ok: false,
      generatedAt: new Date().toISOString(),
      cacheSeconds: 30,
      providers: [],
      error: '额度查询服务异常',
    });
  }
});

// ── 本地跨访客互动接口（模拟 Cloudflare Worker + KV 契约，供本地预览与测试使用）──
let interactWriteQueue = Promise.resolve();
function withInteractLock(op) {
  const next = interactWriteQueue.then(op, op);
  interactWriteQueue = next.catch(() => {});
  return next;
}

async function readInteractLocal() {
  try {
    const raw = await readFile(INTERACT_LOCAL_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      likes: parsed?.likes && typeof parsed.likes === 'object' ? parsed.likes : {},
      comments: parsed?.comments && typeof parsed.comments === 'object' ? parsed.comments : {},
    };
  } catch {
    return { likes: {}, comments: {} };
  }
}

async function writeInteractLocal(data) {
  await atomicWriteFile(INTERACT_LOCAL_JSON, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeInteractTarget(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 240 || !s.startsWith('/')) return '';
  return s.replace(/[\r\n\t]/g, '');
}

app.get('/api/interact/health', (_req, res) => {
  res.json({ ok: true, mode: 'local' });
});

app.get('/api/interact/daily', async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{1,80}$/.test(s))
    .slice(0, 200);
  const store = await readInteractLocal();
  const counts = {};
  for (const id of ids) {
    const n = Number(store.likes[id] || 0);
    if (n > 0) counts[id] = n;
  }
  res.json({ ok: true, counts });
});

app.post('/api/interact/daily/:id/like', express.json(), async (req, res) => withInteractLock(async () => {
  const id = String(req.params.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.status(400).json({ ok: false, error: '无效的日常 ID' });
  const action = req.body?.action === 'unlike' ? 'unlike' : 'like';
  const store = await readInteractLocal();
  const cur = Math.max(0, Number(store.likes[id] || 0));
  const next = action === 'unlike' ? Math.max(0, cur - 1) : cur + 1;
  if (next > 0) store.likes[id] = next;
  else delete store.likes[id];
  await writeInteractLocal(store);
  res.json({ ok: true, id, count: next });
}));

app.get('/api/interact/comments', async (req, res) => {
  const target = normalizeInteractTarget(req.query.target);
  if (!target) return res.status(400).json({ ok: false, error: '缺少有效 target' });
  const store = await readInteractLocal();
  const comments = Array.isArray(store.comments[target]) ? store.comments[target] : [];
  res.json({ ok: true, target, comments });
});

app.post('/api/interact/comments', express.json(), async (req, res) => withInteractLock(async () => {
  if (String(req.body?.website || '').trim()) return res.json({ ok: true, comment: null });
  const target = normalizeInteractTarget(req.body?.target);
  const text = String(req.body?.body || '').replace(/\r\n?/g, '\n').trim();
  const nick = String(req.body?.nick || req.body?.author || '').trim().slice(0, 30) || '匿名观测者';
  if (!target) return res.status(400).json({ ok: false, error: '目标路径无效' });
  if (!text) return res.status(400).json({ ok: false, error: '留言内容不能为空' });
  if (text.length > 300) return res.status(400).json({ ok: false, error: '留言不能超过 300 字' });

  const store = await readInteractLocal();
  const existing = Array.isArray(store.comments[target]) ? store.comments[target] : [];
  const comment = {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    nick,
    body: text,
    createdAt: new Date().toISOString(),
  };
  store.comments[target] = [comment, ...existing].slice(0, 120);
  await writeInteractLocal(store);
  res.status(201).json({ ok: true, target, comment, total: store.comments[target].length });
}));

app.delete('/api/interact/comments', auth, async (req, res) => withInteractLock(async () => {
  const target = normalizeInteractTarget(req.query.target);
  const id = String(req.query.id || '').trim();
  if (!target || !id) return res.status(400).json({ ok: false, error: '缺少 target 或 id' });
  const store = await readInteractLocal();
  const existing = Array.isArray(store.comments[target]) ? store.comments[target] : [];
  store.comments[target] = existing.filter((c) => c.id !== id);
  await writeInteractLocal(store);
  res.json({ ok: true, target, remaining: store.comments[target].length });
}));

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
      invalidatePostCache(); // 新建后立即失效，下一次列表读取必定重扫
      await atomicWriteFile(checked.filePath, markdown);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(201).json({ success: true, slug: checked.slug, contentHash: sha256(markdown) });
    } catch (err) {
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  }));

// Batch post operations (publish / unpublish / archive / unarchive / delete)
app.post('/api/posts/batch', express.json(), upload.none(), async (req, res) => withPostWriteLock(async () => {
  try {
    const action = String(req.body?.action || '').trim();
    const VALID_BATCH_ACTIONS = [
      'publish', 'unpublish', 'archive', 'unarchive', 'delete',
      'set-categories', 'add-categories', 'remove-categories',
    ];
    if (!VALID_BATCH_ACTIONS.includes(action)) {
      return res.status(400).json({ error: '无效的批量操作类型' });
    }
    const rawSlugs = Array.isArray(req.body?.slugs)
      ? req.body.slugs
      : String(req.body?.slugs || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const slugs = [...new Set(rawSlugs.map((s) => String(s || '').trim()).filter(Boolean))];
    if (!slugs.length) return res.status(400).json({ error: '请选择至少一篇文章' });

    const isCatAction = action === 'set-categories' || action === 'add-categories' || action === 'remove-categories';
    const targetCats = isCatAction ? normalizeStrList(req.body?.categories) : [];
    if ((action === 'add-categories' || action === 'remove-categories') && !targetCats.length) {
      return res.status(400).json({ error: '请选择至少一个文章分类' });
    }

    const allPosts = await readPosts();
    let okCount = 0;
    let failCount = 0;
    const errors = [];

    for (const slug of slugs) {
      const checked = validateSlug(slug);
      if (!checked) { failCount += 1; errors.push({ slug, error: '无效的 Slug' }); continue; }
      try {
        const raw = await readFile(checked.filePath, 'utf-8');
        await savePostRevision(checked.slug, raw);
        if (action === 'delete') {
          await unlink(checked.filePath);
          okCount += 1;
          continue;
        }
        const { data, content } = matter(raw);
        const currentCats = normalizeStrList(data.categories);
        let nextCats = currentCats;
        if (action === 'set-categories') nextCats = targetCats;
        else if (action === 'add-categories') nextCats = [...new Set([...currentCats, ...targetCats])];
        else if (action === 'remove-categories') nextCats = currentCats.filter((c) => !targetCats.includes(c));

        const body = {
          title: data.title || '',
          description: data.description || '',
          cover: data.cover || '',
          pubDate: safeDate(data.pubDate),
          dayIndex: data.dayIndex || '',
          tags: Array.isArray(data.tags) ? data.tags.join(',') : '',
          categories: nextCats,
          draft: String(action === 'unpublish' ? true : action === 'publish' ? false : Boolean(data.draft)),
          archived: String(action === 'archive' ? true : action === 'unarchive' ? false : Boolean(data.archived)),
          scheduledAt: action === 'publish' ? '' : safeIso(data.scheduledAt),
          access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
          content: content.trim(),
        };
        const markdown = buildPostMarkdown(body, allPosts, { excludeSlug: checked.slug, existingData: data });
        await atomicWriteFile(checked.filePath, markdown);
        okCount += 1;
      } catch (err) {
        failCount += 1;
        errors.push({ slug, error: err.message });
      }
    }
    invalidatePostCache();
    res.json({ ok: true, success: true, okCount, failCount, errors });
  } catch (err) {
    console.error('Batch API Error:', err.message);
    res.status(500).json({ error: '批量操作失败' });
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
        updatedDate: safeDate(data.updatedDate) || undefined,
        dayIndex: data.dayIndex || undefined,
        tags: data.tags || [],
        categories: normalizeStrList(data.categories),
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

      const { data: existingData } = matter(currentRaw);
      const allPosts = await readPosts();
      const markdown = buildPostMarkdown(req.body, allPosts, { excludeSlug: oldChecked.slug, existingData });

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
        await migratePostRevisions(oldChecked.slug, newChecked.slug);
        invalidatePostCache(); // 改名 / 移动同样会改变文件集合，先失效再落盘
        await atomicWriteFile(newChecked.filePath, markdown);
        await unlink(oldChecked.filePath);
      } else {
        await savePostRevision(oldChecked.slug, currentRaw);
        if (oldChecked.slug !== newChecked.slug) {
          await migratePostRevisions(oldChecked.slug, newChecked.slug);
        }
        invalidatePostCache(); // 保存后立即失效（同尺寸覆盖也能被 epoch 兜住，不依赖 mtime 精度）
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
      invalidatePostCache(); // 删除后立即失效
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
  if (['.png', '.jpg', '.jpeg', '.jfif', '.tiff', '.tif'].includes(ext)) {
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
  if (!['.png', '.jpg', '.jpeg', '.jfif', '.heic', '.heif', '.tiff', '.tif'].includes(ext)) return null;
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

// 图片仓库 Git 写操作串行锁：避免并发上传时同时触发 git add / commit / push 导致 .git/index.lock 冲突
let imageRepoWriteQueue = Promise.resolve();
function withImageRepoLock(operation) {
  const result = imageRepoWriteQueue.then(operation, operation);
  imageRepoWriteQueue = result.catch(() => {});
  return result;
}

// 推送图片仓库（有变更才推），失败时给出友好错误
async function pushImageRepo({ requestId = '' } = {}) {
  return withImageRepoLock(async () => {
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
  });
}

// 最近一次上传失败（供「上传自检」展示，重启后清空）
let lastUploadError = null;

// Image upload
app.post('/api/upload', (req, res, next) => {
  // 使用 any() 接收任意字段名的文件（兼容 Vditor 默认的 file[] 与自建的 file），取第一个作为上传文件
  upload.any()(req, res, async (err) => {
    if (err) {
      console.error('Upload Error:', err.code || '', err.message);
      lastUploadError = {
        time: new Date().toISOString(), requestId: req.requestId, stage: 'multer',
        code: err.code || 'UPLOAD_REJECTED', message: err.message,
      };
      // multer 写入阶段的错误（如超限）可能已落下半成品，尽力清理
      if (req.file?.path) await unlink(req.file.path).catch(() => {});
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          code: 'FILE_TOO_LARGE',
          error: `文件超过 ${Math.round(LIMITS.uploadMaxBytes / 1024 / 1024)}MB 上限，请先压缩图片后重试`,
        });
      }
      if (err.message && err.message.includes('仅支持')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: '上传失败', code: err.code || 'UPLOAD_REJECTED', detail: err.message });
    }
    req.file = (req.files && req.files[0]) || req.file;
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    let filesSaved = false; // 转码/归档是否已成功落库（推送失败时保留文件，不清理）
    try {
      const kind = detectUploadKind(req.file);
      let filename, origName = null, title = '', artist = '', coverUrl = '';
      if (kind === 'audio') {
        // 音频：原样保留（不做转码），落库到 audio/ 目录，并尝试解析歌名 / 歌手 / 封面
        filename = basename(req.file.path);
        const meta = await extractAudioMeta(req.file.path);
        title = meta.title;
        artist = meta.artist;
        coverUrl = meta.coverUrl;
      } else if (kind === 'video' || kind === 'file') {
        // 视频与文档附件：原样保留，分别落库到 video/ 与 file/ 目录
        filename = basename(req.file.path);
      } else {
        origName = await archiveOriginal(req.file.path, basename(req.file.path));
        filename = await saveImageFile(req.file.path);
      }
      filesSaved = true;
      invalidateMediaCache();
      const deferPush = req.query.deferPush === '1' || req.query.deferPush === 'true' || req.body?.deferPush === '1';
      const push = deferPush ? { pushed: false } : await pushImageRepo({ requestId: req.requestId });
      lastUploadError = null;
      const base = kind === 'audio' ? AUDIO_BASE_URL : kind === 'video' ? VIDEO_BASE_URL : kind === 'file' ? FILE_BASE_URL : IMG_BASE_URL;
      const publicUrl = `${base}${encodeURIComponent(filename)}`;
      if (!deferPush) {
        // 上传成功后预热 jsDelivr 缓存（只等 2.5s 就返回，剩余在后台继续预热，上传更快、竞态窗口更小）
        await warmJsDelivr(publicUrl, 2500);
      }
      const size = req.file.size || 0;
      res.status(201).json({
        success: true,
        url: publicUrl,
        originalUrl: origName ? `${IMG_BASE_URL}original/${encodeURIComponent(origName)}` : '',
        pushed: Boolean(push.pushed),
        deferredPush: deferPush,
        type: kind,
        name: filename,
        originalName: req.file.originalname || filename,
        ext: extname(filename).toLowerCase(),
        size,
        jsDelivrWarn: (kind === 'video' || kind === 'file' || kind === 'audio') && size > JSDELIVR_FILE_WARN_BYTES,
        title,
        artist,
        coverUrl,
      });
    } catch (e) {
      console.error('Upload Error:', e.message);
      lastUploadError = {
        time: new Date().toISOString(), requestId: req.requestId, stage: 'process',
        code: e.code || 'UPLOAD_FAILED', message: e.message, detail: e.detail || '',
      };
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

function warmUploadedUrlsAsync(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  const targets = [...new Set(urls.map((u) => String(u || '').trim()))]
    .filter((u) => u.startsWith(IMG_BASE_URL) || u.startsWith(AUDIO_BASE_URL) || u.startsWith(VIDEO_BASE_URL) || u.startsWith(FILE_BASE_URL))
    .slice(0, 300);
  if (!targets.length) return;
  // 后台限流预热，不阻塞请求返回
  mapWithConcurrency(targets, 4, (u) => warmJsDelivr(u, 0)).catch(() => {});
}

// 批量延迟推送图片仓库（配合 /api/upload?deferPush=1 使用）
app.post('/api/upload/push', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const push = await pushImageRepo({ requestId: req.requestId });
    warmUploadedUrlsAsync(req.body?.urls);
    res.json({
      ok: true,
      success: true,
      pushed: Boolean(push.pushed),
      preview: push.preview,
      requestId: req.requestId,
    });
  } catch (err) {
    console.error('Upload Push Error:', err.message);
    respondSyncError(res, req, err, 'UPLOAD_PUSH_FAILED');
  }
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
    if (!IMAGE_MIME.includes(contentType)) {
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
    invalidateMediaCache();
    const push = await pushImageRepo();

    const publicUrl = `${IMG_BASE_URL}${encodeURIComponent(savedName)}`;
    // 预热 jsDelivr 缓存（只等 2.5s），让导入成功后管理面板预览尽快可见
    await warmJsDelivr(publicUrl, 2500);

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

// 链接元信息抓取（书签卡片插入用：SSRF 校验 + 仅抓前 256KB HTML 解析 title / description）
app.get('/api/link-meta', async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).json({ error: '缺少 url 参数' });
    let parsed;
    try {
      parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad proto');
    } catch {
      return res.status(400).json({ error: '仅支持 http/https 链接' });
    }
    const remote = await fetchPublic(parsed.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AcretiondiskBlog/1.0)', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!remote.ok) return res.json({ ok: false, url: parsed.href, title: parsed.hostname, description: '' });
    const ct = (remote.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('xhtml')) {
      return res.json({ ok: true, url: remote.url || parsed.href, title: parsed.hostname, description: '' });
    }
    const buf = await readLimitedBuffer(remote, 256 * 1024);
    const html = buf.toString('utf8');
    const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    const ogTitle = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title)["']/i)?.[1];
    const docTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const ogDesc = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i)?.[1];
    res.json({
      ok: true,
      url: remote.url || parsed.href,
      title: decode(ogTitle || docTitle || parsed.hostname).slice(0, 140),
      description: decode(ogDesc || '').slice(0, 260),
    });
  } catch {
    res.json({ ok: false, url: String(req.query.url || '').trim(), title: '', description: '' });
  }
});

// Git push（内容推送：仅文章/图片/画廊数据；全量推送：全部改动含代码，排除 reasonix.toml）
// 默认开启推前自动同步（拉取 + 变基 + daily/gallery 语义合并），避免多设备编辑推送被拒卡死
async function pushGitChanges({ paths, commitMsg, requestId = '' }) {
  return withBlogGitLock(async () => {
    const startedAt = Date.now();
    try {
      const result = await blogGit.commitAndPush({ paths, message: commitMsg, autoSync: true });
      if (result.syncedRemote) invalidatePostCache();
      recordOperation({
        requestId,
        action: commitMsg.includes('全量') ? 'push-full' : 'push-content',
        status: result.pushed ? 'success' : 'skipped',
        message: result.message,
        durationMs: Date.now() - startedAt,
        meta: {
          fileCount: result.preview?.fileCount || 0,
          syncedBehind: result.syncedBehind || 0,
          autoMergedFiles: result.autoMergedFiles || [],
        },
      });
      return {
        success: true,
        message: result.message,
        detail: result.detail,
        preview: result.preview,
        syncedRemote: Boolean(result.syncedRemote),
        syncedBehind: result.syncedBehind || 0,
        rebased: Boolean(result.rebased),
        autoMergedFiles: result.autoMergedFiles || [],
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
        meta: {
          fileCount: httpErr.preview?.fileCount || 0,
          conflicts: httpErr.conflicts || [],
        },
      });
      throw httpErr;
    }
  });
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

/** 统一的发布中心错误响应（含错误码、详情、冲突文件清单与 requestId） */
function respondSyncError(res, req, err, fallbackCode) {
  const httpErr = toHttpError(err);
  res.status(httpErr.status || 500).json({
    ok: false,
    success: false,
    code: httpErr.errorCode || fallbackCode,
    error: httpErr.message,
    detail: httpErr.detail,
    ...(Array.isArray(httpErr.conflicts) && httpErr.conflicts.length ? { conflicts: httpErr.conflicts } : {}),
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

// ── Git sync（智能拉取远端内容）──
// 安全同步策略：自动暂存本地未提交改动（含未跟踪文件）→ 快进或变基整合远端提交
// （对 daily.json / gallery.json 自动按 id 三方语义合并）→ 还原本地工作区；
// 若遇无法自动解决的真实文件冲突，则原子回滚保持原状并列出冲突文件，绝不覆盖本地改动。
// 返回 { status: 'up-to-date' | 'pulled' | 'skipped' | 'conflict', message, ahead, behind, ... }
async function syncFromRemote({ requestId = '' } = {}) {
  return withBlogGitLock(async () => {
    const startedAt = Date.now();
    // 拉取可能改写/新增文章文件，先失效文章列表缓存，避免面板读到旧快照
    invalidatePostCache();
    try {
      const result = await blogGit.pullSmart();
      if (result.status === 'pulled') invalidatePostCache();
      recordOperation({
        requestId,
        action: 'pull',
        status: result.status === 'pulled' ? 'success' : (result.status === 'conflict' ? 'error' : 'skipped'),
        message: result.message,
        detail: result.detail || '',
        durationMs: Date.now() - startedAt,
        meta: {
          ahead: result.ahead,
          behind: result.behind,
          reason: result.reason,
          stashed: Boolean(result.stashed),
          rebased: Boolean(result.rebased),
          autoMergedFiles: result.autoMergedFiles || [],
          conflicts: result.conflicts || [],
        },
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
  });
}

// 手动拉取远端内容（管理面板按钮触发）
app.post('/api/pull', async (req, res) => {
  try {
    const result = await syncFromRemote({ requestId: req.requestId });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (result.status === 'conflict') {
      return res.status(409).json({
        ok: false,
        success: false,
        code: 'SYNC_CONFLICT',
        error: result.message,
        detail: result.detail || '',
        requestId: req.requestId,
        ...result,
      });
    }
    res.json({ ok: true, success: true, requestId: req.requestId, ...result });
  } catch (err) {
    console.error('Pull Error:', err.message);
    respondSyncError(res, req, err, 'PULL_FAILED');
  }
});

// 启动时检查同步状态；正常模式下默认执行一次后台安全智能拉取（不阻塞面板启动，ADMIN_AUTO_PULL=0 可关闭）
async function autoSyncOnStart() {
  const autoPull = isAutoPullEnabled();
  try {
    const info = await blogGit.status();
    const state = deriveSyncState(info);
    console.log(`   [同步检查] ${SYNC_STATE_LABELS[state] || state}（分支 ${info.branch || '未知'}，未提交 ${info.dirtyCount}，领先 ${info.ahead}，落后 ${info.behind}）`);
    if (autoPull) {
      const result = await withBlogGitLock(() => blogGit.pullSmart());
      if (result.status === 'pulled') invalidatePostCache(); // 启动时自动拉取到新内容，丢弃可能存在的旧缓存
      recordOperation({
        action: 'auto-pull',
        status: result.status === 'pulled' ? 'success' : (result.status === 'conflict' ? 'error' : 'skipped'),
        message: result.message,
        meta: {
          autoMergedFiles: result.autoMergedFiles || [],
          conflicts: result.conflicts || [],
        },
      });
      console.log(`   [自动拉取] ${result.message}`);
    } else {
      console.log('   [同步检查] 已跳过自动拉取（ADMIN_AUTO_PULL=0 或隔离测试模式）；可在「发布中心」手动拉取');
    }
  } catch (err) {
    console.log(`   [同步检查] 无法完成启动同步：${err.message}`);
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

function fallbackGalleryTitle(src, rawTitle) {
  const t = String(rawTitle || '').trim();
  if (t) return t;
  const name = fileNameFromUrl(src)
    .replace(/\.[^.]+$/, '')
    .replace(/_\d{10,}(?:-\d+)?$/, '');
  return name || '未命名图像';
}

function createGalleryId(items) {
  const used = new Set((items || []).map((i) => i.id));
  let id;
  do {
    id = `独立-${Date.now()}-${randomBytes(2).toString('hex')}`;
  } while (used.has(id));
  return id;
}

function buildGalleryItem(raw, existingItems) {
  const src = String(raw?.src || '').trim();
  if (!src) return { error: 'src 为必填字段' };
  const sourceLink = raw?.sourceUrl == null ? '' : safeLink(raw.sourceUrl);
  if (sourceLink === null) return { error: 'Invalid source URL' };
  const finalDate = safeDate(raw?.date, (new Date()).toISOString().split('T')[0]);
  const di = parseDayIndex(raw?.dayIndex);
  const item = {
    id: createGalleryId(existingItems),
    src,
    alt: String(raw?.alt || '').trim(),
    title: fallbackGalleryTitle(src, raw?.title),
    caption: String(raw?.caption || '').trim(),
    date: finalDate,
    dayIndex: di ?? nextGalleryDayIndex(existingItems, finalDate),
  };
  if (sourceLink) item.sourceUrl = sourceLink;
  if (raw?.sourceTitle && String(raw.sourceTitle).trim()) item.sourceTitle = String(raw.sourceTitle).trim();
  if (raw?.original && String(raw.original).trim()) item.original = String(raw.original).trim();
  return { item };
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
      const items = await readGallery();
      const built = buildGalleryItem(req.body, items);
      if (built.error) return res.status(400).json({ error: built.error });
      items.unshift(built.item);
      const written = await writeGallery(items, { expectedHash: hashCheck.hash });
      res.status(201).json({ success: true, item: built.item, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Gallery API');
    }
  });

// Batch create gallery items (one atomic write)
app.post('/api/gallery/batch', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const hashCheck = readExpectedHash(res, req.body?.expectedHash);
    if (!hashCheck.ok) return;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) return res.status(400).json({ error: '请提供至少一项图像数据' });
    const items = await readGallery();
    const created = [];
    for (const raw of rawItems) {
      const built = buildGalleryItem(raw, items);
      if (built.error) return res.status(400).json({ error: built.error });
      items.unshift(built.item);
      created.push(built.item);
    }
    const written = await writeGallery(items, { expectedHash: hashCheck.hash });
    res.status(201).json({ success: true, items: created, count: created.length, contentHash: written.contentHash });
  } catch (err) {
    respondStoreError(res, err, 'Gallery Batch API');
  }
});

// Push image repo + src/data/gallery.json directly after gallery uploads
app.post('/api/gallery/push', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const imgPush = await pushImageRepo({ requestId: req.requestId });
    warmUploadedUrlsAsync(req.body?.urls);
    const blogPush = await pushGitChanges({
      paths: ['src/data/gallery.json'],
      commitMsg: '通过管理面板更新独立收藏',
      requestId: req.requestId,
    });
    res.json({
      ok: true,
      success: true,
      imageRepoPushed: Boolean(imgPush.pushed),
      ...blogPush,
      requestId: req.requestId,
    });
  } catch (err) {
    console.error('Gallery Push Error:', err.message);
    respondSyncError(res, req, err, 'GALLERY_PUSH_FAILED');
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
      if (!src || !String(src).trim()) {
        return res.status(400).json({ error: 'src 为必填字段' });
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
        title: fallbackGalleryTitle(src, title),
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

// ── Daily Moments API（03 日常 · 朋友圈微片段，src/data/daily.json）──
async function readDaily() {
  try {
    const { data } = await dailyStore.read();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof InvalidDataError) throw err;
    return [];
  }
}

async function writeDaily(items, { expectedHash = null } = {}) {
  return dailyStore.write(sortDailyItems(items), { expectedHash });
}

function buildDailyPayload(raw, existingItems, fixedId = '') {
  if (raw?.linkCard?.url) {
    const checked = safeLink(raw.linkCard.url);
    if (checked === null) return { error: 'Invalid linkCard URL' };
  }
  const item = sanitizeDailyEntry({ ...raw, id: fixedId || raw?.id }, existingItems);
  if (!item.text && (!item.images || !item.images.length)) {
    return { error: '请填写日常正文或至少上传 1 张图片' };
  }
  return { item };
}

app.route('/api/daily')
  .get(async (_req, res) => {
    try {
      const { data, contentHash } = await dailyStore.read();
      res.setHeader('x-content-hash', contentHash || '');
      res.json(sortDailyItems(Array.isArray(data) ? data : []));
    } catch (err) {
      respondStoreError(res, err, 'Daily API');
    }
  })
  .post(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.body?.expectedHash);
      if (!hashCheck.ok) return;
      const items = await readDaily();
      const built = buildDailyPayload(req.body, items);
      if (built.error) return res.status(400).json({ error: built.error });
      items.unshift(built.item);
      const written = await writeDaily(items, { expectedHash: hashCheck.hash });
      res.status(201).json({ success: true, item: built.item, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Daily API');
    }
  });

app.post('/api/daily/push', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const imgPush = await pushImageRepo({ requestId: req.requestId });
    warmUploadedUrlsAsync(req.body?.urls);
    const blogPush = await pushGitChanges({
      paths: ['src/data/daily.json'],
      commitMsg: '通过管理面板更新日常时间线',
      requestId: req.requestId,
    });
    res.json({
      ok: true,
      success: true,
      imageRepoPushed: Boolean(imgPush.pushed),
      ...blogPush,
      requestId: req.requestId,
    });
  } catch (err) {
    console.error('Daily Push Error:', err.message);
    respondSyncError(res, req, err, 'DAILY_PUSH_FAILED');
  }
});

app.route('/api/daily/:id')
  .put(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.body?.expectedHash);
      if (!hashCheck.ok) return;
      const items = await readDaily();
      const idx = items.findIndex((i) => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '日常记录不存在' });
      const others = items.filter((_, i) => i !== idx);
      const built = buildDailyPayload(req.body, others, req.params.id);
      if (built.error) return res.status(400).json({ error: built.error });
      items[idx] = built.item;
      const written = await writeDaily(items, { expectedHash: hashCheck.hash });
      res.json({ success: true, item: built.item, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Daily API');
    }
  })
  .delete(async (req, res) => {
    try {
      const hashCheck = readExpectedHash(res, req.query.expectedHash);
      if (!hashCheck.ok) return;
      const items = await readDaily();
      const idx = items.findIndex((i) => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '日常记录不存在' });
      items.splice(idx, 1);
      const written = await writeDaily(items, { expectedHash: hashCheck.hash });
      res.json({ success: true, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Daily API');
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

// ── Frontend customization API（仅保留 HORIZON 主站实际消费的 8 个全站/首屏字段）──

const FRONTEND_DEFAULTS = {
  siteName: 'Acretiondisk',
  siteTagline: '记录想法与生活',
  heroEyebrow: 'PERSONAL ARCHIVE · 2026',
  heroTitleLine1: '欢迎来到Blog.Acretiondisk.top',
  heroTitleLine2: '这是我的个人网站',
  heroDescription: '下滑以查看近期文章、我推荐的图片',
  primaryCtaLabel: '浏览文章',
  primaryCtaHref: '/blog/',
  interactEndpoint: '',
};

function pickHorizonFrontend(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(FRONTEND_DEFAULTS)) {
    out[key] = src[key] != null ? src[key] : FRONTEND_DEFAULTS[key];
  }
  return out;
}

async function readFrontendDoc() {
  const { data, contentHash } = await frontendStore.read();
  return {
    data: pickHorizonFrontend(data),
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
      const interactEndpoint = body.interactEndpoint == null ? prev.interactEndpoint : safeLink(body.interactEndpoint);
      if (interactEndpoint === null) return res.status(400).json({ error: 'Invalid interact endpoint URL' });
      const strField = (key, max = 1000) => body[key] == null
        ? prev[key]
        : cleanAboutStr(body[key], max);
      const next = {
        siteName: strField('siteName', 80),
        siteTagline: strField('siteTagline', 120),
        heroEyebrow: strField('heroEyebrow', 120),
        heroTitleLine1: strField('heroTitleLine1', 80),
        heroTitleLine2: strField('heroTitleLine2', 80),
        heroDescription: strField('heroDescription', 300),
        primaryCtaLabel: strField('primaryCtaLabel', 40),
        primaryCtaHref,
        interactEndpoint: String(interactEndpoint || '').slice(0, 300),
      };
      const written = await frontendStore.write(next, { expectedHash: hashCheck.hash });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, frontend: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Frontend API');
    }
  });

// ── Schedule / WMU Timetable API（由后台维护 src/data/schedule.json）──
app.route('/api/schedule')
  .get(async (_req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const doc = await scheduleStore.read();
      const normalized = normalizeSchedulePayload(doc.data) || { ...SCHEDULE_DEFAULT };
      res.json({ ...normalized, contentHash: doc.contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Schedule API');
    }
  })
  .put(express.json({ limit: '4mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const { expectedHash: _ignored, contentHash: _ignored2, ...candidate } = body;
      const normalized = normalizeSchedulePayload(candidate);
      if (!normalized) return res.status(400).json({ error: '课表数据格式不正确' });
      normalized.updatedAt = Date.now();
      const written = await scheduleStore.write(normalized, { expectedHash: hashCheck.hash });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, schedule: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Schedule API');
    }
  });

// ── 文章大类分类 API（支持增删改并级联更新文章 frontmatter）──
async function cascadeCategoryPosts(oldName, newName) {
  if (!oldName || oldName === newName) return 0;
  return withPostWriteLock(async () => {
    const allPosts = await readPosts();
    const files = (await readdir(BLOG_DIR).catch(() => [])).filter((f) => /\.(md|mdx)$/i.test(f));
    let updatedPosts = 0;
    for (const file of files) {
      const slug = file.replace(/\.(md|mdx)$/i, '');
      const fullPath = join(BLOG_DIR, file);
      const raw = await readFile(fullPath, 'utf-8');
      const { data, content } = matter(raw);
      const currentCats = normalizeStrList(data.categories);
      if (!currentCats.includes(oldName)) continue;
      const nextCats = newName
        ? [...new Set(currentCats.map((c) => (c === oldName ? newName : c)))]
        : currentCats.filter((c) => c !== oldName);
      await savePostRevision(slug, raw);
      const body = {
        title: data.title || '',
        description: data.description || '',
        cover: data.cover || '',
        pubDate: safeDate(data.pubDate),
        dayIndex: data.dayIndex || '',
        tags: Array.isArray(data.tags) ? data.tags.join(',') : '',
        categories: nextCats,
        draft: String(Boolean(data.draft)),
        archived: String(Boolean(data.archived)),
        scheduledAt: safeIso(data.scheduledAt),
        access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
        content: content.trim(),
      };
      const markdown = buildPostMarkdown(body, allPosts, { excludeSlug: slug, existingData: data });
      await atomicWriteFile(fullPath, markdown);
      updatedPosts += 1;
    }
    if (updatedPosts > 0) invalidatePostCache();
    return updatedPosts;
  });
}

function makeSlugId(prefix, raw, existingIds) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  let base = cleaned || `${prefix}-${Date.now().toString(36)}`;
  if (!existingIds.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const cand = `${base}-${i}`;
    if (!existingIds.has(cand)) return cand;
  }
}

app.route('/api/categories')
  .get(async (_req, res) => {
    try {
      const doc = await categoriesStore.read();
      res.json({ categories: doc.data, contentHash: doc.contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Categories API');
    }
  })
  .post(express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await categoriesStore.read();
      const list = Array.isArray(doc.data) ? doc.data.slice() : [];
      const existingIds = new Set(list.map((c) => c.id));
      const id = String(body.id || '').trim() || makeSlugId('cat', body.slug || body.name, existingIds);
      const item = {
        id,
        name: String(body.name || '').trim(),
        slug: String(body.slug || id).trim(),
        description: String(body.description || '').trim(),
        color: String(body.color || '#ff5a1a').trim(),
        order: Number.isFinite(Number(body.order)) ? Math.round(Number(body.order)) : (list.reduce((m, c) => Math.max(m, Number(c.order) || 0), 0) + 1),
      };
      const written = await categoriesStore.write([...list, item], { expectedHash: hashCheck.hash });
      const saved = written.data.find((c) => c.id === item.id) || item;
      res.status(201).json({ success: true, item: saved, categories: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Categories API');
    }
  })
  .put(express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const candidate = Array.isArray(body.categories) ? body.categories : body;
      const written = await categoriesStore.write(candidate, { expectedHash: hashCheck.hash });
      res.json({ success: true, categories: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Categories API');
    }
  });

app.route('/api/categories/:id')
  .put(express.json(), async (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await categoriesStore.read();
      const list = Array.isArray(doc.data) ? doc.data.slice() : [];
      const idx = list.findIndex((c) => c.id === targetId);
      if (idx === -1) return res.status(404).json({ error: '分类不存在' });
      const prev = list[idx];
      list[idx] = {
        ...prev,
        name: body.name != null ? String(body.name).trim() : prev.name,
        slug: body.slug != null ? String(body.slug).trim() : prev.slug,
        description: body.description != null ? String(body.description).trim() : prev.description,
        color: body.color != null ? String(body.color).trim() : prev.color,
        order: body.order != null ? Number(body.order) : prev.order,
      };
      const written = await categoriesStore.write(list, { expectedHash: hashCheck.hash });
      const saved = written.data.find((c) => c.id === targetId) || list[idx];
      let updatedPosts = 0;
      if (prev.name !== saved.name) {
        updatedPosts = await cascadeCategoryPosts(prev.name, saved.name);
      }
      res.json({ success: true, item: saved, categories: written.data, contentHash: written.contentHash, updatedPosts });
    } catch (err) {
      respondStoreError(res, err, 'Categories API');
    }
  })
  .delete(async (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const hashCheck = readExpectedHash(res, req.body?.expectedHash ?? req.query?.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await categoriesStore.read();
      const list = Array.isArray(doc.data) ? doc.data.slice() : [];
      const target = list.find((c) => c.id === targetId);
      if (!target) return res.status(404).json({ error: '分类不存在' });
      const next = list.filter((c) => c.id !== targetId);
      const written = await categoriesStore.write(next, { expectedHash: hashCheck.hash });
      let updatedPosts = 0;
      if (req.query?.cascade !== '0') {
        updatedPosts = await cascadeCategoryPosts(target.name, '');
      }
      res.json({ success: true, removed: target, categories: written.data, contentHash: written.contentHash, updatedPosts });
    } catch (err) {
      respondStoreError(res, err, 'Categories API');
    }
  });

// ── 09 造物 / 实验室 API（src/data/projects.json）──
app.route('/api/projects')
  .get(async (_req, res) => {
    try {
      const doc = await projectsStore.read();
      res.json({ projects: doc.data, contentHash: doc.contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Projects API');
    }
  })
  .post(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await projectsStore.read();
      const list = Array.isArray(doc.data) ? doc.data.slice() : [];
      const existingIds = new Set(list.map((p) => p.id));
      const id = String(body.id || '').trim() || makeSlugId('proj', body.name, existingIds);
      const nextItem = {
        ...body,
        id,
        order: Number.isFinite(Number(body.order)) ? Math.round(Number(body.order)) : (list.reduce((m, p) => Math.max(m, Number(p.order) || 0), 0) + 1),
      };
      delete nextItem.expectedHash;
      const written = await projectsStore.write([...list, nextItem], { expectedHash: hashCheck.hash });
      const saved = written.data.find((p) => p.id === id) || nextItem;
      res.status(201).json({ success: true, item: saved, projects: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Projects API');
    }
  })
  .put(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const candidate = Array.isArray(body.projects) ? body.projects : body;
      const written = await projectsStore.write(candidate, { expectedHash: hashCheck.hash });
      res.json({ success: true, projects: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Projects API');
    }
  });

app.route('/api/projects/:id')
  .put(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await projectsStore.read();
      const list = Array.isArray(doc.data) ? doc.data.slice() : [];
      const idx = list.findIndex((p) => p.id === targetId);
      if (idx === -1) return res.status(404).json({ error: '造物项目不存在' });
      const { expectedHash: _h, id: _i, ...patch } = body;
      list[idx] = { ...list[idx], ...patch, id: targetId };
      const written = await projectsStore.write(list, { expectedHash: hashCheck.hash });
      const saved = written.data.find((p) => p.id === targetId) || list[idx];
      res.json({ success: true, item: saved, projects: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Projects API');
    }
  })
  .delete(async (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const hashCheck = readExpectedHash(res, req.body?.expectedHash ?? req.query?.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await projectsStore.read();
      const list = Array.isArray(doc.data) ? doc.data.slice() : [];
      const target = list.find((p) => p.id === targetId);
      if (!target) return res.status(404).json({ error: '造物项目不存在' });
      const written = await projectsStore.write(list.filter((p) => p.id !== targetId), { expectedHash: hashCheck.hash });
      res.json({ success: true, removed: target, projects: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Projects API');
    }
  });

// ── 10 年度 / 阶段观测报告 API（src/data/report.json）──
app.route('/api/reports')
  .get(async (_req, res) => {
    try {
      const doc = await reportStore.read();
      res.json({ ...doc.data, contentHash: doc.contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Reports API');
    }
  })
  .post(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await reportStore.read();
      const cur = doc.data || { activeReportId: '', reports: [] };
      const list = Array.isArray(cur.reports) ? cur.reports.slice() : [];
      const existingIds = new Set(list.map((r) => r.id));
      const id = String(body.id || '').trim() || makeSlugId('report', body.title, existingIds);
      const { expectedHash: _h, setActive, ...itemBody } = body;
      const nextItem = {
        ...itemBody,
        id,
        order: Number.isFinite(Number(body.order)) ? Math.round(Number(body.order)) : (list.reduce((m, r) => Math.max(m, Number(r.order) || 0), 0) + 1),
      };
      const written = await reportStore.write({
        activeReportId: setActive ? id : (cur.activeReportId || id),
        reports: [...list, nextItem],
      }, { expectedHash: hashCheck.hash });
      const saved = written.data.reports.find((r) => r.id === id) || nextItem;
      res.status(201).json({ success: true, item: saved, ...written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Reports API');
    }
  })
  .put(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const { expectedHash: _h, contentHash: _c, ...candidate } = body;
      const written = await reportStore.write(candidate, { expectedHash: hashCheck.hash });
      res.json({ success: true, ...written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Reports API');
    }
  });

app.route('/api/reports/:id')
  .put(express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await reportStore.read();
      const cur = doc.data || { activeReportId: '', reports: [] };
      const list = Array.isArray(cur.reports) ? cur.reports.slice() : [];
      const idx = list.findIndex((r) => r.id === targetId);
      if (idx === -1) return res.status(404).json({ error: '观测报告不存在' });
      const { expectedHash: _h, id: _i, setActive, ...patch } = body;
      list[idx] = { ...list[idx], ...patch, id: targetId };
      const written = await reportStore.write({
        activeReportId: setActive ? targetId : (cur.activeReportId || targetId),
        reports: list,
      }, { expectedHash: hashCheck.hash });
      const saved = written.data.reports.find((r) => r.id === targetId) || list[idx];
      res.json({ success: true, item: saved, ...written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Reports API');
    }
  })
  .delete(async (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const hashCheck = readExpectedHash(res, req.body?.expectedHash ?? req.query?.expectedHash);
      if (!hashCheck.ok) return;
      const doc = await reportStore.read();
      const cur = doc.data || { activeReportId: '', reports: [] };
      const list = Array.isArray(cur.reports) ? cur.reports.slice() : [];
      const target = list.find((r) => r.id === targetId);
      if (!target) return res.status(404).json({ error: '观测报告不存在' });
      const nextReports = list.filter((r) => r.id !== targetId);
      const written = await reportStore.write({
        activeReportId: cur.activeReportId === targetId ? (nextReports[0]?.id || '') : cur.activeReportId,
        reports: nextReports,
      }, { expectedHash: hashCheck.hash });
      res.json({ success: true, removed: target, ...written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Reports API');
    }
  });

// ── 11 学业轨迹 API（src/data/academics.json）──
app.route('/api/academics')
  .get(async (_req, res) => {
    try {
      const doc = await academicsStore.read();
      res.json({ ...doc.data, contentHash: doc.contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Academics API');
    }
  })
  .put(express.json({ limit: '4mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const { expectedHash: _h, contentHash: _c, ...candidate } = body;
      const written = await academicsStore.write(candidate, { expectedHash: hashCheck.hash });
      res.json({ success: true, academics: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Academics API');
    }
  });

// ── 期末考试日程 API（src/data/exams.json）──
app.route('/api/exams')
  .get(async (_req, res) => {
    try {
      const doc = await examsStore.read();
      res.json({ ...doc.data, contentHash: doc.contentHash || '' });
    } catch (err) {
      respondStoreError(res, err, 'Exams API');
    }
  })
  .put(express.json({ limit: '4mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const hashCheck = readExpectedHash(res, body.expectedHash);
      if (!hashCheck.ok) return;
      const { expectedHash: _h, contentHash: _c, ...candidate } = body;
      const written = await examsStore.write(candidate, { expectedHash: hashCheck.hash });
      res.json({ success: true, exams: written.data, contentHash: written.contentHash });
    } catch (err) {
      respondStoreError(res, err, 'Exams API');
    }
  });

// ── 集中配置：上传 / 请求 / 远程 / 超时 / 并发限制（发布中心与媒体库在 UI 中展示）──

// ── Media library API ──
const MEDIA_IMAGE_EXTS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.heic', '.heif', '.avif'];
const MEDIA_AUDIO_EXTS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac'];
const MEDIA_VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.ogv'];
const MEDIA_FILE_EXTS = ['.pdf', '.zip', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx', '.pptx'];
const IMAGE_ARCHIVE_DIR = join(IMAGE_DIR, '_archive');
const AUDIO_ARCHIVE_DIR = join(AUDIO_DIR, '_archive');
const VIDEO_ARCHIVE_DIR = join(VIDEO_DIR, '_archive');
const FILE_ARCHIVE_DIR = join(FILE_DIR, '_archive');

// ── 媒体目录列表缓存（按目录 mtimeMs + epoch 失效，避免每次请求串行 stat 800+ 文件）──
const mediaDirListCache = new Map(); // dir -> { epoch, dirMtimeMs, files }
let mediaCacheEpoch = 0;
let mediaPayloadCache = null; // { key, payload }
let mediaResponseInFlight = null;

function invalidateMediaCache() {
  mediaCacheEpoch += 1;
  mediaDirListCache.clear();
  mediaPayloadCache = null;
  mediaResponseInFlight = null;
}

async function listMediaFiles(dir, exts) {
  const dirStat = await statFile(dir).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) return [];
  const cached = mediaDirListCache.get(dir);
  if (cached && cached.epoch === mediaCacheEpoch && cached.dirMtimeMs === dirStat.mtimeMs) {
    return cached.files;
  }
  const names = (await readdir(dir).catch(() => [])).filter((name) => exts.includes(extname(name).toLowerCase()));
  const entries = await mapWithConcurrency(names, 24, async (name) => {
    const st = await statFile(join(dir, name)).catch(() => null);
    if (!st || !st.isFile()) return null;
    return { name, size: st.size, mtime: st.mtime.toISOString() };
  });
  const out = entries.filter(Boolean);
  mediaDirListCache.set(dir, { epoch: mediaCacheEpoch, dirMtimeMs: dirStat.mtimeMs, files: out });
  return out;
}

const MEDIA_DIM_CACHE_FILE = join(BACKUP_DIR, 'media-dimensions.json');
const mediaDimensionCache = new Map();
let mediaDimCacheLoaded = false;
let mediaDimWriteQueue = Promise.resolve();

async function loadMediaDimCache() {
  if (mediaDimCacheLoaded) return;
  mediaDimCacheLoaded = true;
  try {
    const raw = await readFile(MEDIA_DIM_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.width === 'number' && typeof v.height === 'number') {
          mediaDimensionCache.set(k, { width: v.width, height: v.height });
        }
      }
    }
  } catch { /* 首次启动尚无缓存文件时忽略 */ }
}

function saveMediaDimCache(validKeys) {
  const run = async () => {
    try {
      if (validKeys) {
        for (const k of mediaDimensionCache.keys()) {
          if (!validKeys.has(k)) mediaDimensionCache.delete(k);
        }
      }
      const obj = {};
      for (const [k, v] of mediaDimensionCache.entries()) obj[k] = v;
      await mkdir(BACKUP_DIR, { recursive: true });
      await atomicWriteFile(MEDIA_DIM_CACHE_FILE, `${JSON.stringify(obj)}\n`);
    } catch { /* 缓存落盘失败不影响媒体列表返回 */ }
  };
  mediaDimWriteQueue = mediaDimWriteQueue.then(run, run);
  return mediaDimWriteQueue;
}

async function mediaDimensions(fullPath, cacheKey) {
  if (mediaDimensionCache.has(cacheKey)) return { dim: mediaDimensionCache.get(cacheKey), hit: true };
  let dim = { width: 0, height: 0 };
  try {
    const meta = await sharp(fullPath).metadata();
    dim = { width: meta.width || 0, height: meta.height || 0 };
  } catch { /* 非图片或读取失败 */ }
  mediaDimensionCache.set(cacheKey, dim);
  return { dim, hit: false };
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
// ── 媒体引用扫描缓存 ──
// collectMediaUsage 会遍历全部文章 + gallery.json 做正则统计（实测约 40ms/次），
// 而每次打开媒体库都会调用它。缓存键 = 文章缓存代次 + gallery.json 的 mtime/size：
//   · 文章写路径已统一调用 invalidatePostCache()，代次变化即失效；
//   · gallery.json 由 writeGallery() 落盘，mtime/size 变化即失效。
let mediaUsageCache = { key: '', usage: null };
const postMediaRefCache = new Map(); // file -> { mtimeMs, size, refs: string[] }

function extractPostMediaRefs(raw) {
  const refs = new Set();
  const cdnRe = /https?:\/\/[^\s)"'<>]*?\/(?:image|audio|video|file)\/([^)"'<>\s/]+)/g;
  let m;
  while ((m = cdnRe.exec(raw))) {
    const n = fileNameFromUrl(m[1]);
    if (n) refs.add(n);
  }
  const bareRe = /([A-Za-z0-9\u4e00-\u9fff_@.\-]+\.(?:webp|png|jpe?g|gif|svg|heic|heif|avif|mp3|flac|ogg|wav|m4a|aac|mp4|webm|mov|ogv|pdf|zip|txt|csv|docx|xlsx|pptx))/gi;
  while ((m = bareRe.exec(raw))) {
    if (m[1]) refs.add(m[1]);
  }
  return [...refs];
}

async function collectMediaUsage() {
  const [blogDirStat, galleryStat, dailyStat, aboutStat, frontendStat, projectsStat] = await Promise.all([
    statFile(BLOG_DIR).catch(() => null),
    statFile(GALLERY_JSON).catch(() => null),
    statFile(DAILY_JSON).catch(() => null),
    statFile(ABOUT_JSON).catch(() => null),
    statFile(FRONTEND_JSON).catch(() => null),
    statFile(PROJECTS_JSON).catch(() => null),
  ]);
  const statSig = (st) => (st ? `${st.mtimeMs}:${st.size}` : 'none');
  const cacheKey = `${postListEpoch}:${statSig(blogDirStat)}:${statSig(galleryStat)}:${statSig(dailyStat)}:${statSig(aboutStat)}:${statSig(frontendStat)}:${statSig(projectsStat)}`;
  if (mediaUsageCache.usage && mediaUsageCache.key === cacheKey) return mediaUsageCache.usage;

  const usage = new Map();
  const mark = (name, owner) => {
    if (!name) return;
    if (!usage.has(name)) usage.set(name, new Set());
    usage.get(name).add(owner);
  };
  const files = (await readdir(BLOG_DIR).catch(() => [])).filter((f) => /\.(md|mdx)$/i.test(f));
  const currentSet = new Set(files);
  for (const k of postMediaRefCache.keys()) {
    if (!currentSet.has(k)) postMediaRefCache.delete(k);
  }
  const postRefsList = await mapWithConcurrency(files, 16, async (file) => {
    const slug = file.replace(/\.(md|mdx)$/i, '');
    const full = join(BLOG_DIR, file);
    const st = await statFile(full).catch(() => null);
    const cached = postMediaRefCache.get(file);
    if (st && cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return { slug, refs: cached.refs };
    }
    const raw = await readFile(full, 'utf8').catch(() => '');
    const refs = extractPostMediaRefs(raw);
    if (st) postMediaRefCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, refs });
    return { slug, refs };
  });
  for (const { slug, refs } of postRefsList) {
    for (const name of refs) mark(name, `post:${slug}`);
  }
  try {
    const { data } = await galleryStore.read();
    if (Array.isArray(data)) {
      for (const item of data) {
        for (const u of [item.src, item.original]) mark(fileNameFromUrl(u), `gallery:${item.id}`);
      }
    }
  } catch { /* 画廊读取失败时忽略 */ }
  try {
    const { data } = await dailyStore.read();
    if (Array.isArray(data)) {
      for (const item of data) {
        for (const img of item.images || []) {
          for (const u of [img?.src, img?.original]) mark(fileNameFromUrl(u), `daily:${item.id}`);
        }
      }
    }
  } catch { /* 日常读取失败时忽略 */ }
  try {
    const { data } = await aboutStore.read();
    if (data && typeof data === 'object' && data.avatar) {
      mark(fileNameFromUrl(data.avatar), 'about:avatar');
    }
  } catch { /* 关于页读取失败时忽略 */ }
  try {
    const { data } = await frontendStore.read();
    if (data && typeof data === 'object' && data.stillHeroImage) {
      mark(fileNameFromUrl(data.stillHeroImage), 'frontend:hero');
    }
  } catch { /* 外观配置读取失败时忽略 */ }
  try {
    const { data } = await projectsStore.read();
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item?.cover) mark(fileNameFromUrl(item.cover), `project:${item.id}`);
      }
    }
  } catch { /* 造物项目读取失败时忽略 */ }
  const plain = {};
  for (const [name, owners] of usage) plain[name] = [...owners];
  mediaUsageCache = { key: cacheKey, usage: plain };
  return plain;
}

// ── 上传链路自检：一次性定位上传失败的环境原因（目录/权限/sharp/git/远端/磁盘）──
app.get('/api/upload/selfcheck', auth, async (req, res) => {
  const startedAt = Date.now();
  const checks = [];
  const add = (id, label, ok, detail = '', hint = '') => checks.push({ id, label, ok: Boolean(ok), detail: String(detail), hint });

  // 1) 图库仓库目录存在
  let repoOk = false, repoDetail = IMG_REPO_DIR;
  try { await fileAccess(IMG_REPO_DIR); repoOk = true; }
  catch (e) { repoDetail = `${IMG_REPO_DIR}（${e.code || e.message}）`; }
  add('repo_dir', '图库仓库目录存在', repoOk, repoDetail, repoOk ? '' : '检查 IMG_REPO_DIR 是否指向 blog-images 仓库（默认 ../blog-images）');

  // 2) 图片目录可写（真实写入 + 删除）
  let writable = false, writeDetail = IMAGE_DIR;
  const probe = join(IMAGE_DIR, `.selfcheck-${Date.now()}.tmp`);
  try {
    await mkdir(IMAGE_DIR, { recursive: true });
    await writeFile(probe, 'ok');
    await unlink(probe);
    writable = true;
  } catch (e) {
    writeDetail = `${IMAGE_DIR}（${e.code || e.message}）`;
    await unlink(probe).catch(() => {});
  }
  add('image_dir', '图片目录可写', writable, writeDetail, writable ? '' : '目录被占用 / 无权限 / 磁盘满：检查安全软件、OneDrive 同步或磁盘空间');

  // 3) sharp 转码可用
  let sharpOk = false, sharpDetail = '';
  try {
    const out = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } } }).webp().toBuffer();
    sharpOk = out.length > 0;
    sharpDetail = `sharp ${sharp.versions?.sharp || ''} · webp ${out.length}B`;
  } catch (e) { sharpDetail = e.message; }
  add('sharp', 'sharp 转码可用', sharpOk, sharpDetail, sharpOk ? '' : 'sharp 原生依赖异常，尝试重新 npm install');

  // 4) 图库是 Git 仓库且工作区状态可读
  let gitOk = false, gitDetail = '';
  try {
    const st = await imageGit.status();
    gitOk = true;
    const bits = [st.branch || 'HEAD'];
    bits.push(st.hasUpstream ? (st.upstream || '有上游') : '无上游');
    if (st.dirtyCount) bits.push(`${st.dirtyCount} 个未提交`);
    if (st.ahead) bits.push(`领先 ${st.ahead}`);
    gitDetail = bits.join(' · ');
  } catch (e) { gitDetail = e.message; }
  add('git_repo', '图库 Git 仓库状态', gitOk, gitDetail, gitOk ? '' : '图库目录可能已被移动/删除，或不是 Git 仓库');

  // 5) 远端可达（隔离测试模式跳过外网连接，避免烟测触网超时；常规模式走 fetch 探测）
  let remoteOk = false, remoteDetail = '';
  if (IS_ISOLATED_DATA_MODE && req.query.probeRemote !== '1') {
    remoteOk = gitOk;
    remoteDetail = '隔离测试模式（已跳过外网探测）';
  } else {
    try {
      const r = await imageGit.fetchRemote({ timeoutMs: 10000 });
      remoteOk = Boolean(r.ok);
      remoteDetail = remoteOk ? 'origin 可达' : String(r.stderr || r.stdout || 'fetch 失败').trim().slice(0, 200);
    } catch (e) { remoteDetail = e.message; }
  }
  add('git_remote', '图片仓库远端可达', remoteOk, remoteDetail, remoteOk ? '' : '网络/代理无法访问 GitHub：上传的文件会保留但推送失败，可稍后在发布中心补推');

  // 6) 磁盘剩余空间
  let freeGB = null;
  try {
    const st = await statfs(IMG_REPO_DIR);
    freeGB = (st.bavail * st.bsize) / 1024 ** 3;
  } catch { /* 忽略 */ }
  add('disk', '磁盘剩余空间', freeGB === null || freeGB > 1,
    freeGB === null ? '无法读取' : `${freeGB.toFixed(1)} GB`,
    freeGB !== null && freeGB <= 1 ? '磁盘空间不足，清理后再上传' : '');

  // 7) 媒体库可读（计数）
  let counts = { images: 0, audios: 0 };
  try {
    counts = {
      images: (await listMediaFiles(IMAGE_DIR, MEDIA_IMAGE_EXTS)).length,
      audios: (await listMediaFiles(AUDIO_DIR, MEDIA_AUDIO_EXTS)).length,
    };
  } catch { /* 忽略 */ }
  add('library', '媒体库目录可读', true, `图片 ${counts.images} · 音频 ${counts.audios}`);

  res.json({
    ok: checks.every((c) => c.ok),
    checks,
    counts,
    lastError: lastUploadError,
    limits: LIMITS,
    config: {
      imgRepoDir: IMG_REPO_DIR,
      imageDir: IMAGE_DIR,
      dataDir: DATA_DIR,
      blogDir: BLOG_DIR,
      port: PORT,
      node: process.version,
      pid: process.pid,
      startedAt: SERVER_STARTED_AT,
      tokenFromEnv: Boolean(process.env.ADMIN_TOKEN),
    },
    durationMs: Date.now() - startedAt,
  });
});

async function buildMediaPayload() {
  const [imgSt, audSt, vidSt, docSt, blogSt, galSt, dailySt, aboutSt, feSt] = await Promise.all([
    statFile(IMAGE_DIR).catch(() => null),
    statFile(AUDIO_DIR).catch(() => null),
    statFile(VIDEO_DIR).catch(() => null),
    statFile(FILE_DIR).catch(() => null),
    statFile(BLOG_DIR).catch(() => null),
    statFile(GALLERY_JSON).catch(() => null),
    statFile(DAILY_JSON).catch(() => null),
    statFile(ABOUT_JSON).catch(() => null),
    statFile(FRONTEND_JSON).catch(() => null),
  ]);
  const sig = (st) => (st ? `${st.mtimeMs}:${st.size}` : '0');
  const cacheKey = [mediaCacheEpoch, postListEpoch, sig(imgSt), sig(audSt), sig(vidSt), sig(docSt), sig(blogSt), sig(galSt), sig(dailySt), sig(aboutSt), sig(feSt)].join('|');
  if (mediaPayloadCache && mediaPayloadCache.key === cacheKey && (Date.now() - mediaPayloadCache.at) < 15000) {
    return mediaPayloadCache.payload;
  }

  await loadMediaDimCache();
  const [imageFiles, audioFiles, videoFiles, docFiles, usage] = await Promise.all([
    listMediaFiles(IMAGE_DIR, MEDIA_IMAGE_EXTS),
    listMediaFiles(AUDIO_DIR, MEDIA_AUDIO_EXTS),
    listMediaFiles(VIDEO_DIR, MEDIA_VIDEO_EXTS),
    listMediaFiles(FILE_DIR, MEDIA_FILE_EXTS),
    collectMediaUsage(),
  ]);
  let dimCacheDirty = false;
  const validDimKeys = new Set();
  const images = await mapWithConcurrency(imageFiles, 8, async (f) => {
    const cacheKeyDim = `${f.name}:${f.mtime}`;
    validDimKeys.add(cacheKeyDim);
    const { dim, hit } = await mediaDimensions(join(IMAGE_DIR, f.name), cacheKeyDim);
    if (!hit) dimCacheDirty = true;
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
  if (dimCacheDirty) {
    saveMediaDimCache(validDimKeys);
  }
  const audios = audioFiles.map((f) => ({
    type: 'audio',
    name: f.name,
    size: f.size,
    mtime: f.mtime,
    url: `${AUDIO_BASE_URL}${encodeURIComponent(f.name)}`,
    usedBy: usage[f.name] || [],
  }));
  const videos = videoFiles.map((f) => ({
    type: 'video',
    name: f.name,
    size: f.size,
    mtime: f.mtime,
    url: `${VIDEO_BASE_URL}${encodeURIComponent(f.name)}`,
    usedBy: usage[f.name] || [],
  }));
  const files = docFiles.map((f) => ({
    type: 'file',
    name: f.name,
    size: f.size,
    mtime: f.mtime,
    ext: extname(f.name).toLowerCase(),
    url: `${FILE_BASE_URL}${encodeURIComponent(f.name)}`,
    usedBy: usage[f.name] || [],
  }));
  images.sort((a, b) => b.mtime.localeCompare(a.mtime));
  audios.sort((a, b) => b.mtime.localeCompare(a.mtime));
  videos.sort((a, b) => b.mtime.localeCompare(a.mtime));
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  const allItems = [...images, ...audios, ...videos, ...files];
  const withUsage = allItems.filter((i) => i.usedBy.length).length;
  const payload = {
    ok: true,
    images,
    audios,
    videos,
    files,
    generatedAt: new Date().toISOString(),
    limits: LIMITS,
    stats: {
      images: images.length,
      audios: audios.length,
      videos: videos.length,
      files: files.length,
      referenced: withUsage,
      orphan: allItems.length - withUsage,
    },
  };
  mediaPayloadCache = { key: cacheKey, at: Date.now(), payload };
  return payload;
}

app.get('/api/media', async (req, res) => {
  try {
    if (!mediaResponseInFlight) {
      mediaResponseInFlight = buildMediaPayload().finally(() => {
        mediaResponseInFlight = null;
      });
    }
    const payload = await mediaResponseInFlight;
    res.json({ ...payload, requestId: req.requestId });
  } catch (err) {
    console.error('Media API Error:', err.message);
    res.status(500).json({ error: '读取媒体库失败' });
  }
});

function resolveMediaTarget(type, name) {
  const raw = String(name || '');
  const safeName = basename(raw);
  if (!safeName || safeName !== raw) return null;
  const map = {
    image: { dir: IMAGE_DIR, exts: MEDIA_IMAGE_EXTS, archiveDir: IMAGE_ARCHIVE_DIR, isImage: true },
    audio: { dir: AUDIO_DIR, exts: MEDIA_AUDIO_EXTS, archiveDir: AUDIO_ARCHIVE_DIR, isImage: false },
    video: { dir: VIDEO_DIR, exts: MEDIA_VIDEO_EXTS, archiveDir: VIDEO_ARCHIVE_DIR, isImage: false },
    file: { dir: FILE_DIR, exts: MEDIA_FILE_EXTS, archiveDir: FILE_ARCHIVE_DIR, isImage: false },
  };
  const cfg = map[type];
  if (!cfg) return null;
  if (!cfg.exts.includes(extname(safeName).toLowerCase())) return null;
  return { dir: cfg.dir, archiveDir: cfg.archiveDir, name: safeName, isImage: cfg.isImage };
}

/** 删除文件（Windows 上被占用时重试几次，避免杀毒/索引/同步盘短暂锁定导致 EBUSY）*/
async function unlinkWithRetry(filePath, attempts = 4) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await unlink(filePath);
      return true;
    } catch (err) {
      lastErr = err;
      if (err.code === 'ENOENT') throw err;
      if (!['EBUSY', 'EPERM', 'EACCES', 'EMFILE'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw lastErr;
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
    await unlinkWithRetry(join(target.dir, target.name));
    if (target.isImage) {
      await unlinkWithRetry(join(THUMB_DIR, `${basename(target.name, extname(target.name))}.webp`), 2).catch(() => {});
      await unlinkWithRetry(join(ORIGINAL_DIR, target.name), 2).catch(() => {});
    }
    invalidateMediaCache();
    let pushed = false;
    try { pushed = (await pushImageRepo({ requestId: req.requestId })).pushed; } catch { /* 推送失败不影响本地删除 */ }
    res.json({ ok: true, deleted: target.name, pushed, requestId: req.requestId });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: '文件不存在' });
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      console.error('Media Delete Error:', err.code, err.message);
      return res.status(409).json({ code: 'FILE_LOCKED', error: '文件正被其它程序占用，请稍后重试（杀毒扫描 / 图片查看器 / 同步盘）' });
    }
    console.error('Media Delete Error:', err.message);
    res.status(500).json({ error: '删除媒体失败', detail: err.message });
  }
});

app.post('/api/media/archive', upload.none(), async (req, res) => {
  try {
    const target = resolveMediaTarget(req.body.type, req.body.name);
    if (!target) return res.status(400).json({ error: '无效的媒体类型或文件名' });
    const archiveDir = target.archiveDir;
    await mkdir(archiveDir, { recursive: true });
    await rename(join(target.dir, target.name), join(archiveDir, target.name));
    invalidateMediaCache();
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
// 面板 HTML 只在磁盘文件变化时重读并重新注入口令：
// 原实现每次请求都 readFile + 字符串替换，这里用 mtimeMs/size 校验缓存，
// 开发时直接改 admin/index.html 刷新即可生效（stat 变化 → 自动重读），无需重启服务。
const ADMIN_TOKEN_MARKER = "window.__ADMIN_TOKEN__ = '__ADMIN_TOKEN__';";
const adminHtmlCache = { mtimeMs: 0, size: -1, injected: '' };

async function readInjectedAdminHtml() {
  const st = await statFile(ADMIN_HTML);
  if (st.mtimeMs === adminHtmlCache.mtimeMs && st.size === adminHtmlCache.size) return adminHtmlCache.injected;
  const html = await readFile(ADMIN_HTML, 'utf8');
  adminHtmlCache.injected = html.replace(ADMIN_TOKEN_MARKER, `window.__ADMIN_TOKEN__ = ${JSON.stringify(ADMIN_TOKEN)};`);
  adminHtmlCache.mtimeMs = st.mtimeMs;
  adminHtmlCache.size = st.size;
  return adminHtmlCache.injected;
}

app.get(['/admin', '/admin/', '/admin/index.html'], async (req, res) => {
  try {
    const injected = await readInjectedAdminHtml();
    // 面板 HTML 必须每次校验（口令注入 + 前端改动即时生效）
    res.set('Cache-Control', 'no-cache');
    const enc = negotiateEncoding(req);
    if (enc) {
      const compressed = compressBufferSync(Buffer.from(injected, 'utf8'), enc);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Content-Encoding', enc);
      res.vary('Accept-Encoding');
      return res.send(compressed);
    }
    res.type('html').send(injected);
  } catch (err) {
    console.error('Admin panel error:', err.message);
    res.status(500).send('Admin panel unavailable');
  }
});

// 管理面板静态资源缓存 + 内存预压缩中间件（对 JS/CSS/SVG 启用 br/gzip + ETag/304，
// 让 814KB tiptap-bundle.mjs 与 118KB main.js 传输体积减少 75%+ 且热命中 <1ms）
const ADMIN_ROOT = resolve(__dirname, 'admin');
const VENDOR_CACHE_CONTROL = 'public, max-age=604800, immutable';
const STATIC_COMPRESS_MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};
const STATIC_COMPRESS_CACHE = new Map(); // cacheKey -> Buffer (max 64 entries)
const MAX_STATIC_COMPRESS_ENTRIES = 64;
const MAX_STATIC_COMPRESS_BYTES = 5 * 1024 * 1024;

function setAdminStaticCacheHeaders(res, filePath) {
  const relative = filePath.slice(ADMIN_ROOT.length + 1).split('\\').join('/');
  const isVendor = relative.startsWith('vendor/');
  if (!res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', isVendor ? VENDOR_CACHE_CONTROL : 'no-cache');
  }
}

async function serveCompressedStaticFile(req, res, filePath, { isVendor = false } = {}) {
  const enc = negotiateEncoding(req);
  if (!enc || req.headers.range) return false;
  const ext = extname(filePath).toLowerCase();
  const mime = STATIC_COMPRESS_MIME[ext];
  if (!mime) return false;
  const st = await statFile(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size < COMPRESS_MIN_BYTES || st.size > MAX_STATIC_COMPRESS_BYTES) return false;

  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
  res.setHeader('Cache-Control', isVendor ? VENDOR_CACHE_CONTROL : 'no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Encoding', enc);

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true;
  }

  const key = `${filePath}:${st.mtimeMs}:${st.size}:${enc}`;
  let buf = STATIC_COMPRESS_CACHE.get(key);
  if (!buf) {
    const raw = await readFile(filePath);
    buf = await compressBufferAsync(raw, enc);
    if (STATIC_COMPRESS_CACHE.size >= MAX_STATIC_COMPRESS_ENTRIES) {
      const oldest = STATIC_COMPRESS_CACHE.keys().next().value;
      if (oldest) STATIC_COMPRESS_CACHE.delete(oldest);
    }
    STATIC_COMPRESS_CACHE.set(key, buf);
  }
  res.send(buf);
  return true;
}

const SHARED_ADMIN_SCRIPTS = {
  '/admin/shared/schedule-core.mjs': resolve(__dirname, 'src', 'lib', 'schedule-core.mjs'),
  '/admin/shared/editor-codec.mjs': resolve(__dirname, 'src', 'lib', 'editor-codec.mjs'),
  '/admin/shared/daily-moments-grid.mjs': resolve(__dirname, 'src', 'lib', 'daily-moments-grid.mjs'),
};
for (const [routePath, filePath] of Object.entries(SHARED_ADMIN_SCRIPTS)) {
  app.get(routePath, async (req, res) => {
    if (await serveCompressedStaticFile(req, res, filePath)) return;
    res.set('Cache-Control', 'no-cache');
    res.type('application/javascript; charset=utf-8');
    res.sendFile(filePath);
  });
}

app.get('/admin/img-repo/thumb/:file', async (req, res, next) => {
  try {
    const file = basename(String(req.params.file || ''));
    if (!file || file !== req.params.file) return next();
    const thumbPath = join(THUMB_DIR, file);
    if (await fileAccess(thumbPath).then(() => true, () => false)) {
      return res.sendFile(thumbPath);
    }
    const base = file.replace(/\.[^.]+$/, '');
    for (const ext of ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.svg']) {
      const cand = join(IMAGE_DIR, `${base}${ext}`);
      if (await fileAccess(cand).then(() => true, () => false)) {
        return res.sendFile(cand);
      }
    }
  } catch { /* fallthrough */ }
  next();
});
app.use('/admin/img-repo', express.static(IMAGE_DIR, { maxAge: '1d' }));
app.use('/admin', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    const reqPath = decodeURIComponent(req.path || '');
    if (!reqPath || reqPath.includes('\0')) return next();
    const resolved = resolve(ADMIN_ROOT, `.${reqPath}`);
    if (!resolved.startsWith(ADMIN_ROOT + '\\') && !resolved.startsWith(ADMIN_ROOT + '/')) return next();
    const rel = resolved.slice(ADMIN_ROOT.length + 1).split('\\').join('/');
    if (await serveCompressedStaticFile(req, res, resolved, { isVendor: rel.startsWith('vendor/') })) return;
  } catch { /* 解码失败或异常时退回 express.static */ }
  next();
});
app.use('/admin', express.static(ADMIN_ROOT, { setHeaders: setAdminStaticCacheHeaders }));

app.listen(PORT, '127.0.0.1', (err) => {
  if (err) {
    console.error(`❌ 无法启动管理面板（端口 ${PORT}）：${err.message}`);
    process.exit(1);
  }
  const url = `http://localhost:${PORT}/admin`;
  console.log(`\n📚 博客管理面板已启动: ${url}\n`);
  console.log(`   仅限本地使用 — 请勿暴露到公网`);
  console.log(`   图库目录：${IMG_REPO_DIR}`);
  console.log(`   数据目录：${DATA_DIR}`);
  console.log(`   进程 PID：${process.pid} · Node ${process.version} · 启动于 ${SERVER_STARTED_AT}`);
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
