import { massOf, mjd, pad2 } from './horizon';
import { normalizePostCategories, UNCATEGORIZED_LABEL } from './categories';

export interface ReportMilestone {
  date: string;
  title: string;
  detail: string;
  link?: string;
}

export interface ReportEntry {
  id: string;
  title: string;
  subtitle: string;
  periodLabel: string;
  dateStart: string;
  dateEnd: string;
  summary: string;
  keywords: string[];
  milestones: ReportMilestone[];
  featuredPosts: string[];
  featuredDailies: string[];
  outroQuote: string;
  published: boolean;
  order: number;
}

export interface ReportDataPayload {
  activeReportId: string;
  reports: ReportEntry[];
}

export function normalizeReportPayload(raw: unknown): ReportDataPayload {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const list = Array.isArray(obj.reports) ? obj.reports : [];
  const seen = new Set<string>();
  const reports: ReportEntry[] = [];

  list.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const r = item as Record<string, unknown>;
    const rawId = String(r.id ?? '').trim() || `report-${idx + 1}`;
    const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || `report-${idx + 1}`;
    if (seen.has(id)) return;
    seen.add(id);

    const keywords = (Array.isArray(r.keywords) ? r.keywords : String(r.keywords ?? '').split(/[,，]/))
      .map((s) => String(s ?? '').trim().slice(0, 32))
      .filter(Boolean)
      .slice(0, 20);

    const milestones: ReportMilestone[] = (Array.isArray(r.milestones) ? r.milestones : [])
      .slice(0, 30)
      .map((m) => {
        if (!m || typeof m !== 'object') return null;
        const mm = m as Record<string, unknown>;
        const title = String(mm.title ?? '').trim().slice(0, 120);
        if (!title) return null;
        const link = String(mm.link ?? '').trim().slice(0, 400);
        return {
          date: String(mm.date ?? '').trim().slice(0, 32),
          title,
          detail: String(mm.detail ?? '').trim().slice(0, 320),
          ...(link ? { link } : {}),
        };
      })
      .filter((x): x is ReportMilestone => Boolean(x));

    const strArr = (v: unknown) =>
      (Array.isArray(v) ? v : [])
        .map((x) => String(x ?? '').trim().slice(0, 140))
        .filter(Boolean)
        .slice(0, 20);

    reports.push({
      id,
      title: String(r.title ?? '').trim().slice(0, 120) || id,
      subtitle: String(r.subtitle ?? '').trim().slice(0, 240),
      periodLabel: String(r.periodLabel ?? '').trim().slice(0, 60),
      dateStart: String(r.dateStart ?? '').trim().slice(0, 10),
      dateEnd: String(r.dateEnd ?? '').trim().slice(0, 10),
      summary: String(r.summary ?? '').trim().slice(0, 2000),
      keywords,
      milestones,
      featuredPosts: strArr(r.featuredPosts),
      featuredDailies: strArr(r.featuredDailies),
      outroQuote: String(r.outroQuote ?? '').trim().slice(0, 300),
      published: r.published !== false,
      order: Number.isFinite(Number(r.order)) ? Math.round(Number(r.order)) : idx + 1,
    });
  });

  reports.sort((a, b) => a.order - b.order);
  const activeReportId = reports.some((r) => r.id === obj.activeReportId)
    ? String(obj.activeReportId)
    : (reports[0]?.id || '');
  return { activeReportId, reports };
}

export interface MonthlyMetric {
  month: string;
  posts: number;
  chars: number;
  dailies: number;
  frames: number;
}

export interface PeriodTelemetry {
  postCount: number;
  totalChars: number;
  avgChars: number;
  longestPost: { id: string; title: string; chars: number } | null;
  dailyCount: number;
  frameCount: number;
  activeDays: number;
  galleryCount: number;
  months: MonthlyMetric[];
  topCategories: Array<{ name: string; count: number; chars: number }>;
  topTags: Array<{ name: string; count: number }>;
  topDevices: Array<{ name: string; count: number }>;
  topLocations: Array<{ name: string; count: number }>;
  mjdSpan: string;
}

function inDateRange(dateKey: string, start: string, end: string): boolean {
  if (!dateKey) return !start && !end;
  if (start && dateKey < start) return false;
  if (end && dateKey > end) return false;
  return true;
}

