/**
 * 从 WMU 课表项目的 GitHub 同步仓库拉取并解码课表配置（users/<username>/config.json）。
 */

const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
const DEFAULT_SYNC_TIMEOUT_MS = 15000;

/**
 * 解析「所有者/仓库名」或 GitHub 仓库 URL。
 * @param {string} value
 * @returns {{ owner: string, repo: string }}
 */
export function parseGithubRepoInput(value) {
  let raw = String(value ?? '').trim();
  raw = raw
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length !== 2 || !GITHUB_SEGMENT_RE.test(parts[0]) || !GITHUB_SEGMENT_RE.test(parts[1])) {
    throw new Error('仓库格式应为「所有者/仓库名」，例如 AnAcretiondisk9986/wmu-timetable-sync');
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * 构造 GitHub Contents API 地址。
 * @param {{ owner: string, repo: string, username?: string }} params
 * @returns {{ url: string, username: string, filePath: string }}
 */
export function buildGithubSyncApiUrl({ owner, repo, username }) {
  const effectiveUser = String(username ?? '').trim() || owner;
  if (!GITHUB_SEGMENT_RE.test(effectiveUser)) {
    throw new Error('同步用户名格式不正确');
  }
  const filePath = `users/${effectiveUser}/config.json`;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  return { url, username: effectiveUser, filePath };
}

/**
 * 解码 GitHub Contents API 返回的 base64 JSON 内容（兼容 UTF-8 多字节字符）。
 * @param {{ encoding?: string, content?: string }} payload
 * @returns {unknown}
 */
export function decodeGithubFileContent(payload) {
  if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string' || !payload.content.trim()) {
    throw new Error('同步仓库文件格式无法识别（缺少 base64 内容）');
  }
  const cleanB64 = payload.content.replace(/\s+/g, '');
  const binary = atob(cleanB64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const text = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(text);
}

/**
 * 从 GitHub 同步仓库拉取 WMU 课表 JSON。
 * @param {{ repo: string, username?: string, token?: string, fetchImpl?: typeof fetch }} options
 */
export async function fetchWmuSyncSchedule({ repo, username = '', token = '', fetchImpl = fetch }) {
  const parsedRepo = parseGithubRepoInput(repo);
  const { url, username: effectiveUser, filePath } = buildGithubSyncApiUrl({
    ...parsedRepo,
    username,
  });

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const trimmedToken = String(token ?? '').trim();
  if (trimmedToken) {
    headers.Authorization = `Bearer ${trimmedToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_SYNC_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, { headers, cache: 'no-store', signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('请求 GitHub 超时，请检查网络连接后重试');
    }
    throw new Error(`无法连接 GitHub：${err?.message || '网络异常'}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let apiMsg = '';
    try {
      const errBody = await res.json();
      apiMsg = errBody?.message ? String(errBody.message) : '';
    } catch { /* ignore */ }
    if (res.status === 404) {
      throw new Error(`未找到 ${parsedRepo.owner}/${parsedRepo.repo} 中的 ${filePath}（若为私有仓库请填写访问令牌）`);
    }
    if (res.status === 401 || res.status === 403) {
      const remaining = res.headers?.get?.('x-ratelimit-remaining');
      if (remaining === '0') {
        throw new Error('GitHub API 匿名请求已达上限，请填写访问令牌后重试');
      }
      throw new Error(`GitHub 鉴权或权限失败（HTTP ${res.status}${apiMsg ? `：${apiMsg}` : ''}）`);
    }
    throw new Error(`拉取同步仓库失败（HTTP ${res.status}${apiMsg ? `：${apiMsg}` : ''}）`);
  }

  const payload = await res.json();
  const raw = decodeGithubFileContent(payload);
  return {
    raw,
    owner: parsedRepo.owner,
    repo: parsedRepo.repo,
    username: effectiveUser,
    filePath,
  };
}
