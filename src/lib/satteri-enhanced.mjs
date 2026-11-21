/**
 * Astro Markdown 增强处理器：
 * 在 @astrojs/markdown-satteri 解析前运行与编辑器共享的 preprocessMarkdownForRender，
 * 解决 CJK 标点紧邻 **...** / *...* / ~~...~~ 无法渲染、嵌套 ** **、历史混写 HTML、
 * 裸 <iframe> 吞标题及裸 $...$/$$...$$ 公式在线上与编辑器不一致的问题。
 */
import { satteri } from '@astrojs/markdown-satteri';
import { preprocessMarkdownForRender } from './markdown-preprocess.mjs';

export function enhancedSatteri(opts = {}) {
  const base = satteri(opts);
  return {
    ...base,
    async createRenderer(shared) {
      const renderer = await base.createRenderer(shared);
      return {
        ...renderer,
        render(content, renderOpts) {
          const processed = preprocessMarkdownForRender(content, { forEditor: false });
          return renderer.render(processed, renderOpts);
        },
      };
    },
    async createMdxRenderer(shared, mdx) {
      return base.createMdxRenderer(shared, mdx);
    },
  };
}