function shanghaiDay(isoOrDate: Date | string): { day: string; month: string; ms: number } {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const ms = Number.isFinite(d.getTime()) ? d.getTime() : 0;
  const sh = new Date(ms + 8 * 3600_000);
  const y = sh.getUTCFullYear();
  const m = pad2(sh.getUTCMonth() + 1);
  const day = pad2(sh.getUTCDate());
  return { day: `${y}-${m}-${day}`, month: `${y}-${m}`, ms };
}

export function computePeriodTelemetry(options: {
  dateStart?: string;
  dateEnd?: string;
  posts: Array<{ id: string; body?: string; data: { title: string; pubDate: Date; tags: string[]; categories?: string[] } }>;
  dailies: Array<{ id: string; createdAt: string; images?: unknown[]; tags?: string[]; device?: string; location?: string }>;
  gallery: Array<{ id: string; date?: string }>;
}): PeriodTelemetry {
  const start = (options.dateStart || '').trim();
  const end = (options.dateEnd || '').trim();

  const posts = options.posts.filter((p) => inDateRange(shanghaiDay(p.data.pubDate).day, start, end));
  const dailies = options.dailies.filter((d) => inDateRange(shanghaiDay(d.createdAt).day, start, end));
  const gallery = options.gallery.filter((g) => {
    if (!start && !end) return true;
    return g.date ? inDateRange(g.date.slice(0, 10), start, end) : false;
  });

  let totalChars = 0;
  let longestPost: { id: string; title: string; chars: number } | null = null;
  const monthMap = new Map<string, MonthlyMetric>();
  const catMap = new Map<string, { count: number; chars: number }>();
  const tagMap = new Map<string, number>();
  const activeDaySet = new Set<string>();
  const timestamps: number[] = [];

  const ensureMonth = (month: string) => {
    let m = monthMap.get(month);
    if (!m) {
      m = { month, posts: 0, chars: 0, dailies: 0, frames: 0 };
      monthMap.set(month, m);
    }
    return m;
  };

  for (const post of posts) {
    const chars = massOf(post.body ?? '');
    totalChars += chars;
    if (!longestPost || chars > longestPost.chars) {
      longestPost = { id: post.id, title: post.data.title, chars };
    }
    const dt = shanghaiDay(post.data.pubDate);
    activeDaySet.add(dt.day);
    timestamps.push(dt.ms);
    const m = ensureMonth(dt.month);
    m.posts += 1;
    m.chars += chars;

    const cats = normalizePostCategories(post.data.categories);
    const catKeys = cats.length > 0 ? cats : [UNCATEGORIZED_LABEL];
    for (const c of catKeys) {
      const prev = catMap.get(c) ?? { count: 0, chars: 0 };
      catMap.set(c, { count: prev.count + 1, chars: prev.chars + chars });
    }
    for (const t of post.data.tags) {
      tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
    }
  }

  let frameCount = 0;
  const deviceMap = new Map<string, number>();
  const locMap = new Map<string, number>();

  for (const d of dailies) {
    const dt = shanghaiDay(d.createdAt);
    activeDaySet.add(dt.day);
    timestamps.push(dt.ms);
    const imgs = Array.isArray(d.images) ? d.images.length : 0;
    frameCount += imgs;
    const m = ensureMonth(dt.month);
    m.dailies += 1;
    m.frames += imgs;
    if (d.device) deviceMap.set(d.device, (deviceMap.get(d.device) ?? 0) + 1);
    if (d.location) locMap.set(d.location, (locMap.get(d.location) ?? 0) + 1);
    for (const t of d.tags || []) {
      tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
    }
  }

  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const topCategories = [...catMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count || b.chars - a.chars);
  const topTags = [...tagMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const topDevices = [...deviceMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const topLocations = [...locMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  let mjdSpan = '—';
  if (timestamps.length > 0) {
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    mjdSpan = `${mjd(new Date(minT)).toFixed(0)} → ${mjd(new Date(maxT)).toFixed(0)}`;
  }

  return {
    postCount: posts.length,
    totalChars,
    avgChars: posts.length > 0 ? Math.round(totalChars / posts.length) : 0,
    longestPost,
    dailyCount: dailies.length,
    frameCount,
    activeDays: activeDaySet.size,
    galleryCount: gallery.length,
    months,
    topCategories,
    topTags,
    topDevices,
    topLocations,
    mjdSpan,
  };
}
