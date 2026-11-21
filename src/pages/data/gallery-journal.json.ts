import type { APIRoute } from 'astro';
import { getPublicPosts } from '../../lib/posts';
import { thumbOf } from '../../lib/gallery';

const markdownImage = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

export const GET: APIRoute = async () => {
  const posts = await getPublicPosts();
  const journalImages = posts.flatMap((post) => {
    const body = post.body ?? '';
    return [...body.matchAll(markdownImage)].map((match, idx) => {
      const src = match[2];
      const fileName = decodeURIComponent(src.split('/').pop() || `image-${idx + 1}`);
      const item: Record<string, unknown> = {
        id: `journal-${post.id}-${idx + 1}`,
        src,
        thumb: thumbOf(src),
        title: post.data.title,
        date: post.data.pubDate.toISOString().slice(0, 10),
        sourceUrl: `/blog/${post.id}/`,
      };
      if (match[1]) item.alt = match[1];
      if (match[1] || fileName) item.caption = match[1] || fileName;
      if (post.data.dayIndex) item.dayIndex = post.data.dayIndex;
      return item;
    });
  });

  return new Response(JSON.stringify(journalImages), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
