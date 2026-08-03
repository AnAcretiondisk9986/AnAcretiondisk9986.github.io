import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { readdir, readFile, writeFile, unlink, mkdir, access, copyFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { join, dirname, extname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'acr-admin';

// ── Auth middleware ──
function auth(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  if (req.path === '/admin' && req.method === 'GET') return next();
  const token = req.headers['x-admin-token'] || req.query.token || '';
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: '未授权' });
}

const app = express();
app.use(express.urlencoded({ extended: true }));

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
      dayIndex: data.dayIndex || undefined,
    });
  }
  return posts;
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
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a'];
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
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PNG / JPEG / GIF / WebP / SVG 图片与 MP3 / FLAC / OGG / WAV / M4A 音频'), false);
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
      const { title, description, cover, pubDate, dayIndex, tags, content, draft } = req.body;
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

      const { title, description, cover, pubDate, dayIndex, tags, content, draft, slug: newSlug } = req.body;
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

// 把已写入 IMAGE_DIR 的图片文件转成 WebP（png/jpg/jpeg），返回最终文件名；其余格式原样保留
async function saveImageFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return basename(filePath);
  const base = filePath.slice(0, -ext.length);
  const outPath = `${base}.webp`;
  await sharp(filePath).webp({ quality: 78 }).toFile(outPath);
  await unlink(filePath);
  return `${basename(outPath)}`;
}

// 归档原图到 image/original/（仅转码格式 png/jpg/jpeg 才有归档必要；gif/svg/webp 原样保留，主图即原图）。
// 返回归档后的文件名（不含目录），或 null 表示无需归档。
async function archiveOriginal(filePath, name) {
  const ext = extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
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
// 上传成功后主动请求一次（后台进行，不阻塞响应），让链接立即可用；失败仅记日志不影响上传结果
function warmJsDelivr(url) {
  fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(90000) })
    .then(r => {
      if (!r.ok) console.error('jsDelivr warm failed:', url, r.status);
      else console.log('jsDelivr warmed:', url);
    })
    .catch(e => console.error('jsDelivr warm error:', url, e.message));
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
      const push = await pushImageRepo();
      const base = isAudio ? AUDIO_BASE_URL : IMG_BASE_URL;
      const publicUrl = `${base}${encodeURIComponent(filename)}`;
      // 上传成功后后台预热 jsDelivr 缓存（不阻塞响应），避免用户立即播放时首次访问失败
      warmJsDelivr(publicUrl);
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
      const r = await fetch(probeUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000), headers });
      contentType = r.headers.get('content-type') || '';
      size = Number(r.headers.get('content-length')) || 0;
      ok = r.ok && (contentType.startsWith('audio/') || contentType.includes('mpeg') || contentType.includes('octet-stream'));
      if (ok && idMatch) note = '网易云歌曲：经官方外链直链播放';
    } catch { /* HEAD 不可用，走 GET Range */ }
    // 2) GET Range 前 2KB，按 Content-Type 与音频魔数兜底
    if (!ok) {
      try {
        const r = await fetch(probeUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { ...headers, Range: 'bytes=0-2047' } });
        contentType = r.headers.get('content-type') || '';
        size = Number(r.headers.get('content-length')) || 0;
        ok = r.status === 206 || r.ok;
        if (ok && !contentType.startsWith('audio/')) {
          const head = Buffer.from(await r.arrayBuffer()).subarray(0, 12).toString('latin1');
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

    const remote = await fetch(url.trim(), {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });

    if (!remote.ok) {
      return res.status(502).json({ error: `远程服务器返回 ${remote.status}` });
    }

    const contentType = (remote.headers.get('content-type') || '').split(';')[0].trim();
    if (!ALLOWED_MIME.includes(contentType)) {
      return res.status(400).json({ error: `远程文件不是支持的图片格式（${contentType || '未知'}）` });
    }

    const contentLength = parseInt(remote.headers.get('content-length') || '0', 10);
    if (contentLength > 35 * 1024 * 1024) {
      return res.status(400).json({ error: '远程文件超过 35MB 限制' });
    }

    const buffer = Buffer.from(await remote.arrayBuffer());
    if (buffer.length > 35 * 1024 * 1024) {
      return res.status(400).json({ error: '下载文件超过 35MB 限制' });
    }

    // Generate safe filename
    const urlPath = parsed.pathname;
    const rawName = urlPath.split('/').pop() || 'import';
    const safeName = rawName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
      .substring(0, 60);
    const ext = extname(rawName).toLowerCase();
    const finalExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext) ? ext : '.jpg';
    const filename = `${safeName}_${Date.now()}${finalExt}`;

    await mkdir(IMAGE_DIR, { recursive: true });
    const filePath = join(IMAGE_DIR, filename);
    await writeFile(filePath, buffer);
    const origName = await archiveOriginal(filePath, filename);
    const savedName = await saveImageFile(filePath);
    const push = await pushImageRepo();

    res.status(201).json({
      success: true,
      url: `${IMG_BASE_URL}${encodeURIComponent(savedName)}`,
      originalUrl: origName ? `${IMG_BASE_URL}original/${encodeURIComponent(origName)}` : '',
      pushed: push.pushed,
    });
  } catch (err) {
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
      if (sourceUrl) item.sourceUrl = sourceUrl.trim();
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
        sourceUrl: (sourceUrl || '').trim() || undefined,
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
      };
      await writeFile(ABOUT_JSON, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ success: true, about: next });
    } catch (err) {
      console.error('About API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
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
        primaryCtaHref: strField('primaryCtaHref', 1000),
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
app.use('/admin', express.static(join(__dirname, 'admin')));
app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, 'admin', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/admin`;
  console.log(`\n📚 博客管理面板已启动: ${url}\n`);
  console.log(`   仅限本地使用 — 请勿暴露到公网\n`);

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
