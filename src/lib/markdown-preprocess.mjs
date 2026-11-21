/**
 * 共享 Markdown / 富文本 / 历史混写 HTML 预处理器。
 * 同时供 Astro 构建（Sätteri 管线）与后台/移动端编辑器（editor-codec.mjs）复用，
 * 确保编辑器所见、分屏预览与线上最终渲染 100% 一致。
 */

const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;
const CJK_OR_WORD_RE = /[\p{L}\p{N}]/u;
const INLINE_HTML_OPEN_CLOSE_RE = /^<\/?(?:span|mark|u|s|del|ins|sub|sup|em|i|strong|b|a|code|kbd|small|abbr|cite|q|time|br)\b/i;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function createSlotGuard(prefix) {
  const slots = [];
  return {
    hold(value) {
      const idx = slots.length;
      slots.push(value);
      return `\u0000${prefix}_${idx}\u0000`;
    },
    replace(src, pattern) {
      return String(src || '').replace(pattern, (m) => this.hold(m));
    },
    restore(src) {
      const re = new RegExp(`\u0000${prefix}_(\\d+)\u0000`, 'g');
      let out = String(src || '');
      // 嵌套占位可能需还原多轮
      for (let i = 0; i < 4 && re.test(out); i += 1) {
        out = out.replace(re, (_, idx) => slots[Number(idx)] ?? '');
      }
      return out;
    },
  };
}

/** 保护代码块、行内代码、<pre>/<script>/<style>/注释，避免被预处理正则误伤 */
export function protectCodeAndRawBlocks(src) {
  const guard = createSlotGuard('CODE');
  let text = String(src || '');
  // 1) 围栏代码块（``` 或 ~~~）
  text = text.replace(/(^|\n)([ \t]{0,3}(?:`{3,}|~{3,}))[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)/g, (m) => guard.hold(m));
  // 2) 原始 HTML 不可解析块
  text = text.replace(/<!--[\s\S]*?-->/g, (m) => guard.hold(m));
  text = text.replace(/<(pre|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => guard.hold(m));
  text = text.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, (m) => guard.hold(m));
  // 3) 行内代码（不跨空行）
  text = text.replace(/(`+)(?!`)(?:[^`\n]|(?!\1)`|\n(?!\n))*?\1(?!`)/g, (m) => guard.hold(m));
  return { text, restore: (s) => guard.restore(s) };
}

/**
 * 判断 $...$ 内容是否为真正的行内 LaTeX 公式（排除货币金额、环境变量、纯中文长句）
 */
export function isLikelyInlineMath(rawTex) {
  const tex = String(rawTex || '').trim();
  if (!tex) return false;
  // 明显是金额：$100, $0.10/M, $14.71, $JP￥180...
  if (/^\d[\d,.]*(?:\s|\/|$|[;；，,。)])/.test(tex)) return false;
  if (/[￥¥€£]/.test(tex)) return false;
  // 明显是环境变量/路径：$env:LOCALAPPDATA...
  if (/^(?:env:|PATH\b|HOME\b|USER\b)/i.test(tex)) return false;
  // 包含 Markdown 粗体/删除线或 HTML 标签的不是行内公式
  if (/\*\*|~~|<[a-z/]/i.test(tex)) return false;
  // 长纯中文句子（含 3 个以上连续汉字且不含 LaTeX \text/\mathrm）不是公式
  if (/[\u4e00-\u9fff]{3,}/.test(tex) && !/\\(?:text|mathrm|operatorname)\s*\{/.test(tex)) return false;
  // 必须包含至少一个字母、反斜杠命令或数学符号
  if (!/[A-Za-z\\^_=+\-*/<>≤≥≠≈∞∑∫∏√±×÷→←↔]/.test(tex)) return false;
  return true;
}

function extractAlign(styleStr) {
  const m = String(styleStr || '').match(/text-align\s*:\s*(left|center|right|justify)/i);
  return m ? m[1].toLowerCase() : '';
}

function isWhitespace(ch) {
  return !ch || /\s/.test(ch);
}

function isPunct(ch) {
  return Boolean(ch) && UNICODE_PUNCT_RE.test(ch);
}

function isWordOrCjk(ch) {
  return Boolean(ch) && CJK_OR_WORD_RE.test(ch);
}

