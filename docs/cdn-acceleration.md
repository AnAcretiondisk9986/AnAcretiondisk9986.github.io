# AI 额度页 · 国内访问加速

`/ai-quota/` 在弱网下「慢、转圈、最后显示未连接」，根子不在页面本身，而在两段链路：

| 环节 | 现状 | 国内实测症状 |
| --- | --- | --- |
| 静态页 | GitHub Pages（CNAME → `anacretiondisk9986.github.io`，Fastly，`x-github-edge-region: japaneast`） | 首字节 1–5s，移动网偶发 TLS 重置；`github.io` 域名存在 DNS 污染 |
| 额度接口 | `https://ai-quota.anacretiondisk.workers.dev/api/ai-quota` | `*.workers.dev` 在国内长期被限速/阻断，3–15s 或直接超时 |
| 文章配图 | `cdn.jsdelivr.net`（部分文章） | jsDelivr 国内节点时通时断，图片转圈 |

所以「加个 CDN」要解决的是三件事：**静态页边缘化、接口同源化、图片本地化**。

前端侧已经做完的部分（不依赖任何账号操作）：

- 构建期快照内联进 HTML（`npm run build` 先跑 `scripts/ai-quota-snapshot.mjs`），首屏零网络；
- `localStorage` 7 天长缓存 + 会话缓存，取「更新的一份」并在页头标注「快照 / 缓存 · 时间」；
- 主端点在 `data-endpoint`（本站 `/api/ai-quota`），失败才退到 `data-endpoint-fallback`（workers.dev）；
- 首屏 4.5s、常规 8s 超时；失败后指数退避（60s → 2min → 4min → 5min 封顶），不再每 60s 白扔请求；
- 已有读数时回源失败只把连接状态标红，**不把卡片清空**。

下面三条路按「改造成本 / 效果」排序，任选其一即可。

---

## 方案 A：Cloudflare 全站接管（推荐，0 成本，效果最直接）

域名现在托管在阿里云 DNS（`dns7/dns8.hichina.com`），把 NS 换成 Cloudflare 即可获得：边缘缓存、同源接口、优选 IP 的落地条件。

### A1. 把 zone 迁到 Cloudflare

1. Cloudflare 控制台 → Add a site → `acretiondisk.top` → Free 计划。
2. 记下分配的两个 NS（形如 `xxx.ns.cloudflare.com`）。
3. 阿里云「域名控制台 → DNS 修改」把 NS 改成这两个（原解析记录建议先导出）。
4. Cloudflare 里补齐记录（**橙云 = 走 CDN**）：

| 类型 | 名称 | 内容 | 代理 |
| --- | --- | --- | --- |
| CNAME | `blog` | `anacretiondisk9986.github.io` | 开启（橙云） |
| A/CNAME | 其它既有记录 | 按阿里云导出的原样补 | 按需 |

5. SSL/TLS → 模式选 **Full**（GitHub Pages 有有效证书，不要用 Flexible）。

### A2. 让 Worker 承接同源 `/api/*`

`deploy/ai-quota-worker/wrangler.toml` 里取消这段注释后再 `wrangler deploy`：

```toml
routes = [
  { pattern = "blog.acretiondisk.top/api/*", zone_name = "acretiondisk.top" }
]
```

部署后 `https://blog.acretiondisk.top/api/ai-quota` 由 Worker 直接应答：
同源、无额外 DNS、无额外 TLS 握手，前端 `data-endpoint` 已经是这个路径，**不用改代码**。
页面里的 `data-endpoint-fallback` 保留 workers.dev，只在同源路由失效时兜底。

### A3. 缓存规则（省掉绝大部分回源）

Cloudflare → Caching → Cache Rules：

| 规则 | 匹配 | 设置 |
| --- | --- | --- |
| 静态资源 | `blog.acretiondisk.top/_astro/*`、`/fonts/*`、`/images/*` | Edge TTL 1 年，Browser TTL 1 年 |
| HTML | `blog.acretiondisk.top/*`（`text/html`） | Edge TTL 10 分钟，Browser TTL 0，开启 Always Online |
| 接口 | `blog.acretiondisk.top/api/*` | 交给 Worker 自己的 `Cache-Control`（已按 `cacheSeconds` 输出 `s-maxage`） |

### A4. 优选 IP（国内最后一公里）

免费版 CF 在国内常被调度到洛杉矶/香港的拥塞节点。两个做法：

1. **给自己的域名锁入口**：把 `blog` 的 CNAME 换成 A 记录，填 Cloudflare 优选段里当前最快的 IP
   （用 [CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest) 在本机跑一遍，取延迟最低的几个），
   代理保持开启。CF 任播会把请求送进边缘，等于把「DNS 选路」变成「你选路」。
2. **客户端侧**：给访客提供一份 hosts/CNAME 说明，或另开 `cf.acretiondisk.top` 指向优选 IP，
   页脚放一句「打不开时用 cf 前缀」。前者改动大，后者更省事。

> 注意：优选 IP 会随线路漂移，建议每月重测一次；`blog` 记录改 A 之前先备份原 CNAME。

---

## 方案 B：腾讯云 EdgeOne 国际版（免备案，不动 NS）

适合不想迁 NS、也不想备案的情况：

