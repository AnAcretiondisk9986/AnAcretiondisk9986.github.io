/**
 * Word / WPS / 飞书 / 网页富文本粘贴清洗与图片提取工具：
 * 剔除冗余 mso-* / 无意义内联字体与背景，保留标题、加粗、斜体、下划线、删除线、
 * 对齐、有效前景色/高亮、列表、表格与链接，并支持收集外部图片链接以便自动转存图库。
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'STRIKE', 'MARK', 'SUB', 'SUP', 'CODE', 'PRE',
  'BLOCKQUOTE', 'UL', 'OL', 'LI', 'HR',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'SPAN', 'DIV', 'DETAILS', 'SUMMARY',
]);

function normalizeColor(raw) {
  const s = String(raw || '').trim();
  if (!s || /^inherit|initial|unset|transparent|windowtext|auto$/i.test(s)) return '';
  // 忽略默认纯黑/极暗黑字（Word 深浅主题粘贴进来常带 color: rgb(0,0,0)，在暗色编辑器里会看不见）
  if (/^(?:#000(?:000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(s)) return '';
  return s;
}

function cleanStyleAttr(el) {
  const style = el.style;
  if (!style) return '';
  const kept = [];
  const tag = el.tagName;

  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV'].includes(tag)) {
    const align = style.textAlign;
    if (align && ['left', 'center', 'right', 'justify'].includes(align.toLowerCase())) {
      kept.push(`text-align: ${align.toLowerCase()}`);
    }
    const ti = style.textIndent;
    if (ti && parseFloat(ti) >= 12) kept.push('text-indent: 2em');
  }

  if (['SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'MARK'].includes(tag)) {
    const color = normalizeColor(style.color);
    if (color) kept.push(`color: ${color}`);
    const bg = normalizeColor(style.backgroundColor);
    if (bg && !/^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|^#fff(?:fff)?$/i.test(bg)) {
      kept.push(`background-color: ${bg}`);
    }
  }

  if (tag === 'IMG') {
    const w = style.width;
    if (w && /^[\d.]+(?:%|px)$/.test(w)) kept.push(`width: ${w}`);
  }

  return kept.join('; ');
}

/** 清洗从 Word / 网页粘贴过来的 HTML，返回干净 HTML 与发现的外部图片 URL 列表 */
export function cleanPastedHtml(rawHtml) {
  if (!rawHtml || typeof DOMParser === 'undefined') return { html: rawHtml || '', externalImages: [] };

  // 先剥离 Word 条件注释与 <style>/<meta>/<xml> 块
  const stripped = String(rawHtml)
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|meta|link|xml|o:p)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:o:p|w:[^>\s]+)[^>]*>/gi, '');

  const doc = new DOMParser().parseFromString(stripped, 'text/html');
  const externalImages = [];

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      return;
    }

    const children = [...node.childNodes];
    children.forEach(walk);

    const tag = node.tagName;
    if (!ALLOWED_TAGS.has(tag)) {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      return;
    }

    // 保留合法属性，清洗其余属性
    const href = tag === 'A' ? node.getAttribute('href') : '';
    const src = tag === 'IMG' ? node.getAttribute('src') : '';
    const alt = tag === 'IMG' ? (node.getAttribute('alt') || '') : '';
    const colspan = (tag === 'TD' || tag === 'TH') ? node.getAttribute('colspan') : '';
    const rowspan = (tag === 'TD' || tag === 'TH') ? node.getAttribute('rowspan') : '';
    const cls = node.getAttribute('class') || '';
    const styleStr = cleanStyleAttr(node);

    [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));

    if (styleStr) node.setAttribute('style', styleStr);
    if (href && /^(?:https?:|mailto:|\/|#)/i.test(href)) node.setAttribute('href', href);
    if (tag === 'IMG' && src) {
      node.setAttribute('src', src);
      node.setAttribute('alt', alt);
      if (/^https?:\/\//i.test(src) && !src.includes('cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images')) {
        externalImages.push(src);
      }
    }
    if (colspan && Number(colspan) > 1) node.setAttribute('colspan', colspan);
    if (rowspan && Number(rowspan) > 1) node.setAttribute('rowspan', rowspan);

    // 保留本博客自有的语义容器类名
    const safeClasses = cls.split(/\s+/).filter((c) => /^(?:hz-|song-player|video-embed|language-)/.test(c));
    if (safeClasses.length) node.setAttribute('class', safeClasses.join(' '));

    // 空无属性 span 拆壳
    if (tag === 'SPAN' && !node.attributes.length && node.parentNode) {
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.remove();
    }
  }

  walk(doc.body);
  return {
    html: doc.body.innerHTML,
    externalImages: [...new Set(externalImages)],
  };
}
