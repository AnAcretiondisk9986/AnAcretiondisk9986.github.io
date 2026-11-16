/**
 * HORIZON 设计系统的纯函数工具：时间（MJD / 红移）、字数（质量）、阅读时长、编号、封面。
 * 只在构建期（Astro frontmatter）使用，不进入浏览器包。
 */
import type { CollectionEntry } from 'astro:content';
import { firstImageFromBody } from './post-cover';
import { thumbOf } from './gallery';

type Post = CollectionEntry<'blog'>;

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 修正儒略日（Modified Julian Date），天文常用的连续日计数 */
export const mjd = (d: Date) => d.getTime() / 86400000 + 40587;

/** 2026.09.28 */
export const fmtDot = (d: Date) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;

/** 2026-09-28 或 2026-09-28 21:04（frontmatter 只写日期时不伪造 08:00） */
export const fmtMinute = (d: Date) => {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const isDateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  return isDateOnly ? date : `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 去掉代码、图片、链接地址、HTML 与 Markdown 记号后的「有效字符」 */
const plainText = (body = '') =>
  body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#>*_`|~\-\s]/g, '');

/** 质量：有效字数 */
export const massOf = (body = '') => plainText(body).length;

/** 阅读时长：中文约 400 字 / 分钟 */
export const readingMinutes = (body = '') => Math.max(1, Math.round(massOf(body) / 400));

/** 质量的短写：8.4k */
export const fmtMass = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * 红移：发表距构建时刻的天数 / 365。只是一个风格化读数，不是物理量。
 * age 归一到 0..1，供 CSS 把旧文章标题往红、暗方向推。
 */
export const redshift = (d: Date, now = Date.now()) => {
  const days = Math.max(0, (now - d.getTime()) / 86400000);
  return { z: days / 365, age: Math.min(1, days / 240) };
};

/** 同一天多篇时带上日内序号的编号：2026—0928 / 2026—0928—02 */
export function folioCodes(posts: Post[]) {
  const dayCounts = new Map<string, number>();
  for (const post of posts) {
    const key = post.data.pubDate.toISOString().slice(0, 10);
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  return (post: Post) => {
    const d = post.data.pubDate;
    const key = d.toISOString().slice(0, 10);
    const base = `${d.getFullYear()}—${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    return (dayCounts.get(key) ?? 0) > 1 ? `${base}—${pad2(post.data.dayIndex ?? 1)}` : base;
  };
}

/** 封面：frontmatter cover → 正文首图；thumb 走 480px 缩略图，original 供 cdn-fallback 回退 */
export function coverOf(post: Post) {
  const original = post.data.cover?.trim() || firstImageFromBody(post.body ?? '');
  if (!original) return { thumb: '', original: '' };
  const thumb = thumbOf(original);
  return { thumb, original: thumb !== original ? original : '' };
}

/** 把文本里的 http(s) 链接转成 <a>；先整体转义，杜绝注入 */
export function linkify(text = '') {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g, (raw) => {
    const url = raw.replace(/[),.;:!?]+$/, '').replace(/[）】」』，。；：！？、]+$/, '');
    if (!url) return raw;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

/** 公开可列出的过滤条件（与 lib/posts.ts 一致），文章页 / 短链页的 getStaticPaths 共用 */
export const isListable = ({ data }: Post) =>
  !data.draft && !data.archived && data.access !== 'admin' && (!data.scheduledAt || data.scheduledAt.getTime() <= Date.now());
