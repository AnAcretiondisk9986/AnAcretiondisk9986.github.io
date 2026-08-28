/**
 * 图志（gallery）共用数据工具：缩略图 URL 推导、按时间/日内序号排序、精简类型。
 * 供图志页与首页「图志精选」版块共用。
 */

export interface GalleryImageBrief {
  id: string;
  src: string;
  thumb?: string;
  alt: string;
  title: string;
  date?: string;
  dayIndex?: number;
}

/** 主图 URL → 缩略图 URL：image/xxx.<ext> → image/thumb/xxx.webp
 * （缩略图由 scripts/gen-thumbs.mjs 批量生成 / 上传时同步生成，全部为 480px webp） */
export const thumbOf = (src: string) => {
  const m = src.match(/^(.*\/image\/)([^/?#]+)$/);
  if (!m) return src;
  const base = decodeURIComponent(m[2]).replace(/\.[^.]+$/, '');
  return `${m[1]}thumb/${encodeURIComponent(base)}.webp`;
};

const imageTime = (image: GalleryImageBrief) =>
  image.date ? Date.parse(image.date) : Number.NEGATIVE_INFINITY;

const dayIndexOf = (image: GalleryImageBrief) => image.dayIndex ?? 0;

/** 从新至旧排序：date 降序 → dayIndex 降序，不修改原数组 */
export const sortNewestFirst = (images: GalleryImageBrief[]) =>
  [...images].sort(
    (a, b) => imageTime(b) - imageTime(a) || dayIndexOf(b) - dayIndexOf(a),
  );
