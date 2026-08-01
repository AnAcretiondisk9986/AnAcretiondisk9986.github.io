# Acretiondisk Blog — 更新日志

> 使用 Astro 构建的个人博客，部署到 GitHub Pages（`https://anacretiondisk9986.github.io/`）。
> 当前版本：**1.3.1**（2026-08-01）

---

## 1.3.1（2026-08-01）

### 🐛 修复：关于页保存时身份表与兴趣列表被静默清空

- 根因：管理面板「关于」模式保存时，收集身份表 / 兴趣列表条目的 DOM 选择器使用 `.label`、`.value`、`.index`、`.name`、`.note`，而输入框实际类名为 `ai-label`、`ai-value`、`ai-index`、`ai-name`、`ai-note`——选择器匹配不到任何元素，导致整表被清空后保存（提交 `cea2633` 中 `identity: []`、`interests: []`）。
- 修复：收集逻辑改为「提交键名 → 输入框类名」显式映射（`[['label','ai-label'], ...]`），并附渲染→收集闭环回归测试（`aboutRowTemplate` 源码执行 + 类名匹配模拟）。
- 数据恢复：`src/data/about.json` 从 v1.3.0 提交恢复被清空的 5 行身份档案与 4 行兴趣条目，同时保留用户本次的修改（头像、开头段「你好，这里是 Acretiondisk。」、标题「我的关联网站」）。
- 线上验证：部署后 `/about/` 实测头像、身份表、兴趣列表均正常显示。

## 1.3.0（2026-08-01）

### 📄 「关于」页全部文本与头像纳入管理系统编辑

- 关于页内容从硬编码改为数据源 `src/data/about.json`：眉题 / 大标题 / 副标题 / 身份档案表（可增删行）/ 开头段 / 正文段落 / 引用标签与内容 / 研究兴趣索引（可增删行）全部可在管理面板编辑。
- 原先的书本标记区域改为可编辑头像：管理面板拖放 / 点击 / 粘贴 / URL 导入上传，带实时预览；设置头像后页面显示全幅图片（保留档案相框边框），未设置时回退书本标记。
- 管理面板新增「关于」模式（第四标签页），`Ctrl+S` 保存；后端新增 `/api/about`（GET/PUT），「⬆ 推送」纳入 `src/data/about.json`，保存后点推送即可发布到网站。
- 安全：数组字段 JSON 传输 + 白名单清洗、字段截断（5000 字符 / 30 条）、未提交字段保留旧值、提交空串可清空（如移除头像）；`x-admin-token` 鉴权沿用。

## 1.2.1（2026-08-01）

### 🐛 修复：亮色模式下纸张底纹压在图片上方

- 根因：纸张颗粒纹层 `.paper-grain` 是 `position: fixed; z-index: 20` 的全屏覆盖层，铺在页面最上层；亮色模式下 `multiply` 混合 + 较高透明度，纹路会明显叠在图片上（暗色模式因 `screen` 混合 + 低透明度不明显）。
- 修复：将页面纸色渐变背景从 `body` 移到 `html`，纹图层降为 `z-index: -1` 的内容之下底纹——文字、图片均位于纹路上方，亮色 / 暗色主题统一生效，纸张颗粒质感保留在背景上。

## 1.2.0（2026-08-01）

### 🔢 文章页新增「阅览次数」（不蒜子统计）

- 文章详情页侧栏档案登记条新增「阅览次数」条目，按当前页面 URL 统计浏览量，统计服务在国内，境内可直接访问。
- 实现：页面底部内联脚本通过不蒜子 JSONP 接口取数（`busuanzi_value_page_pv`），数字就绪后才显示条目；服务不可用时条目保持隐藏，不影响页面其余内容。
- 脚本显式携带完整 Referer 路径（`referrerPolicy="no-referrer-when-downgrade"`），确保每篇文章按 URL 独立计数。
- 计数自接入日起累计，同 IP 短时间刷新自动去重；目录页批量显示每篇浏览量受不蒜子 API 限制无法实现。

## 1.1.1（2026-07-31）

### ✍ 管理面板文章编辑新增 Markdown 实时预览（含图片）

- 正文编辑区改为「编辑 / 分屏 / 预览」三态视图（默认分屏，选择记忆在 localStorage `admin-editor-view`）：分屏时左侧源码右侧实时渲染，纯预览模式仅渲染结果。
- 输入防抖 150ms 实时渲染；图片上传、外部 URL 导入、粘贴插入 Markdown 后自动刷新预览。
- **零依赖手写 Markdown 渲染器**（延续项目无依赖风格）：标题、粗体/斜体/删除线、行内代码、围栏代码块（带语言标注）、引用（支持嵌套）、无序/有序列表（支持缩进嵌套、任务列表 `- [x]`）、表格（含对齐）、分割线、图片、链接、自动链接；图片输出 `loading="lazy"`，本地 `/image/` 由 admin-server 静态托管可直接显示。
- 安全：文本层轻转义（`&`、`<`）保留 `>`/`"` 不破坏结构语法，属性输出单独转义引号（`mdAttr`），`<script>` 与属性注入均不可执行。
- 细节修复：斜体 `_` 正则加单词边界避免误伤文件名下划线、代码块去除末尾换行、admin 页补 `<link rel="icon">` 消除 favicon 404。

### 🐛 修复：编辑器无法纵向滚动、Markdown 预览区不可滚动

- 根因：`#editorContainer` 非 flex 导致 `.editor{overflow-y:auto}` 失效，正文区随内容增长被 `overflow:hidden` 裁剪；`editor-wrap` 的 `min-height:auto` 把预览区撑到与内容等高，内部滚动永不触发。
- 修复：`#editorContainer` 改为 `flex:1; display:flex; flex-direction:column; min-height:0`，`.editor-wrap{min-height:300px}` 覆盖 `min-height:auto`，使预览区高度受容器约束、内部滚动生效。

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
