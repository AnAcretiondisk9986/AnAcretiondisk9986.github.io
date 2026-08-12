import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';

export default defineConfig({
  site: 'https://acretiondisk.top',
  output: 'static',
  markdown: {
    processor: satteri({}),
  },
});
