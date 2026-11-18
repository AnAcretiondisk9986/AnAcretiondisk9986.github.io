#!/usr/bin/env node
/**
 * 将 admin/src/editor/tiptap-entry.js 打包为单文件 ES Module（admin/vendor/tiptap-bundle.mjs），
 * 并同步复制 KaTeX 样式与字体到 admin/vendor/katex/ 与 public/vendor/katex/，
 * 确保 PC 管理后台与 Electron 桌面版完全离线零外部 CDN 依赖。
 */
import { rolldown } from 'rolldown';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function buildBundle() {
  const input = resolve(ROOT, 'admin/src/editor/tiptap-entry.js');
  const outFile = resolve(ROOT, 'admin/vendor/tiptap-bundle.mjs');
  await mkdir(dirname(outFile), { recursive: true });

  const bundle = await rolldown({
    input,
    platform: 'browser',
  });
  await bundle.write({
    file: outFile,
    format: 'es',
    minify: true,
    codeSplitting: false,
  });
  await bundle.close();
  console.log('[build:editor] 已生成 admin/vendor/tiptap-bundle.mjs');
}

async function syncKatexAssets() {
  const srcCss = resolve(ROOT, 'node_modules/katex/dist/katex.min.css');
  const srcFonts = resolve(ROOT, 'node_modules/katex/dist/fonts');
  for (const destRoot of [
    resolve(ROOT, 'admin/vendor/katex'),
    resolve(ROOT, 'public/vendor/katex'),
  ]) {
    await mkdir(destRoot, { recursive: true });
    await cp(srcCss, resolve(destRoot, 'katex.min.css'));
    await rm(resolve(destRoot, 'fonts'), { recursive: true, force: true });
    await cp(srcFonts, resolve(destRoot, 'fonts'), { recursive: true });
  }
  console.log('[build:editor] 已同步 KaTeX 样式与字体到 admin/vendor/katex 与 public/vendor/katex');
}

await buildBundle();
await syncKatexAssets();
