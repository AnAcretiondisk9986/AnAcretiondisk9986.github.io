import type { APIRoute } from 'astro';
import { getPublicPosts } from '../lib/posts';
import frontend from '../data/frontend.json';

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
  const siteName = frontend.siteName || 'Acretiondisk';
  const siteDesc = frontend.siteTagline || '记录技术、医学、艺术与生活。';

  // RSS 仅输出完全公开（access === 'public'）文章，不暴露授权级 / 管理员级私密内容
  const posts = (await getPublicPosts())
    .filter((p) => !p.data.access || p.data.access === 'public')
    .slice(0, 50);

  const lastBuild = posts[0]?.data.pubDate ? posts[0].data.pubDate.toUTCString() : new Date().toUTCString();

  const itemsXml = posts.map((post) => {
    const link = `${origin}/blog/${encodeURI(post.id)}/`;
    const cats = [...(post.data.categories || []), ...(post.data.tags || [])];
    const catTags = [...new Set(cats)]
      .map((c) => `    <category>${escXml(c)}</category>`)
      .join('\n');
    return `  <item>
    <title>${escXml(post.data.title)}</title>
    <link>${escXml(link)}</link>
    <guid isPermaLink="true">${escXml(link)}</guid>
    <pubDate>${escXml(post.data.pubDate.toUTCString())}</pubDate>
    <description>${escXml(post.data.description || post.data.title)}</description>
${catTags}
  </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escXml(siteName)}</title>
  <link>${escXml(origin)}/</link>
  <description>${escXml(siteDesc)}</description>
  <language>zh-CN</language>
  <lastBuildDate>${escXml(lastBuild)}</lastBuildDate>
  <atom:link href="${escXml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />
${itemsXml}
</channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
