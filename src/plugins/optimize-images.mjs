// 文章正文图片压缩：构建时把 public 中文章引用的图片转为 WebP，加速加载。
//
// 两个钩子协作：
// 1. Sätteri hast 插件（markdown 渲染时）：只处理 <Content /> 的文章页 HTML。
//    把 /image/xxx 压缩为 WebP 写入 public/image/opt/（源目录，渲染缓存命中时
//    旧产物依然在），并把 src 替换为 /image/opt/xxx.webp。
//    压缩成功才替换，失败自动回退原图，不中断构建。
// 2. Astro integration（astro:build:done）：构建收尾时清空并重建
//    dist/image/opt/（vite 复制 public 先于路由渲染，渲染时写入的文件不会被
//    本次构建复制，故由该钩子补复制；同时覆盖「渲染被缓存跳过」的场景）。
//
// 画廊页（src/pages/gallery.astro）从 post.body 原文解析 src，不经过此管道，
// 因此「随文图像」与「独立收藏」都保持原图。
//
// 参数：WebP quality 78，宽度超过 1920px 才等比缩小。
//
// 注意：public/image/opt/ 是构建产物，已加入 .gitignore，不入库。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const OPT_SOURCE_DIR = path.join(PUBLIC_DIR, 'image', 'opt');
const DIST_OPT_DIR = path.join(ROOT, 'dist', 'image', 'opt');

const QUALITY = 78;
const MAX_WIDTH = 1920;

/** @type {Map<string, { ok: boolean; outUrl?: string }>} 原图 src -> 压缩结果（防重复压缩） */
const cache = new Map();

const isProd = () => process.env.NODE_ENV === 'production';

/** @type {import('satteri').HastPluginDefinition} */
const hastPlugin = {
  name: 'astro-optimize-images',
  element: {
    filter: ['img'],
    async visit(node, ctx) {
      // 非生产构建（dev / preview 等）不压缩，保留原图 URL
      if (!isProd()) return;

      const props = node.properties ?? {};
      const src = props.src;
      if (typeof src !== 'string' || !src.startsWith('/image/')) return;

      try {
        const result = await optimize(src);
        if (!result.ok) return;
        ctx.setProperty(node, 'src', result.outUrl);
        if (!('loading' in props)) ctx.setProperty(node, 'loading', 'lazy');
        ctx.setProperty(node, 'decoding', 'async');
      } catch (err) {
        console.warn(`[astro-optimize-images] 跳过压缩 ${src}: ${err.message}`);
      }
    },
  },
};

async function optimize(src) {
  if (cache.has(src)) return cache.get(src);

  const result = await (async () => {
    const decoded = decodeURIComponent(src);
    const sourcePath = path.join(PUBLIC_DIR, decoded);
    // 防路径穿越：解析后必须仍位于 public/ 内
    const resolved = path.resolve(sourcePath);
    if (!resolved.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
      throw new Error(`图片路径越界 public/ 之外: ${src}`);
    }
    const fileName = path.basename(resolved);
    const lastDot = fileName.lastIndexOf('.');
    const fileBase = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
    const outUrl = `/image/opt/${encodeURIComponent(fileBase)}.webp`;
    const outPath = path.join(OPT_SOURCE_DIR, `${fileBase}.webp`);

    let pipeline = sharp(sourcePath);
    const meta = await pipeline.metadata();
    if (meta.width && meta.width > MAX_WIDTH) {
      pipeline = pipeline.resize({ width: MAX_WIDTH });
    }
    await fs.mkdir(OPT_SOURCE_DIR, { recursive: true });
    await pipeline.webp({ quality: QUALITY }).toFile(outPath);

    return { ok: true, outUrl };
  })().catch((err) => {
    console.warn(`[astro-optimize-images] 跳过压缩 ${src}: ${err.message}`);
    return { ok: false };
  });

  cache.set(src, result);
  return result;
}

/** Astro integration：构建结束把 public/image/opt/ 复制进 dist/image/opt/ */
function optimizeImagesIntegration() {
  return {
    name: 'astro-optimize-images',
    hooks: {
      'astro:build:done': async () => {
        let files;
        try {
          files = await fs.readdir(OPT_SOURCE_DIR);
        } catch {
          return; // 本次构建没有文章图片需要压缩
        }
        const webps = files.filter((f) => f.endsWith('.webp'));
        if (webps.length === 0) return;

        await fs.rm(DIST_OPT_DIR, { recursive: true, force: true });
        await fs.mkdir(DIST_OPT_DIR, { recursive: true });
        let copied = 0;
        for (const file of webps) {
          try {
            await fs.copyFile(path.join(OPT_SOURCE_DIR, file), path.join(DIST_OPT_DIR, file));
            copied++;
          } catch (err) {
            console.warn(`[astro-optimize-images] 复制 ${file} 失败: ${err.message}`);
          }
        }
        console.log(`[astro-optimize-images] 已为文章页生成 ${copied} 张压缩图 → /image/opt/`);
      },
    },
  };
}

export default hastPlugin;
export { optimizeImagesIntegration };
