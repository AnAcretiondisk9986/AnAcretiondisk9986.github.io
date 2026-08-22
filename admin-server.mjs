import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import decodeHeic from 'heic-decode';
import { getHeicOrientation } from './admin/heic-exif.mjs';
import { readdir, readFile, writeFile, unlink, mkdir, access, copyFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join, dirname, extname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import matter from 'gray-matter';
import { parseFile as parseAudioMeta } from 'music-metadata';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = resolve(__dirname, 'src', 'content', 'blog');
// 图片仓库：与博客仓库平级的 blog-images，图片上传后经 jsDelivr CDN 外链引用
// IMG_REPO_DIR 支持环境变量覆盖（测试隔离用）
const IMG_REPO_DIR = process.env.IMG_REPO_DIR ? resolve(process.env.IMG_REPO_DIR) : resolve(__dirname, '..', 'blog-images');
const IMAGE_DIR = resolve(IMG_REPO_DIR, 'image');
const AUDIO_DIR = resolve(IMG_REPO_DIR, 'audio');
const ORIGINAL_DIR = resolve(IMAGE_DIR, 'original');
const IMG_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/';
const AUDIO_BASE_URL = 'https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/audio/';
const GALLERY_JSON = resolve(__dirname, 'src', 'data', 'gallery.json');
const ABOUT_JSON = resolve(__dirname, 'src', 'data', 'about.json');
const FRONTEND_JSON = resolve(__dirname, 'src', 'data', 'frontend.json');
const PORT = parseInt(process.env.PORT, 10) || 4322;
const TOKEN_FILE = resolve(__dirname, '.admin-token');
const ADMIN_HTML = resolve(__dirname, 'admin', 'index.html');
const PRIVATE_ACCESS_FILE = resolve(__dirname, 'src', 'data', 'private-access.json');
const DEFAULT_PRIVATE_PASSWORD = process.env.PRIVATE_ARTICLE_PASSWORD || 'AnAcretiondisk';

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

// ── Auth middleware ──
function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: '未授权' });
}

const app = express();
app.use(express.urlencoded({ extended: true }));

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

// ── Day index helpers（同一天内的发表顺序，1 = 当天第一篇）──
async function readPosts() {
  const files = await readdir(BLOG_DIR);
  const posts = [];
  for (const file of files) {
    if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
    const raw = await readFile(join(BLOG_DIR, file), 'utf-8');
    const { data } = matter(raw);
    const slug = file.replace(/\.(md|mdx)$/, '');
    posts.push({
      slug,
      title: data.title || slug,
      description: data.description || '',
      cover: data.cover || '',
      pubDate: safeDate(data.pubDate),
      tags: data.tags || [],
      draft: data.draft ?? false,
      access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
      dayIndex: data.dayIndex || undefined,
    });
  }
  return posts;
}

function privatePasswordHash(password) {
  return createHash('sha256').update(String(password)).digest('hex');
}

async function readPrivateAccess() {
  try {
    const raw = JSON.parse(await readFile(PRIVATE_ACCESS_FILE, 'utf8'));
    if (typeof raw.passwordHash === 'string' && /^[a-f0-9]{64}$/i.test(raw.passwordHash)) return raw;
  } catch { /* initialize below */ }
  const next = { passwordHash: privatePasswordHash(DEFAULT_PRIVATE_PASSWORD) };
  await mkdir(dirname(PRIVATE_ACCESS_FILE), { recursive: true });
  await writeFile(PRIVATE_ACCESS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
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
  limits: { fileSize: 35 * 1024 * 1024 },
});

// ── API Routes ──

// Auth for all API routes
app.use('/api', auth);

