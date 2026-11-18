import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { thumbOf } from './gallery';
import { mjd, pad2 } from './horizon';
import { safeLink } from './safe-link';

export const MAX_DAILY_IMAGES = 9;

export interface DailyImageInput {
  src: string;
  thumb?: string;
  original?: string;
  alt?: string;
}

export interface DailyLinkCardInput {
  title: string;
  url: string;
  description?: string;
  label?: string;
}

export interface DailyEntryInput {
  id: string;
  createdAt: string;
  text: string;
  images?: DailyImageInput[];
  tags?: string[];
  pinned?: boolean;
  threadId?: string;
  threadLabel?: string;
  location?: string;
  device?: string;
  mood?: string;
  linkCard?: DailyLinkCardInput;
  draft?: boolean;
}

export interface ResolvedDailyImage {
  src: string;
  fullSrc: string;
  originalSrc: string;
  fallbackSrc: string;
  alt: string;
  index: number;
}

export interface ResolvedDailyLinkCard {
  title: string;
  url: string;
  description: string;
  label: string;
  external: boolean;
}

export interface NormalizedDailyEntry {
  id: string;
  createdAt: string;
  timestamp: number;
  dateDot: string;
  timeStr: string;
  fullDateTime: string;
  monthKey: string;
  monthLabel: string;
  dayKey: string;
  mjdLabel: string;
  text: string;
  html: string;
  images: ResolvedDailyImage[];
  tags: string[];
  pinned: boolean;
  threadId: string;
  threadLabel: string;
  location: string;
  device: string;
  mood: string;
  linkCard: ResolvedDailyLinkCard | null;
  searchBlob: string;
}

export interface DailyTagCount {
  tag: string;
  count: number;
}

export interface DailyMonthBucket {
  key: string;
  label: string;
  count: number;
}

export interface DailyPulseDay {
  dayKey: string;
  count: number;
  level: 0 | 1 | 2 | 3;
}

export interface DailyStats {
  totalMoments: number;
  totalFrames: number;
  activeDays: number;
  pinnedCount: number;
  mediaMoments: number;
  textMoments: number;
  latestLabel: string;
  tags: DailyTagCount[];
  months: DailyMonthBucket[];
  pulseDays: DailyPulseDay[];
}

