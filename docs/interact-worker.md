# Cloudflare Worker + KV 互动服务部署说明

> 对应脚本：[scripts/interact-worker.js](../scripts/interact-worker.js) · 配置：[deploy/interact-worker/wrangler.toml](../deploy/interact-worker/wrangler.toml)

## 功能

1. **03 日常跨访客共鸣计数**（`GET /api/interact/daily?ids=...`、`POST /api/interact/daily/:id/like`）
2. **文章与日常轻量纯文字留言**（`GET/POST/DELETE /api/interact/comments`）
3. **无后端自动优雅降级**：若线上尚未部署该 Worker，站点前端自动保持 `localStorage` 本地共鸣模式，不报错、不阻塞阅读。

## 快速部署

```bash
# 1. 创建 KV 命名空间，并把输出 id 填入 deploy/interact-worker/wrangler.toml
npx wrangler kv namespace create INTERACT_KV --config deploy/interact-worker/wrangler.toml

# 2. 设置管理员删评密钥
npx wrangler secret put ADMIN_SECRET --config deploy/interact-worker/wrangler.toml

# 3. 部署 Worker
npx wrangler deploy --config deploy/interact-worker/wrangler.toml
```

如需自定义子域名或 Workers.dev 地址，可在后台「06 外观」中配置 `interactEndpoint`（默认为同源 `/api/interact`）。
