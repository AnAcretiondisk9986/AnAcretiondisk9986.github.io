# Acretiondisk Blog — 更新日志

> 使用 Astro 构建的个人博客，部署到 GitHub Pages（`https://anacretiondisk9986.github.io/`）。
> 当前版本：**1.1.0**（2026-07-31）

---

## 1.1.0（2026-07-31）

### ✍ 新增「留言」页面（B 站评论区版式 + Waline）

- 新增 `/guestbook/`（导航「V 留言」，第五页面），版式仿 B 站评论区：左侧圆形字母头像（按昵称哈希取色）、昵称、楼层号、相对时间、正文；发送区为头像 + 可编辑昵称 + 300 字计数 + 发送按钮。
- 后端为 Waline 评论服务（Vercel + Neon PostgreSQL，部署与接入见 `docs/WALINE_DEPLOY.md`），前端按 Waline 官方 API 契约实现；`?server=` 可临时指定服务地址并记忆（localStorage）。
- 不可附加图片（无任何图片上传/粘贴入口，渲染时剥离 img/svg/script/iframe 等全部媒体元素）；300 字限制前后端双重强制；IP 属地由服务端 ip2region 解析展示。
- 管理面板新增「留言」模式：填写 serverURL + 管理员邮箱/密码换 token，列出留言（属地/原始 IP/邮箱/时间）并支持删除。
- 本地预览：`npm run mock:waline` → `http://127.0.0.1:8765`（管理员 `admin@acretiondisk.local` / `admin123`）。

### 🖼 新增「图志」页面与双图像档案

- 新增 `/gallery/`（导航「III 图志」），延续私人档案/编目册视觉语言。
- 「随文图像」自动扫描所有已发布文章中的图片，显示日期、说明、来源文章，支持原生 `<dialog>` 大图预览。
- 「独立收藏」读取 `src/data/gallery.json`，管理面板可直接增删改查。
- ARIA 标签页切换（`#journal` / `#independent` 记忆状态）、默认「从新至旧」可切换「从旧至新」的排序控件（`?order=oldest` 记忆），排序同步卡片编号。

### 📄 文章页新增「导出 PDF」

- 文章侧栏新增「⤓ 导出 PDF」按钮，触发 `window.print()`，浏览器「另存为 PDF」即可导出——零依赖，文字矢量可选、无中文乱码问题。
- A4 档案版式（`@media print`）：页眉页脚（站点名 / FOLIO 编号 / 文章 URL / 「第 X 页 · 共 Y 页」）、侧栏化为四栏「档案登记条」、强制浅色配色、分页控制（图片/代码块/引用不跨页）、正文外链自动附注完整 URL。

### 🔢 同日条目增加发表顺序索引号 dayIndex

- 博客 schema 新增可选 `dayIndex`（同一天内发表顺序，1 = 第一篇），模板已加默认值；画廊 / 目录页 / 首页 / 详情页同日排序统一使用（缺省按文件名兜底）。
- 卡片与条目展示日内序号：`D.03/05`、`DAY 02`、`· #02`、详情页条目编号如 `2026—0731—03`。
- 管理面板文章与画廊表单新增「同日序号」输入框（留空自动推导为同日最大 +1）。

### 🔄 主页与卷册目录页新增「从新至旧 / 从旧至新」切换

- 与画廊同一套控件样式（`.gallery-order-bar`），排序键：日期 → `dayIndex` → 初始位置兜底；`?order=oldest` 记忆状态。
- 条目 FOLIO 编号随排序重编（目录页 2 位、首页 3 位），同日序号不随排序变化。

### ⬆ 管理面板新增「全量推送」

- 原「推送」仅提交内容文件（`src/content/blog/`、`public/image/`、`src/data/gallery.json`），不含代码；新增「全量推送」`git add -A`（排除 `reasonix.toml`），提交信息与内容推送区分。

### 🖼 图片性能优化

- 构建时用 `sharp` 将文章图片压缩为 WebP 加速加载（`src/plugins/optimize-images.mjs`），画廊保持原图；画廊卡片预览改用压缩图，点击查看大图时展示原图。
- 新增技术报告《博客图片压缩优化》：`src/content/blog/博客图片压缩优化技术报告.md`。

### 🛠 管理面板与基础设施（1.0 → 1.1 累积）

- 独立 Express 管理服务器（`npm run admin` → `http://localhost:4322/admin`），纯 HTML/CSS/JS 前端，暗色主题，Ctrl+S 保存。
- 完整文章 CRUD API、图片上传（拖放/粘贴/点击 → `public/image/`，MIME 白名单 + 20MB 限制）、一键推送。
- 安全加固：`x-admin-token` 认证（默认 `acr-admin`，环境变量 `ADMIN_TOKEN` 可覆盖）、路径穿越防护、YAML 转义、错误信息脱敏、绑定 127.0.0.1。
- Git 远程切换为 SSH（ED25519，走 22 端口）；双击 `启动管理面板.bat` 一键启动 + 自动打开浏览器。

### 🐛 修复

- slug 仅改大小写时文章被静默删除（Windows 文件系统大小写不敏感，改为 `toLowerCase()` 比较，重命名目标被占用时返回 409）。
- YAML 注入残留（pubDate/标签 yamlStr 转义）、上传错误脱敏遗漏、保存失败（缺 `express.urlencoded` 中间件）、`drafts` 字段拼写错误。
- GitHub Pages 尝试用 Jekyll 解析 `.astro` 文件报错（添加 `.nojekyll`）。
- 首页「近期入藏」移除数量限制，显示全部文章；同日文章排序稳定（日期 → slug 降序）。

## 1.0.0（2026-07-29）

- Astro 静态博客初始化：Content Collections（`src/content.config.ts`，title/description/pubDate/tags/draft schema）、现代法典风格设计（私人档案 / 印章 / 标本图版视觉）、`.nojekyll` 禁用 Jekyll。
- GitHub Actions 部署：push `main` → Node 22 → `npm ci` → `npm run build` → deploy `dist/`；`.githooks/pre-commit` 提交前自动构建保护。
- Obsidian 集成：Vault = `src/content/blog/`，附件 `image/`，模板 `_templates/`，`.obsidian` 已 gitignore。
- 页面：首页 / 文章目录 / 文章详情 / 关于 / 404。

---

## 快速使用

### 写新文章

在 `src/content/blog/` 新建 Markdown 文件并填写 frontmatter（`title` / `description` / `pubDate` / `tags` / `draft`），或直接在管理面板中新建。

### 管理面板

`npm run admin` → `http://localhost:4322/admin`（或双击 `启动管理面板.bat`）

### 留言页

- 页面：`/guestbook/`（第五页，B 站评论区版式）
- 后端：Waline 评论服务，部署与接入见 `docs/WALINE_DEPLOY.md`
- 本地预览：`npm run mock:waline` 后访问 `http://localhost:4321/guestbook/?server=http://127.0.0.1:8765`

### 自定义前端

- 页面：`src/pages/`
- 公共布局：`src/layouts/BaseLayout.astro`
- 全局样式：`src/styles/global.css`
- 图片等静态资源：`public/`

### 常用命令

| 命令                     | 作用                                   |
| ------------------------ | -------------------------------------- |
| `npm run dev`            | Astro 开发服务器                        |
| `npm run build`          | 生产构建                               |
| `npm run preview`        | 预览构建结果                            |
| `npm run admin`          | 启动管理面板 → `http://localhost:4322/admin` |
| `npm run mock:waline`    | 本地留言服务 → `http://127.0.0.1:8765`  |
| `git push origin main`   | 部署（SSH，禁止 force push）            |
