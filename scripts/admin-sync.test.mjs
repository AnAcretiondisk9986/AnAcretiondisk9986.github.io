import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { createGitService, GitCommandError, redactSecrets } from '../admin/git-service.mjs';
import { mergeJsonArrayById, tryMergeKnownJsonFile } from '../admin/json-merge.mjs';

const pexec = promisify(execFile);

let tempRoot;
afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

async function git(cwd, args) {
  const { stdout } = await pexec('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

/** 建一对本地仓库：origin.git（裸仓库）+ work（工作副本），默认分支 main */
async function makeRepoPair() {
  tempRoot = await mkdtemp(join(tmpdir(), 'blog-git-sync-'));
  const originDir = join(tempRoot, 'origin.git');
  const workDir = join(tempRoot, 'work');
  await git(tempRoot, ['init', '--bare', '-b', 'main', originDir]);
  await git(tempRoot, ['clone', originDir, workDir]);
  await git(workDir, ['config', 'user.email', 'test@example.com']);
  await git(workDir, ['config', 'user.name', 'Test']);
  await writeFile(join(workDir, 'article.md'), 'one\n', 'utf8');
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'init']);
  await git(workDir, ['push', '-u', 'origin', 'main']);
  return { originDir, workDir };
}

/** 再克隆一份工作副本，用于模拟“另一台设备推送” */
async function makeSecondClone(originDir) {
  const cloneDir = join(tempRoot, 'other');
  await git(tempRoot, ['clone', originDir, cloneDir]);
  await git(cloneDir, ['config', 'user.email', 'other@example.com']);
  await git(cloneDir, ['config', 'user.name', 'Other']);
  return cloneDir;
}

test('redactSecrets 移除 URL 凭据与 token 形态', () => {
  assert.equal(redactSecrets('https://user:ghp_secret@github.com/a/b.git'), 'https://***@github.com/a/b.git');
  assert.ok(!redactSecrets('remote: token=abcdef123456').includes('abcdef123456'));
  assert.ok(!redactSecrets('Authorization: Bearer abc123').includes('abc123'));
});

test('git 服务拒绝白名单外的子命令', async () => {
  const { workDir } = await makeRepoPair();
  const svc = createGitService({ cwd: workDir });
  await assert.rejects(() => svc.run(['rm', '-rf', '.']), GitCommandError);
  await assert.rejects(() => svc.run(['clean', '-fd']), /不允许执行的 git 子命令/);
});

test('status 在干净仓库报告 clean 且与远端一致', async () => {
  const { workDir } = await makeRepoPair();
  const svc = createGitService({ cwd: workDir });
  const status = await svc.status();
  assert.equal(status.branch, 'main');
  assert.equal(status.upstream, 'origin/main');
  assert.equal(status.hasUpstream, true);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
  assert.equal(status.dirtyCount, 0);
  assert.equal(status.clean, true);
});

test('previewCommit 列出待提交文件但不修改索引', async () => {
  const { workDir } = await makeRepoPair();
  const svc = createGitService({ cwd: workDir });
  await writeFile(join(workDir, 'article.md'), 'one\ntwo\n', 'utf8');
  await writeFile(join(workDir, 'new.md'), 'new file\n', 'utf8');

  const preview = await svc.previewCommit({ paths: ['.'] });
  const paths = preview.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['article.md', 'new.md']);
  assert.equal(preview.insertions, 1); // 未跟踪文件不计入行数

  // 预览只读：索引不应被写入
  const staged = await svc.run(['diff', '--cached', '--quiet'], { allowFailure: true });
  assert.equal(staged.code, 0);
  assert.equal((await svc.status()).dirtyCount, 2);
});

test('commitAndPush 提交并推送后工作区回到 clean', async () => {
  const { workDir } = await makeRepoPair();
  const svc = createGitService({ cwd: workDir });
  await writeFile(join(workDir, 'article.md'), 'one\ntwo\n', 'utf8');

  const result = await svc.commitAndPush({ paths: ['.'], message: '测试提交' });
  assert.equal(result.committed, true);
  assert.equal(result.pushed, true);
  assert.equal(result.preview.fileCount, 1);
  assert.equal((await svc.status()).clean, true);

  const subject = await git(workDir, ['log', '-1', '--pretty=format:%s']);
  assert.equal(subject, '测试提交');
});

