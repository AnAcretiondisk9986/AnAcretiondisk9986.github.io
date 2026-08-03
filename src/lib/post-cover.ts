function maskCode(source: string) {
  const lines = source.split(/(?<=\n)/);
  let fence = '';

  return lines.map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? '';
    if (marker && !fence) {
      fence = marker[0];
      return line.replace(/[^\n]/g, ' ');
    }
    if (fence && marker.startsWith(fence)) {
      fence = '';
      return line.replace(/[^\n]/g, ' ');
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line.replace(/[^\n]/g, ' ');

    return line.replace(/(`+)(?:[^`]|`(?!\1))*?\1/g, (match) => ' '.repeat(match.length));
  }).join('');
}

function cleanImageSource(value: string) {
  const source = value.trim();
  if (!source || /^(?:javascript|vbscript):/i.test(source)) return '';
  return source;
}

export function firstImageFromBody(body: string) {
  const source = maskCode(body);
  const candidates: Array<{ index: number; src: string }> = [];
  const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  const htmlImage = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/gi;

  for (const match of source.matchAll(markdownImage)) {
    const src = cleanImageSource(match[1] ?? match[2] ?? '');
    if (src) candidates.push({ index: match.index ?? Number.MAX_SAFE_INTEGER, src });
  }
  for (const match of source.matchAll(htmlImage)) {
    const src = cleanImageSource(match[1] ?? match[2] ?? match[3] ?? '');
    if (src) candidates.push({ index: match.index ?? Number.MAX_SAFE_INTEGER, src });
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates[0]?.src ?? '';
}
