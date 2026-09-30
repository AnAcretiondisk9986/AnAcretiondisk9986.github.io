import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { createGitService, GitCommandError, redactSecrets } from '../admin/git-service.mjs';

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