test('commitAndPush 在没有变更时跳过且不产生提交', async () => {
  const { workDir } = await makeRepoPair();
  const svc = createGitService({ cwd: workDir });
  const before = await git(workDir, ['rev-parse', 'HEAD']);
  const result = await svc.commitAndPush({ paths: ['.'], message: '空提交' });
  assert.equal(result.committed, false);
  assert.equal(result.pushed, false);
  assert.equal(await git(workDir, ['rev-parse', 'HEAD']), before);
});

test('本地有新提交时报告 ahead，并可被 push 清除', async () => {
  const { workDir } = await makeRepoPair();
  const svc = createGitService({ cwd: workDir });
  await writeFile(join(workDir, 'article.md'), 'one\nlocal\n', 'utf8');
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'local work']);

  const ahead = await svc.status();
  assert.equal(ahead.ahead, 1);
  assert.equal(ahead.behind, 0);

  await git(workDir, ['push', 'origin', 'main']);
  const synced = await svc.status();
  assert.equal(synced.ahead, 0);
  assert.equal(synced.clean, true);
});

test('pullFastForward 快进拉取远端新提交', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);
  await writeFile(join(other, 'article.md'), 'one\nremote\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote work']);
  await git(other, ['push', 'origin', 'main']);

  const svc = createGitService({ cwd: workDir });
  await svc.fetchRemote();
  const before = await svc.status();
  assert.equal(before.behind, 1);
  assert.equal(before.ahead, 0);
  assert.equal(before.clean, true);

  const preview = await svc.previewPull();
  assert.equal(preview.behind, 1);
  assert.equal(preview.commits.length, 1);
  assert.match(preview.commits[0], /remote work/);

  const result = await svc.pullFastForward();
  assert.equal(result.status, 'pulled');
  assert.equal((await readFile(join(workDir, 'article.md'), 'utf8')).replace(/\r\n/g, '\n'), 'one\nremote\n');
  assert.equal((await svc.status()).clean, true);
});

test('pullFastForward 在工作区脏时跳过，不覆盖本地改动', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);
  await writeFile(join(other, 'article.md'), 'one\nremote\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote work']);
  await git(other, ['push', 'origin', 'main']);

  await writeFile(join(workDir, 'article.md'), 'one\nlocal dirty\n', 'utf8');
  const svc = createGitService({ cwd: workDir });
  const result = await svc.pullFastForward();
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'dirty');
  assert.equal((await readFile(join(workDir, 'article.md'), 'utf8')).replace(/\r\n/g, '\n'), 'one\nlocal dirty\n');
});

test('分叉时 pullFastForward 跳过并报告 diverged', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);

  // 本地提交
  await writeFile(join(workDir, 'local.md'), 'local\n', 'utf8');
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'local work']);

  // 远端提交
  await writeFile(join(other, 'remote.md'), 'remote\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote work']);
  await git(other, ['push', 'origin', 'main']);

  const svc = createGitService({ cwd: workDir });
  const result = await svc.pullFastForward();
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'diverged');
  assert.equal(result.ahead, 1);
  assert.equal(result.behind, 1);
  assert.equal((await svc.status()).diverged, true);
});

test('推送被远端拒绝时抛出可读错误且保留已提交状态', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);
  await writeFile(join(other, 'article.md'), 'one\nremote\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote work']);
  await git(other, ['push', 'origin', 'main']);

  const svc = createGitService({ cwd: workDir });
  await writeFile(join(workDir, 'article.md'), 'one\nlocal\n', 'utf8');
  await assert.rejects(
    () => svc.commitAndPush({ paths: ['.'], message: '本地提交' }),
    (err) => {
      assert.ok(err instanceof GitCommandError);
      assert.match(err.message, /拒绝|分叉|拉取/);
      return true;
    },
  );
  // 提交已落在本地，远端未前进
  assert.equal(await git(workDir, ['log', '-1', '--pretty=format:%s']), '本地提交');
  assert.equal((await svc.status()).ahead, 1);
});

// ── 三方 JSON 语义合并测试 ──