/**
 * 判断一个 ** 或 * 定界符在严格 CommonMark §6.2 下是否能正常左/右贴合。
 * 若不能正常贴合（如 中文**“词”** 或 **词：**中文 或 中文**<mark>词</mark>**中文），
 * 我们需要把它转为显式 <strong>/<em>，避免在 Sätteri / Marked 中裸露星号。
 */
function isCommonMarkLeftFlanking(prev, next) {
  if (isWhitespace(next)) return false;
  if (!isPunct(next)) return true;
  return isWhitespace(prev) || isPunct(prev);
}

function isCommonMarkRightFlanking(prev, next) {
  if (isWhitespace(prev)) return false;
  if (!isPunct(prev)) return true;
  return isWhitespace(next) || isPunct(next);
}

/**
 * 在单行非代码文本上修复 **...**、***...***、*...*、~~...~~ 的 CJK 标点贴合、
 * 嵌套 ** **、相邻 ****、包裹内联 HTML 标签、以及意外首尾空格问题。
 */
function fixEmphasisInLine(rawLine) {
  if (!rawLine || (!rawLine.includes('*') && !rawLine.includes('~'))) return rawLine;

  // 跳过 Markdown 水平分割线（如 *** / * * *）
  if (/^\s*(?:\*[ \t]*){3,}$/.test(rawLine)) return rawLine;

  // 保留块级前缀（标题 #、引用 >、无序/有序列表标记），只处理正文部分
  let prefix = '';
  let body = rawLine;
  const blockPrefixMatch = body.match(/^([ \t]*(?:(?:>[ \t]*)+|#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))/);
  if (blockPrefixMatch) {
    prefix = blockPrefixMatch[1];
    body = body.slice(prefix.length);
  }
  if (!body || (!body.includes('*') && !body.includes('~'))) return rawLine;

  // 临时保护：1) 链接/图片目标 ](...) 与自动链接 <http...>  2) HTML 标签的属性部分
  const attrGuard = createSlotGuard('EMPHATTR');
  // 保护转义字符 \* \~
  body = body.replace(/\\[*~]/g, (m) => attrGuard.hold(m));
  // 保护 Markdown 链接/图片 URL 部分（含嵌套括号的一层兼容）
  body = body.replace(/\]\((?:[^()\s]|\([^()]*\))+(?:\s+"[^"]*")?\)/g, (m) => attrGuard.hold(m));
  // 保护自动链接 <https://...>
  body = body.replace(/<https?:\/\/[^>]+>/gi, (m) => attrGuard.hold(m));
  // 保护 HTML 标签：保留内联标签本身（只保护其属性），整块保护非内联标签（如 <img>, <iframe>）
  body = body.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?\/?>/g, (tag) => {
    if (INLINE_HTML_OPEN_CLOSE_RE.test(tag)) {
      // 保留 <tag...> 的尖括号结构，但保护属性内容里的任何 * 或 ~
      return tag.replace(/\s+[^<>]+(?=\/?>)/, (attrs) => attrGuard.hold(attrs));
    }
    return attrGuard.hold(tag);
  });

  // ── 1) 栈式解析 ** 与 ***（支持嵌套 ** **、相邻 ****、CJK 标点、包裹 HTML 标签）──
  // 必须先于首尾空格修复执行，否则 "**外层 **内层** 外层**" 会被误切为 "**外层 **"
  body = resolveBoldRuns(body);

  // ── 2) 处理残余的 ** ... ** 意外首尾空格（如 "** 路由**"、"** 这个DeepSeek...**"）──
  body = body.replace(/(^|[^*])\*\*([ \t]+(?=\S)[^*\n]+?(?<=\S)|\S[^*\n]*?(?<=\S)[ \t]+)\*\*(?!\*)/g, (full, lead, inner) => {
    const trimmed = inner.trim();
    if (!trimmed) return full;
    return `${lead}<strong>${trimmed}</strong>`;
  });

  // ── 3) CJK 标点贴合的 *...* 斜体修复（如 医师*（注释）*也、是*“台词”*，）──
  // 仅修复因内部紧邻标点/HTML 而在 CommonMark 中失效的单星号斜体，不碰 2*3*4 等乘法
  body = resolveCjkItalic(body);

  // ── 4) CJK 标点或 HTML 贴合的 ~~...~~ 删除线修复 ──
  body = body.replace(/(^|[^~])~~(?!~)([^~\n]+?)~~(?!~)/g, (full, lead, inner, offset, str) => {
    if (!inner.trim()) return full;
    const prev = lead || '';
    const first = inner[0] || '';
    const last = inner[inner.length - 1] || '';
    const afterIdx = offset + full.length;
    const next = str[afterIdx] || '';
    const needsHtml =
      !isCommonMarkLeftFlanking(prev, first)
      || !isCommonMarkRightFlanking(last, next)
      || /<[a-z/]/i.test(inner)
      || /^\s|\s$/.test(inner);
    if (!needsHtml) return full;
    return `${lead}<s>${inner.trim()}</s>`;
  });

  return prefix + attrGuard.restore(body);
}

/**
 * 用显式令牌扫描 + 栈配对解决：
 *  - 中文**“引号内容”** / **标题：**正文 / 中文**（括号）**中文
 *  - **<span ...>彩色</span>** / **<mark>高亮</mark>**
 *  - **甲****乙**（相邻 4 个 *）
 *  - **外层 **内层** 外层**（真正嵌套的 ** **）
 *  - ***“粗斜体”***
 */
function resolveBoldRuns(line) {
  if (!line.includes('**')) return line;

  // 将所有连续 >=2 个星号切分为 token：
  //   2 个 * -> strong (len 2)
  //   3 个 * -> strong-em (len 3)
  //   4 个 * -> 若两侧均非空白，拆成 close(**) + open(**)
  const rawTokens = [];
  const starRe = /\*{2,}/g;
  let m;
  while ((m = starRe.exec(line)) !== null) {
    const start = m.index;
    const len = m[0].length;
    if (len === 2 || len === 3) {
      rawTokens.push({ start, end: start + len, len, splitRole: null });
    } else if (len === 4) {
      // **foo****bar** -> 第一个 ** 结束，第二个 ** 开始
      rawTokens.push({ start, end: start + 2, len: 2, splitRole: 'close' });
      rawTokens.push({ start: start + 2, end: start + 4, len: 2, splitRole: 'open' });
    }
    // >=5 个星号留作字面量，不做猜测
  }

  if (rawTokens.length < 2) return line;

  const stack = [];
  const pairs = []; // { openTok, closeTok, len, nested }

  for (let i = 0; i < rawTokens.length; i += 1) {
    const tok = rawTokens[i];
    const prev = tok.start > 0 ? line[tok.start - 1] : '';
    const next = tok.end < line.length ? line[tok.end] : '';

    // 放宽 CJK 规则：只要不紧跟空白就可开，只要不紧接空白就可闭
    const canOpen = tok.splitRole === 'close' ? false : !isWhitespace(next);
    const canClose = tok.splitRole === 'open' ? false : !isWhitespace(prev);

    // 在栈非空时优先判断：如果当前明显是“内部新开”（前有空白、后无空白），则压栈形成嵌套
    const isPureOpen = canOpen && !canClose;

    let matchedIdx = -1;
    if (canClose && !isPureOpen) {
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (stack[s].len === tok.len) {
          // 排除空内容 ****
          if (tok.start > stack[s].end) {
            matchedIdx = s;
            break;
          }
        }
      }
    }

    if (matchedIdx !== -1) {
      const openTok = stack[matchedIdx];
      const nested = matchedIdx > 0 || stack.length - 1 > matchedIdx;
      // 弹出匹配项及其上方未闭合的项
      stack.splice(matchedIdx);
      pairs.push({ openTok, closeTok: tok, len: tok.len, nested });
    } else if (canOpen) {
      stack.push(tok);
    }
  }

  if (!pairs.length) return line;

  // 标记哪些配对存在嵌套（包含子配对或被父配对包含）
  const pairSet = pairs.map((p) => ({ ...p, forceHtml: p.nested }));
  for (let i = 0; i < pairSet.length; i += 1) {
    for (let j = 0; j < pairSet.length; j += 1) {
      if (i === j) continue;
      if (pairSet[i].openTok.start < pairSet[j].openTok.start && pairSet[i].closeTok.end > pairSet[j].closeTok.end) {
        pairSet[i].forceHtml = true;
        pairSet[j].forceHtml = true;
      }
    }
  }

  // 决定每个配对是否需要转为 HTML 标签（<strong> / <strong><em>）
  const replacements = []; // { start, end, text }
  for (const p of pairSet) {
    const { openTok, closeTok, len } = p;
    const prevBeforeOpen = openTok.start > 0 ? line[openTok.start - 1] : '';
    const firstInside = line[openTok.end] || '';
    const lastInside = line[closeTok.start - 1] || '';
    const nextAfterClose = closeTok.end < line.length ? line[closeTok.end] : '';
    const inner = line.slice(openTok.end, closeTok.start);

    const cmOk =
      isCommonMarkLeftFlanking(prevBeforeOpen, firstInside)
      && isCommonMarkRightFlanking(lastInside, nextAfterClose);

    const hasAdjacentSplit = openTok.splitRole !== null || closeTok.splitRole !== null;
    const wrapsHtml = /<\/?[a-zA-Z]/.test(inner);
    const hasInnerStars = inner.includes('*');

    if (p.forceHtml || !cmOk || hasAdjacentSplit || wrapsHtml || hasInnerStars) {
      const openTag = len === 3 ? '<strong><em>' : '<strong>';
      const closeTag = len === 3 ? '</em></strong>' : '</strong>';
      replacements.push({ start: openTok.start, end: openTok.end, text: openTag });
      replacements.push({ start: closeTok.start, end: closeTok.end, text: closeTag });
    }
  }

  if (!replacements.length) return line;

  // 按位置降序替换，保证索引不偏移
  replacements.sort((a, b) => b.start - a.start);
  let out = line;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

/**
 * 修复单星号斜体在 CJK + 标点紧邻时失效的问题：
 * 例如：柳原主治医师*（注释）*也 -> 柳原主治医师<em>（注释）</em>也
 *      第一反应是*“我没有在闪耀吗”*， -> 第一反应是<em>“我没有在闪耀吗”</em>，
 */
function resolveCjkItalic(line) {
  if (!line.includes('*')) return line;
  // 找所有单 * 位置（非 ** 的一部分）
  const stars = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '*' && line[i - 1] !== '*' && line[i + 1] !== '*') {
      stars.push(i);
    }
  }
  if (stars.length < 2) return line;

  const replacements = [];
  let i = 0;
  while (i < stars.length - 1) {
    const openPos = stars[i];
    const prevBeforeOpen = openPos > 0 ? line[openPos - 1] : '';
    const firstInside = line[openPos + 1] || '';

    // 开星号不能紧跟空白
    if (isWhitespace(firstInside)) {
      i += 1;
      continue;
    }

    // 寻找匹配的闭星号
    let found = -1;
    for (let j = i + 1; j < stars.length; j += 1) {
      const closePos = stars[j];
      const lastInside = line[closePos - 1] || '';
      if (isWhitespace(lastInside)) continue;
      found = j;
      break;
    }

    if (found === -1) {
      i += 1;
      continue;
    }

    const closePos = stars[found];
    const lastInside = line[closePos - 1] || '';
    const nextAfterClose = closePos + 1 < line.length ? line[closePos + 1] : '';
    const inner = line.slice(openPos + 1, closePos);

    // 避免误伤纯数字/英文变量相乘（如 a*b*c 或 2*3*4）
    const looksLikeMultiply = /^[A-Za-z0-9_.\s]+$/.test(inner)
      && /[A-Za-z0-9]/.test(prevBeforeOpen)
      && /[A-Za-z0-9]/.test(nextAfterClose);

    const cmOk =
      isCommonMarkLeftFlanking(prevBeforeOpen, firstInside)
      && isCommonMarkRightFlanking(lastInside, nextAfterClose);

    // 只在 CommonMark 确实无法贴合（且非纯数字/变量乘法，且涉及 CJK/标点/HTML）时才转 <em>
    const involvesPunctOrHtml = isPunct(firstInside) || isPunct(lastInside) || /<\/?[a-zA-Z]/.test(inner);
    if (!cmOk && !looksLikeMultiply && involvesPunctOrHtml && (isWordOrCjk(prevBeforeOpen) || isWordOrCjk(nextAfterClose))) {
      replacements.push({ start: openPos, end: openPos + 1, text: '<em>' });
      replacements.push({ start: closePos, end: closePos + 1, text: '</em>' });
    }

    i = found + 1;
  }

  if (!replacements.length) return line;
  replacements.sort((a, b) => b.start - a.start);
  let out = line;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

/** 轻量级内联 Markdown 转 HTML（用于 <p style="..."> / <h1 style="..."> 等 HTML 块内部） */
function fallbackInlineMarkdown(raw) {
  let s = fixEmphasisInLine(String(raw || '').trim());
  // 行内代码
  const codeGuard = createSlotGuard('INCODE');
  s = s.replace(/(`+)([^`]|`(?!\1))*?\1/g, (m, ticks) => {
    const inner = m.slice(ticks.length, -ticks.length).trim();
    return codeGuard.hold(`<code>${escapeHtml(inner)}</code>`);
  });
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+|#[^\s)]+)\)/g, (_, label, href) => (
    `<a href="${escapeAttr(href)}">${label}</a>`
  ));
  // 粗斜体 / 粗体 / 斜体 / 删除线
  s = s.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  return codeGuard.restore(s);
}

/**
 * 统一预处理 Markdown(+安全 HTML)：
 * - forEditor = false：供 Astro（Sätteri）静态构建使用，保留干净的线上 DOM 结构
 * - forEditor = true：供 Tiptap 编辑器与本地预览使用，附加 Tiptap 所需的 callout/details 内部容器
 */
export function preprocessMarkdownForRender(markdown, { forEditor = false, parseInline, parseBlock } = {}) {
  const inlineRender = (raw) => {
    const fixed = fixEmphasisInLine(String(raw || '').trim());
    return parseInline ? parseInline(fixed) : fallbackInlineMarkdown(fixed);
  };

  const normalizedNewlines = String(markdown || '').replace(/\r\n?/g, '\n');
  const codeGuard = protectCodeAndRawBlocks(normalizedNewlines);
  let text = codeGuard.text;

  // 1) 保护已结构化的数学 HTML，避免内部 $...$ 再次匹配
  const mathGuard = createSlotGuard('MATH');
  text = mathGuard.replace(
    text,
    /<span\b[^>]*class=["'][^"']*\bhz-math\b[^"']*["'][^>]*>[\s\S]*?<\/span>|<div\b[^>]*class=["'][^"']*\bhz-math-block\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
  );

  // 2) 转换裸 $$...$$ 块级公式与合法的 $...$ 行内公式（并立即保护，防止内部 * 或 _ 被改写）
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (full, tex) => {
    const clean = String(tex).trim();
    if (!clean) return full;
    return mathGuard.hold(`<div class="hz-math-block" data-tex="${escapeAttr(clean)}"></div>`);
  });
  text = text.replace(/(^|[^\\$\w])\$([^\s$\n][^$\n]*?[^\s$\n]|[^\s$\n])\$(?!\d)/g, (full, prefix, tex) => {
    if (!isLikelyInlineMath(tex)) return full;
    return `${prefix}${mathGuard.hold(`<span class="hz-math" data-tex="${escapeAttr(tex.trim())}"></span>`)}`;
  });

  // 3) 修复粘贴来的单块 <span style="..."><blockquote ...>...</blockquote></span>（不含内部嵌套 span，避免产生孤立 </span>）
  text = text.replace(
    /<span\b[^>]*>\s*(<blockquote\b(?:(?!<\/?span\b)[\s\S])*?<\/blockquote>)\s*<\/span>/gi,
    (_, bq) => `\n\n${bq}\n\n`,
  );
  // 清理 Twitter 等外链粘贴遗留的 <span style="..."><script ...></script></span>
  text = text.replace(
    /<span\b[^>]*>\s*(\u0000CODE_\d+\u0000)\s*<\/span>/gi,
    (_, slot) => slot,
  );

  // 4) 裸 <iframe ...>...</iframe> 后紧跟 Markdown 内容时补空行，防止 CommonMark HTML 块吞掉下一行
  text = text.replace(
    /(^|\n)([ \t]*<iframe\b[^>]*>[\s\S]*?<\/iframe>[ \t]*)\n(?=[ \t]*\S)/gi,
    '$1$2\n\n',
  );

  // 5) 历史混写：# <span style="..."><div style="text-align: center">...</div></span>
  text = text.replace(
    /^(#{1,6})\s+<span\b([^>]*)>\s*<div\b([^>]*)>([\s\S]*?)<\/div>\s*<\/span>\s*$/gim,
    (full, hashes, spanAttr, divAttr, inner) => {
      const align = extractAlign(divAttr);
      if (!align) return full;
      const level = hashes.length;
      return `\n<h${level} style="text-align: ${align}"><span${spanAttr}>${inlineRender(inner)}</span></h${level}>\n`;
    },
  );

  // 6) 历史混写：# <div style="text-align: center">...</div>
  text = text.replace(
    /^(#{1,6})\s+<div\b([^>]*)>([\s\S]*?)<\/div>\s*$/gim,
    (full, hashes, divAttr, inner) => {
      const align = extractAlign(divAttr);
      if (!align) return full;
      const level = hashes.length;
      return `\n<h${level} style="text-align: ${align}">${inlineRender(inner)}</h${level}>\n`;
    },
  );

  // 7) 历史混写：多行 <span style="..."><div style="text-align: center">...</div>\n<div ...>...</div></span>
  text = text.replace(
    /<span\b([^>]*)>((?:\s*<div\b[^>]*>[^\n]*<\/div>)+)\s*<\/span>/gi,
    (full, spanAttr, divsBlock) => {
      if (/<(?:table|ul|ol|blockquote|iframe|video|figure)\b/i.test(divsBlock)) return full;
      const parts = [];
      const divRe = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
      let dm;
      while ((dm = divRe.exec(divsBlock)) !== null) {
        const align = extractAlign(dm[1]);
        if (!align) return full;
        const trimmed = dm[2].trim();
        if (!trimmed) continue;
        parts.push(`<p style="text-align: ${align}"><span${spanAttr}>${inlineRender(trimmed)}</span></p>`);
      }
      return parts.length ? `\n\n${parts.join('\n\n')}\n\n` : full;
    },
  );

  // 8) 历史混写：~~<div style="text-align: center">...</div>~~
  text = text.replace(
    /^~~<div\b([^>]*)>([\s\S]*?)<\/div>~~\s*$/gim,
    (full, divAttr, inner) => {
      const align = extractAlign(divAttr);
      if (!align) return full;
      return `\n<p style="text-align: ${align}"><s>${inlineRender(inner)}</s></p>\n`;
    },
  );

  // 9) 独立对齐 <div style="text-align: ...">...</div>（无 class，单行内联文本）
  text = text.replace(
    /(^|\n)<div\b([^>]*)>([^\n]*)<\/div>(?=\n|$)/gi,
    (full, lead, divAttr, inner) => {
      if (/class\s*=/i.test(divAttr)) return full;
      const align = extractAlign(divAttr);
      if (!align) return full;
      const trimmed = inner.trim();
      if (!trimmed) return forEditor ? `${lead}\n<p style="text-align: ${align}"><br></p>\n` : `${lead}`;
      if (/<(?:div|p|table|ul|ol|blockquote|iframe|video|figure)\b/i.test(trimmed)) return full;
      return `${lead}\n<p style="text-align: ${align}">${inlineRender(trimmed)}</p>\n`;
    },
  );

  // 折叠多余空行，同时保证刚生成的独立块级 HTML（<h1..6>/<p>）与紧随其后的 Markdown 之间留有空行
  text = text.replace(/\n{3,}/g, '\n\n');

  // 10) 逐行修复 CJK 标点贴合 / 嵌套 ** ** / 意外空格 / HTML 包裹的强调语法
  text = text
    .split('\n')
    .map((line) => fixEmphasisInLine(line))
    .join('\n');

  // 11) 规范化 <p style="..."> 与 <h1..6 style="..."> 内的内联 Markdown
  text = text.replace(
    /(^|\n)<(p|h[1-6])\b([^>]*)>([\s\S]*?)<\/\2>(?=\n|$)/gi,
    (full, lead, tag, attrs, inner) => {
      if (!attrs.trim()) return full;
      if (/<(?:div|table|ul|ol|p|blockquote)\b/i.test(inner)) return full;
      // 仅当内容包含潜在 Markdown 语法时重解析，避免破坏已纯 HTML 内容
      if (!/[*~`\[]/.test(inner)) return full;
      return `${lead}<${tag}${attrs}>${inlineRender(inner)}</${tag}>`;
    },
  );

  // 12) 编辑器专属结构归一化：Callout 与 Details
  if (forEditor && parseBlock) {
    text = text.replace(
      /<div\b([^>]*class=["'][^"']*\bhz-callout\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi,
      (full, attrs, inner) => {
        if (/\bhz-callout__body\b/i.test(inner)) return full;
        const bodyHtml = parseBlock(inner.trim()).trim();
        return `<div${attrs}><div class="hz-callout__body">${bodyHtml}</div></div>`;
      },
    );
    text = text.replace(
      /<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
      (full, attrs, summary, rest) => {
        if (/data-type=["']detailsContent["']/i.test(rest)) return full;
        const bodyHtml = parseBlock(rest.trim()).trim() || '<p></p>';
        return `<details${attrs}><summary>${inlineRender(summary)}</summary><div data-type="detailsContent">${bodyHtml}</div></details>`;
      },
    );
  }

  text = mathGuard.restore(text);
  return codeGuard.restore(text);
}
