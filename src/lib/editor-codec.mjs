/**
 * 编辑器双向编解码器：Markdown(+安全HTML) ↔ Tiptap 编辑器 HTML / ProseMirror JSON。
 * 被 PC 端 Word 级编辑器、手机端 /write/ 编辑器与单元测试共同复用。
 */
import { Marked } from 'marked';
import {
  escapeHtml,
  escapeAttr,
  preprocessMarkdownForRender,
} from './markdown-preprocess.mjs';

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);
const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;

export { escapeHtml, escapeAttr };

export function unescapeHtml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function safeUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) return value;
  if (/^(?:https?:|mailto:|tel:|blob:)/i.test(value)) return value;
  return '';
}

function createEditorMarked() {
  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({
    renderer: {
      list(token) {
        const items = Array.isArray(token.items) ? token.items : [];
        const isTask = items.some((i) => i.task);
        const body = items.map((item) => this.listitem(item)).join('');
        if (isTask) return `<ul data-type="taskList">${body}</ul>\n`;
        const tag = token.ordered ? 'ol' : 'ul';
        const start = token.ordered && token.start !== 1 ? ` start="${token.start}"` : '';
        return `<${tag}${start}>${body}</${tag}>\n`;
      },
      listitem(token) {
        let inner = this.parser.parse(token.tokens || []).trim();
        if (token.task) {
          inner = inner.replace(/<input\b[^>]*type=["']?checkbox["']?[^>]*>\s*/i, '').trim();
          if (inner && !/^<(?:p|div|ul|ol|blockquote|pre|h[1-6])\b/i.test(inner)) {
            inner = `<p>${inner}</p>`;
          }
          return `<li data-type="taskItem" data-checked="${token.checked ? 'true' : 'false'}"><label><input type="checkbox"${token.checked ? ' checked' : ''} /><span></span></label><div>${inner}</div></li>\n`;
        }
        return `<li>${inner}</li>\n`;
      },
      image(token) {
        const href = escapeAttr(token.href || '');
        const alt = escapeAttr(token.text || '');
        const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
        return `<img src="${href}" alt="${alt}"${title} />`;
      },
    },
  });
  return instance;
}

const editorMarked = createEditorMarked();

/**
 * 预处理历史博文中的混写 HTML（如 `# <div style="text-align: center">...</div>`、
 * `<span style="..."><div style="text-align: center">...</div></span>`）、CJK 强调与扩展容器。
 * 与 Astro 构建端共用同一份 preprocessMarkdownForRender 实现。
 */
export function normalizeLegacyMarkdown(markdown) {
  return preprocessMarkdownForRender(markdown, {
    forEditor: true,
    parseInline: (raw) => editorMarked.parseInline(String(raw || '').trim()),
    parseBlock: (raw) => editorMarked.parse(String(raw || '').trim()),
  });
}

/** 将 Markdown（含嵌入式 HTML）转换为 Tiptap 编辑器可无损装载的 HTML */
export function markdownToEditorHtml(markdown) {
  const source = String(markdown || '');
  if (!source.trim()) return '<p></p>';
  const normalized = normalizeLegacyMarkdown(source);
  return editorMarked.parse(normalized);
}

// ── ProseMirror / Tiptap JSON → Markdown(+安全HTML) 序列化 ──

function needsHtmlEmphasis(content, prevChar, nextChar, { hasHtmlInner = false, hasAdjacentDelim = false } = {}) {
  if (hasHtmlInner || hasAdjacentDelim) return true;
  if (!content) return false;
  const first = content[0];
  const last = content[content.length - 1];
  if (first === '*' || last === '*' || first === '~' || last === '~' || first === '<' || last === '>') {
    return true;
  }
  const firstPunct = UNICODE_PUNCT_RE.test(first);
  const lastPunct = UNICODE_PUNCT_RE.test(last);
  const prevWsOrEmpty = !prevChar || /\s/.test(prevChar);
  const nextWsOrEmpty = !nextChar || /\s/.test(nextChar);
  const prevPunct = Boolean(prevChar) && UNICODE_PUNCT_RE.test(prevChar);
  const nextPunct = Boolean(nextChar) && UNICODE_PUNCT_RE.test(nextChar);

  // CommonMark §6.2：标点紧邻非空白非标点字符会导致定界符贴合失败，改用显式 HTML 标签保证 100% 可渲染
  if (firstPunct && !prevWsOrEmpty && !prevPunct) return true;
  if (lastPunct && !nextWsOrEmpty && !nextPunct) return true;
  return false;
}

function splitOuterWhitespace(text) {
  const str = String(text ?? '');
  const m = str.match(/^([ \t]*)([\s\S]*?)([ \t]*)$/);
  if (!m) return { lead: '', core: str, trail: '' };
  return { lead: m[1], core: m[2], trail: m[3] };
}

function collectMarkWrappers(marks = [], { useHtml = false, prevChar = '', nextChar = '', adjacentEmphasis = false } = {}) {
  const sorted = [...marks];
  const styleParts = [];
  const textStyleMark = sorted.find((m) => m.type === 'textStyle');
  if (textStyleMark?.attrs) {
    const a = textStyleMark.attrs;
    if (a.color) styleParts.push(`color: ${a.color}`);
    if (a.backgroundColor) styleParts.push(`background-color: ${a.backgroundColor}`);
    if (a.fontSize) styleParts.push(`font-size: ${a.fontSize}`);
    if (a.fontFamily) styleParts.push(`font-family: ${a.fontFamily}`);
  }

  return (rawText) => {
    const hasCode = sorted.some((m) => m.type === 'code');
    const hasEmphasis = sorted.some((m) => m.type === 'bold' || m.type === 'italic' || m.type === 'strike');

    // 对非代码块强调文本，把误选中的首尾空白挪到定界符外，避免生成 "** 文本**" 导致无法渲染
    let leadWs = '';
    let trailWs = '';
    let baseText = String(rawText ?? '');
    if (!useHtml && !hasCode && hasEmphasis && baseText.trim()) {
      const split = splitOuterWhitespace(baseText);
      leadWs = split.lead;
      baseText = split.core;
      trailWs = split.trail;
    }

    let out = useHtml ? escapeHtml(baseText) : baseText;
    let wrappedWithHtml = false;

    // 代码行内标记优先处理（避免内部符号被强调包裹干扰）
    if (hasCode) {
      if (useHtml) {
        out = `<code>${out}</code>`;
        wrappedWithHtml = true;
      } else {
        const ticks = out.includes('``') ? '```' : out.includes('`') ? '``' : '`';
        const pad = out.startsWith('`') || out.endsWith('`') ? ' ' : '';
        out = `${ticks}${pad}${out}${pad}${ticks}`;
      }
    }

    if (styleParts.length) {
      out = `<span style="${escapeAttr(styleParts.join('; '))}">${out}</span>`;
      wrappedWithHtml = true;
    }

    const effPrev = leadWs ? leadWs[leadWs.length - 1] : prevChar;
    const effNext = trailWs ? trailWs[0] : nextChar;
    const hasBold = sorted.some((m) => m.type === 'bold');
    const hasItalic = sorted.some((m) => m.type === 'italic');

    for (const mark of sorted) {
      if (mark.type === 'code' || mark.type === 'textStyle') continue;
      if (mark.type === 'highlight') {
        const bg = mark.attrs?.color;
        out = bg ? `<mark style="background-color: ${escapeAttr(bg)}">${out}</mark>` : `<mark>${out}</mark>`;
        wrappedWithHtml = true;
      } else if (mark.type === 'underline') {
        out = `<u>${out}</u>`;
        wrappedWithHtml = true;
      } else if (mark.type === 'subscript') {
        out = `<sub>${out}</sub>`;
        wrappedWithHtml = true;
      } else if (mark.type === 'superscript') {
        out = `<sup>${out}</sup>`;
        wrappedWithHtml = true;
      } else if (mark.type === 'strike') {
        const forceHtml = useHtml || needsHtmlEmphasis(out, effPrev, effNext, { hasHtmlInner: wrappedWithHtml, hasAdjacentDelim: adjacentEmphasis });
        out = forceHtml ? `<s>${out}</s>` : `~~${out}~~`;
        if (forceHtml) wrappedWithHtml = true;
      } else if (mark.type === 'italic') {
        const forceHtml = useHtml || needsHtmlEmphasis(out, effPrev, effNext, { hasHtmlInner: wrappedWithHtml, hasAdjacentDelim: adjacentEmphasis || hasBold });
        out = forceHtml ? `<em>${out}</em>` : `*${out}*`;
        if (forceHtml) wrappedWithHtml = true;
      } else if (mark.type === 'bold') {
        const forceHtml = useHtml || needsHtmlEmphasis(out, effPrev, effNext, { hasHtmlInner: wrappedWithHtml, hasAdjacentDelim: adjacentEmphasis || (hasItalic && wrappedWithHtml) });
        out = forceHtml ? `<strong>${out}</strong>` : `**${out}**`;
        if (forceHtml) wrappedWithHtml = true;
      } else if (mark.type === 'link') {
        const href = safeUrl(mark.attrs?.href) || mark.attrs?.href || '';
        const title = mark.attrs?.title;
        if (useHtml) {
          out = `<a href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ''} target="_blank" rel="noopener">${out}</a>`;
          wrappedWithHtml = true;
        } else {
          out = title ? `[${out}](${href} "${title.replace(/"/g, '\\"')}")` : `[${out}](${href})`;
        }
      }
    }
    return `${leadWs}${out}${trailWs}`;
  };
}

function nodeHasEmphasisMark(node) {
  if (!node || node.type !== 'text' || !Array.isArray(node.marks)) return false;
  return node.marks.some((m) => m.type === 'bold' || m.type === 'italic' || m.type === 'strike');
}

function edgeCharOfNode(node, side) {
  if (!node) return '';
  if (node.type === 'text') {
    const t = String(node.text || '');
    return t ? (side === 'start' ? t[0] : t[t.length - 1]) : '';
  }
  if (node.type === 'mathInline' || node.type === 'image' || node.type === 'figureImage') {
    return side === 'start' ? '<' : '>';
  }
  return '';
}

function serializeInlineNodes(nodes = [], { useHtml = false } = {}) {
  const parts = nodes.map((node, idx) => {
    if (!node) return '';
    if (node.type === 'text') {
      const prevNode = idx > 0 ? nodes[idx - 1] : null;
      const nextNode = idx + 1 < nodes.length ? nodes[idx + 1] : null;
      const prevChar = edgeCharOfNode(prevNode, 'end');
      const nextChar = edgeCharOfNode(nextNode, 'start');
      const adjacentEmphasis = nodeHasEmphasisMark(prevNode) || nodeHasEmphasisMark(nextNode);
      const wrap = collectMarkWrappers(node.marks || [], {
        useHtml,
        prevChar,
        nextChar,
        adjacentEmphasis,
      });
      return wrap(node.text || '');
    }
    if (node.type === 'hardBreak') {
      return useHtml ? '<br />' : '  \n';
    }
    if (node.type === 'mathInline') {
      const tex = node.attrs?.tex || '';
      return `<span class="hz-math" data-tex="${escapeAttr(tex)}"></span>`;
    }
    if (node.type === 'image') {
      return serializeImageAttrs(node.attrs || {}, { inline: true });
    }
    if (node.type === 'figureImage') {
      return serializeFigureImage(node.attrs || {});
    }
    if (Array.isArray(node.content)) {
      return serializeInlineNodes(node.content, { useHtml });
    }
    return '';
  });

  // 合并相邻同类强调标签（如相邻文本节点同具加粗但内层样式不同时），避免冗余标签或 **** 拼接
  return parts
    .join('')
    .replace(/<\/strong><strong>/g, '')
    .replace(/<\/em><em>/g, '')
    .replace(/<\/s><s>/g, '');
}

function paragraphStyleAttr(attrs = {}) {
  const parts = [];
  if (attrs.textAlign && ALIGN_VALUES.has(attrs.textAlign) && attrs.textAlign !== 'left') {
    parts.push(`text-align: ${attrs.textAlign}`);
  }
  if (attrs.textIndent) {
    parts.push(`text-indent: ${attrs.textIndent === true ? '2em' : attrs.textIndent}`);
  }
  if (attrs.lineHeight) {
    parts.push(`line-height: ${attrs.lineHeight}`);
  }
  return parts.join('; ');
}

function serializeImageAttrs(attrs = {}, { inline = false } = {}) {
  const src = attrs.src || '';
  const alt = attrs.alt || '';
  const width = attrs.width ? String(attrs.width).trim() : '';
  const align = attrs.align && attrs.align !== 'none' ? String(attrs.align) : '';
  const rounded = attrs.rounded;
  const title = attrs.title ? String(attrs.title) : '';
  if (!width && !align && !rounded) {
    const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
    return `![${alt}](${src}${titlePart})`;
  }
  const styles = [];
  if (width) styles.push(`width: ${width}`);
  if (rounded === false) styles.push('border-radius: 0');
  let html = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"`;
  if (title) html += ` title="${escapeAttr(title)}"`;
  if (styles.length) html += ` style="${escapeAttr(styles.join('; '))}"`;
  if (align) html += ` data-align="${escapeAttr(align)}"`;
  html += ' />';
  return inline ? html : html;
}

function serializeFigureImage(attrs = {}) {
  const caption = String(attrs.caption || '').trim();
  const imgTag = serializeImageAttrs({ ...attrs, caption: '' });
  if (!caption) return imgTag;
  const width = attrs.width ? String(attrs.width).trim() : '';
  const align = attrs.align && attrs.align !== 'none' ? String(attrs.align) : '';
  let figAttrs = 'class="hz-figure"';
  if (align) figAttrs += ` data-align="${escapeAttr(align)}"`;
  if (width) figAttrs += ` style="width: ${escapeAttr(width)}"`;
  const innerImg = `<img src="${escapeAttr(attrs.src || '')}" alt="${escapeAttr(attrs.alt || '')}" />`;
  return `<figure ${figAttrs}>${innerImg}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function serializeTable(node) {
  const rows = node.content || [];
  if (!rows.length) return '';
  const canUseGfm = rows.every((row) =>
    (row.content || []).every((cell) => {
      const blocks = cell.content || [];
      if (blocks.length > 1) return false;
      const p = blocks[0];
      if (!p || p.type !== 'paragraph') return false;
      if (paragraphStyleAttr(p.attrs)) return false;
      return (p.content || []).every((ch) =>
        ch.type === 'text' && !(ch.marks || []).some((m) => ['textStyle', 'underline', 'highlight', 'subscript', 'superscript'].includes(m.type)),
      );
    }),
  ) && rows[0]?.content?.every((c) => c.type === 'tableHeader');

  if (canUseGfm) {
    const lines = rows.map((row) => {
      const cells = (row.content || []).map((cell) => {
        const p = cell.content?.[0];
        return serializeInlineNodes(p?.content || [], { useHtml: false }).replace(/\|/g, '\\|').trim();
      });
      return `| ${cells.join(' | ')} |`;
    });
    const colCount = rows[0]?.content?.length || 1;
    const sep = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
    return [lines[0], sep, ...lines.slice(1)].join('\n');
  }

  const rowHtml = rows.map((row) => {
    const cells = (row.content || []).map((cell) => {
      const tag = cell.type === 'tableHeader' ? 'th' : 'td';
      const attrs = [];
      if (cell.attrs?.colspan > 1) attrs.push(`colspan="${cell.attrs.colspan}"`);
      if (cell.attrs?.rowspan > 1) attrs.push(`rowspan="${cell.attrs.rowspan}"`);
      const inner = (cell.content || []).map((b) => serializeBlock(b, { forceHtmlParagraph: true })).join('');
      return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${tag}>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('\n');
  return `<table>\n<tbody>\n${rowHtml}\n</tbody>\n</table>`;
}

function serializeList(node, indent = '') {
  const ordered = node.type === 'orderedList';
  const isTask = node.type === 'taskList';
  const start = ordered && node.attrs?.start && node.attrs.start !== 1 ? node.attrs.start : 1;
  return (node.content || []).map((item, idx) => {
    const prefix = isTask
      ? `- [${item.attrs?.checked ? 'x' : ' '}] `
      : ordered ? `${start + idx}. ` : '- ';
    const childIndent = `${indent}${' '.repeat(prefix.length)}`;
    const blocks = item.content || [];
    const rendered = blocks.map((block, bIdx) => {
      if (block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList') {
        return serializeList(block, childIndent);
      }
      const line = serializeBlock(block);
      return bIdx === 0 ? `${indent}${prefix}${line}` : `${childIndent}${line}`;
    });
    return rendered.join('\n');
  }).join('\n');
}

function serializeBlock(node, { forceHtmlParagraph = false } = {}) {
  if (!node) return '';
  switch (node.type) {
    case 'paragraph': {
      const style = paragraphStyleAttr(node.attrs || {});
      if (style || forceHtmlParagraph) {
        const inner = serializeInlineNodes(node.content || [], { useHtml: true });
        return style ? `<p style="${escapeAttr(style)}">${inner}</p>` : `<p>${inner}</p>`;
      }
      return serializeInlineNodes(node.content || [], { useHtml: false });
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level || 2)));
      const align = node.attrs?.textAlign;
      if (align && ALIGN_VALUES.has(align) && align !== 'left') {
        const inner = serializeInlineNodes(node.content || [], { useHtml: true });
        return `<h${level} style="text-align: ${align}">${inner}</h${level}>`;
      }
      const inner = serializeInlineNodes(node.content || [], { useHtml: false });
      return `${'#'.repeat(level)} ${inner}`;
    }
    case 'blockquote': {
      const inner = serializeBlocks(node.content || []);
      return inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    }
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = (node.content || []).map((c) => c.text || '').join('');
      const fence = code.includes('```') ? '~~~~' : '```';
      return `${fence}${lang}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return serializeList(node);
    case 'table':
      return serializeTable(node);
    case 'image':
      return serializeImageAttrs(node.attrs || {});
    case 'figureImage':
      return serializeFigureImage(node.attrs || {});
    case 'imageGallery': {
      const cols = Number(node.attrs?.cols) === 3 ? 3 : 2;
      const items = Array.isArray(node.attrs?.images) ? node.attrs.images : [];
      const imgs = items
        .filter((it) => it && it.src)
        .map((it) => `  <img src="${escapeAttr(it.src)}" alt="${escapeAttr(it.alt || '图片')}" />`)
        .join('\n');
      return `<div class="hz-gallery" data-cols="${cols}">\n${imgs}\n</div>`;
    }
    case 'videoEmbed': {
      const a = node.attrs || {};
      if (a.kind === 'video') {
        const poster = a.poster ? ` poster="${escapeAttr(a.poster)}"` : '';
        return `<div class="video-embed"><video controls preload="metadata" src="${escapeAttr(a.src || '')}"${poster}></video></div>`;
      }
      return `<div class="video-embed"><iframe src="${escapeAttr(a.src || '')}" title="${escapeAttr(a.title || '嵌入式视频播放器')}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
    }
    case 'songPlayer': {
      const a = node.attrs || {};
      let attrs = `data-src="${escapeAttr(a.src || '')}"`;
      if (a.title) attrs += ` data-title="${escapeAttr(a.title)}"`;
      if (a.artist) attrs += ` data-artist="${escapeAttr(a.artist)}"`;
      if (a.cover) attrs += ` data-cover="${escapeAttr(a.cover)}"`;
      return `<div class="song-player" ${attrs}><a href="${escapeAttr(a.src || '')}">♪ 播放音频</a></div>`;
    }
    case 'callout': {
      const a = node.attrs || {};
      const kind = a.kind || 'note';
      const title = a.title ? ` data-title="${escapeAttr(a.title)}"` : '';
      const inner = serializeBlocks(node.content || []);
      return `<div class="hz-callout" data-callout="${escapeAttr(kind)}"${title}>\n\n${inner}\n\n</div>`;
    }
    case 'details': {
      const children = node.content || [];
      const summaryNode = children.find((c) => c.type === 'detailsSummary');
      const contentNode = children.find((c) => c.type === 'detailsContent');
      const summary = serializeInlineNodes(summaryNode?.content || [], { useHtml: true }) || '详情';
      const body = serializeBlocks(contentNode?.content || []);
      return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
    }
    case 'attachmentCard': {
      const a = node.attrs || {};
      const href = escapeAttr(a.href || '');
      const name = escapeAttr(a.name || '附件');
      const size = escapeAttr(a.size || '');
      const ext = escapeAttr(a.ext || '');
      return `<div class="hz-attachment" data-href="${href}" data-name="${name}" data-size="${size}" data-ext="${ext}"><a href="${href}" target="_blank" rel="noopener">📎 ${escapeHtml(a.name || '附件')}${a.size ? ` (${escapeHtml(a.size)})` : ''}</a></div>`;
    }
    case 'bookmarkCard': {
      const a = node.attrs || {};
      const url = escapeAttr(a.url || '');
      const title = escapeHtml(a.title || a.url || '链接');
      const desc = escapeHtml(a.description || '');
      return `<div class="hz-bookmark"><a href="${url}" target="_blank" rel="noopener"><strong>${title}</strong>${desc ? `<span>${desc}</span>` : ''}<small>${escapeHtml(a.url || '')}</small></a></div>`;
    }
    case 'mathBlock': {
      const tex = node.attrs?.tex || '';
      return `<div class="hz-math-block" data-tex="${escapeAttr(tex)}"></div>`;
    }
    default:
      if (Array.isArray(node.content)) return serializeBlocks(node.content);
      return '';
  }
}

function serializeBlocks(blocks = []) {
  const parts = [];
  for (const block of blocks) {
    parts.push(serializeBlock(block));
  }
  return parts.join('\n\n');
}

/** 将 Tiptap / ProseMirror JSON 文档序列化为规范 Markdown(+安全HTML) */
export function serializeDocToMarkdown(docJson) {
  if (!docJson || !Array.isArray(docJson.content)) return '';
  const raw = serializeBlocks(docJson.content);
  return raw.replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** 提取标题列表作为实时大纲 */
export function extractOutlineFromDoc(docJson) {
  const headings = [];
  if (!docJson || !Array.isArray(docJson.content)) return headings;
  docJson.content.forEach((node, idx) => {
    if (node.type !== 'heading') return;
    const text = (node.content || []).map((c) => c.text || '').join('').trim();
    if (!text) return;
    headings.push({
      index: idx,
      level: Number(node.attrs?.level || 2),
      text,
    });
  });
  return headings;
}

/** 统计正文字数 / 段落 / 图片 / 缺 alt / 外链 / 预计阅读分钟数 */
export function countMarkdownStats(md) {
  const text = String(md || '');
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latinWords = (text.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) || []).length;
  const mdImgs = [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)];
  const htmlImgs = [...text.matchAll(/<img\b[^>]*>/gi)];
  const missingAlt = mdImgs.filter((m) => !String(m[1] || '').trim()).length
    + htmlImgs.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;
  const mdLinks = (text.match(/\]\(\s*https?:\/\//g) || []).length;
  const htmlLinks = (text.match(/<a\b[^>]*href\s*=\s*["']https?:\/\//gi) || []).length;
  const chars = cjk + latinWords;
  return {
    chars,
    images: mdImgs.length + htmlImgs.length,
    missingAlt,
    links: mdLinks + htmlLinks,
    minutes: Math.max(1, Math.round(chars / 300)),
  };
}