test('mergeJsonArrayById 合并两端各自新增与字段级编辑并按时间排序', () => {
  const base = JSON.stringify([
    { id: 'daily-20261119-01', createdAt: '2026-11-19T08:00:00+08:00', text: '旧动态' },
  ]);
  const local = JSON.stringify([
    { id: 'daily-20261119-02', createdAt: '2026-11-19T12:00:00+08:00', text: '电脑端新增' },
    { id: 'daily-20261119-01', createdAt: '2026-11-19T08:00:00+08:00', text: '旧动态', tags: ['电脑标签'] },
  ]);
  const remote = JSON.stringify([
    { id: 'daily-20261119-03', createdAt: '2026-11-19T15:00:00+08:00', text: '手机端新增' },
    { id: 'daily-20261119-01', createdAt: '2026-11-19T08:00:00+08:00', text: '旧动态', location: '实验室' },
  ]);
  const merged = tryMergeKnownJsonFile('src/data/daily.json', { baseText: base, localText: local, remoteText: remote });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.items.map((i) => i.id), ['daily-20261119-03', 'daily-20261119-02', 'daily-20261119-01']);
  const old = merged.items.find((i) => i.id === 'daily-20261119-01');
  assert.deepEqual(old.tags, ['电脑标签']);
  assert.equal(old.location, '实验室');
});

test('daily.json 两端同日离线均生成 -01 时保留远端 id 并为本地重分配 -02', () => {
  const base = JSON.stringify([]);
  const remote = JSON.stringify([
    { id: 'daily-20261120-01', createdAt: '2026-11-20T09:00:00+08:00', text: '手机首条' },
  ]);
  const local = JSON.stringify([
    { id: 'daily-20261120-01', createdAt: '2026-11-20T09:30:00+08:00', text: '电脑首条' },
  ]);
  const merged = tryMergeKnownJsonFile('src/data/daily.json', { baseText: base, localText: local, remoteText: remote });
  assert.equal(merged.ok, true);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.items.find((i) => i.text === '手机首条').id, 'daily-20261120-01');
  assert.equal(merged.items.find((i) => i.text === '电脑首条').id, 'daily-20261120-02');
  assert.deepEqual(merged.stats.rekeyedIds, [{ from: 'daily-20261120-01', to: 'daily-20261120-02' }]);
});

test('mergeJsonArrayById 在删除与修改同一条目或改同一字段时返回冲突', () => {
  const base = JSON.stringify([{ id: 'a', text: 'v1' }]);
  const localDel = JSON.stringify([]);
  const remoteMod = JSON.stringify([{ id: 'a', text: 'v2' }]);
  const res1 = mergeJsonArrayById({ baseText: base, localText: localDel, remoteText: remoteMod });
  assert.equal(res1.ok, false);
  assert.deepEqual(res1.conflictedIds, ['a']);

  const localMod = JSON.stringify([{ id: 'a', text: 'v3' }]);
  const res2 = mergeJsonArrayById({ baseText: base, localText: localMod, remoteText: remoteMod });
  assert.equal(res2.ok, false);
  assert.deepEqual(res2.conflictedIds, ['a']);
});

// ── 多设备智能同步（pullSmart + commitAndPush autoSync）──

async function seedDataFiles(workDir, dailyItems = [], galleryItems = []) {
  await mkdir(join(workDir, 'src', 'data'), { recursive: true });
  await mkdir(join(workDir, 'src', 'content', 'blog'), { recursive: true });
  await writeFile(join(workDir, 'src', 'data', 'daily.json'), `${JSON.stringify(dailyItems, null, 2)}\n`, 'utf8');
  await writeFile(join(workDir, 'src', 'data', 'gallery.json'), `${JSON.stringify(galleryItems, null, 2)}\n`, 'utf8');
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'seed data']);
  await git(workDir, ['push', 'origin', 'main']);
}

test('pullSmart 在工作区有未提交修改与未跟踪文件且不重叠时自动拉取并完整保留本地改动', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);

  // 远端推送新文章
  await writeFile(join(other, 'mobile-post.md'), 'from phone\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'mobile publish']);
  await git(other, ['push', 'origin', 'main']);

  // 本地有已跟踪修改 + 未跟踪草稿
  await writeFile(join(workDir, 'article.md'), 'one\nlocal draft edit\n', 'utf8');
  await writeFile(join(workDir, 'claude-code-cli-使用手册.md'), '# 草稿\n', 'utf8');

  const svc = createGitService({ cwd: workDir });
  await svc.fetchRemote();
  const preview = await svc.previewPull();
  assert.deepEqual(preview.remoteFiles, ['mobile-post.md']);
  assert.deepEqual(preview.overlappingFiles, []);

  const result = await svc.pullSmart({ fetch: false });
  assert.equal(result.status, 'pulled');
  assert.equal(result.stashed, true);
  assert.equal(result.behind, 1);

  // 远端新文章已拉回，本地改动与未跟踪草稿完好无损，且无残留 stash
  assert.equal((await readFile(join(workDir, 'mobile-post.md'), 'utf8')).replace(/\r\n/g, '\n'), 'from phone\n');
  assert.equal((await readFile(join(workDir, 'article.md'), 'utf8')).replace(/\r\n/g, '\n'), 'one\nlocal draft edit\n');
  assert.equal((await readFile(join(workDir, 'claude-code-cli-使用手册.md'), 'utf8')).replace(/\r\n/g, '\n'), '# 草稿\n');
  assert.equal((await git(workDir, ['stash', 'list'])), '');
  const st = await svc.status();
  assert.equal(st.behind, 0);
  assert.equal(st.ahead, 0);
  assert.equal(st.dirtyCount, 2);
});