const PUBLIC_DIR = join(process.cwd(), 'public');
const CDN_RE = /^https:\/\/cdn\.jsdelivr\.net\/gh\/AnAcretiondisk9986\/blog-images@main\/(image\/[^\s"'<>)]+)$/;

function localIfExists(webPath: string): string {
  try {
    const abs = join(PUBLIC_DIR, webPath.replace(/^\/+/, ''));
    return existsSync(abs) ? webPath : '';
  } catch {
    return '';
  }
}

function resolveImageUrls(input: DailyImageInput, index: number): ResolvedDailyImage {
  const rawSrc = String(input.src || '').trim();
  const remoteThumb = input.thumb?.trim() || thumbOf(rawSrc);
  const originalSrc = input.original?.trim() || rawSrc;

  let localFull = '';
  let localThumb = '';
  const m = rawSrc.match(CDN_RE);
  if (m && !m[1].includes('/original/')) {
    const rel = m[1].replace(/^image\//, '').replace(/\.[^./]+$/, '.webp');
    const fileName = rel.split('/').pop() || '';
    localFull = localIfExists(`/images/ext/${rel}`);
    if (fileName) {
      localThumb = localIfExists(`/images/ext/thumb/${fileName}`);
    }
  }

  const fullSrc = localFull || rawSrc;
  const thumbSrc = localThumb || localFull || remoteThumb || rawSrc;
  const fallbackSrc = thumbSrc !== fullSrc ? fullSrc : rawSrc !== thumbSrc ? rawSrc : '';

  return {
    src: thumbSrc,
    fullSrc,
    originalSrc,
    fallbackSrc,
    alt: String(input.alt || '').trim(),
    index,
  };
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const URL_TOKEN_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const HASHTAG_RE = /(^|[\s(（[【])#([A-Za-z0-9_\-\u4e00-\u9fff\u3040-\u30ff]+)/g;

function highlightInlineTags(escapedPlain: string, collector: Set<string>): string {
  return escapedPlain.replace(HASHTAG_RE, (_full, lead: string, tag: string) => {
    collector.add(tag);
    return `${lead}<button type="button" class="hz-tl-hashtag" data-tl-tag-inline="${tag}">#${tag}</button>`;
  });
}

function renderTweetParagraphs(text: string): { html: string; extractedTags: string[] } {
  const collector = new Set<string>();
  const paragraphs = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = paragraphs
    .map((para) => {
      const lines = para.split('\n').map((line) => {
        let out = '';
        let cursor = 0;
        URL_TOKEN_RE.lastIndex = 0;
        for (const match of line.matchAll(URL_TOKEN_RE)) {
          const idx = match.index ?? 0;
          if (idx > cursor) {
            out += highlightInlineTags(escapeHtml(line.slice(cursor, idx)), collector);
          }
          const rawUrl = match[0];
          const trimmed = rawUrl
            .replace(/[),.;:!?]+$/, '')
            .replace(/[）】」』，。；：！？、]+$/, '');
          const suffix = rawUrl.slice(trimmed.length);
          const safe = safeLink(trimmed, '');
          if (safe) {
            const label = trimmed.replace(/^https?:\/\//, '');
            const display = label.length > 44 ? `${label.slice(0, 41)}…` : label;
            out += `<a class="hz-tl-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(display)}</a>${escapeHtml(suffix)}`;
          } else {
            out += escapeHtml(rawUrl);
          }
          cursor = idx + rawUrl.length;
        }
        if (cursor < line.length) {
          out += highlightInlineTags(escapeHtml(line.slice(cursor)), collector);
        }
        return out;
      });
      return `<p>${lines.join('<br />')}</p>`;
    })
    .join('');

  return { html, extractedTags: [...collector] };
}

function formatShanghaiTime(iso: string) {
  const parsed = Date.parse(iso);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  const sh = new Date(date.getTime() + 8 * 3600_000);
  const year = sh.getUTCFullYear();
  const month = pad2(sh.getUTCMonth() + 1);
  const day = pad2(sh.getUTCDate());
  const hour = pad2(sh.getUTCHours());
  const minute = pad2(sh.getUTCMinutes());

  return {
    timestamp: date.getTime(),
    dateDot: `${year}.${month}.${day}`,
    timeStr: `${hour}:${minute}`,
    fullDateTime: `${year}.${month}.${day} · ${hour}:${minute}`,
    monthKey: `${year}-${month}`,
    monthLabel: `${year} · ${month}`,
    dayKey: `${year}-${month}-${day}`,
    mjdLabel: `MJD ${mjd(date).toFixed(2)}`,
  };
}

function resolveLinkCard(raw?: DailyLinkCardInput): ResolvedDailyLinkCard | null {
  if (!raw || !raw.url) return null;
  const safeUrl = safeLink(raw.url, '');
  if (!safeUrl) return null;
  return {
    title: String(raw.title || safeUrl).trim(),
    url: safeUrl,
    description: String(raw.description || '').trim(),
    label: String(raw.label || 'LINK').trim(),
    external: /^https?:\/\//i.test(safeUrl),
  };
}

export function normalizeDailyEntries(rawList: DailyEntryInput[]): NormalizedDailyEntry[] {
  const normalized = (Array.isArray(rawList) ? rawList : [])
    .filter((item) => item && !item.draft && item.id && item.createdAt)
    .map((item) => {
      const time = formatShanghaiTime(item.createdAt);
      const { html, extractedTags } = renderTweetParagraphs(item.text || '');
      const tagSet = new Set<string>();
      for (const t of item.tags || []) {
        const clean = String(t || '').trim().replace(/^#/, '');
        if (clean) tagSet.add(clean);
      }
      for (const t of extractedTags) {
        tagSet.add(t);
      }
      const tags = [...tagSet];
      const images = (Array.isArray(item.images) ? item.images : [])
        .filter((img) => img && img.src)
        .slice(0, MAX_DAILY_IMAGES)
        .map((img, idx) => resolveImageUrls(img, idx));
      const linkCard = resolveLinkCard(item.linkCard);
      const location = String(item.location || '').trim();
      const device = String(item.device || '').trim();
      const mood = String(item.mood || '').trim();

      const searchBlob = [
        item.text || '',
        tags.join(' '),
        time.dateDot,
        time.dayKey,
        location,
        device,
        mood,
        linkCard?.title || '',
        ...images.map((img) => img.alt),
      ]
        .join(' ')
        .toLowerCase();

      return {
        id: String(item.id).trim(),
        createdAt: item.createdAt,
        timestamp: time.timestamp,
        dateDot: time.dateDot,
        timeStr: time.timeStr,
        fullDateTime: time.fullDateTime,
        monthKey: time.monthKey,
        monthLabel: time.monthLabel,
        dayKey: time.dayKey,
        mjdLabel: time.mjdLabel,
        text: String(item.text || '').trim(),
        html,
        images,
        tags,
        pinned: Boolean(item.pinned),
        threadId: String(item.threadId || '').trim(),
        threadLabel: String(item.threadLabel || '').trim(),
        location,
        device,
        mood,
        linkCard,
        searchBlob,
      };
    });

  return normalized.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp || b.id.localeCompare(a.id),
  );
}

export function computeDailyStats(entries: NormalizedDailyEntry[]): DailyStats {
  const tagMap = new Map<string, number>();
  const monthMap = new Map<string, { label: string; count: number }>();
  const dayMap = new Map<string, number>();
  let totalFrames = 0;
  let pinnedCount = 0;
  let mediaMoments = 0;
  let textMoments = 0;
  let latestTs = 0;
  let latestLabel = '—';

  for (const entry of entries) {
    totalFrames += entry.images.length;
    if (entry.pinned) pinnedCount += 1;
    if (entry.images.length > 0) mediaMoments += 1;
    else textMoments += 1;
    if (entry.timestamp > latestTs) {
      latestTs = entry.timestamp;
      latestLabel = entry.fullDateTime;
    }

    dayMap.set(entry.dayKey, (dayMap.get(entry.dayKey) ?? 0) + 1);

    const m = monthMap.get(entry.monthKey);
    if (m) m.count += 1;
    else monthMap.set(entry.monthKey, { label: entry.monthLabel, count: 1 });

    for (const tag of entry.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  const tags: DailyTagCount[] = [...tagMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([tag, count]) => ({ tag, count }));

  const months: DailyMonthBucket[] = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, v]) => ({ key, label: v.label, count: v.count }));

  const anchorMs = latestTs || Date.now();
  const pulseDays: DailyPulseDay[] = [];
  for (let i = 27; i >= 0; i -= 1) {
    const sh = new Date(anchorMs - i * 86400_000 + 8 * 3600_000);
    const dayKey = `${sh.getUTCFullYear()}-${pad2(sh.getUTCMonth() + 1)}-${pad2(sh.getUTCDate())}`;
    const count = dayMap.get(dayKey) ?? 0;
    const level: 0 | 1 | 2 | 3 = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3;
    pulseDays.push({ dayKey, count, level });
  }

  return {
    totalMoments: entries.length,
    totalFrames,
    activeDays: dayMap.size,
    pinnedCount,
    mediaMoments,
    textMoments,
    latestLabel,
    tags,
    months,
    pulseDays,
  };
}
