/** 把终端输入块解码为按键序列（支持方向键、翻页、Home/End、Tab、退格等）。 */

const SEQUENCES = new Map([
  ['\u001b[A', 'up'], ['\u001b[B', 'down'], ['\u001b[C', 'right'], ['\u001b[D', 'left'],
  ['\u001bOA', 'up'], ['\u001bOB', 'down'], ['\u001bOC', 'right'], ['\u001bOD', 'left'],
  ['\u001b[H', 'home'], ['\u001b[F', 'end'], ['\u001b[1~', 'home'], ['\u001b[4~', 'end'],
  ['\u001b[7~', 'home'], ['\u001b[8~', 'end'],
  ['\u001b[5~', 'pgup'], ['\u001b[6~', 'pgdown'],
  ['\u001b[Z', 'shift-tab'],
  ['\u001b[3~', 'delete'],
]);

const SINGLE = new Map([
  ['\r', 'enter'], ['\n', 'enter'],
  ['\u0003', 'ctrl-c'], ['\u0004', 'ctrl-d'], ['\u001a', 'ctrl-z'],
  ['\u007f', 'backspace'], ['\u0008', 'backspace'],
  ['\t', 'tab'],
]);

const MAX_SEQ = Math.max(...[...SEQUENCES.keys()].map((s) => s.length));

function isSequencePrefix(text) {
  if (!text.startsWith('\u001b')) return false;
  for (const seq of SEQUENCES.keys()) {
    if (seq.startsWith(text)) return true;
  }
  return false;
}

/** 解码一个完整缓冲，返回 { keys, rest }（rest 是不完整的转义序列，需等待后续数据） */
export function decodeChunk(buffer) {
  const keys = [];
  let i = 0;
  while (i < buffer.length) {
    if (buffer[i] === '\u001b') {
      const rest = buffer.slice(i, i + MAX_SEQ);
      let matched = null;
      for (const [seq, name] of SEQUENCES) {
        if (buffer.startsWith(seq, i)) {
          matched = { seq, name };
          break;
        }
      }
      if (matched) {
        keys.push(matched.name);
        i += matched.seq.length;
        continue;
      }
      if (isSequencePrefix(rest)) break; // 序列尚未收全，等待下一块
      keys.push('esc');
      i += 1;
      continue;
    }
    const ch = buffer[i];
    keys.push(SINGLE.get(ch) ?? ch);
    i += 1;
  }
  return { keys, rest: buffer.slice(i) };
}

/** 有状态的解码器：内部缓存跨块的不完整序列 */
export function createKeyDecoder() {
  let pending = '';
  return {
    push(chunk) {
      const { keys, rest } = decodeChunk(pending + String(chunk ?? ''));
      pending = rest;
      return keys;
    },
    pending() {
      return pending;
    },
  };
}
