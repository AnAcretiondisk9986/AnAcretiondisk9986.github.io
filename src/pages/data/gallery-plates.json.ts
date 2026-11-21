import type { APIRoute } from 'astro';
import { sortNewestFirst, thumbOf } from '../../lib/gallery';
import { safeLink } from '../../lib/safe-link';
import standaloneGallery from '../../data/gallery.json';

interface RawGalleryItem {
  id: string;
  src: string;
  thumb?: string;
  original?: string;
  alt?: string;
  title?: string;
  caption?: string;
  date?: string;
  dayIndex?: number;
  sourceUrl?: string;
  sourceTitle?: string;
}

export const GET: APIRoute = () => {
  const standaloneImages = sortNewestFirst(standaloneGallery as RawGalleryItem[]).map((img) => {
    const thumb = img.thumb || thumbOf(img.src);
    const out: Record<string, unknown> = {
      id: img.id,
      src: img.src,
      alt: img.alt || '',
      title: img.title || '',
    };
    if (thumb && thumb !== img.src) out.thumb = thumb;
    if (img.original && img.original !== img.src) out.original = img.original;
    if (img.caption) out.caption = img.caption;
    if (img.date) out.date = img.date;
    if (img.dayIndex) out.dayIndex = img.dayIndex;
    const safeSrc = safeLink(img.sourceUrl);
    if (safeSrc) out.sourceUrl = safeSrc;
    if (img.sourceTitle) out.sourceTitle = img.sourceTitle;
    return out;
  });

  return new Response(JSON.stringify(standaloneImages), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
