/** 由标题生成 Slug：小写、非中英文数字字符转连字符、去首尾连字符、限长 80 */
export function slugifyTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
