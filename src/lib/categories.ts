export interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  order: number;
}

export const UNCATEGORIZED_ID = 'uncategorized';
export const UNCATEGORIZED_LABEL = '未归类';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeCategoryList(raw: unknown): CategoryItem[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: CategoryItem[] = [];

  raw.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const name = String(obj.name ?? '').trim().slice(0, 40);
    if (!name || seenNames.has(name)) return;
    const rawId = String(obj.id ?? '').trim() || `cat-${idx + 1}`;
    const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || `cat-${idx + 1}`;
    if (seenIds.has(id) || id === UNCATEGORIZED_ID) return;

    seenIds.add(id);
    seenNames.add(name);
    const slugRaw = String(obj.slug ?? '').trim() || id;
    const colorRaw = String(obj.color ?? '').trim();
    const orderNum = Number(obj.order);

    out.push({
      id,
      name,
      slug: slugRaw.slice(0, 48),
      description: String(obj.description ?? '').trim().slice(0, 200),
      color: HEX_COLOR_RE.test(colorRaw) ? colorRaw : '#ff5a1a',
      order: Number.isFinite(orderNum) ? Math.round(orderNum) : idx + 1,
    });
  });

  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export function normalizePostCategories(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const clean = String(item ?? '').trim().slice(0, 40);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export interface CategoryBucket {
  id: string;
  name: string;
  description: string;
  color: string;
  count: number;
}

export function buildCategoryStats(
  definitions: CategoryItem[],
  posts: Array<{ data: { categories?: string[] } }>,
): { buckets: CategoryBucket[]; uncategorizedCount: number } {
  const counts = new Map<string, number>();
  let uncategorizedCount = 0;

  for (const post of posts) {
    const cats = normalizePostCategories(post.data.categories);
    if (cats.length === 0) {
      uncategorizedCount += 1;
      continue;
    }
    for (const name of cats) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const definedNames = new Set(definitions.map((d) => d.name));
  const buckets: CategoryBucket[] = definitions.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    color: d.color,
    count: counts.get(d.name) ?? 0,
  }));

  // 兼容：若文章引用了尚未登记在 categories.json 中的分类名，也自动展示出来
  for (const [name, count] of counts.entries()) {
    if (!definedNames.has(name)) {
      buckets.push({
        id: `extra-${name}`,
        name,
        description: '',
        color: '#ff5a1a',
        count,
      });
    }
  }

  return { buckets, uncategorizedCount };
}
