/**
 * 新功能核心算法与 Worker 契约单元测试（Node 原生 node:test，无需构建）：
 *   1. categories/projects/report/academics 纯数据聚合逻辑
 *   2. Cloudflare Worker (scripts/interact-worker.js) 点赞计数、评论读写与反垃圾校验
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// 解析 Astro TS 模块里无扩展名的相对导入（如 from './horizon' → './horizon.ts'）
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const tsPath = resolve(parentDir, `${specifier}.ts`);
      if (existsSync(tsPath)) {
        return { shortCircuit: true, url: pathToFileURL(tsPath).href };
      }
    }
    return nextResolve(specifier, context);
  },
});

const { normalizeCategoryList, normalizePostCategories, buildCategoryStats } = await import('../src/lib/categories.ts');
const { normalizeProjects, matchProjectPosts } = await import('../src/lib/projects.ts');
const { computePeriodTelemetry, normalizeReportPayload } = await import('../src/lib/report.ts');
const { computeAcademicTelemetry, resolveCoursePosts } = await import('../src/lib/academics.ts');
const { handleInteractRequest } = await import('./interact-worker.js');

function createMemoryKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, val) {
      map.set(key, String(val));
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

test('categories helpers normalize and count uncategorized posts', () => {
  const cats = normalizeCategoryList([
    { id: 'tech', name: '技术工程', order: 2, color: '#8fb3ff' },
    { id: 'ai', name: 'AI 与工作流', order: 1, color: '#ff5a1a' },
    { id: 'uncategorized', name: '非法保留值' },
  ]);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].id, 'ai');
  assert.deepEqual(normalizePostCategories([' 技术工程 ', '技术工程', '']), ['技术工程']);

  const posts = [
    { id: 'p1', body: 'hello world', data: { pubDate: new Date('2026-11-01'), tags: ['Astro'], categories: ['技术工程'] } },
    { id: 'p2', body: 'no class', data: { pubDate: new Date('2026-11-02'), tags: [], categories: [] } },
  ];
  const stats = buildCategoryStats(cats, posts);
  assert.equal(stats.uncategorizedCount, 1);
  assert.equal(stats.buckets.find((x) => x.name === '技术工程')?.count, 1);
});

test('projects matching merges explicit postSlugs and postTags without duplicates', () => {
  const projs = normalizeProjects([
    { id: 'p-lab', name: 'HORIZON', status: 'active', kind: 'web', postSlugs: ['post-a'], postTags: ['HORIZON'], featured: true },
  ]);
  const posts = [
    { id: 'post-a', data: { title: 'Post A', pubDate: new Date('2026-11-05'), tags: ['HORIZON'] } },
    { id: 'post-b', data: { title: 'Post B', pubDate: new Date('2026-11-06'), tags: ['HORIZON'] } },
    { id: 'post-c', data: { title: 'Post C', pubDate: new Date('2026-11-07'), tags: ['Other'] } },
  ];
  const matched = matchProjectPosts(projs[0], posts);
  assert.deepEqual(matched.map((p) => p.id), ['post-a', 'post-b']);
});

test('report period telemetry aggregates posts, categories, dailies, and gallery in window', () => {
  const repDoc = normalizeReportPayload({
    activeReportId: '2026-annual',
    reports: [
      { id: '2026-annual', title: '2026 年报', dateStart: '2026-01-01', dateEnd: '2026-12-31', published: true },
    ],
  });
  const posts = [
    { id: 'p-in', body: '今天写了一段代码 hello', data: { title: 'In Window', pubDate: new Date('2026-10-01'), categories: ['技术工程'], tags: ['Code'] } },
    { id: 'p-out', body: '去年的记录', data: { title: 'Out Window', pubDate: new Date('2025-05-01'), categories: [], tags: ['Old'] } },
  ];
  const dailies = [
    { id: 'd1', createdAt: '2026-10-02T08:00:00Z', images: [{ src: 'a.webp' }, { src: 'b.webp' }] },
    { id: 'd2', createdAt: '2025-12-01T08:00:00Z', images: [{ src: 'old.webp' }] },
  ];
  const gallery = [{ id: 'g1', date: '2026-10-03' }];
  const tele = computePeriodTelemetry({
    dateStart: repDoc.reports[0].dateStart,
    dateEnd: repDoc.reports[0].dateEnd,
    posts,
    dailies,
    gallery,
  });
  assert.equal(tele.postCount, 1);
  assert.equal(tele.dailyCount, 1);
  assert.equal(tele.frameCount, 2);
  assert.equal(tele.galleryCount, 1);
  assert.equal(tele.longestPost?.id, 'p-in');
});

test('academics telemetry computes weighted GPA and resolves post links', () => {
  const data = {
    meta: { title: '学业', subtitle: '', updatedAt: '', activeTermLabel: '' },
    tracks: {
      orig: { id: 'orig', code: 'T1', name: '信息管理', span: '', note: '' },
      clin: { id: 'clin', code: 'T2', name: '临床医学', span: '', note: '' },
    },
    transfer: { date: '2026.09', title: '转专业', summary: '', posts: ['p1'] },
    tools: [],
    semesters: [
      { id: 'orig-1', track: 'orig', year: '2025-2026', term: '1', label: '原大一上', sub: '', hue: 200 },
      { id: 'clin-1', track: 'clin', year: '2026-2027', term: '1', label: '新大一上', sub: '', hue: 20 },
    ],
    courses: [
      { id: 'c1', code: 'A1', name: '高数', credits: 4, dept: '数学', nature: '必修', semesterId: 'orig-1', track: 'orig', status: 'completed', gpa: 4.0, posts: ['p1'] },
      { id: 'c2', code: 'A2', name: '英语', credits: 2, dept: '外语', nature: '必修', semesterId: 'orig-1', track: 'orig', status: 'completed', gpa: 3.1 },
      { id: 'c3', code: 'B1', name: '组胚', credits: 3, dept: '基础', nature: '必修', semesterId: 'clin-1', track: 'clin', status: 'active' },
    ],
  };
  const tele = computeAcademicTelemetry(data);
  assert.equal(tele.origCompletedCredits, 6);
  assert.equal(tele.overallWeightedGpa, 3.7);
  assert.equal(tele.clinActiveCredits, 3);
  const resolved = resolveCoursePosts(['p1', 'missing'], new Map([['p1', { id: 'p1', title: '转专业复盘' }]]));
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'p1');
});

test('interact Cloudflare Worker supports daily resonance, comments, honeypot, and admin moderation', async () => {
  const env = {
    INTERACT_KV: createMemoryKv(),
    ADMIN_SECRET: 'secret-adm',
    ALLOWED_ORIGIN: 'https://blog.acretiondisk.top',
  };
  const reqOpts = (method, body, ip = '203.0.113.10') => ({
    method,
    headers: {
      Origin: 'https://blog.acretiondisk.top',
      'CF-Connecting-IP': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const likeRes = await handleInteractRequest(new Request('https://w.example/api/interact/daily/d-1/like', reqOpts('POST', { action: 'like' })), env);
  assert.equal(likeRes.status, 200);
  assert.equal((await likeRes.json()).count, 1);

  const listLikes = await handleInteractRequest(new Request('https://w.example/api/interact/daily?ids=d-1', reqOpts('GET')), env);
  assert.equal((await listLikes.json()).counts['d-1'], 1);

  const spamRes = await handleInteractRequest(new Request('https://w.example/api/interact/comments', reqOpts('POST', {
    target: '/blog/demo', nick: 'bot', body: 'buy now', website: 'http://spam.invalid',
  }, '203.0.113.99')), env);
  const spamJson = await spamRes.json();
  assert.equal(spamJson.ok, true);
  assert.equal(spamJson.comment, null);

  const cmtRes = await handleInteractRequest(new Request('https://w.example/api/interact/comments', reqOpts('POST', {
    target: '/blog/demo', nick: '访客A', body: '写得真好！',
  })), env);
  assert.equal(cmtRes.status, 201);
  const cmtJson = await cmtRes.json();
  assert.equal(cmtJson.total, 1);
  const cmtId = cmtJson.comment.id;

  const getCmt = await handleInteractRequest(new Request('https://w.example/api/interact/comments?target=/blog/demo', reqOpts('GET')), env);
  assert.equal((await getCmt.json()).comments.length, 1);

  const delUnauth = await handleInteractRequest(new Request(`https://w.example/api/interact/comments?target=/blog/demo&id=${cmtId}`, reqOpts('DELETE')), env);
  assert.equal(delUnauth.status, 401);

  const delOk = await handleInteractRequest(new Request(`https://w.example/api/interact/comments?target=/blog/demo&id=${cmtId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer secret-adm' },
  }), env);
  assert.equal(delOk.status, 200);
  const afterDel = await handleInteractRequest(new Request('https://w.example/api/interact/comments?target=/blog/demo', reqOpts('GET')), env);
  assert.equal((await afterDel.json()).comments.length, 0);
});
