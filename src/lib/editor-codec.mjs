/**
 * 编辑器双向编解码器：Markdown(+安全HTML) ↔ Tiptap 编辑器 HTML / ProseMirror JSON。
 * 被 PC 端 Word 级编辑器、手机端 /write/ 编辑器与单元测试共同复用。
 */
import { Marked } from 'marked';

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

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

/** 临时占位保护代码块与行内代码，避免预处理正则误改代码内容 */
function protectCode(src) {
  const slots = [];
  const hold = (value) => {
    const idx = slots.length;
    slots.push(value);
    return `\u0000CODE_SLOT_${idx}\u0000`;
  };
  let out = String(src || '').replace(/(^|\n)(```+|~~~+)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (m) => hold(m));
  out = out.replace(/(`+)([^`]|`(?!\1))*?\1/g, (m) => hold(m));
  return {
    text: out,
    restore: (s) => s.replace(/\u0000CODE_SLOT_(\d+)\u0000/g, (_, idx) => slots[Number(idx)] ?? ''),
  };
}

/** 保护已有的 HTML 块/节点免被 math/legacy 规则二次改写 */
function protectHtmlTags(src, pattern) {
  const slots = [];
  const hold = (value) => {
    const idx = slots.length;
    slots.push(value);
    return `\u0000HTML_SLOT_${idx}\u0000`;
  };
  const text = String(src || '').replace(pattern, (m) => hold(m));
  return {
    text,
    restore: (s) => s.replace(/\u0000HTML_SLOT_(\d+)\u0000/g, (_, idx) => slots[Number(idx)] ?? ''),
  };
}

function extractAlign(styleStr) {
  const m = String(styleStr || '').match(/text-align\s*:\s*(left|center|right|justify)/i);
  return m ? m[1].toLowerCase() : '';
}

function parseInnerInline(raw) {
  return editorMarked.parseInline(String(raw || '').trim());
}

/**
 * 预处理历史博文中的混写 HTML（如 `# <div style="text-align: center">...</div>`、
 * `<span style="..."><div style="text-align: center">...</div></span>`）与扩展容器。
 */
export function normalizeLegacyMarkdown(markdown) {
  const codeGuard = protectCode(String(markdown || '').replace(/\r\n?/g, '\n'));
  let text = codeGuard.text;

  // 1) 保护已结构化的数学 HTML，避免内部 $...$ 再次匹配
  const mathHtmlGuard = protectHtmlTags(
    text,
    /<span\b[^>]*class=["'][^"']*\bhz-math\b[^"']*["'][^>]*>[\s\S]*?<\/span>|<div\b[^>]*class=["'][^"']*\bhz-math-block\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
  );
  text = mathHtmlGuard.text;

  // 2) 转换裸 $$...$$ 块级公式与 $...$ 行内公式
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    const clean = String(tex).trim();
    return clean ? `<div class="hz-math-block" data-tex="${escapeAttr(clean)}"></div>` : '$$$$';
  });
  text = text.replace(/(^|[^\\$])\$([^\s$\n][^$\n]*?[^\s$\n]|[^\s$\n])\$/g, (m, prefix, tex) => {
    // 跳过明显的金额写法，如 $100 ... $200
    if (/^\d[\d,.]*(?:\s|$)/.test(tex)) return m;
    return `${prefix}<span class="hz-math" data-tex="${escapeAttr(tex.trim())}"></span>`;
  });

  // 3) 规范化历史混写：<span style="..."><div style="text-align:center">...</div></span>
  text = text.replace(
    /<span\b([^>]*)>\s*<div\b([^>]*)>([\s\S]*?)<\/div>\s*<\/span>/gi,
    (full, spanAttr, divAttr, inner) => {
      const align = extractAlign(divAttr);
      if (!align || /<(?:div|table|ul|ol|blockquote|iframe|video|figure)\b/i.test(inner)) return full;
      return `<p style="text-align: ${align}"><span${spanAttr}>${parseInnerInline(inner)}</span></p>`;
    },
  );

  // 4) 规范化标题里的 div 对齐：# <div style="text-align: center">...</div>
  text = text.replace(
    /^(#{1,6})\s+<div\b([^>]*)>([\s\S]*?)<\/div>\s*$/gim,
    (full, hashes, divAttr, inner) => {
      const align = extractAlign(divAttr);
      if (!align) return full;
      const level = hashes.length;
      return `<h${level} style="text-align: ${align}">${parseInnerInline(inner)}</h${level}>`;
    },
  );

  // 5) 规范化删除线包裹 div：~~<div style="text-align: center">...</div>~~
  text = text.replace(
    /^~~<div\b([^>]*)>([\s\S]*?)<\/div>~~\s*$/gim,
    (full, divAttr, inner) => {
      const align = extractAlign(divAttr);
      if (!align) return full;
      return `<p style="text-align: ${align}"><s>${parseInnerInline(inner)}</s></p>`;
    },
  );

  // 6) 规范化独立对齐 div（仅单段内联文本，不含块级子标签）
  text = text.replace(
    /(^|\n)<div\b([^>]*)>([^\n]*)<\/div>(?=\n|$)/gi,
    (full, lead, divAttr, inner) => {
      if (/class\s*=/i.test(divAttr)) return full;
      const align = extractAlign(divAttr);
      if (!align) return full;
      const trimmed = inner.trim();
      if (!trimmed) return `${lead}<p style="text-align: ${align}"><br></p>`;
      if (/<(?:div|p|table|ul|ol|blockquote|iframe|video|figure)\b/i.test(trimmed)) return full;
      return `${lead}<p style="text-align: ${align}">${parseInnerInline(trimmed)}</p>`;
    },
  );

  // 7) 规范化 Callout 内部 Markdown
  text = text.replace(
    /<div\b([^>]*class=["'][^"']*\bhz-callout\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi,
    (full, attrs, inner) => {
      if (/\bhz-callout__body\b/i.test(inner)) return full;
      const bodyHtml = editorMarked.parse(inner.trim()).trim();
      return `<div${attrs}><div class="hz-callout__body">${bodyHtml}</div></div>`;
    },
  );

  // 8) 规范化 <details> 为 Tiptap Details 结构（<summary> + <div data-type="detailsContent">）
  text = text.replace(
    /<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
    (full, attrs, summary, rest) => {
      if (/data-type=["']detailsContent["']/i.test(rest)) return full;
      const bodyHtml = editorMarked.parse(rest.trim()).trim() || '<p></p>';
      return `<details${attrs}><summary>${parseInnerInline(summary)}</summary><div data-type="detailsContent">${bodyHtml}</div></details>`;
    },
  );

  // 9) 规范化 <p style="..."> 内的内联 Markdown
  text = text.replace(
    /(^|\n)<p\b([^>]*)>([\s\S]*?)<\/p>(?=\n|$)/gi,
    (full, lead, attrs, inner) => {
      if (!attrs.trim()) return full;
      if (/<(?:div|table|ul|ol|p)\b/i.test(inner)) return full;
      return `${lead}<p${attrs}>${parseInnerInline(inner)}</p>`;
    },
  );

  text = mathHtmlGuard.restore(text);
  return codeGuard.restore(text);
}

/** 将 Markdown（含嵌入式 HTML）转换为 Tiptap 编辑器可无损装载的 HTML */
export function markdownToEditorHtml(markdown) {
  const source = String(markdown || '');
  if (!source.trim()) return '<p></p>';
  const normalized = normalizeLegacyMarkdown(source);
  return editorMarked.parse(normalized);
}

// ── ProseMirror / Tiptap JSON → Markdown(+安全HTML) 序列化 ──

function collectMarkWrappers(marks = [], { useHtml = false } = {}) {
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
    let out = useHtml ? escapeHtml(rawText) : rawText;

    // 代码行内标记优先处理（避免内部符号被强调包裹干扰）
    const hasCode = sorted.some((m) => m.type === 'code');
    if (hasCode) {
      if (useHtml) {
        out = `<code>${out}</code>`;
      } else {
        const ticks = out.includes('``') ? '```' : out.includes('`') ? '``' : '`';
        const pad = out.startsWith('`') || out.endsWith('`') ? ' ' : '';
        out = `${ticks}${pad}${out}${pad}${ticks}`;
      }
    }

    if (styleParts.length) {
      out = `<span style="${escapeAttr(styleParts.join('; '))}">${out}</span>`;
    }

    for (const mark of sorted) {
      if (mark.type === 'code' || mark.type === 'textStyle') continue;
      if (mark.type === 'highlight') {
        const bg = mark.attrs?.color;
        out = bg ? `<mark style="background-color: ${escapeAttr(bg)}">${out}</mark>` : `<mark>${out}</mark>`;
      } else if (mark.type === 'underline') {
        out = `<u>${out}</u>`;
      } else if (mark.type === 'subscript') {
        out = `<sub>${out}</sub>`;
      } else if (mark.type === 'superscript') {
        out = `<sup>${out}</sup>`;
      } else if (mark.type === 'strike') {
        out = useHtml ? `<s>${out}</s>` : `~~${out}~~`;
      } else if (mark.type === 'italic') {
        out = useHtml ? `<em>${out}</em>` : `*${out}*`;
      } else if (mark.type === 'bold') {
        out = useHtml ? `<strong>${out}</strong>` : `**${out}**`;
      } else if (mark.type === 'link') {
        const href = safeUrl(mark.attrs?.href) || mark.attrs?.href || '';
        const title = mark.attrs?.title;
        if (useHtml) {
          out = `<a href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ''} target="_blank" rel="noopener">${out}</a>`;
        } else {
          out = title ? `[${out}](${href} "${title.replace(/"/g, '\\"')}")` : `[${out}](${href})`;
        }
      }
    }
    return out;
  };
}

function serializeInlineNodes(nodes = [], { useHtml = false } = {}) {
  return nodes.map((node) => {
    if (!node) return '';
    if (node.type === 'text') {
      const wrap = collectMarkWrappers(node.marks || [], { useHtml });
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
  }).join('');
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
