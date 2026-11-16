/**
 * 桌面版的本地配置：博客仓库路径、图片仓库路径、管理口令。
 * 存放在系统的用户数据目录（Electron 的 app.getPath('userData')），不写进仓库。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_NAME = 'config.json';

export function configPath(userDataDir) {
  return join(userDataDir, CONFIG_NAME);
}

export function loadConfig(userDataDir) {
  try {
    return JSON.parse(readFileSync(configPath(userDataDir), 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(userDataDir, data) {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(configPath(userDataDir), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** 判断一个目录是不是可作为博客仓库（有服务端脚本与内容目录） */
export function isBlogRepo(dir) {
  if (!dir) return false;
  return existsSync(join(dir, 'admin-server.mjs')) && existsSync(join(dir, 'src', 'content', 'blog'));
}

/** 首次启动时按顺序尝试的默认仓库位置 */
export function defaultRepoCandidates(documentsDir) {
  const list = [];
  if (process.env.BLOG_REPO) list.push(process.env.BLOG_REPO);
  const home = homedir();
  // 文档目录可能被 OneDrive 重定向，因此同时尝试用户目录下的固定位置
  for (const dir of [documentsDir, join(home, 'Documents'), join(home, '文档')]) {
    if (!dir) continue;
    list.push(join(dir, '个人博客'));
    list.push(join(dir, 'blog'));
  }
  return list;
}

/** 取第一个可用的默认仓库，找不到则返回 null（交给用户选择） */
export function pickDefaultRepo(documentsDir) {
  return defaultRepoCandidates(documentsDir).find((dir) => isBlogRepo(dir)) ?? null;
}

/** 图片仓库默认与博客仓库同级 */
export function defaultImageRepo(repoPath) {
  return repoPath ? join(repoPath, '..', 'blog-images') : '';
}

export function ensureToken(existing) {
  if (typeof existing === 'string' && existing.length >= 16) return existing;
  return randomBytes(32).toString('hex');
}

/**
 * 把本地配置翻译成服务端读取的环境变量。
 * 桌面版在应用进程内启动 admin-server.mjs，全靠这份环境变量决定读写哪里。
 */
export function serverEnv({ repoPath, imageRepoPath, token, port, env = {} }) {
  return {
    ...env,
    ADMIN_NO_OPEN: '1',
    ADMIN_TOKEN: token,
    ADMIN_REPO_ROOT: repoPath,
    ADMIN_BLOG_DIR: join(repoPath, 'src', 'content', 'blog'),
    ADMIN_DATA_DIR: join(repoPath, 'src', 'data'),
    ADMIN_BACKUP_DIR: join(repoPath, '.admin-backups'),
    ADMIN_REVISIONS_DIR: join(repoPath, '.admin-revisions'),
    IMG_REPO_DIR: imageRepoPath || defaultImageRepo(repoPath),
    SITE_ORIGIN: env.SITE_ORIGIN || 'https://blog.acretiondisk.top',
    PORT: String(port),
  };
}
