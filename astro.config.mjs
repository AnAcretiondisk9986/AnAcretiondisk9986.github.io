import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';

/* 本地联调用的额度查询代理地址：管理服务（npm run admin）默认在 127.0.0.1:4322。
   dev / preview 都把同源的 /api/* 转发过去，浏览器因此不需要跨域，
   前端也不会出现任何密钥——密钥只存在于 admin-server 进程读的 .ai-quota.keys.json。
   线上是静态站（GitHub Pages），改由 Cloudflare Worker 承接同一份契约，见 docs/ai-quota-contract.md。 */
const adminOrigin = process.env.ADMIN_ORIGIN || 'http://127.0.0.1:4322';
const apiProxy = {
  '/api': { target: adminOrigin, changeOrigin: true },
};

export default defineConfig({
  site: 'https://blog.acretiondisk.top',
  output: 'static',
  markdown: {
    processor: satteri({}),
  },
  vite: {
    server: { proxy: apiProxy },
    preview: { proxy: apiProxy },
  },
});
