/**
 * 博客 CLI 端到端测试：在临时目录里搭建「博客仓库 + 远端」与「图片仓库 + 远端」，
 * 通过子进程调用 cli/blog.mjs，不触碰真实仓库。
 * 运行：npm run test:blog-cli
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fixtureEnv, git, makeFixture } from './test-fixture.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'blog.mjs');

let fx;

function cli(args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: fx.repo,
    encoding: 'utf8',
    input,
    timeout: 120000,
    env: fixtureEnv(fx, env),
  });
  return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` };
}

const postFile = (slug) => join(fx.repo, 'src', 'content', 'blog', `${slug}.md`);
const readPostFile = (slug) => readFileSync(postFile(slug), 'utf8');

before(() => {
  fx = makeFixture();
});

after(() => {
  if (fx) rmSync(fx.root, { recursive: true, force: true, maxRetries: 5 });
});

describe('blog CLI', () => {
  test('new 创建文章，frontmatter 正确，校验通过', () => {
    const r = cli(['new', '第一篇文章', '--slug', 'first-post', '--tags', 'a,b', '--access', 'authorized']);
    assert.equal(r.code, 0, r.all);
    const raw = readPostFile('first-post');
    assert.match(raw, /^---\ntitle: 第一篇文章\n/);
    assert.match(raw, /access: authorized/);
    assert.match(raw, /tags:\n {2}- a\n {2}- b\n/);
    assert.match(raw, /dayIndex: 1/);

    const check = cli(['check']);
    assert.equal(check.code, 0, check.all);
    assert.match(check.out, /全部文章校验通过/);
  });

  test('new 拒绝重复的 slug', () => {
    const r = cli(['new', '重复', '--slug', 'first-post']);
    assert.equal(r.code, 1);
    assert.match(r.all, /已存在/);
  });

  test('set 只改指定字段，正文保持不变', () => {
    const before = readPostFile('first-post');
    writeFileSync(postFile('first-post'), `${before}\n正文第一段\n`);

    const r = cli(['set', 'first-post', 'draft=true', 'tags=x, y', 'cover=']);
    assert.equal(r.code, 0, r.all);
    const raw = readPostFile('first-post');
    assert.match(raw, /draft: true/);
    assert.match(raw, /  - x\n {2}- y/);
    assert.doesNotMatch(raw, /cover:/);
    assert.match(raw, /正文第一段/);
  });

  test('set 拒绝非法取值', () => {
    const r = cli(['set', 'first-post', 'access=bogus']);
    assert.equal(r.code, 1);
    assert.match(r.all, /只能是/);
  });

  test('edit 通过编辑器修改，并保存修订快照', () => {
    const r = cli(['edit', 'first-post'], { env: { EDITOR: fx.appendEditor } });
    assert.equal(r.code, 0, r.all);
    assert.match(readPostFile('first-post'), /编辑器追加内容 ZZ/);
    const history = JSON.parse(cli(['history', 'first-post', '--json']).out);
    assert.ok(history.length >= 2, `修订数应 ≥2，实际 ${history.length}`);
  });

  test('restore 可回到更早的修订，且覆盖前的版本也被保存', () => {
    const history = JSON.parse(cli(['history', 'first-post', '--json']).out);
    const oldest = history[history.length - 1];
    const r = cli(['restore', 'first-post', oldest.id, '--yes']);
    assert.equal(r.code, 0, r.all);
    const raw = readPostFile('first-post');
    assert.doesNotMatch(raw, /编辑器追加内容 ZZ/);
    assert.match(raw, /draft: false/);
    const afterHistory = JSON.parse(cli(['history', 'first-post', '--json']).out);
    assert.equal(afterHistory.length, history.length + 1);
  });

  test('mv 重命名文章', () => {
    const r = cli(['mv', 'first-post', 'renamed-post']);
    assert.equal(r.code, 0, r.all);
    assert.equal(existsSync(postFile('first-post')), false);
    assert.equal(existsSync(postFile('renamed-post')), true);
  });

  test('rm 非交互环境下必须带 --yes，删除后可从修订恢复', () => {
    const refused = cli(['rm', 'renamed-post']);
    assert.equal(refused.code, 1);
    assert.equal(existsSync(postFile('renamed-post')), true);

    const r = cli(['rm', 'renamed-post', '--yes']);
    assert.equal(r.code, 0, r.all);
    assert.equal(existsSync(postFile('renamed-post')), false);
    const revisions = readdirSync(join(fx.repo, '.admin-revisions', 'renamed-post'));
    assert.ok(revisions.length >= 1);
  });

  test('check 发现页面地址冲突', () => {
    writeFileSync(postFile('dup-a'), '---\ntitle: A\ndescription: ""\npubDate: 2026-02-01\nslug: same-id\n---\n\n');
    writeFileSync(postFile('dup-b'), '---\ntitle: B\ndescription: ""\npubDate: 2026-02-02\nslug: same-id\n---\n\n');
    const r = cli(['check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /相同的页面地址/);
    rmSync(postFile('dup-a'));
    rmSync(postFile('dup-b'));
  });

  test('gallery 外链图片：添加、列出、移除', () => {
    const add = cli(['gallery', 'add', 'https://example.com/pic.webp', '--title', '测试图', '--date', '2026-11-02']);
    assert.equal(add.code, 0, add.all);
    const items = JSON.parse(cli(['gallery', 'ls', '--json']).out);
    const item = items.find((i) => i.title === '测试图');
    assert.ok(item, '应能列出新加入的图片');
    assert.equal(item.src, 'https://example.com/pic.webp');
    const rm = cli(['gallery', 'rm', item.id, '--yes']);
    assert.equal(rm.code, 0, rm.all);
    assert.equal(JSON.parse(cli(['gallery', 'ls', '--json']).out).length, 0);
  });

  test('img 导入 PNG：转 WebP、生成缩略图与原图归档，并推送图片仓库', async () => {
    const png = join(fx.root, 'sample.png');
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#336699' } }).png().toFile(png);
    const r = cli(['img', png, '--no-warm']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /cdn\.jsdelivr\.net/);
    assert.match(r.out, /原图/);
    const imageFiles = readdirSync(join(fx.imgRepo, 'image')).filter((f) => f.endsWith('.webp'));
    assert.equal(imageFiles.length, 1);
    assert.ok(existsSync(join(fx.imgRepo, 'image', 'thumb', imageFiles[0])));
    assert.ok(readdirSync(join(fx.imgRepo, 'image', 'original')).some((f) => f.endsWith('.png')));
    const remoteLog = git(fx.imgRemote, ['--git-dir', fx.imgRemote, 'log', '--oneline', 'main']);
    assert.match(remoteLog, /通过博客 CLI 更新图片/);
  });

  test('data edit：合法 JSON 保存；非法 JSON 不覆盖并另存草稿', () => {
    const good = join(fx.root, 'about-good.json');
    writeFileSync(good, '{"title": "关于我"}\n');
    const ok = cli(['data', 'edit', 'about'], { env: { EDITOR: fx.replaceEditor, FAKE_CONTENT_FILE: good } });
    assert.equal(ok.code, 0, ok.all);
    assert.match(readFileSync(join(fx.repo, 'src', 'data', 'about.json'), 'utf8'), /关于我/);

    const bad = join(fx.root, 'about-bad.json');
    writeFileSync(bad, '{ 这不是 JSON');
    const fail = cli(['data', 'edit', 'about'], { env: { EDITOR: fx.replaceEditor, FAKE_CONTENT_FILE: bad } });
    assert.equal(fail.code, 1);
    assert.match(fail.all, /已保存到/);
    assert.match(readFileSync(join(fx.repo, 'src', 'data', 'about.json'), 'utf8'), /关于我/);
  });

  test('push 预览、确认后提交并推送到远端', () => {
    const r = cli(['push', '--yes', '--no-images']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /推送成功/);
    const remoteLog = git(fx.repo, ['--git-dir', fx.remote, 'log', '--oneline', 'main']);
    assert.match(remoteLog, /通过博客 CLI 更新博客/);
  });

  test('pull 快进拉取远端的新文章', () => {
    const other = join(fx.root, 'other');
    git(fx.root, ['clone', fx.remote, other]);
    git(other, ['config', 'user.email', 'test@example.com']);
    git(other, ['config', 'user.name', 'tester']);
    writeFileSync(
      join(other, 'src', 'content', 'blog', 'from-remote.md'),
      '---\ntitle: 远端文章\ndescription: ""\npubDate: 2026-03-01\ndayIndex: 1\n---\n\n',
    );
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'remote change']);
    git(other, ['push', 'origin', 'main']);

    const r = cli(['pull']);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /已从远端拉取/);
    assert.equal(existsSync(postFile('from-remote')), true);
  });

  test('access set：通过管道输入口令，只保存 SHA-256 哈希', () => {
    const r = cli(['access', 'set'], { input: 'secret-pass\n' });
    assert.equal(r.code, 0, r.all);
    const stored = JSON.parse(readFileSync(join(fx.repo, 'src', 'data', 'private-access.json'), 'utf8'));
    const expected = createHash('sha256').update('secret-pass').digest('hex');
    assert.equal(stored.passwordHash, expected);
  });

  test('push 在校验失败时拒绝推送（--force 可跳过）', () => {
    writeFileSync(postFile('dup-a'), '---\ntitle: A\ndescription: ""\npubDate: 2026-02-01\nslug: same-id\n---\n\n');
    writeFileSync(postFile('dup-b'), '---\ntitle: B\ndescription: ""\npubDate: 2026-02-02\nslug: same-id\n---\n\n');
    const r = cli(['push', '--yes', '--no-images']);
    assert.equal(r.code, 1);
    assert.match(r.all, /校验未通过/);
    rmSync(postFile('dup-a'));
    rmSync(postFile('dup-b'));
  });

  test('未知命令与缺少参数返回用法错误（退出码 2）', () => {
    assert.equal(cli(['nope']).code, 2);
    assert.equal(cli(['show']).code, 2);
    assert.equal(cli(['help']).code, 0);
  });
});