// List / create posts
app.route('/api/posts')
  .get(async (_req, res) => {
    try {
      const posts = await readPosts();
      posts.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || (b.dayIndex || 0) - (a.dayIndex || 0) || b.slug.localeCompare(a.slug));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json(posts);
    } catch (err) {
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .post(upload.none(), async (req, res) => {
    try {
      const { title, description, cover, pubDate, dayIndex, tags, content, draft, access } = req.body;
      const candidate = (req.body.slug
        || (title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
        || 'untitled');
      const checked = validateSlug(candidate);
      if (!checked) return res.status(400).json({ error: 'Slug 包含无效字符或路径非法' });

      const tagArray = (tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
      const finalPubDate = pubDate || new Date().toISOString().split('T')[0];
      const allPosts = await readPosts();
      const di = parseDayIndex(dayIndex);

      const fm = [
        '---',
        `title: ${yamlStr(title)}`,
        `description: ${yamlStr(description)}`,
        `pubDate: ${yamlStr(finalPubDate)}`,
        `dayIndex: ${di ?? nextDayIndex(allPosts, finalPubDate)}`,
      ];
      if (cover?.trim()) fm.push(`cover: ${yamlStr(cover.trim())}`);
      if (tagArray.length) {
        fm.push('tags:');
        tagArray.forEach(t => fm.push(`  - ${yamlStr(t)}`));
      }
      fm.push(`draft: ${draft === 'true'}`);
      fm.push(`access: ${['public', 'authorized', 'admin'].includes(access) ? access : 'public'}`);
      fm.push('---');
      fm.push('');
      fm.push(content || '');

      await writeFile(checked.filePath, fm.join('\n'), 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(201).json({ success: true, slug: checked.slug });
    } catch (err) {
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  });

// Get / update / delete single post
app.route('/api/posts/:slug')
  .get(async (req, res) => {
    try {
      const checked = validateSlug(req.params.slug);
      if (!checked) return res.status(400).json({ error: '无效的 Slug' });
      const raw = await readFile(checked.filePath, 'utf-8');
      const { data, content } = matter(raw);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({
        slug: checked.slug,
        title: data.title || '',
        description: data.description || '',
        cover: data.cover || '',
        pubDate: safeDate(data.pubDate),
        dayIndex: data.dayIndex || undefined,
        tags: data.tags || [],
        draft: data.draft ?? false,
        access: ['public', 'authorized', 'admin'].includes(data.access) ? data.access : 'public',
        content: content.trim(),
      });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: '文章不存在' });
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
      const oldChecked = validateSlug(req.params.slug);
      if (!oldChecked) return res.status(400).json({ error: '无效的 Slug' });

      const { title, description, cover, pubDate, dayIndex, tags, content, draft, access, slug: newSlug } = req.body;
      const finalSlug = newSlug || req.params.slug;
      const newChecked = validateSlug(finalSlug);
      if (!newChecked) return res.status(400).json({ error: '新 Slug 包含无效字符或路径非法' });

      const tagArray = (tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
      const finalPubDate = pubDate || new Date().toISOString().split('T')[0];
      const allPosts = await readPosts();
      const others = allPosts.filter(p => p.slug !== oldChecked.slug);
      const di = parseDayIndex(dayIndex);

      const fm = [
        '---',
        `title: ${yamlStr(title)}`,
        `description: ${yamlStr(description)}`,
        `pubDate: ${yamlStr(finalPubDate)}`,
        `dayIndex: ${di ?? nextDayIndex(others, finalPubDate)}`,
      ];
      if (cover?.trim()) fm.push(`cover: ${yamlStr(cover.trim())}`);
      if (tagArray.length) {
        fm.push('tags:');
        tagArray.forEach(t => fm.push(`  - ${yamlStr(t)}`));
      }
      fm.push(`draft: ${draft === 'true'}`);
      fm.push(`access: ${['public', 'authorized', 'admin'].includes(access) ? access : 'public'}`);
      fm.push('---');
      fm.push('');
      fm.push(content || '');

      // Write new file first, then delete old (safe rename)
      // Windows/macOS 文件系统不区分大小写：仅大小写不同的 slug 指向同一文件，
      // 若按字符串比较判定为重命名，会先写后删导致文章丢失，故需大小写不敏感比较。
      const caseInsensitiveFS = process.platform === 'win32' || process.platform === 'darwin';
      const sameFile = caseInsensitiveFS
        ? newChecked.filePath.toLowerCase() === oldChecked.filePath.toLowerCase()
        : newChecked.filePath === oldChecked.filePath;

      if (!sameFile) {
        // 目标 slug 已被另一篇文章占用时拒绝，避免 writeFile 覆盖已有文件
        try {
          await access(newChecked.filePath);
          return res.status(409).json({ error: `Slug「${newChecked.slug}」已存在，请更换` });
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        await writeFile(newChecked.filePath, fm.join('\n'), 'utf-8');
        await unlink(oldChecked.filePath);
      } else {
        await writeFile(oldChecked.filePath, fm.join('\n'), 'utf-8');
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, slug: newChecked.slug });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: '文章不存在' });
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .delete(async (req, res) => {
    try {
      const checked = validateSlug(req.params.slug);
      if (!checked) return res.status(400).json({ error: '无效的 Slug' });
      await unlink(checked.filePath);
      res.json({ success: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: '文章不存在' });
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  });

// 管理员级文章的访问口令（仅管理面板可读写，文章页只拿构建时生成的哈希）
app.route('/api/private-access')
  .get(async (_req, res) => {
    try {
      const settings = await readPrivateAccess();
      res.json({ configured: Boolean(settings.passwordHash) });
    } catch (err) {
      res.status(500).json({ error: '读取私密文章设置失败' });
    }
  })
  .put(upload.none(), async (req, res) => {
    const password = String(req.body.password || '');
    if (password.length < 4 || password.length > 200) return res.status(400).json({ error: '密码长度需为 4-200 个字符' });
    try {
      await mkdir(dirname(PRIVATE_ACCESS_FILE), { recursive: true });
      await writeFile(PRIVATE_ACCESS_FILE, JSON.stringify({ passwordHash: privatePasswordHash(password) }, null, 2) + '\n', 'utf8');
      res.json({ success: true });
    } catch (err) {
      console.error('Private access error:', err.message);
      res.status(500).json({ error: '保存私密文章密码失败' });
    }
  });

// 把已写入 IMAGE_DIR 的图片文件转成 WebP（png/jpg/jpeg 直接转；heic/heif 先用 libheif(wasm) 解码再转），
// 返回最终文件名；其余格式原样保留
async function saveImageFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const base = filePath.slice(0, -ext.length);
  const outPath = `${base}.webp`;
  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    await sharp(filePath).webp({ quality: 78 }).toFile(outPath);
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
    } finally {
      images.dispose();
    }
  } else {
    return basename(filePath);
  }
  await unlink(filePath).catch(() => {});
  return `${basename(outPath)}`;
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
async function pushImageRepo() {  const run = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, { cwd: IMG_REPO_DIR, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });

  await run('git add -A');
  let hasChanges = false;
  try {
    await run('git diff --cached --quiet');
  } catch {
    hasChanges = true;
  }
  if (!hasChanges) return { pushed: false };

  await run('git commit -m "通过管理面板更新图片"');
  try {
    await run('git push origin main');
    return { pushed: true };
  } catch (pushErr) {
    const msg = pushErr.message || '';
    const err = new Error(msg.includes('Connection') || msg.includes('reset')
      ? '图片已保存到本地图片仓库，但推送 GitHub 失败（网络问题），稍后可再次推送'
      : '图片已保存到本地图片仓库，但推送 GitHub 失败，请检查网络后重试');
    err.status = 500;
    err.detail = msg;
    throw err;
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
            await unlink(`${req.file.path.slice(0, -ext.length)}.webp`).catch(() => {});
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
    if (contentLength > 35 * 1024 * 1024) {
      return res.status(400).json({ error: '远程文件超过 35MB 限制' });
    }

    const buffer = await readLimitedBuffer(remote);
    if (buffer.length > 35 * 1024 * 1024) {
      return res.status(400).json({ error: '下载文件超过 35MB 限制' });
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

// Git push
// Git push（内容推送：仅文章/图片/画廊数据；全量推送：全部改动含代码，排除 reasonix.toml）
async function pushGitChanges({ stageCmd, commitMsg }) {
  const run = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, { cwd: __dirname, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });

  await run(stageCmd);

  // Check if there are staged changes
  let hasChanges = false;
  try {
    await run('git diff --cached --quiet');
  } catch {
    hasChanges = true;
  }

  if (!hasChanges) {
    return { success: true, message: '没有需要推送的更改' };
  }

  // Commit
  await run(`git commit -m "${commitMsg}"`);

  // Push
  try {
    const pushResult = await run('git push origin main');
    return { success: true, message: '推送成功！网站即将更新', detail: pushResult };
  } catch (pushErr) {
    const msg = pushErr.message || '';
    if (msg.includes('Connection') || msg.includes('Could not connect') || msg.includes('reset')) {
      const err = new Error('推送失败：无法连接 GitHub（网络问题），已本地提交，稍后重试');
      err.status = 500;
      throw err;
    }
    const err = new Error('推送失败：已本地提交但推送出错，请检查网络后重试');
    err.status = 500;
    err.detail = msg;
    throw err;
  }
}

// 内容推送：仅文章 / 画廊数据（图片已在上传时推送到图片仓库）
app.post('/api/push', async (_req, res) => {
  try {
    const result = await pushGitChanges({
      stageCmd: 'git add src/content/blog/ src/data/gallery.json src/data/about.json src/data/frontend.json',
      commitMsg: '通过管理面板更新博客',
    });
    // 顺带把图片仓库未推送的变更（如上次推送失败遗留）也推掉，不影响博客推送结果
    try {
      const imgPush = await pushImageRepo();
      if (imgPush.pushed) result.imageRepoPushed = true;
    } catch (imgErr) {
      result.imageRepoWarning = imgErr.message;
    }
    res.json(result);
  } catch (err) {
    console.error('Push Error:', err.message);
    res.status(err.status || 500).json({ error: err.message, detail: err.detail });
  }
});

// 全量推送：所有改动（含页面代码 / 管理面板等），排除 reasonix.toml
app.post('/api/push-full', async (_req, res) => {
  try {
    const result = await pushGitChanges({
      stageCmd: 'git add -A -- . ":(exclude)reasonix.toml"',
      commitMsg: '通过管理面板全量推送',
    });
    res.json(result);
  } catch (err) {
    console.error('Push Full Error:', err.message);
    res.status(err.status || 500).json({ error: err.message, detail: err.detail });
  }
});

// ── Git sync（拉取远端内容）──
// 安全同步策略：仅当「远端领先、本地无未推送提交、工作区干净」可快进时才拉取；
// 其余情况（本地领先 / 分叉 / 工作区有未提交更改）跳过并给出原因，避免覆盖未推送内容或制造冲突。
// 返回 { status: 'up-to-date' | 'pulled' | 'skipped', message, ahead, behind, ... }
async function syncFromRemote() {
  const run = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, { cwd: __dirname, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });

  // 1. 拉取远端引用，网络问题（连接失败/超时）时直接抛出
  await run('git fetch origin');

  // 2. 计算本地与远端的领先 / 落后提交数
  const branch = await run('git rev-parse --abbrev-ref HEAD');
  const remoteBranch = `origin/${branch}`;
  const behind = parseInt(await run(`git rev-list --count HEAD..${remoteBranch}`), 10) || 0;
  const ahead = parseInt(await run(`git rev-list --count ${remoteBranch}..HEAD`), 10) || 0;
  const result = { ahead, behind };

  // 3. 无差异：忽略
  if (behind === 0 && ahead === 0) {
    result.status = 'up-to-date';
    result.message = '本地与远端一致，无需同步';
    return result;
  }

  // 4. 本地领先（含分叉）：不自动拉取，避免覆盖未推送内容
  if (ahead > 0) {
    result.status = 'skipped';
    result.reason = 'local-ahead';
    result.message = behind > 0
      ? `本地与远端已分叉：本地领先 ${ahead} 个提交、远端领先 ${behind} 个提交，请先在管理面板「全量推送」或手动处理`
      : `本地领先远端 ${ahead} 个提交（有未推送内容），无需拉取`;
    return result;
  }

  // 5. 远端领先且本地无未推送提交：检查工作区后快进合并
  const dirty = (await run('git status --porcelain')) !== '';
  if (dirty) {
    result.status = 'skipped';
    result.reason = 'dirty';
    result.message = `远端领先 ${behind} 个提交，但本地有未提交的更改（可能尚未推送），已跳过拉取以避免覆盖`;
    return result;
  }

  const mergeOut = await run(`git merge --ff-only ${remoteBranch}`);
  result.status = 'pulled';
  result.message = `已从远端拉取 ${behind} 个提交并完成同步`;
  result.detail = mergeOut;
  return result;
}

// 手动拉取远端内容（管理面板按钮触发）
app.post('/api/pull', async (_req, res) => {
  try {
    const result = await syncFromRemote();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Pull Error:', err.message);
    res.status(500).json({
      error: /Connection|Could not connect|reset|timed out/i.test(err.message)
        ? '无法连接远端（网络问题），请稍后重试'
        : '拉取失败，请稍后重试',
      detail: err.message,
    });
  }
});

// 启动时自动比对：有版本差异则自动拉取同步，无差异则忽略（不阻塞面板启动）
async function autoSyncOnStart() {
  try {
    const r = await syncFromRemote();
    if (r.status === 'up-to-date') {
      console.log('   [自动同步] 本地与远端一致，无需同步');
    } else if (r.status === 'pulled') {
      console.log(`   [自动同步] 已自动拉取远端更新：${r.message}`);
    } else {
      console.log(`   [自动同步] 已跳过（${r.reason}）：${r.message}`);
    }
  } catch (err) {
    console.log(`   [自动同步] 跳过：无法连接远端（${err.message}），稍后可在管理面板手动「拉取」`);
  }
}

// ── Gallery API ──

// Helper: read/write gallery.json
async function readGallery() {
  try {
    const raw = await readFile(GALLERY_JSON, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeGallery(items) {
  await writeFile(GALLERY_JSON, JSON.stringify(items, null, 2) + '\n', 'utf-8');
}

// List / create gallery items
app.route('/api/gallery')
  .get(async (_req, res) => {
    try {
      const items = await readGallery();
      res.json(items);
    } catch (err) {
      console.error('Gallery API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .post(upload.none(), async (req, res) => {
    try {
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
      await writeGallery(items);
      res.status(201).json({ success: true, item });
    } catch (err) {
      console.error('Gallery API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
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
      console.error('Gallery API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
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
      await writeGallery(items);
      res.json({ success: true, item: items[idx] });
    } catch (err) {
      console.error('Gallery API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .delete(async (req, res) => {
    try {
      const items = await readGallery();
      const idx = items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '图像不存在' });
      items.splice(idx, 1);
      await writeGallery(items);
      res.json({ success: true });
    } catch (err) {
      console.error('Gallery API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
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

// Read about.json (fallback to default empty structure)
async function readAbout() {
  try {
    const raw = await readFile(ABOUT_JSON, 'utf-8');
    return JSON.parse(raw);
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
      res.json(await readAbout());
    } catch (err) {
      console.error('About API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
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
      await writeFile(ABOUT_JSON, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, about: next });
    } catch (err) {
      console.error('About API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
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
  defaultVisualTheme: 'still',
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

const VISUAL_THEMES = new Set(['still', 'fluid', 'minimal', 'trace']);
const IMAGE_POSITIONS = new Set(['center', 'center top', 'center bottom', 'left center', 'right center']);
const DISPLAY_FONTS = new Set(['noto-serif', 'noto-sans', 'kaiti', 'songti', 'sans']);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

async function readFrontend() {
  try {
    const raw = await readFile(FRONTEND_JSON, 'utf-8');
    return { ...FRONTEND_DEFAULTS, ...JSON.parse(raw) };
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
      res.json(await readFrontend());
    } catch (err) {
      console.error('Frontend API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
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
      await writeFile(FRONTEND_JSON, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, frontend: next });
    } catch (err) {
      console.error('Frontend API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  });

// Static files from public/
app.use(express.static(join(__dirname, 'public')));

// Admin panel
app.get(['/admin', '/admin/', '/admin/index.html'], async (_req, res) => {
  try {
    const html = await readFile(ADMIN_HTML, 'utf8');
    const injected = html.replace("const TOKEN = '__ADMIN_TOKEN__';", `const TOKEN = ${JSON.stringify(ADMIN_TOKEN)};`);
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
