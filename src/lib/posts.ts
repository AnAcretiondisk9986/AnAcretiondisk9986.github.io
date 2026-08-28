/**
 * 全站公开文章拉取与排序（首页 / 卷册目录 / 图志共用）。
 * 过滤草稿与仅管理员可见文章，按 pubDate 降序 → dayIndex 降序 → id 降序。
 */
import { getCollection } from 'astro:content';

export async function getPublicPosts() {
  return (await getCollection('blog', ({ data }) => !data.draft && data.access !== 'admin'))
    .sort((a, b) =>
      b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
      || (b.data.dayIndex ?? 0) - (a.data.dayIndex ?? 0)
      || b.id.localeCompare(a.id));
}