test('pullSmart 在分支分叉（ahead > 0 且 behind > 0）时自动变基整合', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);

  // 本地提交
  await writeFile(join(workDir, 'local-post.md'), 'local\n', 'utf8');
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'local commit']);

  // 远端提交
  await writeFile(join(other, 'remote-post.md'), 'remote\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote commit']);
  await git(other, ['push', 'origin', 'main']);

  const svc = createGitService({ cwd: workDir });
  const result = await svc.pullSmart();
  assert.equal(result.status, 'pulled');
  assert.equal(result.rebased, true);
  const st = await svc.status();
  assert.equal(st.behind, 0);
  assert.equal(st.ahead, 1);
  assert.equal((await readFile(join(workDir, 'remote-post.md'), 'utf8')).replace(/\r\n/g, '\n'), 'remote\n');
  assert.equal((await readFile(join(workDir, 'local-post.md'), 'utf8')).replace(/\r\n/g, '\n'), 'local\n');
});

test('pullSmart 自动语义合并两端并发新增的 daily.json（含同日 id 冲突）且保留未跟踪文件', async () => {
  const { originDir, workDir } = await makeRepoPair();
  await seedDataFiles(workDir, [
    { id: 'daily-20261119-01', createdAt: '2026-11-19T10:00:00+08:00', text: '基准日常' },
  ]);
  const other = await makeSecondClone(originDir);

  // 手机端新增 20261120-01 并推送
  const remoteDaily = [
    { id: 'daily-20261120-01', createdAt: '2026-11-20T09:00:00+08:00', text: '手机动态' },
    { id: 'daily-20261119-01', createdAt: '2026-11-19T10:00:00+08:00', text: '基准日常' },
  ];
  await writeFile(join(other, 'src', 'data', 'daily.json'), `${JSON.stringify(remoteDaily, null, 2)}\n`, 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'mobile daily']);
  await git(other, ['push', 'origin', 'main']);

  // 电脑端未提交修改：也新增了 20261120-01，并带有一个未跟踪草稿
  const localDaily = [
    { id: 'daily-20261120-01', createdAt: '2026-11-20T10:00:00+08:00', text: '电脑动态' },
    { id: 'daily-20261119-01', createdAt: '2026-11-19T10:00:00+08:00', text: '基准日常' },
  ];
  await writeFile(join(workDir, 'src', 'data', 'daily.json'), `${JSON.stringify(localDaily, null, 2)}\n`, 'utf8');
  await writeFile(join(workDir, 'scratch.md'), 'keep me\n', 'utf8');

  const svc = createGitService({ cwd: workDir });
  await svc.fetchRemote();
  const preview = await svc.previewPull();
  assert.deepEqual(preview.autoMergeableFiles, ['src/data/daily.json']);
  assert.deepEqual(preview.riskyOverlapFiles, []);

  const result = await svc.pullSmart({ fetch: false });
  assert.equal(result.status, 'pulled');
  assert.deepEqual(result.autoMergedFiles, ['src/data/daily.json']);

  const merged = JSON.parse(await readFile(join(workDir, 'src', 'data', 'daily.json'), 'utf8'));
  assert.equal(merged.length, 3);
  assert.equal(merged.find((i) => i.text === '手机动态').id, 'daily-20261120-01');
  assert.equal(merged.find((i) => i.text === '电脑动态').id, 'daily-20261120-02');
  assert.equal((await readFile(join(workDir, 'scratch.md'), 'utf8')).replace(/\r\n/g, '\n'), 'keep me\n');
  assert.equal(await git(workDir, ['stash', 'list']), '');
});

