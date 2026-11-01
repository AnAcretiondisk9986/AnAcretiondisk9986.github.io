# AI 额度页 · 数据契约 v1

页面 `/ai-quota/` 只认这一份 JSON。**任何密钥都不允许出现在浏览器可下载的文件里**：
页面请求本站点（或 Cloudflare Worker）上的 `/api/ai-quota`，由服务端持钥访问上游。

## 1. 请求

```
GET /api/ai-quota            # 命中 30s 内存缓存
GET /api/ai-quota?force=1    # 跳过缓存，强制回源
```

响应 `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`。
HTTP 状态恒为 200（单个上游失败写进 `providers[].status`，不整体报错）；
服务端完全读不到密钥文件时同样返回 200，但 `ok:false` 且六个 provider 全部 `status:"config-error"`，
页面据此逐条提示，而不是假装"没有数据"。

## 2. 响应

```json
{
  "ok": true,
  "generatedAt": "2026-11-01T07:45:00.000Z",
  "cacheSeconds": 30,
  "providers": [ Provider, ... ]
}
```

### Provider

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `"opencode-go"｜"yundu"｜"toolcode"｜"taffcloud"｜"deepseek"｜"glm"` | 稳定标识 |
| `label` | string | 展示名，如 `云渡` |
| `group` | `"subscription"｜"relay"｜"platform"` | 页面分区 |
| `status` | `"ok"｜"missing-key"｜"auth"｜"network"｜"timeout"｜"upstream"｜"config-error"` | 查询结果 |
| `message` | string \| null | 失败时的中文一句话说明（可直接展示） |
| `updatedAt` | ISO string | 该条读数时间 |
| `currency` | `"USD"｜"CNY"｜null` | 金额币种 |
| `balance` | number \| null | 余额（原币种） |
| `quota` | Quota \| null | 套餐/额度区间信息 |
| `windows` | Window[] \| null | 订阅制窗口（OpenCode GO / GLM 计划） |
| `usage` | Usage \| null | 用量汇总 |
| `series` | Point[] \| null | 按日用量序列（升序，最多 30 天） |
| `meta` | object | 各后端的补充事实（只放可公开展示的） |

```ts
type Quota = {
  unlimited: boolean;      // 后端声明"不限额度"
  limit: number | null;    // 总额度（原币种）
  used: number | null;     // 已用（原币种）
  remaining: number | null;// 剩余（原币种，未知填 null）
};

type Window = {
  key: string;             // rolling | weekly | monthly | session
  label: string;           // 中文标签，如"滚动 5 小时"
  percent: number | null;  // 已用百分比 0..100
  resetsAt: string | null; // 重置时刻 ISO
  status: string;          // 上游原文状态，如 active
};

type Usage = {
  todayRequests: number | null;
  todayCost: number | null;   // 原币种
  totalCost: number | null;   // 原币种
  isValid?: boolean | null;   // 上游声明 key 是否有效
  mode?: string | null;       // 上游计费模式原文
  todayTokens?: TokenCounts | null; // 只有云渡 / ToolCode 给，其它家恒 null
  totalTokens?: number | null;      // 云渡 / ToolCode 累计 token；智谱填资源包剩余
};

type TokenCounts = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  total: number | null;
};

type Point = { date: string; cost: number | null; requests: number | null };
```

字段缺失一律用 `null`，不要用 `0` 冒充未知。

## 3. 各上游取数口径