1. EdgeOne 控制台 → 创建站点 → 加速域名 `blog.acretiondisk.top` → 接入方式选 **CNAME**。
2. 源站类型选「域名」，源站填 `anacretiondisk9986.github.io`，回源 Host 用 `blog.acretiondisk.top`
   （GitHub Pages 认 Host，填错会 404）。
3. 在阿里云 DNS 把 `blog` 的 CNAME 改成 EdgeOne 给的目标域名。
4. 接口同理再挂一个 `api.acretiondisk.top`，源站填 `ai-quota.anacretiondisk.workers.dev`——
   EdgeOne 从海外节点回源，国内用户只面对 EdgeOne 的边缘，绕开 workers.dev 的直连限速。
5. 缓存：HTML 5–10 分钟，`/_astro/*` 一年，`/api/*` 30 秒。

EdgeOne 免费版有流量与请求数配额，个人博客够用；国内节点需要备案，国际版走港澳台/新加坡节点。

---

## 方案 B+：一台境外 VPS 自建反代（可控性最好）

如果你手上已有香港/日本的小鸡（CN2/CMI 线路更佳），比任何免费 CDN 都稳：

```nginx
# /etc/nginx/conf.d/aiq.conf
proxy_cache_path /var/cache/aiq levels=1:2 keys_zone=aiq:10m max_size=100m inactive=10m;

server {
  listen 443 ssl http2;
  server_name api.acretiondisk.top;
  ssl_certificate     /etc/letsencrypt/live/api.acretiondisk.top/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.acretiondisk.top/privkey.pem;

  location /api/ {
    proxy_pass https://ai-quota.anacretiondisk.workers.dev/api/;
    proxy_set_header Host ai-quota.anacretiondisk.workers.dev;
    proxy_ssl_server_name on;

    proxy_cache aiq;
    proxy_cache_valid 200 30s;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    add_header X-Cache-Status $upstream_cache_status always;
  }
}
```

然后把 `src/data/ai-quota.json` 的 `endpoint` 改成 `https://api.acretiondisk.top/api/ai-quota`
（或让 EdgeOne/CF 再包一层），`fallbackEndpoint` 保留 workers.dev。
同一台机器顺手可以做 GitHub Pages 的反代（`proxy_pass https://anacretiondisk9986.github.io;`
+ `proxy_set_header Host blog.acretiondisk.top;`），静态页也就一起加速了。

---

## 方案 C：备案 + 国内 CDN（效果最好，周期最长）

`.top` 域名在国内注册，可以正常做 ICP 备案（约 1–3 周）。备案通过后：

1. `dist/` 传到阿里云 OSS（静态网站托管）或腾讯云 COS；
2. 阿里云 CDN / 腾讯云 CDN 加速域名 `blog.acretiondisk.top`，源站选 OSS；
3. `/api/*` 用函数计算（FC）或轻量服务器反代 Worker，同样挂到 CDN 上；
4. 开启 Brotli、HTTP/3、智能压缩。

这条路国内节点直连，晚高峰也稳，但要备案 + 一点点存储/CDN 费用。博客是纯静态站，成本通常每月几块钱。

---

## 图片：把 jsDelivr 换成本地或自家域名

文章里大量 `https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/...`。jsDelivr 在国内不稳定，两条路：

- **推荐**：把 `blog-images` 仓库的 `image/` 目录同步到本仓库 `public/images/external/`，构建时改写链接；
  静态站本来就要跟 CDN 一起走，图片同源后缓存规则、HTTP/2 复用全部生效。
- **临时**：把域名换成 `fastly.jsdelivr.net` 或 `gcore.jsdelivr.net`（同一套 CDN 的不同入口，国内可达性不同）。

---

## 验收

```bash
# 首字节（换 CF/EdgeOne 前后各跑一次，对比 TTFB）
curl -o /dev/null -s -w 'dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer}\n' \
  https://blog.acretiondisk.top/ai-quota/

# 接口（应当同源、且带 s-maxage）
curl -sI https://blog.acretiondisk.top/api/ai-quota | grep -i 'cache-control\|cf-cache-status'
```

浏览器侧看两个数：`/ai-quota/` 的 LCP 应该落在 1s 内（快照铺屏），控制条在 1–3s 内从「快照」翻成实时时间。

---

## 变更清单（本次已落地）

| 文件 | 改动 |
| --- | --- |
| `scripts/ai-quota-snapshot.mjs` | 新增：构建期抓一份额度快照，抓不到沿用旧的，构建不失败 |
| `package.json` | 新增 `prebuild` / `snapshot:quota` |
| `src/pages/ai-quota.astro` | 内联快照、`data-endpoint-fallback`、断线提示的「显示的是最近读数」分支 |
| `src/scripts/ai-quota.ts` | 同源优先 + 回落、4.5s/8s 双超时、localStorage 长缓存、指数退避、失败不清空卡片 |
| `src/data/ai-quota.json` | `endpoint` 改 `/api/ai-quota`，新增 `fallbackEndpoint` |
| `scripts/ai-quota-worker.js` | 响应改 `public, max-age/s-maxage=cacheSeconds`（`force=1` 仍 no-store） |
| `deploy/ai-quota-worker/wrangler.toml` | 预留 `blog.acretiondisk.top/api/*` 路由配置 |
