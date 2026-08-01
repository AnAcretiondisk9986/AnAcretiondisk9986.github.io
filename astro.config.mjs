import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';

export default defineConfig({
  site: 'https://anacretiondisk9986.github.io',
  output: 'static',
  markdown: {
    processor: satteri({}),
  },
});
