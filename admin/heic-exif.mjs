// 从 HEIC/HEIF 容器中提取 EXIF Orientation(1~8),供解码后按方向旋转。
// heic-decode 只输出原始像素(不含 EXIF),iPhone 竖拍照片(orientation=6/8)会因此横置;
// 此模块按 ISO-BMFF 规范定位 meta>iinf 中的 'Exif' item,再经 iloc 取数据,解析 TIFF IFD0 的 0x0112。
// 零依赖;解析失败返回 null(调用方按方向 1 处理,不阻断上传)。
//
// 兼容性说明(真实 iPhone 样本实测):
// - infe 的 item_ID 实际为 2 字节(即使 version=2 声明为 4 字节)——按 2/4 双解析自适应;
// - iloc 声明的 base_offset_size(0)与实际(2)不一致——对候选宽度自校正,取能精确解析出目标 item 者。

function readU32(buf, o) { return buf.readUInt32BE(o); }
function readU16(buf, o) { return buf.readUInt16BE(o); }
function readU64(buf, o) { return Number(buf.readBigUInt64BE(o)); }

// 遍历 [start, end) 内的所有 box;返回 { type, start, header, size, end }
function walkBoxes(buf, start, end) {
  const boxes = [];
  let p = start;
  while (p + 8 <= end) {
    let size = readU32(buf, p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = readU64(buf, p + 8);
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) break;
    boxes.push({ type, start: p, header, size, end: p + size });
    p += size;
  }
  return boxes;
}

// 定位 meta>iinf 中 item_type=='Exif' 的 item_ID;item_ID 宽度按 2/4 字节双解析;失败返回 null
function findExifItemId(buf, iinfBox) {
  const fullVersion = buf[iinfBox.start + iinfBox.header]; // fullbox 首字节 = version
  const countWidth = fullVersion === 0 ? 2 : 4;
  let p = iinfBox.start + iinfBox.header + 4 + countWidth;
  if (p + 4 > iinfBox.end) return null;
  const infeBoxes = walkBoxes(buf, p, iinfBox.end);
  for (const infe of infeBoxes) {
    if (infe.type !== 'infe') continue;
    // 尝试 item_ID 宽度 2 与 4,item_type 分别位于其后 2+4 / 2+4 字节处
    for (const idWidth of [2, 4]) {
      const q = infe.start + infe.header + 4;
      const itemId = idWidth === 2 ? readU16(buf, q) : readU32(buf, q);
      const typeAt = q + idWidth + 2; // + protection_index
      if (typeAt + 4 > infe.end) continue;
      if (buf.toString('latin1', typeAt, typeAt + 4) === 'Exif') {
        return { itemId, idWidth };
      }
    }
  }
  return null;
}

// 按给定 base_offset_size 解析 iloc 全部条目;返回 itemId 对应 { offset, length } 或 null。
// 解析要求:条目精确消耗到 iloc 末尾(或遇到越界即失败),避免错位误读。
function parseIlocWithBase(buf, ilocBox, itemId, baseOffsetSize) {
  const version = buf[ilocBox.start + ilocBox.header];
  const sizesByte1 = buf[ilocBox.start + ilocBox.header + 4]; // offset_size(4) + length_size(4)
  const offsetSize = sizesByte1 >> 4;
  const lengthSize = sizesByte1 & 0x0f;
  let p = ilocBox.start + ilocBox.header + 5;
  let indexSize = 0;
  let itemCount = 0;
  let itemIdWidth = 2;
  if (version === 0) {
    itemCount = readU16(buf, p); p += 2;
  } else {
    if (version === 1) {
      const sizesByte2 = buf[p]; p += 1;
      indexSize = sizesByte2 & 0x0f;
      itemCount = readU16(buf, p); p += 2;
    } else {
      p += 1; // sizesByte2(未使用,base 由自校正决定)
      p += 2; // reserved
      itemCount = readU32(buf, p); p += 4;
      itemIdWidth = 4;
    }
  }
  let result = null;
  for (let i = 0; i < itemCount; i++) {
    if (p + 8 > ilocBox.end) return null; // 条目数不符 → 候选宽度错误
    const id = itemIdWidth === 2 ? readU16(buf, p) : readU32(buf, p);
    p += itemIdWidth;
    p += 2; // construction_method + data_reference_index
    const baseOffset = baseOffsetSize ? readOffset(buf, p, baseOffsetSize) : 0;
    p += baseOffsetSize;
    const extentCount = version === 2 ? readU32(buf, p) : readU16(buf, p);
    p += version === 2 ? 4 : 2;
    for (let e = 0; e < extentCount; e++) {
      if (version === 1 && indexSize) p += indexSize; // extent_index
      if (p + offsetSize + lengthSize > ilocBox.end) return null;
      const extentOffset = readOffset(buf, p, offsetSize);
      p += offsetSize;
      const extentLength = readOffset(buf, p, lengthSize);
      p += lengthSize;
      if (id === itemId) {
        result = { offset: baseOffset + extentOffset, length: extentLength };
      }
    }
  }
  // 精确消费到 iloc 末尾才算可靠解析
  return p === ilocBox.end ? result : null;
}

