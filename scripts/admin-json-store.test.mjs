import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createJsonStore, InvalidDataError, parseExpectedHash, VersionConflictError } from '../admin/json-store.mjs';

let tempDir;
afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempDir() {
  tempDir = await mkdtemp(join(tmpdir(), 'blog-json-store-'));
  return tempDir;
}

test('parseExpectedHash 识别缺失、空值与非法值', () => {
  assert.deepEqual(parseExpectedHash(undefined), { missing: true });
  assert.deepEqual(parseExpectedHash(''), { hash: '' });
  assert.deepEqual(parseExpectedHash('a'.repeat(64)), { hash: 'a'.repeat(64) });
  assert.deepEqual(parseExpectedHash('not-a-hash'), { invalid: true });
});

test('read 返回内容哈希，write 返回新哈希', async () => {
  const dir = await makeTempDir();
  const store = createJsonStore({ filePath: join(dir, 'data.json'), readDefault: () => ({}) });
  const initial = await store.read();
  assert.equal(initial.contentHash, null);
  assert.equal(initial.exists, false);

  const written = await store.write({ a: 1 });
  assert.match(written.contentHash, /^[a-f0-9]{64}$/);

  const reread = await store.read();
  assert.deepEqual(reread.data, { a: 1 });
  assert.equal(reread.contentHash, written.contentHash);
});

test('校验失败时抛 InvalidDataError 且不覆盖已有文件', async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, 'data.json');
  const store = createJsonStore({
    filePath,
    validate: (value) => {
      if (!Array.isArray(value)) throw new InvalidDataError('必须是数组');
      return value;
    },
  });
  await store.write([{ id: 1 }]);

  await assert.rejects(() => store.write({ not: 'array' }), InvalidDataError);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), [{ id: 1 }]);
});

test('expectedHash 不匹配时抛 VersionConflictError 并给出当前哈希', async () => {
  const dir = await makeTempDir();
  const store = createJsonStore({ filePath: join(dir, 'data.json') });
  const first = await store.write({ v: 1 });

  await assert.rejects(
    () => store.write({ v: 2 }, { expectedHash: 'f'.repeat(64) }),
    (err) => {
      assert.ok(err instanceof VersionConflictError);
      assert.equal(err.currentHash, first.contentHash);
      return true;
    },
  );
  assert.deepEqual((await store.read()).data, { v: 1 });

  const second = await store.write({ v: 2 }, { expectedHash: first.contentHash });
  assert.notEqual(second.contentHash, first.contentHash);
  assert.deepEqual((await store.read()).data, { v: 2 });
});

test('覆盖写入前生成备份并轮换保留数量', async () => {
  const dir = await makeTempDir();
  const backupDir = join(dir, 'backups');
  const store = createJsonStore({ filePath: join(dir, 'data.json'), label: 'demo', backupDir, maxBackups: 2 });

  for (let i = 0; i < 4; i += 1) {
    await store.write({ v: i });
    // 时间戳只精确到毫秒，稍作等待避免文件名冲突
    await new Promise((r) => setTimeout(r, 5));
  }

  const backups = (await readdir(backupDir)).filter((n) => n.startsWith('demo.'));
  assert.equal(backups.length, 2);
  assert.deepEqual((await store.read()).data, { v: 3 });
});

test('非法 JSON 的现有文件在重新写入前会被备份', async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, 'data.json');
  const backupDir = join(dir, 'backups');
  const store = createJsonStore({ filePath, label: 'broken', backupDir });
  await writeFile(filePath, '{ not valid json', 'utf8');

  await assert.rejects(() => store.read(), InvalidDataError);
  const written = await store.write({ ok: true });
  assert.match(written.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual((await store.read()).data, { ok: true });
  const backups = await readdir(backupDir);
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(backupDir, backups[0]), 'utf8'), '{ not valid json');
});

test('并发写入被串行化，最终文件是合法 JSON', async () => {
  const dir = await makeTempDir();
  const store = createJsonStore({ filePath: join(dir, 'data.json') });
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.write({ index: i })));
  const raw = await readFile(join(dir, 'data.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed.index, 'number');
  assert.deepEqual((await readdir(dir)), ['data.json']);
});