| id | 上游 | 鉴权 | 取值 |
| --- | --- | --- | --- |
| `opencode-go` | `GET https://opencode.ai/zen/go/v1/usage` | `Authorization: Bearer <key>` + `x-opencode-session: <uuid>` | `usage.{rolling,weekly,monthly}.{status,percent,resetsAt}` → `windows` |
| `yundu` | `GET https://gd.yundu.lol/v1/usage` | `Bearer <sk>` | `balance`、`daily_usage[]`、`isValid`、`mode` |
| `toolcode` | `GET https://toolcode.cc/v1/usage`（失败回落 `https://toolcode.top/v1/usage`） | `Bearer <sk>` | 同上 |
| `taffcloud` | 优先 `GET /api/user/self`（需面板 access token）→ `data.quota/used_quota`；否则回落 `GET /v1/dashboard/billing/subscription` + `/v1/dashboard/billing/usage` | `Bearer <sk>`；access token 模式另加 `New-Api-User: <userId>` | 回落时 `quota.unlimited = hard_limit_usd >= 1e8`，`used = total_usage / 100`（分→美元） |
| `deepseek` | `GET https://api.deepseek.com/user/balance` | `Bearer <sk>` | `balance_infos[0].{currency,total_balance,granted_balance,topped_up_balance}` |
| `glm` | 余额 `GET https://open.bigmodel.cn/api/biz/account/query-customer-account-report`；资源包 `GET https://open.bigmodel.cn/api/biz/tokenAccounts/list/my`；计划用量 `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | **裸 key**（不加 `Bearer`，中国站） | `data.availableBalance/rechargeAmount/giveAmount/totalSpendAmount/todaySpendAmount`；资源包 `rows[].tokenBalance`（只算未过期且 >0 的包）→ `meta.tokenBalanceTotal`；计划 `data.limits[]` → `windows` |

`glm` 若 key 为空 → `status:"missing-key"`，页面照常渲染其余五块。
账号没订阅 Coding Plan 时计划接口回 `{"code":500,"msg":"当前用户不存在coding plan"}`：
这是"没有套餐"而不是鉴权失败，按 `status:"ok"` + `meta.planAvailable:false` + `message:"未开通 Coding Plan"` 输出，不得判成 `auth`。
资源包全部过期时 `tokenBalanceTotal` 为 `null`（不要用过期包的数值冒充剩余）。

### 3.1 谁能读到 token / 金额（2026-11 实测）

| 上游 | 额度/余额 | 今日花费 | 今日 Token | 明细 |
| --- | --- | --- | --- | --- |
| OpenCode GO | 只有三窗口百分比 | — | — | 各窗口重置时间 |
| 云渡 | 钱包余额（USD） | `actual_cost` | `usage.today.{input,output,cache_read,total}` | `model_stats`（按模型）+ 累计 token |
| ToolCode | 钱包余额（USD） | 同上 | 同上 | 同上 |
| TaffCloud | 不限额度 + 本月已用 | — | — | — |
| DeepSeek | 余额（赠送/充值） | — | — | — |
| 智谱 GLM | 余额 + 资源包 | `todaySpendAmount`（按账号，可为 null） | 资源包剩余（有效包） | Coding Plan 窗口（若已订阅） |

页面的「04 可读口径」表就是这份事实的展示副本，改这里时同步改 `src/data/ai-quota.json` 的 `reads`。

## 4. 密钥文件

服务端读取 `.ai-quota.keys.json`（已被 `.gitignore` 忽略；`AI_QUOTA_KEYS_FILE` 可改路径）：

```json
{
  "opencode-go": { "apiKey": "" },
  "yundu":       { "apiKey": "sk-..." },
  "toolcode":    { "apiKey": "sk-..." },
  "taffcloud":   { "apiKey": "sk-...", "accessToken": "", "userId": "" },
  "deepseek":    { "apiKey": "sk-..." },
  "glm":         { "apiKey": "" }
}
```

仓库里只提交 `.ai-quota.keys.example.json`。

## 5. 前端行为

- 进入页面立即取一次；之后每 60s 轮询（标签页隐藏时暂停，回到前台立即补一次）。
- 手动刷新按钮：`?force=1`；同一秒内重复点击不重复发请求。
- 响应写入 `sessionStorage`（键 `ai-quota:v1`），20s 内重载页面先用缓存渲染再回源。
- `/api/ai-quota` 404 / 非 JSON / 网络失败 → 整页进入"代理未连接"提示，文案说明需要启动本地管理服务或配置 Worker 地址；不得显示假数字。
- 所有 `percent` 截断到 0..100；`resetsAt` 倒计时每秒更新，超过 24h 显示日期。

## 6. 部署形态

1. 本地：`npm run admin` 起 `admin-server.mjs`（127.0.0.1:4322），`/api/ai-quota` 由其提供
   （路由必须注册在 `app.use('/api', auth)` 之前）；`astro.config.mjs` 已把 dev / preview 的
   `/api/*` 代理到 4322，所以 `npm run dev` 后直接开 `http://127.0.0.1:4321/ai-quota/` 即可。
   只想看数据不打开页面时用 `npm run quota:check`（加 `--json` 出原始 JSON，`--force` 跳过缓存）。
2. 线上静态站：部署 `scripts/ai-quota-worker.js`（Cloudflare Worker，密钥走 `wrangler secret`），
   页面通过 `src/data/ai-quota.json` 的 `endpoint` 字段或 `PUBLIC_AI_QUOTA_ENDPOINT` 指向它。

```bash
# 1) 写入密钥：整份 keys JSON 作为一个 secret（或分别用 OPENCODE_GO_API_KEY 等单键 secret）
npx wrangler secret put AI_QUOTA_KEYS_JSON --name ai-quota
# 2) 允许的来源（默认 https://blog.acretiondisk.top）
npx wrangler secret put ALLOWED_ORIGIN --name ai-quota
# 3) 部署（入口 scripts/ai-quota-worker.js，需 Node 兼容日期 ≥ 2024-09-23）
npx wrangler deploy scripts/ai-quota-worker.js --name ai-quota --compatibility-date 2026-01-01
# 4) 把 https://ai-quota.<account>.workers.dev/api/ai-quota 写进 src/data/ai-quota.json 的 endpoint
```

注意：这条线路本身是公开只读的——任何知道 Worker 地址的人都能看到同样的余额读数。
只想自己看时，要么保持在本地跑（`npm run admin` + `npm run dev`），要么在 Cloudflare 侧加
Access 策略/随机路径，不要把它当成带鉴权的后台。

## 7. 已知取舍

- `taffcloud` 只有 `sk` 时读不到面板的剩余额度（new-api 的 `/api/user/self` 要登录态），
  回落到 OpenAI 兼容计费接口，于是只能给出「不限额度 + 本月已用」；填了 `accessToken` 与
  `userId` 后才会显示面板原始 quota 折算的剩余额度。
- billing 接口的 `total_usage` 是「月初至今」区间值，`usage.todayCost` 因此为 `null`，
  页面显示 `—` 而不是把区间值冒充今日花费。
- 上游把「无限」写成 `hard_limit_usd = 1e8` 这类哨兵值时不当作真实总额度，
  只标记 `quota.unlimited`，原始数值留在 `meta`。

