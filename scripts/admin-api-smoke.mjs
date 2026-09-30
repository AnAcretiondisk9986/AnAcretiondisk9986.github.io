/**
 * 管理 API 冒烟测试。
 *
 * 在隔离的临时目录启动一份 admin-server（独立端口 + 独立 data/blog 目录），
 * 覆盖文章增删改查、版本冲突、JSON 配置保存与冲突、同步状态接口。
 * 不会触碰真实文章、图片仓库或真实配置，也不会执行真实 git 推送。
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKEN = 'admin-api-smoke-token';
const PORT = 4400 + Math.floor(Math.random() * 400);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + String(extra).slice(0, 160) + ']' : ''));
  if (!cond) failures += 1;
};

const form = (fields) => new URLSearchParams(fields);
const JSON_HEADERS = { 'x-admin-token': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' };
const HASH_RE = /^[a-f0-9]{64}$/;

const root = await mkdtemp(join(tmpdir(), 'blog-admin-api-'));
const dataDir = join(root, 'data');
const blogDir = join(root, 'blog');
const backupDir = join(root, 'backups');
const revisionsDir = join(root, 'revisions');
await mkdir(dataDir, { recursive: true });
await mkdir(blogDir, { recursive: true });
await writeFile(join(dataDir, 'gallery.json'), '[]\n', 'utf8');
await writeFile(join(dataDir, 'about.json'), '{}\n', 'utf8');
await writeFile(join(dataDir, 'frontend.json'), '{}\n', 'utf8');
await writeFile(join(dataDir, 'private-access.json'), `${JSON.stringify({ passwordHash: 'a'.repeat(64) })}\n`, 'utf8');

const child = spawn(process.execPath, [join(ROOT, 'admin-server.mjs')], {
  env: {
    ...process.env,
    ADMIN_DATA_DIR: dataDir,
    ADMIN_BLOG_DIR: blogDir,
    ADMIN_BACKUP_DIR: backupDir,
    ADMIN_REVISIONS_DIR: revisionsDir,
    ADMIN_TOKEN: TOKEN,
    ADMIN_NO_OPEN: '1',
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

const base = `http://127.0.0.1:${PORT}`;
const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { 'x-admin-token': TOKEN, ...(opts.headers || {}) } });
const apiForm = (path, method, fields) => api(path, { method, body: form(fields), headers: JSON_HEADERS });

async function waitReady(timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${base}/api/sync/status`, { headers: { 'x-admin-token': TOKEN } });
      if (res.status < 600) return;
    } catch { /* 尚未监听 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`管理服务启动超时\n${serverLog}`);
}

try {
  await waitReady();

  // ── 尚未授权 ──
  const unauth = await fetch(`${base}/api/posts`);
  check('未携带口令返回 401', unauth.status === 401, unauth.status);

  // ── 文章 ──
  const list0 = await (await api('/api/posts')).json();
  check('文章列表初始为空数组', Array.isArray(list0) && list0.length === 0);

  const createRes = await apiForm('/api/posts', 'POST', { title: '冒烟测试文章', content: '# 你好', pubDate: '2026-09-30', tags: 'a,b', scheduledAt: '2030-01-01T00:00:00.000Z' });
  const created = await createRes.json();
  check('新建文章返回 201 与 contentHash', createRes.status === 201 && HASH_RE.test(created.contentHash || ''), JSON.stringify(created));
  const slug = created.slug;

  const got = await (await api(`/api/posts/${encodeURIComponent(slug)}`)).json();
  check('读取单篇文章 hash 与新建一致', got.contentHash === created.contentHash && got.title === '冒烟测试文章', got.title);
  check('定时发布字段回读且未到时间不公开', Boolean(got.scheduledAt) && got.hasPublicPage === false, `scheduledAt=${got.scheduledAt} public=${got.hasPublicPage}`);

  const updRes = await apiForm(`/api/posts/${encodeURIComponent(slug)}`, 'PUT', { title: '冒烟测试文章 2', content: '# 修改', pubDate: '2026-09-30', expectedHash: created.contentHash });
  const updated = await updRes.json();
  check('带正确 hash 更新成功且 hash 变化', updRes.status === 200 && updated.contentHash !== created.contentHash, updated.contentHash);

  const noHash = await apiForm(`/api/posts/${encodeURIComponent(slug)}`, 'PUT', { title: 'x', content: 'y', pubDate: '2026-09-30' });
  check('缺少 hash 更新返回 428', noHash.status === 428, noHash.status);

  const afterUpdate = await (await api(`/api/posts/${encodeURIComponent(slug)}`)).json();
  check('更新未携带定时字段时清除', !afterUpdate.scheduledAt && afterUpdate.hasPublicPage === true, `scheduledAt=${afterUpdate.scheduledAt} public=${afterUpdate.hasPublicPage}`);

  const revRes = await api(`/api/posts/${encodeURIComponent(slug)}/revisions`);
  const revData = await revRes.json();
  check('保存后产生修订历史', revRes.status === 200 && Array.isArray(revData.revisions) && revData.revisions.length >= 1, JSON.stringify(revData.revisions && revData.revisions.length));
  if (revData.revisions && revData.revisions.length) {
    const revContent = await (await api(`/api/posts/${encodeURIComponent(slug)}/revisions/${encodeURIComponent(revData.revisions[0].id)}`)).json();
    check('可读取修订内容', typeof revContent.content === 'string' && revContent.content.includes('# 你好'), String(revContent.content || '').slice(0, 40));
  }

  const conflict = await apiForm(`/api/posts/${encodeURIComponent(slug)}`, 'PUT', { title: 'x', content: 'y', pubDate: '2026-09-30', expectedHash: 'f'.repeat(64) });
  const conflictBody = await conflict.json();
  check('错误 hash 更新返回 409 且不覆盖', conflict.status === 409 && conflictBody.code === 'VERSION_CONFLICT');

  const afterConflict = await (await api(`/api/posts/${encodeURIComponent(slug)}`)).json();
  check('冲突后文章内容未被覆盖', afterConflict.title === '冒烟测试文章 2' && afterConflict.contentHash === updated.contentHash);

  const dup = await apiForm('/api/posts', 'POST', { title: '重复 slug', slug });
  check('重复 slug 返回 409', dup.status === 409, dup.status);

  const delRes = await api(`/api/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  check('删除文章成功', delRes.status === 200);
  check('删除后列表为空', (await (await api('/api/posts')).json()).length === 0);

  // ── 画廊 ──
  const gList = await api('/api/gallery');
  const galleryHash0 = gList.headers.get('x-content-hash') || '';
  check('画廊列表返回 x-content-hash 响应头', gList.status === 200 && HASH_RE.test(galleryHash0), galleryHash0);

  const gNoHash = await apiForm('/api/gallery', 'POST', { src: 'https://cdn.example.com/a.webp', title: '图 A' });
  check('画廊新建缺少 hash 返回 428', gNoHash.status === 428, gNoHash.status);

  const gCreate = await apiForm('/api/gallery', 'POST', { src: 'https://cdn.example.com/a.webp', title: '图 A', expectedHash: galleryHash0 });
  const gCreated = await gCreate.json();
  check('画廊带正确 hash 新建成功', gCreate.status === 201 && Boolean(gCreated.item?.id) && HASH_RE.test(gCreated.contentHash || ''), JSON.stringify(gCreated).slice(0, 120));

  const gStaleDelete = await api(`/api/gallery/${encodeURIComponent(gCreated.item.id)}?expectedHash=${galleryHash0}`, { method: 'DELETE' });
  check('画廊使用过期 hash 删除返回 409', gStaleDelete.status === 409, gStaleDelete.status);

  const gList2 = await api('/api/gallery');
  check('画廊列表包含新建项', (await gList2.json()).length === 1);

  const gDelete = await api(`/api/gallery/${encodeURIComponent(gCreated.item.id)}?expectedHash=${gCreated.contentHash}`, { method: 'DELETE' });
  check('画廊使用最新 hash 删除成功', gDelete.status === 200 && Boolean((await gDelete.json()).contentHash));

  const galleryRaw = await readFile(join(dataDir, 'gallery.json'), 'utf8');
  check('画廊文件始终是合法 JSON', Array.isArray(JSON.parse(galleryRaw)));

  // ── 关于页 ──
  const about0 = await (await api('/api/about')).json();
  check('关于页 GET 返回 contentHash', HASH_RE.test(about0.contentHash || ''), about0.contentHash);
  const aboutPut = await apiForm('/api/about', 'PUT', { title: '关于冒烟', paragraphs: JSON.stringify(['第一段']), expectedHash: about0.contentHash });
  const aboutSaved = await aboutPut.json();
  check('关于页保存成功并返回新 hash', aboutPut.status === 200 && HASH_RE.test(aboutSaved.contentHash || '') && aboutSaved.contentHash !== about0.contentHash);
  const aboutConflict = await apiForm('/api/about', 'PUT', { title: '冲突', expectedHash: about0.contentHash });
  check('关于页旧 hash 保存返回 409', aboutConflict.status === 409 && (await aboutConflict.json()).code === 'VERSION_CONFLICT');
  const aboutNoHash = await apiForm('/api/about', 'PUT', { title: '缺 hash' });
  check('关于页缺少 hash 返回 428', aboutNoHash.status === 428);

  // ── 前端定制 ──
  const fe0 = await (await api('/api/frontend')).json();
  check('前端定制 GET 返回 contentHash', HASH_RE.test(fe0.contentHash || ''), fe0.contentHash);
  const fePut = await apiForm('/api/frontend', 'PUT', { siteName: '冒烟站点', expectedHash: fe0.contentHash });
  const feSaved = await fePut.json();
  check('前端定制保存成功', fePut.status === 200 && feSaved.frontend?.siteName === '冒烟站点');

  // ── 访问控制 ──
  const paPut = await apiForm('/api/private-access', 'PUT', { password: 'smoke-pass' });
  check('访问控制密码保存成功', paPut.status === 200, paPut.status);

  // ── 同步状态 / 操作日志 ──
  const status = await (await api('/api/sync/status')).json();
  check('同步状态接口返回 state 与 label', status.ok === true && typeof status.state === 'string' && typeof status.stateLabel === 'string', status.state);
  const preview = await (await api('/api/sync/preview?kind=content')).json();
  check('推送预览接口可用', preview.ok === true && preview.kind === 'content');
  const pullPreview = await (await api('/api/sync/pull-preview')).json();
  check('拉取预览接口可用', pullPreview.ok === true);
  const ops = await (await api('/api/operations')).json();
  check('操作日志接口可用', ops.ok === true && Array.isArray(ops.operations));

  // ── 备份 ──
  const { readdir } = await import('node:fs/promises');
  const backups = await readdir(backupDir).catch(() => []);
  check('配置覆盖前生成备份', backups.length > 0, backups.join(','));
} catch (err) {
  check('冒烟测试流程未抛异常', false, err.stack || err.message);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  await rm(root, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 项失败 ===`);
process.exit(failures === 0 ? 0 : 1);