test('pullSmart 遇到普通 Markdown 同行冲突时原子回滚（不留冲突标记、保留未跟踪文件、无残留 stash）', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);

  await writeFile(join(other, 'article.md'), 'one\nremote change\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote edit']);
  await git(other, ['push', 'origin', 'main']);

  const origHead = await git(workDir, ['rev-parse', 'HEAD']);
  await writeFile(join(workDir, 'article.md'), 'one\nlocal change\n', 'utf8');
  await writeFile(join(workDir, 'untracked-note.md'), 'do not lose me\n', 'utf8');

  const svc = createGitService({ cwd: workDir });
  const result = await svc.pullSmart();
  assert.equal(result.status, 'conflict');
  assert.equal(result.rolledBack, true);
  assert.deepEqual(result.conflicts, ['article.md']);

  // 完全回到拉取前状态：HEAD 未变、本地改动完整、无冲突标记、未跟踪文件完整、无残留 stash
  assert.equal(await git(workDir, ['rev-parse', 'HEAD']), origHead);
  const content = (await readFile(join(workDir, 'article.md'), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(content, 'one\nlocal change\n');
  assert.ok(!content.includes('<<<<<<<'));
  assert.equal((await readFile(join(workDir, 'untracked-note.md'), 'utf8')).replace(/\r\n/g, '\n'), 'do not lose me\n');
  assert.equal(await git(workDir, ['stash', 'list']), '');
});

test('pullSmart 检测本地未跟踪文件与远端新增文件重名并原子回滚', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);

  await writeFile(join(other, 'same-slug.md'), 'remote version\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'add same slug']);
  await git(other, ['push', 'origin', 'main']);

  await writeFile(join(workDir, 'same-slug.md'), 'local version\n', 'utf8');
  const svc = createGitService({ cwd: workDir });
  const result = await svc.pullSmart();
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'untracked-conflict');
  assert.equal(result.rolledBack, true);
  assert.deepEqual(result.conflicts, ['same-slug.md']);
  assert.equal((await readFile(join(workDir, 'same-slug.md'), 'utf8')).replace(/\r\n/g, '\n'), 'local version\n');
  assert.equal(await git(workDir, ['stash', 'list']), '');
});

test('commitAndPush 在远端领先时自动同步并推送，同时保护未纳入本次推送的本地代码改动', async () => {
  const { originDir, workDir } = await makeRepoPair();
  await seedDataFiles(workDir, []);
  const other = await makeSecondClone(originDir);

  // 手机端先发一篇文章
  await mkdir(join(other, 'src', 'content', 'blog'), { recursive: true });
  await writeFile(join(other, 'src', 'content', 'blog', 'phone.md'), 'phone post\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'mobile publish']);
  await git(other, ['push', 'origin', 'main']);

  // 电脑端写了新文章（纳入内容推送）+ 改了代码（不纳入内容推送）
  await writeFile(join(workDir, 'src', 'content', 'blog', 'pc.md'), 'pc post\n', 'utf8');
  await writeFile(join(workDir, 'article.md'), 'unrelated code edit\n', 'utf8');

  const svc = createGitService({ cwd: workDir });
  const res = await svc.commitAndPush({
    paths: ['src/content/blog/', 'src/data/daily.json'],
    message: '通过管理面板更新博客',
  });
  assert.equal(res.committed, true);
  assert.equal(res.pushed, true);
  assert.equal(res.syncedRemote, true);
  assert.equal(res.syncedBehind, 1);

  // 手机端文章已同步到本地，电脑端文章已推到远端，且未推送的 article.md 仍完好保留在工作区
  assert.equal((await readFile(join(workDir, 'src', 'content', 'blog', 'phone.md'), 'utf8')).replace(/\r\n/g, '\n'), 'phone post\n');
  assert.equal((await readFile(join(workDir, 'article.md'), 'utf8')).replace(/\r\n/g, '\n'), 'unrelated code edit\n');
  assert.equal(await git(workDir, ['stash', 'list']), '');

  // 验证远端确实同时包含 phone.md 与 pc.md
  await git(other, ['pull', '--ff-only']);
  assert.equal((await readFile(join(other, 'src', 'content', 'blog', 'pc.md'), 'utf8')).replace(/\r\n/g, '\n'), 'pc post\n');
});

test('commitAndPush 在两端同时写入 daily.json 时自动语义合并并成功推送', async () => {
  const { originDir, workDir } = await makeRepoPair();
  await seedDataFiles(workDir, [
    { id: 'daily-20261119-01', createdAt: '2026-11-19T08:00:00+08:00', text: '基准' },
  ]);
  const other = await makeSecondClone(originDir);

  // 手机端发日常
  await writeFile(join(other, 'src', 'data', 'daily.json'), `${JSON.stringify([
    { id: 'daily-20261120-01', createdAt: '2026-11-20T09:00:00+08:00', text: '手机早安' },
    { id: 'daily-20261119-01', createdAt: '2026-11-19T08:00:00+08:00', text: '基准' },
  ], null, 2)}\n`, 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'mobile daily']);
  await git(other, ['push', 'origin', 'main']);

  // 电脑端未拉取也发一条日常，直接点内容推送
  await writeFile(join(workDir, 'src', 'data', 'daily.json'), `${JSON.stringify([
    { id: 'daily-20261120-01', createdAt: '2026-11-20T10:00:00+08:00', text: '电脑日常' },
    { id: 'daily-20261119-01', createdAt: '2026-11-19T08:00:00+08:00', text: '基准' },
  ], null, 2)}\n`, 'utf8');

  const svc = createGitService({ cwd: workDir });
  const res = await svc.commitAndPush({
    paths: ['src/data/daily.json'],
    message: '通过管理面板更新日常',
  });
  assert.equal(res.pushed, true);
  assert.equal(res.syncedRemote, true);
  assert.deepEqual(res.autoMergedFiles, ['src/data/daily.json']);

  await git(other, ['pull', '--ff-only']);
  const finalRemote = JSON.parse(await readFile(join(other, 'src', 'data', 'daily.json'), 'utf8'));
  assert.equal(finalRemote.length, 3);
  assert.equal(finalRemote.find((i) => i.text === '手机早安').id, 'daily-20261120-01');
  assert.equal(finalRemote.find((i) => i.text === '电脑日常').id, 'daily-20261120-02');
});

