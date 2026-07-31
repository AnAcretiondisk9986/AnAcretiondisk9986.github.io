# Waline 留言服务部署指引

留言页 `/guestbook/` 使用 [Waline](https://waline.js.org/) 作为评论后端：
它负责存储留言、限制字数，并在**服务端解析发送端 IP 的属地**（中国显示省份、国外显示国家，基于内置 ip2region 离线库，无需任何第三方地理 API 密钥）。

本仓库前端已按 Waline 的 API 契约实现（读取 / 发布 / 管理删除），部署后无需改前端代码。

---

## 一、部署 Waline（Vercel 免费方案，约 10 分钟）

1. 注册/登录 [Vercel](https://vercel.com/)（可用 GitHub 账号登录）。
2. 打开 Waline 一键部署模板（或手动新建项目导入仓库 `walinejs/waline`）：

   - 模板地址：<https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwalinejs%2Fwaline>
   - 需要将 **Waline 仓库 Fork 到自己的 GitHub**（模板页会引导）。

3. 配置环境变量（Project Settings → Environment Variables）：

   | 变量 | 必填 | 值 |
   | --- | --- | --- |
   | `LEAN_KEY` / `LEAN_ID` | 任选其一存储方案 | 推荐直接用 **Vercel KV (Upstash)**：Add → Vercel KV → 创建后自动注入 `KV_URL` 等变量，无需手动填。也可用 LeanCloud / MySQL / MongoDB（见下方备选） |
   | `WORD_LIMIT` | 建议 | `0,300` — 服务端强制单条留言不超过 300 字 |
   | `AUTHOR_EMAIL` | 是 | 你的邮箱（用于邮件通知等） |
   | `JWT_TOKEN` | 是 | 任意随机长字符串（管理令牌签名密钥，例如 `openssl rand -hex 32`） |
   | `SITE_NAME` | 建议 | `Acretiondisk` |
   | `SITE_URL` | 建议 | `https://anacretiondisk9986.github.io/` |
   | `DISABLE_REGION` | 不要设置 | 不设置即默认显示 IP 属地；若设为 `true` 会关闭属地显示 |
   | `IPQPS` | 可选 | 同一 IP 发布间隔秒数，默认 60 |

   > **不要** 设置 `IMAGE_UPLOAD` 等任何图片上传相关变量——留言页按需求不支持图片。

4. 点击 Deploy，部署完成后得到服务地址，形如 `https://waline-xxxx.vercel.app`。

5. **注册管理员**：打开 `https://你的服务地址/ui/`（Waline 自带管理后台），注册第一个账号 ——
   **第一个注册的账号即管理员**。请使用真实邮箱并牢记密码。

## 二、接入本博客

✅ **已接入（2026-07-31）**：默认服务地址已写死在 `src/pages/guestbook.astro` 的 `DEFAULT_SERVER = 'https://comment-sys-ashen.vercel.app'`，线上访客打开 `/guestbook/` 即可直接留言，无需任何参数。

- 后台管理：`npm run admin` → 管理面板「留言」标签页 → 填入 `https://comment-sys-ashen.vercel.app` + 管理员邮箱密码 → 连接后即可查看/删除留言。
- 本地调试仍可用 `?server=http://127.0.0.1:8765` 临时切换回 mock 服务（仅当前浏览器生效）。
- 若将来更换 Waline 地址，改 `DEFAULT_SERVER` 常量即可；也支持浏览器访问 `/guestbook/?server=新地址` 覆盖。

## 三、本地预览（可选，无需部署）

仓库自带一个与 Waline API 契约一致的本地 mock 服务（数据存 `.mock-waline/`，仅本机）：

```bash
npm run mock:waline        # 启动 http://127.0.0.1:8765
npm run dev                # 另开终端启动博客
```

浏览器访问 `http://localhost:4321/guestbook/?server=http://127.0.0.1:8765`。
mock 管理员：`admin@acretiondisk.local` / `admin123`（可用环境变量 `MOCK_ADMIN_EMAIL` / `MOCK_ADMIN_PASSWORD` 覆盖）。

> mock 的 IP 属地为轮换示例数据（本地无公网 IP 可解析）；真实部署后由 Waline 服务端自动解析真实属地。

## 四、存储方案备选（如不用 Vercel KV）

- **LeanCloud 国际版**：`LEAN_ID` + `LEAN_KEY`（免费额度够个人博客用）；
- **MySQL**：`MYSQL_DB` / `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD`；
- **MongoDB Atlas**：`MONGO_DB` / `MONGO_USER` / `MONGO_PASSWORD` / `MONGO_HOST` / `MONGO_PORT`。

其他平台（Railway / Fly.io / Docker）见 <https://waline.js.org/guide/deploy/>。

## 五、常见问题

- **留言页提示「留言服务尚未连接」**：访客浏览器尚未带 `?server=` 且页面内未写死默认地址 → 按上文「二、接入」写死默认值。
- **IP 属地不显示**：确认 `DISABLE_REGION` 未设置；新部署后首条留言需等 ip2region 首次加载。
- **发送提示「Comment too fast!」**：Waline 默认同一 IP 60 秒内只能发一条（`IPQPS` 可调）。
- **管理面板提示令牌失效**：重新填邮箱密码连接即可。
