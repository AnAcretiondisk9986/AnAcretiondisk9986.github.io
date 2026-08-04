import { createHash } from 'node:crypto';

/**
 * 由文章 id(content 集合中 slugified 后的相对路径)生成确定性短链码。
 *
 * 背景:文章 slug 含中文,完整链接复制时会被浏览器百分号转码,变得极长且难读。
 * 这里取 sha256 前 8 位 hex 转 base36,得到 6~7 位纯 ASCII 字母数字短码,
 * 短链形如 `https://<site>/s/<短码>`。
 *
 * 性质:
 * - 确定性:同一 id 永远生成同一短码,无需后端、无需存储。
 * - 稳定性:短码只依赖 slug,不依赖构建时间/随机数,重构建不变化。
 * - 碰撞概率:2^32 ≈ 4.3e9 空间,几百篇文章碰撞概率可忽略;
 *   构建侧另有冲突检测(见 src/pages/s/[id].astro),命中即构建失败提醒。
 */
export function shortIdForPath(id: string): string {
  const hex = createHash('sha256').update(id).digest('hex').slice(0, 8);
  return parseInt(hex, 16).toString(36);
}
