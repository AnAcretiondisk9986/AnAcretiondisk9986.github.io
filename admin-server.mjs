import express from 'express';
import multer from 'multer';
import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = resolve(__dirname, 'src', 'content', 'blog');
const IMAGE_DIR = resolve(__dirname, 'public', 'image');
const PORT = 4322;
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

// ── Multer: image-only upload ──
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        mkdir(IMAGE_DIR, { recursive: true }).then(() => cb(null, IMAGE_DIR), err => cb(err));
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
      cb(new Error('仅支持 PNG / JPEG / GIF / WebP / SVG 图片格式'), false);
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── API Routes ──

// Auth for all API routes
app.use('/api', auth);

// List / create posts
app.route('/api/posts')
  .get(async (_req, res) => {
    try {
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
          pubDate: safeDate(data.pubDate),
          tags: data.tags || [],
          draft: data.draft ?? false,
        });
      }
      posts.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || b.slug.localeCompare(a.slug));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json(posts);
    } catch (err) {
      console.error('API Error:', err.message);
      res.status(500).json({ error: '服务器内部错误' });
    }
  })
  .post(upload.none(), async (req, res) => {
    try {
      const { title, description, pubDate, tags, content, draft } = req.body;
      const candidate = (req.body.slug
        || (title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
        || 'untitled');
      const checked = validateSlug(candidate);
      if (!checked) return res.status(400).json({ error: 'Slug 包含无效字符或路径非法' });

      const tagArray = (tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);

      const fm = [
        '---',
        `title: ${yamlStr(title)}`,
        `description: ${yamlStr(description)}`,
        `pubDate: ${yamlStr(pubDate || new Date().toISOString().split('T')[0])}`,
      ];
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
        pubDate: safeDate(data.pubDate),
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

      const { title, description, pubDate, tags, content, draft, slug: newSlug } = req.body;
      const finalSlug = newSlug || req.params.slug;
      const newChecked = validateSlug(finalSlug);
      if (!newChecked) return res.status(400).json({ error: '新 Slug 包含无效字符或路径非法' });

      const tagArray = (tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);

      const fm = [
        '---',
        `title: ${yamlStr(title)}`,
        `description: ${yamlStr(description)}`,
        `pubDate: ${yamlStr(pubDate || new Date().toISOString().split('T')[0])}`,
      ];
      if (tagArray.length) {
        fm.push('tags:');
        tagArray.forEach(t => fm.push(`  - ${yamlStr(t)}`));
      }
      fm.push(`draft: ${draft === 'true'}`);
      fm.push('---');
      fm.push('');
      fm.push(content || '');

      // Write new file first, then delete old (safe rename)
      const isRename = oldChecked.filePath !== newChecked.filePath;
      if (isRename) {
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

// Image upload
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err) {
      console.error('Upload Error:', err.message);
      if (err.message && err.message.includes('仅支持')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: '上传失败' });
    }
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    res.status(201).json({ success: true, url: `/image/${req.file.filename}` });
  });
});

// Static files from public/
app.use(express.static(join(__dirname, 'public')));

// Admin panel
app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, 'admin', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/admin`;
  console.log(`\n📚 博客管理面板已启动: ${url}\n`);
  console.log(`   仅限本地使用 — 请勿暴露到公网\n`);

  // Auto-open browser
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log('   请手动打开浏览器访问上述地址');
  });
});