test('commitAndPush 在工作区干净但存在待推提交（ahead > 0）且远端领先时可自动变基并推掉', async () => {
  const { originDir, workDir } = await makeRepoPair();
  const other = await makeSecondClone(originDir);

  await writeFile(join(workDir, 'stranded.md'), 'pending commit\n', 'utf8');
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'stranded local commit']);

  await writeFile(join(other, 'remote.md'), 'remote commit\n', 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote commit']);
  await git(other, ['push', 'origin', 'main']);

  const svc = createGitService({ cwd: workDir });
  const res = await svc.commitAndPush({ paths: ['.'], message: '推送待推提交' });
  assert.equal(res.committed, false);
  assert.equal(res.pushed, true);
  assert.equal(res.syncedRemote, true);
  const st = await svc.status();
  assert.equal(st.ahead, 0);
  assert.equal(st.behind, 0);
});

test('pullSmart 在两端同时向 gallery.json 顶部新增画廊图时自动按 id 无损合并', async () => {
  const { originDir, workDir } = await makeRepoPair();
  await seedDataFiles(workDir, [], [
    { id: 'img-base', src: 'https://cdn.example.com/0.webp', title: '基础图', date: '2026-11-18' },
  ]);
  const other = await makeSecondClone(originDir);

  await writeFile(join(other, 'src', 'data', 'gallery.json'), `${JSON.stringify([
    { id: 'img-remote', src: 'https://cdn.example.com/r.webp', title: '远端图', date: '2026-11-20' },
    { id: 'img-base', src: 'https://cdn.example.com/0.webp', title: '基础图', date: '2026-11-18' },
  ], null, 2)}\n`, 'utf8');
  await git(other, ['add', '-A']);
  await git(other, ['commit', '-m', 'remote gallery']);
  await git(other, ['push', 'origin', 'main']);

  await writeFile(join(workDir, 'src', 'data', 'gallery.json'), `${JSON.stringify([
    { id: 'img-local', src: 'https://cdn.example.com/l.webp', title: '本地图', date: '2026-11-20' },
    { id: 'img-base', src: 'https://cdn.example.com/0.webp', title: '基础图', date: '2026-11-18' },
  ], null, 2)}\n`, 'utf8');

  const svc = createGitService({ cwd: workDir });
  const res = await svc.pullSmart();
  assert.equal(res.status, 'pulled');
  assert.deepEqual(res.autoMergedFiles, ['src/data/gallery.json']);
  const merged = JSON.parse(await readFile(join(workDir, 'src', 'data', 'gallery.json'), 'utf8'));
  assert.deepEqual(merged.map((i) => i.id), ['img-local', 'img-remote', 'img-base']);
});
