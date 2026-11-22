/**
 * 浏览器端轻量 Frontmatter 解析与序列化（严格对齐 src/content.config.ts 与 admin-server.mjs）。
 */

export interface PostMeta {
  title: string;
  description: string;
  pubDate: string;
  updatedDate?: string;
  cover: string;
  dayIndex?: number | '';
  tags: string[];
  categories: string[];
  draft: boolean;
  archived: boolean;
  scheduledAt: string;
  access: 'public' | 'authorized' | 'admin';
  extra: Record<string, string>;
}

function unquoteYaml(val: string): string {
  const s = val.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  return s;
}

export function yamlStr(value: string): string {
  return JSON.stringify(String(value ?? ''));
}

export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parsePostFile(raw: string): { meta: PostMeta; content: string } {
  const normalized = String(raw || '').replace(/\r\n?/g, '\n');
  const meta: PostMeta = {
    title: '',
    description: '',
    pubDate: localToday(),
    cover: '',
    dayIndex: '',
    tags: [],
    categories: [],
    draft: false,
    archived: false,
    scheduledAt: '',
    access: 'public',
    extra: {},
  };

  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta, content: normalized };

  const fmText = match[1];
  const body = match[2].replace(/^\n/, '');
  const lines = fmText.split('\n');
  let activeListKey = '';

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && (activeListKey === 'tags' || activeListKey === 'categories')) {
      const valItem = unquoteYaml(listItem[1]);
      if (valItem) meta[activeListKey].push(valItem);
      continue;
    }
    activeListKey = '';
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    const val = rawVal.trim();

    if (key === 'tags' || key === 'categories') {
      if (val.startsWith('[') && val.endsWith(']')) {
        meta[key] = val.slice(1, -1).split(',').map((t) => unquoteYaml(t)).filter(Boolean);
      } else if (!val) {
        activeListKey = key;
      } else {
        meta[key] = val.split(/[,，]/).map((t) => unquoteYaml(t)).filter(Boolean);
      }
    } else if (key === 'title') meta.title = unquoteYaml(val);
    else if (key === 'description') meta.description = unquoteYaml(val);
    else if (key === 'pubDate') meta.pubDate = unquoteYaml(val).slice(0, 10) || localToday();
    else if (key === 'updatedDate') meta.updatedDate = unquoteYaml(val).slice(0, 10);
    else if (key === 'cover') meta.cover = unquoteYaml(val);
    else if (key === 'dayIndex') {
      const n = parseInt(val, 10);
      if (Number.isInteger(n) && n >= 1) meta.dayIndex = n;
    } else if (key === 'draft') meta.draft = val === 'true';
    else if (key === 'archived') meta.archived = val === 'true';
    else if (key === 'scheduledAt') meta.scheduledAt = unquoteYaml(val);
    else if (key === 'access') {
      const clean = unquoteYaml(val);
      if (clean === 'public' || clean === 'authorized' || clean === 'admin') meta.access = clean;
    } else {
      meta.extra[key] = rawVal;
    }
  }

  return { meta, content: body };
}

export function serializePostFile(meta: PostMeta, content: string): string {
  const lines = [
    '---',
    `title: ${yamlStr(meta.title || '未命名文章')}`,
    `description: ${yamlStr(meta.description || '')}`,
    `pubDate: ${yamlStr(meta.pubDate || localToday())}`,
  ];
  if (meta.dayIndex && Number.isInteger(Number(meta.dayIndex)) && Number(meta.dayIndex) >= 1) {
    lines.push(`dayIndex: ${Number(meta.dayIndex)}`);
  }
  if (meta.updatedDate) lines.push(`updatedDate: ${yamlStr(meta.updatedDate)}`);
  if (meta.cover && meta.cover.trim()) lines.push(`cover: ${yamlStr(meta.cover.trim())}`);
  const tags = (meta.tags || []).map((t) => t.trim()).filter(Boolean);
  if (tags.length) {
    lines.push('tags:');
    tags.forEach((t) => lines.push(`  - ${yamlStr(t)}`));
  }
  const categories = [...new Set((meta.categories || []).map((c) => c.trim()).filter(Boolean))];
  if (categories.length) {
    lines.push('categories:');
    categories.forEach((c) => lines.push(`  - ${yamlStr(c)}`));
  }
  lines.push(`draft: ${Boolean(meta.draft)}`);
  lines.push(`access: ${meta.access || 'public'}`);
  if (meta.archived) lines.push('archived: true');
  if (meta.scheduledAt && meta.scheduledAt.trim()) lines.push(`scheduledAt: ${yamlStr(meta.scheduledAt.trim())}`);
  for (const [k, v] of Object.entries(meta.extra || {})) {
    if (/^[A-Za-z0-9_-]+$/.test(k)) lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', String(content || '').trimEnd(), '');
  return lines.join('\n');
}

export function slugifyTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
