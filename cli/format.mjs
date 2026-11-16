/** 终端文本度量与对齐（CJK 按 2 列宽计算），CLI 与 TUI 共用。 */

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115f)
    || (cp >= 0x2e80 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe6f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1f9ff)
    || (cp >= 0x20000 && cp <= 0x3fffd);
}

export function displayWidth(text) {
  let w = 0;
  for (const ch of String(text ?? '')) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

export function padEnd(text, width) {
  const s = String(text ?? '');
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** 按显示宽度截断，超出时以 … 结尾 */
export function truncate(text, width) {
  const s = String(text ?? '');
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  if (width === 1) return '…';
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** 截断并补齐到固定宽度 */
export function fit(text, width) {
  return padEnd(truncate(text, width), width);
}

/** 按显示宽度折行（保留换行符分段） */
export function wrapText(text, width) {
  const out = [];
  if (width <= 1) return out;
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    if (displayWidth(paragraph) <= width) {
      out.push(paragraph);
      continue;
    }
    let line = '';
    let w = 0;
    for (const ch of paragraph) {
      const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
      if (w + cw > width) {
        out.push(line);
        line = ch;
        w = cw;
      } else {
        line += ch;
        w += cw;
      }
    }
    out.push(line);
  }
  return out;
}
