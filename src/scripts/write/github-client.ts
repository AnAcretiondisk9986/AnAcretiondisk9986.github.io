/**
 * 手机端发文助手（/write/）双模 GitHub 客户端与移动端图片压缩器。
 * 支持：
 *   1. pat 模式：直连 GitHub API（或自定义反代），凭据仅保存在手机浏览器 localStorage；
 *   2. worker 模式：通过 Cloudflare Worker（scripts/mobile-write-worker.js）鉴权转发，手机端只输密码。
 */

export const BLOG_OWNER = 'AnAcretiondisk9986';
export const BLOG_REPO = 'AnAcretiondisk9986.github.io';
export const IMG_REPO = 'blog-images';
export const CDN_IMG_BASE = `https://cdn.jsdelivr.net/gh/${BLOG_OWNER}/${IMG_REPO}@main/image/`;

const CONFIG_KEY = 'hz-mobile-write-config-v1';

export interface WriteAuthConfig {
  mode: 'pat' | 'worker';
  pat: string;
  apiBase: string;
  workerUrl: string;
  workerToken: string;
  workerExpiresAt: number;
}

export function loadAuthConfig(): WriteAuthConfig {
  const defaults: WriteAuthConfig = {
    mode: 'pat',
    pat: '',
    apiBase: 'https://api.github.com',
    workerUrl: '',
    workerToken: '',
    workerExpiresAt: 0,
  };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...(parsed || {}) };
  } catch {
    return defaults;
  }
}

export function saveAuthConfig(cfg: Partial<WriteAuthConfig>): WriteAuthConfig {
  const next = { ...loadAuthConfig(), ...cfg };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function isConfigured(cfg: WriteAuthConfig = loadAuthConfig()): boolean {
  if (cfg.mode === 'worker') {
    return Boolean(cfg.workerUrl && cfg.workerToken && (!cfg.workerExpiresAt || cfg.workerExpiresAt > Date.now()));
  }
  return Boolean(cfg.pat && cfg.pat.trim());
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToUtf8(b64: string): string {
  const clean = String(b64 || '').replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function loginWorker(workerUrl: string, password: string): Promise<WriteAuthConfig> {
  const cleanBase = workerUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请填写 Worker 地址');
  const res = await fetch(`${cleanBase}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.error || `登录失败（HTTP ${res.status}）`);
  }
  return saveAuthConfig({
    mode: 'worker',
    workerUrl: cleanBase,
    workerToken: data.token,
    workerExpiresAt: data.expiresAt || (Date.now() + 7 * 24 * 3600 * 1000),
  });
}

async function ghRequest(ghPath: string, init: RequestInit = {}): Promise<Response> {
  const cfg = loadAuthConfig();
  if (cfg.mode === 'worker') {
    if (!cfg.workerUrl || !cfg.workerToken) throw new Error('请先在设置中登录 Worker');
    const base = cfg.workerUrl.replace(/\/+$/, '');
    return fetch(`${base}/gh${ghPath}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.workerToken}`,
        Accept: 'application/vnd.github+json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
  }

  if (!cfg.pat) throw new Error('请先在设置中填写 GitHub Token');
  const apiBase = (cfg.apiBase || 'https://api.github.com').trim().replace(/\/+$/, '');
  return fetch(`${apiBase}${ghPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.pat.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
}

async function parseJsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `GitHub 请求失败（HTTP ${res.status}）`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

export interface RemoteBlogEntry {
  name: string;
  slug: string;
  path: string;
  sha: string;
  size: number;
}

export async function listBlogFiles(): Promise<RemoteBlogEntry[]> {
  const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/contents/src/content/blog`);
  const list = await parseJsonOrThrow(res);
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item.type === 'file' && /\.(md|mdx)$/i.test(item.name))
    .map((item) => ({
      name: item.name,
      slug: item.name.replace(/\.(md|mdx)$/i, ''),
      path: item.path,
      sha: item.sha,
      size: item.size || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function readBlogFile(filename: string): Promise<{ raw: string; sha: string; path: string }> {
  const encoded = encodeURIComponent(filename);
  const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/contents/src/content/blog/${encoded}`);
  const data = await parseJsonOrThrow(res);
  return {
    raw: base64ToUtf8(data.content || ''),
    sha: data.sha || '',
    path: data.path || `src/content/blog/${filename}`,
  };
}

export async function saveBlogFile({
  filename,
  rawMarkdown,
  sha,
  message,
}: {
  filename: string;
  rawMarkdown: string;
  sha?: string;
  message: string;
}): Promise<{ sha: string }> {
  const encoded = encodeURIComponent(filename);
  const body: Record<string, string> = {
    message,
    content: utf8ToBase64(rawMarkdown),
  };
  if (sha) body.sha = sha;
  const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/contents/src/content/blog/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow(res);
  return { sha: data.content?.sha || '' };
}

export async function deleteBlogFile({
  filename,
  sha,
  message,
}: {
  filename: string;
  sha: string;
  message: string;
}): Promise<void> {
  const encoded = encodeURIComponent(filename);
  const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/contents/src/content/blog/${encoded}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha }),
  });
  await parseJsonOrThrow(res);
}

