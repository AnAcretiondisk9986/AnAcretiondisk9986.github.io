/**
 * 桌面版本地配置的测试：仓库识别、默认目录挑选、口令生成、配置读写。
 * 运行：npm run test:desktop
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configPath, defaultImageRepo, defaultRepoCandidates, ensureToken, isBlogRepo,
  loadConfig, pickDefaultRepo, saveConfig, serverEnv,
} from './config.mjs';

function tempDir(prefix = 'acr-cfg-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeRepo(root, name = '个人博客') {
  const repo = join(root, name);
  mkdirSync(join(repo, 'src', 'content', 'blog'), { recursive: true });
  writeFileSync(join(repo, 'admin-server.mjs'), '// stub\n');
  return repo;
}

describe('仓库识别', () => {
  test('同时具备 admin-server.mjs 与内容目录才算仓库', () => {
    const { dir, cleanup } = tempDir();
    try {
      const repo = makeRepo(dir);
      assert.equal(isBlogRepo(repo), true);
      assert.equal(isBlogRepo(join(dir, 'nope')), false);
      assert.equal(isBlogRepo(''), false);

      const half = join(dir, 'half');
      mkdirSync(half, { recursive: true });
      writeFileSync(join(half, 'admin-server.mjs'), '// stub\n');
      assert.equal(isBlogRepo(half), false, '缺少内容目录不应算仓库');
    } finally {
      cleanup();
    }
  });

  test('默认候选优先使用文档目录下的「个人博客」', () => {
    const { dir, cleanup } = tempDir();
    try {
      const repo = makeRepo(dir);
      assert.equal(pickDefaultRepo(dir), repo);
      const candidates = defaultRepoCandidates(dir);
      assert.ok(candidates.includes(repo));
      // 文档目录被 OneDrive 重定向时，仍应尝试用户目录下的固定位置
      assert.ok(candidates.some((c) => c.endsWith(join('Documents', '个人博客'))));
    } finally {
      cleanup();
    }
  });

  test('没有可用仓库时返回 null，交给用户选择', (t) => {
    const { dir, cleanup } = tempDir();
    try {
      const found = pickDefaultRepo(dir);
      if (found) {
        // 本机用户目录下确实存在默认博客仓库，此时无法构造「找不到」的场景
        t.skip(`本机存在默认仓库：${found}`);
        return;
      }
      assert.equal(found, null);
    } finally {
      cleanup();
    }
  });
});

describe('口令与配置', () => {
  test('已有合法口令时保持不变，否则生成 64 位随机串', () => {
    assert.equal(ensureToken('a'.repeat(32)), 'a'.repeat(32));
    const generated = ensureToken(undefined);
    assert.match(generated, /^[a-f0-9]{64}$/);
    assert.notEqual(ensureToken(undefined), generated, '每次应生成不同的口令');
  });

  test('配置可写入并读回，缺失时返回空对象', () => {
    const { dir, cleanup } = tempDir();
    try {
      assert.deepEqual(loadConfig(dir), {});
      saveConfig(dir, { repoPath: 'C:/blog', token: 'x' });
      assert.equal(configPath(dir), join(dir, 'config.json'));
      const loaded = loadConfig(dir);
      assert.equal(loaded.repoPath, 'C:/blog');
      assert.equal(loaded.token, 'x');
    } finally {
      cleanup();
    }
  });

  test('图片仓库默认与博客仓库同级', () => {
    assert.match(defaultImageRepo(join('C:', 'docs', '个人博客')), /blog-images$/);
  });

  test('serverEnv 把配置翻译成服务端环境变量', () => {
    const repo = join('C:', 'docs', '个人博客');
    const env = serverEnv({ repoPath: repo, imageRepoPath: '', token: 'tk', port: 4399 });
    assert.equal(env.ADMIN_REPO_ROOT, repo);
    assert.equal(env.ADMIN_BLOG_DIR, join(repo, 'src', 'content', 'blog'));
    assert.equal(env.ADMIN_DATA_DIR, join(repo, 'src', 'data'));
    assert.equal(env.ADMIN_BACKUP_DIR, join(repo, '.admin-backups'));
    assert.equal(env.ADMIN_REVISIONS_DIR, join(repo, '.admin-revisions'));
    assert.match(env.IMG_REPO_DIR, /blog-images$/);
    assert.equal(env.ADMIN_TOKEN, 'tk');
    assert.equal(env.ADMIN_NO_OPEN, '1');
    assert.equal(env.PORT, '4399');
    assert.equal(env.SITE_ORIGIN, 'https://blog.acretiondisk.top');
    // 显式传入的图片仓库优先
    const custom = serverEnv({ repoPath: repo, imageRepoPath: 'D:/imgs', token: 'tk', port: 1 });
    assert.equal(custom.IMG_REPO_DIR, 'D:/imgs');
  });
});
