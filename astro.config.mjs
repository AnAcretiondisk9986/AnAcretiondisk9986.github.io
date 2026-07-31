import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import optimizeImagesPlugin, { optimizeImagesIntegration } from './src/plugins/optimize-images.mjs';

export default defineConfig({
  site: 'https://anacretiondisk9986.github.io',
  output: 'static',
  integrations: [optimizeImagesIntegration()],
  markdown: {
    processor: satteri({
      hastPlugins: [optimizeImagesPlugin],
    }),
  },
});
