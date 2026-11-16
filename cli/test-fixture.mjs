/**
 * 测试夹具：在临时目录里生成「博客仓库 + 裸远端」与「图片仓库 + 裸远端」。
 * blog.test.mjs 与 tui.test.mjs 共用，不触碰真实仓库。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout;
}

export function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'blog-cli-test-'));
  const repo = join(root, 'site');
  const remote = join(root, 'remote.git');
  const imgRepo = join(root, 'blog-images');
  const imgRemote = join(root, 'img-remote.git');

  mkdirSync(join(repo, 'src', 'content', 'blog'), { recursive: true });
  mkdirSync(join(repo, 'src', 'data'), { recursive: true });
  writeFileSync(join(repo, 'src', 'data', 'about.json'), '{}\n');
  writeFileSync(join(repo, 'src', 'data', 'frontend.json'), '{}\n');
  writeFileSync(join(repo, 'src', 'data', 'gallery.json'), '[]\n');
  writeFileSync(join(repo, '.gitignore'), '.admin-backups/\n.admin-revisions/\n');
  writeFileSync(
    join(repo, 'src', 'content', 'blog', 'seed.md'),
    '---\ntitle: 种子文章\ndescription: 初始\npubDate: 2026-01-01\ndayIndex: 1\ntags: []\ndraft: false\naccess: public\n---\n\n正文\n',
  );
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'tester']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'init']);
  git(root, ['init', '--bare', '-b', 'main', remote]); // 裸仓库 HEAD 必须指向 main，否则 clone 得到空工作区
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);

  mkdirSync(join(imgRepo, 'image'), { recursive: true });
  writeFileSync(join(imgRepo, 'image', '.keep'), '');
  git(imgRepo, ['init', '-b', 'main']);
  git(imgRepo, ['config', 'user.email', 'test@example.com']);
  git(imgRepo, ['config', 'user.name', 'tester']);
  git(imgRepo, ['add', '-A']);
  git(imgRepo, ['commit', '-m', 'init']);
  git(root, ['init', '--bare', '-b', 'main', imgRemote]);
  git(imgRepo, ['remote', 'add', 'origin', imgRemote]);
  git(imgRepo, ['push', '-u', 'origin', 'main']);

  // 测试用编辑器：向文件末尾追加一段文字
  writeFileSync(
    join(root, 'append-editor.mjs'),
    "import { readFileSync, writeFileSync } from 'node:fs';\nconst f = process.argv[2];\nwriteFileSync(f, readFileSync(f, 'utf8') + '\\n编辑器追加内容 ZZ\\n');\n",
  );
  // 测试用编辑器：用 FAKE_CONTENT_FILE 的内容覆盖目标文件
  writeFileSync(
    join(root, 'replace-editor.mjs'),
    "import { copyFileSync } from 'node:fs';\ncopyFileSync(process.env.FAKE_CONTENT_FILE, process.argv[2]);\n",
  );

  return {
    root,
    repo,
    remote,
    imgRepo,
    imgRemote,
    appendEditor: `node "${join(root, 'append-editor.mjs')}"`,
    replaceEditor: `node "${join(root, 'replace-editor.mjs')}"`,
  };
}

/** 子进程调用 CLI/TUI 时使用的隔离环境变量 */
export function fixtureEnv(fx, extra = {}) {
  return {
    ...process.env,
    BLOG_REPO_DIR: fx.repo,
    IMG_REPO_DIR: fx.imgRepo,
    ADMIN_BLOG_DIR: '',
    ADMIN_DATA_DIR: '',
    ADMIN_BACKUP_DIR: '',
    ADMIN_REVISIONS_DIR: '',
    VISUAL: '',
    EDITOR: '',
    ...extra,
  };
}
