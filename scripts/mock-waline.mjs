/**
 * mock-waline.mjs — 本地 Waline 兼容服务（仅用于开发预览）
 *
 * 与真实 Waline 服务端 API 契约保持一致：
 *   GET  /api/comment?path=&page=&pageSize=&sortBy=         公开评论列表
 *   GET  /api/comment?type=count&url=                       评论数
 *   GET  /api/comment?type=list&token=                      管理列表（需 token）
 *   POST /api/comment                                       发布评论（JSON body）
 *   DELETE /api/comment/:objectId?token=                    删除评论（需 token）
 *   POST /api/token                                         管理员登录换 token
 *
 * 数据存储在 .mock-waline/comments.json（已 gitignore）。
 * 运行：node scripts/mock-waline.mjs    （默认 127.0.0.1:8765）
 * 管理账号：MOCK_ADMIN_EMAIL / MOCK_ADMIN_PASSWORD（默认 admin@acretiondisk.local / admin123）
 *
 * 真实部署时请使用 Waline（见 docs/WALINE_DEPLOY.md），IP 属地由服务端 ip2region
 * 解析（中国显示省份、国外显示国家）；本 mock 因本地无公网 IP，用示例属地轮换模拟。
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.mock-waline');
const DATA_FILE = path.join(DATA_DIR, 'comments.json');

const PORT = Number(process.env.MOCK_WALINE_PORT || 8765);
const ADMIN_EMAIL = process.env.MOCK_ADMIN_EMAIL || 'admin@acretiondisk.local';
const ADMIN_PASSWORD = process.env.MOCK_ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = 'mock-admin-token';
const PAGE_PATH = '/guestbook/';
const MAX_LEN = 300;

// 示例 IP 属地：中国省份 + 国外国家，轮换展示两种形态
const REGION_POOL = [
  '浙江', '广东', '北京', '上海', '江苏', '四川', '湖北', '山东', '福建',
  '湖南', '陕西', '河南', '美国', '日本', '新加坡', '德国', '澳大利亚', '加拿大',
];

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(comments) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(comments, null, 2), 'utf8');
}

/** 极简纯文本 → HTML（模拟 Waline 的 markdown 渲染结果；仅用于本地预览） */
function toHtml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

/** 公开视角：剥离邮箱等敏感字段，补充属地/时间/头像 */
function publicView(comment) {
  const { mail, ip, user_id, ...rest } = comment;
  return {
    ...rest,
    addr: comment.addr,
    avatar: '',
    time: new Date(comment.insertedAt).getTime(),
  };
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/** 与 Waline 一致：支持 Authorization: Bearer 或 state/token 查询参数 */
function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.query.token || req.query.state || '';
}

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,PUT,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-waline-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/comment', (req, res) => {
  const { type, path: p, page = 1, pageSize = 20, sortBy, token, url } = req.query;
  const comments = load();

  if (type === 'count') {
    const target = Array.isArray(url) ? url : String(url || '');
    const paths = target.split(',').map((s) => s.trim()).filter(Boolean);
    const data = paths.length
      ? paths.map((u) => comments.filter((c) => c.url === u && c.status === 'approved').length)
      : comments.filter((c) => c.status === 'approved').length;
    return res.json({ errno: 0, data });
  }

  if (type === 'list') {
    if (getToken(req) !== ADMIN_TOKEN) return res.status(401).json({ errno: 401, errmsg: 'Unauthorized' });
    const list = [...comments].reverse();
    return res.json({
      errno: 0,
      data: {
        page: 1,
        totalPages: 1,
        pageSize: list.length || 1,
        data: list.map((c) => ({
          ...publicView(c),
          mail: c.mail,
          ip: c.ip,
          addr: c.addr, // 管理员视角：省市完整属地（mock 简化为省份）
        })),
      },
    });
  }

  if (type === 'recent') {
    const data = [...comments]
      .filter((c) => c.status === 'approved')
      .reverse()
      .slice(0, Number(req.query.count) || 10)
      .map((c) => ({ ...publicView(c), url: c.url }));
    return res.json({ errno: 0, data });
  }

  // 公开列表：仅 approved，按时间正序（楼层从旧到新，类 B 站）
  const approved = comments
    .filter((c) => c.status === 'approved' && (!p || c.url === p))
    .sort((a, b) => new Date(a.insertedAt) - new Date(b.insertedAt));

  if (String(sortBy || '') === 'insertedAt_desc') approved.reverse();

  const pageNum = Math.max(Number(page) || 1, 1);
  const size = Math.max(Number(pageSize) || 20, 1);
  const totalPages = Math.max(Math.ceil(approved.length / size), 1);
  const data = approved.slice((pageNum - 1) * size, pageNum * size).map(publicView);

  res.json({
    errno: 0,
    data: { page: pageNum, totalPages, pageSize: size, count: approved.length, data },
  });
});

app.post('/api/comment', (req, res) => {
  const { url, nick, comment, mail, link, ua } = req.body || {};
  if (!url || !String(comment || '').trim()) {
    return res.status(400).json({ errno: 400, errmsg: 'Missing required fields' });
  }
  if (String(comment).length > MAX_LEN) {
    return res.status(400).json({ errno: 400, errmsg: `Comment too long! ${MAX_LEN} chars max` });
  }

  const ip = `203.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  const record = {
    objectId: randomUUID().slice(0, 12),
    nick: String(nick || '').trim().slice(0, 30) || '匿名访客',
    comment: String(comment),
    mail: String(mail || '').slice(0, 254),
    link: String(link || '').slice(0, 254),
    ua: String(ua || ''),
    url: String(url),
    ip,
    addr: REGION_POOL[Math.floor(Math.random() * REGION_POOL.length)],
    status: 'approved',
    insertedAt: new Date().toISOString(),
    like: 0,
  };

  const comments = load();
  comments.push(record);
  save(comments);

  res.json({ errno: 0, data: { ...publicView(record), comment: toHtml(record.comment) } });
});

app.delete('/api/comment/:id', (req, res) => {
  if (getToken(req) !== ADMIN_TOKEN) return res.status(401).json({ errno: 401, errmsg: 'Unauthorized' });
  const comments = load();
  const next = comments.filter((c) => c.objectId !== req.params.id);
  if (next.length === comments.length) return res.status(404).json({ errno: 404, errmsg: 'Not Found' });
  save(next);
  res.json({ errno: 0, data: { ok: true } });
});

app.post('/api/token', (req, res) => {
  const { email, password } = req.body || {};
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      errno: 0,
      data: { token: ADMIN_TOKEN, email, display_name: 'Mock Admin', type: 'administrator' },
    });
  }
  res.status(401).json({ errno: 401, errmsg: 'Incorrect email or password' });
});

app.get('/api/token', (req, res) => {
  if (getToken(req) !== ADMIN_TOKEN) return res.status(401).json({ errno: 401, errmsg: 'Unauthorized' });
  res.json({ errno: 0, data: { objectId: 'mock-admin', email: ADMIN_EMAIL, display_name: 'Mock Admin', type: 'administrator' } });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-waline] http://127.0.0.1:${PORT}`);
  console.log(`[mock-waline] admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`[mock-waline] data: ${DATA_FILE}`);
});