function readOffset(buf, p, size) {
  switch (size) {
    case 1: return buf[p];
    case 2: return readU16(buf, p);
    case 4: return readU32(buf, p);
    case 8: return readU64(buf, p);
    default: return 0;
  }
}

// 解析 TIFF 数据(从 exif_tiff_header_offset 指向的 TIFF 头开始)中的 Orientation(IFD0 tag 0x0112, SHORT)
function parseTiffOrientation(buf, start) {
  const end = buf.length;
  if (start + 8 > end) return null;
  const byteOrder = buf.toString('latin1', start, start + 2);
  const little = byteOrder === 'II';
  const read16 = (o) => little ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const read32 = (o) => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  // TIFF magic 为 2 字节(0x002A),需按字节序读取
  const magic = little ? buf.readUInt16LE(start + 2) : buf.readUInt16BE(start + 2);
  if (magic !== 42) return null;
  const ifd0 = read32(start + 4);
  if (start + ifd0 + 2 > end) return null;
  const entryCount = read16(start + ifd0);
  for (let i = 0; i < entryCount; i++) {
    const o = start + ifd0 + 2 + i * 12;
    if (o + 12 > end) return null;
    const tag = read16(o);
    if (tag === 0x0112) {
      const type = read16(o + 2);
      // SHORT(3) 的值直接内联在 4 字节 value 字段;其他类型仅 SHORT 常见
      if (type === 3) {
        const v = read16(o + 8);
        return v >= 1 && v <= 8 ? v : null;
      }
      return null;
    }
  }
  return null;
}

/**
 * 提取 HEIC/HEIF 的 EXIF Orientation(1~8);解析失败返回 null。
 * @param {Buffer} buffer HEIC/HEIF 文件内容
 * @returns {number|null}
 */
export function getHeicOrientation(buffer) {
  try {
    const top = walkBoxes(buffer, 0, buffer.length);
    const meta = top.find((b) => b.type === 'meta');
    if (!meta) return null;
    const metaBoxes = walkBoxes(buffer, meta.start + meta.header + 4, meta.end); // 跳过 fullbox
    const iinf = metaBoxes.find((b) => b.type === 'iinf');
    const iloc = metaBoxes.find((b) => b.type === 'iloc');
    if (!iinf || !iloc) return null;
    const exif = findExifItemId(buffer, iinf);
    if (!exif) return null;
    const declaredBase = buf2(buffer, iloc) >> 4;
    const candidates = [declaredBase, 2, 0, 4, 8].filter((v, i, a) => a.indexOf(v) === i);
    for (const baseSize of candidates) {
      const loc = parseIlocWithBase(buffer, iloc, exif.itemId, baseSize);
      if (!loc || loc.length < 8 || loc.offset + loc.length > buffer.length) continue;
      // Exif item 数据:4 字节 exif_tiff_header_offset + TIFF 数据(偏移相对 item 数据起点)
      const tiffOffset = readU32(buffer, loc.offset);
      const tiffStart = loc.offset + 4 + tiffOffset;
      const orientation = parseTiffOrientation(buffer, tiffStart);
      if (orientation !== null) return orientation;
    }
    return null;
  } catch {
    return null;
  }
}

function buf2(buffer, ilocBox) {
  return buffer[ilocBox.start + ilocBox.header + 5];
}
