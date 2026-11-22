import type { APIRoute } from 'astro';
import { getPublicPosts } from '../lib/posts';

function escXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  const origin = (site?.origin || 'https://blog.acretiondisk.top').replace(/\/$/, '');
  const staticPaths = [
    { path: '/', priority: '1.0' },
    { path: '/blog/', priority: '0.9' },
    { path: '/blog/report/', priority: '0.8' },
    { path: '/projects/', priority: '0.9' },
    { path: '/daily/', priority: '0.8' },
    { path: '/gallery/', priority: '0.8' },
    { path: '/about/', priority: '0.7' },
    { path: '/academics/', priority: '0.7' },
    { path: '/schedule/', priority: '0.6' },
    { path: '/schedule/exams/', priority: '0.6' },
    { path: '/ai-quota/', priority: '0.6' },
    { path: '/ai-quota/pricing/', priority: '0.5' },
  ];

  const posts = (await getPublicPosts()).filter((p) => !p.data.access || p.data.access === 'public');
  const todayIso = new Date().toISOString().split('T')[0];

  const urls = [
    ...staticPaths.map((s) => `  <url>
    <loc>${escXml(`${origin}${s.path}`)}</loc>
    <lastmod>${todayIso}</lastmod>
    <priority>${s.priority}</priority>
  </url>`),
    ...posts.map((post) => {
      const lastmod = (post.data.updatedDate || post.data.pubDate).toISOString().split('T')[0];
      return `  <url>
    <loc>${escXml(`${origin}/blog/${encodeURI(post.id)}/`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <priority>0.75</priority>
  </url>`;
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
