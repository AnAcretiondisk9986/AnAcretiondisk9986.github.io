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

function parseRgb(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] !== undefined ? Number(rgb[4]) : 1 };
  const hex3 = s.match(/^#([0-9a-f]{3})$/);
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  const hex6 = s.match(/^#([0-9a-f]{6})$/);
  if (hex6) {
    return {
      r: parseInt(hex6[1].slice(0, 2), 16),
      g: parseInt(hex6[1].slice(2, 4), 16),
      b: parseInt(hex6[1].slice(4, 6), 16),
      a: 1,
    };
  }
  return null;
}

function isNeutralGray(c) {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 18;
}

function normalizeTextColor(raw) {
  const s = String(raw || '').trim();
  if (!s || /^inherit|initial|unset|transparent|windowtext|auto$/i.test(s)) return '';
  if (/^(?:black|white)$/i.test(s)) return '';
  const c = parseRgb(s);
  if (c) {
    if (c.a === 0) return '';
    // 剔除默认纯黑/极暗灰正文色（浅色网页/Word 粘贴）与默认纯白/极浅灰正文色（暗色网页如 X/Twitter 粘贴）
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (isNeutralGray(c) && (lum <= 48 || lum >= 220)) return '';
  }
  return s;
}

function normalizeBgColor(raw) {
  const s = String(raw || '').trim();
  if (!s || /^inherit|initial|unset|transparent|windowtext|auto$/i.test(s)) return '';
  if (/^(?:black|white)$/i.test(s)) return '';
  const c = parseRgb(s);
  if (c) {
    if (c.a === 0) return '';
    // 剔除页面底色：纯白/近白（浅色站点）或纯黑/深灰底（暗色站点如 X/Discord/VSCode）
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (isNeutralGray(c) && (lum <= 42 || lum >= 235)) return '';
  }
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
    const color = normalizeTextColor(style.color);
    if (color) kept.push(`color: ${color}`);
    const bg = normalizeBgColor(style.backgroundColor);
    if (bg) kept.push(`background-color: ${bg}`);
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

    // 空无属性 span，或非法包裹块级元素的 span 拆壳
    const wrapsBlock = tag === 'SPAN' && Boolean(node.querySelector('p, div, blockquote, pre, table, ul, ol, h1, h2, h3, h4, h5, h6'));
    if (tag === 'SPAN' && (!node.attributes.length || wrapsBlock) && node.parentNode) {
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
