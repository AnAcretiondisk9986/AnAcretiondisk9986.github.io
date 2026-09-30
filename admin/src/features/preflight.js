/**
 * 发布前检查（preflight）：对当前文章做静态体检，返回可展示的检查结果。
 * 纯函数，不依赖 DOM / 网络，便于测试与复用。
 */

/** 统计正文字数：CJK 按字计，西文按词计 */
export function countChars(markdown) {
  const text = String(markdown || '');
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latinWords = (text.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) || []).length;
  return cjk + latinWords;
}

const SLUG_RE = /^[a-z0-9\u4e00-\u9fff]([a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/i;

/**
 * @param {object} options
 * @param {object} options.form 表单状态（title/description/slug/pubDate/tags/cover/draft/archived/access）
 * @param {string} options.content Markdown 正文
 * @param {Array} options.posts 现有文章列表（用于 Slug 查重）
 * @param {string|null} options.currentSlug 当前编辑文章的 slug
 * @param {Date} [options.now]
 * @returns {{ results: Array<{level:'error'|'warn'|'ok'|'info', label:string, message:string}>, errors:number, warns:number, blocked:boolean }}
 */
export function runPreflight({ form = {}, content = '', posts = [], currentSlug = null, now = new Date() } = {}) {
  const results = [];
  const push = (level, label, message) => results.push({ level, label, message });
  const md = String(content || '');

  const title = String(form.title || '').trim();
  if (!title) push('error', '标题', '标题不能为空');
  else if (title.length > 60) push('warn', '标题', `标题较长（${title.length} 字），列表页可能被截断`);
  else push('ok', '标题', `长度合适（${title.length} 字）`);

  const description = String(form.description || '').trim();
  if (!description) push('warn', '描述', '缺少描述，会影响列表页与分享摘要');
  else if (description.length < 20) push('warn', '描述', `偏短（${description.length} 字），建议 20–160 字`);
  else if (description.length > 160) push('warn', '描述', `偏长（${description.length} 字），建议不超过 160 字`);
  else push('ok', '描述', `长度合适（${description.length} 字）`);

  const slug = String(form.slug || '').trim();
  if (!slug) push('error', 'Slug', 'Slug 不能为空');
  else if (!SLUG_RE.test(slug)) push('error', 'Slug', '只能包含中英文、数字与连字符');
  else {
    const clash = posts.find((p) => p.slug.toLowerCase() === slug.toLowerCase() && p.slug !== currentSlug);
    if (clash) push('error', 'Slug', `与「${clash.title || clash.slug}」重复`);
    else push('ok', 'Slug', '可用');
  }

  if (!form.pubDate) push('warn', '发布日期', '未设置发布日期，将按保存时间推导');
  else {
    const d = new Date(form.pubDate);
    if (Number.isNaN(d.getTime())) push('error', '发布日期', '日期格式不正确');
    else if (d.getTime() > now.getTime() + 24 * 3600 * 1000 && !form.scheduledAt) push('warn', '发布日期', '发布日期在未来，需构建后才会公开');
    else push('ok', '发布日期', String(form.pubDate));
  }

  const tags = String(form.tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  if (!tags.length) push('warn', '标签', '未设置标签，不利于分类与检索');
  else push('ok', '标签', `${tags.length} 个标签`);

  const imgs = [...md.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)];
  const htmlImgs = [...md.matchAll(/<img\b[^>]*>/gi)];
  const imageCount = imgs.length + htmlImgs.length;
  if (!String(form.cover || '').trim() && !imageCount) push('warn', '封面', '没有封面也没有正文图片，列表页可能缺少配图');
  else push('ok', '封面', String(form.cover || '').trim() ? '已设置自定义封面' : '将使用正文首图');

  const missingAlt = imgs.filter((m) => !String(m[1] || '').trim()).length
    + htmlImgs.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;
  if (missingAlt) push('warn', '图片 alt', `${missingAlt} 张图片缺少 alt 文本`);
  else if (imageCount) push('ok', '图片 alt', '图片均含 alt 文本');
  else push('ok', '图片 alt', '正文没有图片');

  const chars = countChars(md);
  if (!md.trim()) push('error', '正文', '正文为空');
  else if (chars < 80) push('warn', '正文', `正文偏短（${chars} 字）`);
  else push('ok', '正文', `${chars} 字，约 ${Math.max(1, Math.round(chars / 300))} 分钟`);

  if (form.archived) push('warn', '归档', '文章处于归档状态，不会出现在公开列表');
  if (form.draft) push('info', '发布状态', '当前为草稿，不会出现在公开列表');
  else push('info', '发布状态', '将作为已发布文章');
  if (form.access === 'admin') push('info', '访问权限', '管理员级文章，需要密码访问');
  else if (form.access === 'authorized') push('info', '访问权限', '授权级文章，需要验证站长网名');

  const errors = results.filter((r) => r.level === 'error').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  return { results, errors, warns, blocked: errors > 0 };
}
