import express from 'express';
import multer from 'multer';
import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, 'src', 'content', 'blog');
const IMAGE_DIR = join(__dirname, 'public', 'image');
const PORT = 4322;

const app = express();

// Multer for image upload
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await mkdir(IMAGE_DIR, { recursive: true });
      cb(null, IMAGE_DIR);
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
        .substring(0, 60);
      const ext = extname(file.originalname);
      cb(null, `${safeName}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// === API Routes ===

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
          pubDate: data.pubDate ? new Date(data.pubDate).toISOString().split('T')[0] : '',
          tags: data.tags || [],
          draft: data.draft ?? false,
        });
      }
      posts.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || b.slug.localeCompare(a.slug));
      res.json(posts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
  .post(upload.none(), async (req, res) => {
    try {
      const { title, description, pubDate, tags, content, draft } = req.body;
      const slug = req.body.slug || title
        ?.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
        || 'untitled';
      const tagArray = (tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);

      const fm = [
        '---',
        `title: "${(title || '').replace(/"/g, '\\"')}"`,
        `description: "${(description || '').replace(/"/g, '\\"')}"`,
        `pubDate: ${pubDate || new Date().toISOString().split('T')[0]}`,
      ];
      if (tagArray.length) {
        fm.push('tags:');
        tagArray.forEach(t => fm.push(`  - ${t}`));
      }
      fm.push(`draft: ${draft === 'true'}`);
      fm.push('---');
      fm.push('');
      fm.push(content || '');

      await writeFile(join(BLOG_DIR, `${slug}.md`), fm.join('\n'), 'utf-8');
      res.status(201).json({ success: true, slug });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// Get / update / delete single post
app.route('/api/posts/:slug')
  .get(async (req, res) => {
    try {
      const filePath = join(BLOG_DIR, `${req.params.slug}.md`);
      const raw = await readFile(filePath, 'utf-8');
      const { data, content } = matter(raw);
      res.json({
        slug: req.params.slug,
        title: data.title || '',
        description: data.description || '',
        pubDate: data.pubDate ? new Date(data.pubDate).toISOString().split('T')[0] : '',
        tags: data.tags || [],
        draft: data.draft ?? false,
        content: content.trim(),
      });
    } catch {
      res.status(404).json({ error: '文章不存在' });
    }
  })
  .put(upload.none(), async (req, res) => {
    try {
      const { title, description, pubDate, tags, content, draft, slug: newSlug } = req.body;
      const finalSlug = newSlug || req.params.slug;
      const tagArray = (tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);

      const fm = [
        '---',
        `title: "${(title || '').replace(/"/g, '\\"')}"`,
        `description: "${(description || '').replace(/"/g, '\\"')}"`,
        `pubDate: ${pubDate || new Date().toISOString().split('T')[0]}`,
      ];
      if (tagArray.length) {
        fm.push('tags:');
        tagArray.forEach(t => fm.push(`  - ${t}`));
      }
      fm.push(`draft: ${draft === 'true'}`);
      fm.push('---');
      fm.push('');
      fm.push(content || '');

      const oldPath = join(BLOG_DIR, `${req.params.slug}.md`);
      const newPath = join(BLOG_DIR, `${finalSlug}.md`);
      if (oldPath !== newPath) await unlink(oldPath);
      await writeFile(newPath, fm.join('\n'), 'utf-8');

      res.json({ success: true, slug: finalSlug });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
  .delete(async (req, res) => {
    try {
      await unlink(join(BLOG_DIR, `${req.params.slug}.md`));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// Image upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' });
  res.status(201).json({ success: true, url: `/image/${req.file.filename}` });
});

// Static files from public/
app.use(express.static(join(__dirname, 'public')));

// Admin panel
app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, 'admin', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n📚 博客管理面板已启动: http://localhost:${PORT}/admin\n`);
});