/** 手机端图片压缩：长边缩至 <=1600px，优先输出 WebP（不支持时回退 JPEG） */
export async function compressImageForMobile(file: File, maxEdge = 1600): Promise<{ bytes: Uint8Array; ext: string; previewUrl: string }> {
  const previewUrl = URL.createObjectURL(file);
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
    const buf = new Uint8Array(await file.arrayBuffer());
    return { bytes: buf, ext: 'svg', previewUrl };
  }

  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let w = 0;
  let h = 0;

  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      w = bitmap.width;
      h = bitmap.height;
    } else {
      throw new Error('no createImageBitmap');
    }
  } catch {
    imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('当前浏览器无法解码该图片格式（如原生 HEIC 请先在系统相册选“最兼容”或转 JPEG）'));
      img.src = previewUrl;
    });
    w = imgEl.naturalWidth;
    h = imgEl.naturalHeight;
  }

  const scale = Math.min(1, maxEdge / Math.max(w, h, 1));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas 图片压缩');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close();
  } else if (imgEl) {
    ctx.drawImage(imgEl, 0, 0, outW, outH);
  }

  const encode = (mime: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q));

  let blob = await encode('image/webp', 0.84);
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await encode('image/jpeg', 0.86);
    ext = 'jpg';
  }
  if (!blob) throw new Error('图片编码失败');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, ext, previewUrl };
}

export async function uploadImageToRepo(file: File): Promise<{ url: string; previewUrl: string; filename: string }> {
  const { bytes, ext, previewUrl } = await compressImageForMobile(file);
  const safeStem = (file.name || 'photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
    .slice(0, 48) || 'photo';
  const filename = `${safeStem}_${Date.now()}.${ext}`;
  const encoded = encodeURIComponent(filename);

  const res = await ghRequest(`/repos/${BLOG_OWNER}/${IMG_REPO}/contents/image/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `mobile upload ${filename}`,
      content: bytesToBase64(bytes),
    }),
  });
  await parseJsonOrThrow(res);
  return {
    url: `${CDN_IMG_BASE}${encoded}`,
    previewUrl,
    filename,
  };
}

export interface DailyMomentRecord {
  id: string;
  createdAt: string;
  text: string;
  images: Array<{ src: string; alt?: string; original?: string }>;
  tags?: string[];
  pinned?: boolean;
  draft?: boolean;
  location?: string;
  device?: string;
  mood?: string;
  threadId?: string;
  threadLabel?: string;
  linkCard?: { title: string; url: string; label?: string; description?: string };
}

export async function readDailyJson(): Promise<{ items: DailyMomentRecord[]; sha: string }> {
  const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/contents/src/data/daily.json`);
  const data = await parseJsonOrThrow(res);
  const rawText = base64ToUtf8(data.content || '[]');
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = [];
  }
  return {
    items: Array.isArray(parsed) ? parsed : [],
    sha: data.sha || '',
  };
}

export async function saveDailyJson({
  items,
  sha,
  message,
}: {
  items: DailyMomentRecord[];
  sha?: string;
  message: string;
}): Promise<{ sha: string }> {
  const jsonText = `${JSON.stringify(items, null, 2)}\n`;
  const body: Record<string, string> = {
    message,
    content: utf8ToBase64(jsonText),
  };
  if (sha) body.sha = sha;
  const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/contents/src/data/daily.json`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow(res);
  return { sha: data.content?.sha || '' };
}

export async function getLatestDeployRun(): Promise<{
  status: string;
  conclusion: string | null;
  url: string;
  updatedAt: string;
} | null> {
  try {
    const res = await ghRequest(`/repos/${BLOG_OWNER}/${BLOG_REPO}/actions/runs?per_page=3`);
    if (!res.ok) return null;
    const data = await res.json();
    const run = Array.isArray(data.workflow_runs) ? data.workflow_runs[0] : null;
    if (!run) return null;
    return {
      status: run.status || 'unknown',
      conclusion: run.conclusion || null,
      url: run.html_url || '',
      updatedAt: run.updated_at || '',
    };
  } catch {
    return null;
  }
}
