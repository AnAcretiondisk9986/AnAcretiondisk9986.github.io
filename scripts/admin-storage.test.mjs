import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { atomicWriteFile, sha256 } from '../admin/atomic-file.mjs';

let tempDir;
afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempDir() {
  tempDir = await mkdtemp(join(tmpdir(), 'blog-admin-storage-'));
  return tempDir;
}

test('sha256 returns a stable digest for the exact stored content', () => {
  assert.equal(sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.notEqual(sha256('hello'), sha256('Hello'));
});

test('atomicWriteFile replaces an existing file and leaves no temporary sibling', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'post.md');
  await writeFile(target, 'old version', 'utf8');

  await atomicWriteFile(target, 'new version');

  assert.equal(await readFile(target, 'utf8'), 'new version');
  assert.deepEqual(await readdir(dir), ['post.md']);
});

test('atomicWriteFile does not damage the original if replacement fails', async () => {
  const dir = await makeTempDir();
  const targetDirectory = join(dir, 'directory-target');
  const blocker = join(dir, 'directory-target.blocker');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(targetDirectory);
  await writeFile(blocker, 'blocker', 'utf8');

  await assert.rejects(atomicWriteFile(targetDirectory, 'new version'));

  assert.equal(await readFile(blocker, 'utf8'), 'blocker');
  assert.deepEqual((await readdir(dir)).sort(), ['directory-target', 'directory-target.blocker']);
});
