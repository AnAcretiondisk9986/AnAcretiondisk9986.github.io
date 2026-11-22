export type ProjectStatus = 'active' | 'maintaining' | 'experiment' | 'archived';
export type ProjectKind = 'web' | 'app' | 'cli' | 'extension' | 'ai' | 'other';

export interface ProjectItem {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: ProjectStatus;
  kind: ProjectKind;
  stack: string[];
  repoUrl: string;
  demoUrl: string;
  cover: string;
  featured: boolean;
  order: number;
  postSlugs: string[];
  postTags: string[];
  highlights: string[];
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '活跃迭代',
  maintaining: '稳定维护',
  experiment: '实验原型',
  archived: '已归档',
};

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  web: 'WEB 应用',
  app: '桌面 / 客户端',
  cli: '终端 / 插件',
  extension: '浏览器扩展',
  ai: 'AI / RAG',
  other: '其他造物',
};

const VALID_STATUS = new Set<ProjectStatus>(['active', 'maintaining', 'experiment', 'archived']);
const VALID_KIND = new Set<ProjectKind>(['web', 'app', 'cli', 'extension', 'ai', 'other']);

function cleanStrList(raw: unknown, maxItems = 20, maxLen = 80): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，\n]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const clean = String(item ?? '').trim().slice(0, maxLen);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function normalizeProjects(raw: unknown): ProjectItem[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const out: ProjectItem[] = [];

  raw.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const name = String(obj.name ?? '').trim().slice(0, 80);
    if (!name) return;
    const rawId = String(obj.id ?? '').trim() || `proj-${idx + 1}`;
    const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || `proj-${idx + 1}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const status = VALID_STATUS.has(obj.status as ProjectStatus) ? (obj.status as ProjectStatus) : 'maintaining';
    const kind = VALID_KIND.has(obj.kind as ProjectKind) ? (obj.kind as ProjectKind) : 'other';
    const orderNum = Number(obj.order);

    out.push({
      id,
      name,
      tagline: String(obj.tagline ?? '').trim().slice(0, 140),
      description: String(obj.description ?? '').trim().slice(0, 1200),
      status,
      kind,
      stack: cleanStrList(obj.stack, 12, 32),
      repoUrl: String(obj.repoUrl ?? '').trim().slice(0, 500),
      demoUrl: String(obj.demoUrl ?? '').trim().slice(0, 500),
      cover: String(obj.cover ?? '').trim().slice(0, 500),
      featured: Boolean(obj.featured),
      order: Number.isFinite(orderNum) ? Math.round(orderNum) : idx + 1,
      postSlugs: cleanStrList(obj.postSlugs, 20, 140),
      postTags: cleanStrList(obj.postTags, 12, 40),
      highlights: cleanStrList(obj.highlights, 8, 120),
    });
  });

  return out.sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order);
}

export interface LinkedPostBrief {
  id: string;
  title: string;
  pubDate: Date;
}

export function matchProjectPosts<T extends { id: string; data: { title: string; pubDate: Date; tags: string[] } }>(
  project: ProjectItem,
  posts: T[],
): T[] {
  const slugSet = new Set(project.postSlugs.map((s) => s.toLowerCase()));
  const tagSet = new Set(project.postTags.map((t) => t.toLowerCase()));
  if (slugSet.size === 0 && tagSet.size === 0) return [];

  const matched = posts.filter((post) => {
    if (slugSet.has(post.id.toLowerCase())) return true;
    return post.data.tags.some((tag) => tagSet.has(tag.toLowerCase()));
  });

  // 显式指定的 postSlugs 优先排在前面，其次按发布时间降序
  return matched.sort((a, b) => {
    const aExplicit = slugSet.has(a.id.toLowerCase()) ? 1 : 0;
    const bExplicit = slugSet.has(b.id.toLowerCase()) ? 1 : 0;
    if (aExplicit !== bExplicit) return bExplicit - aExplicit;
    return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  });
}
