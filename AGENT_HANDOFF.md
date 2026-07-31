# 个人博客 — Agent 变更日志

> 本文件已在用户授权下公开于 GitHub 仓库。每位 Agent 完成工作后在此记录变更。

最后更新：2026-07-31（留言页）

---

## 快速启动

| 命令                     | 作用                                       |
| ---------------------- | ---------------------------------------- |
| `npm install`          | 安装依赖                                     |
| `npm run dev`          | Astro 开发服务器                              |
| `npm run build`        | 生产构建                                     |
| `npm run preview`      | 预览构建结果                                   |
| `npm run admin`        | 启动博客管理面板 → `http://localhost:4322/admin` |
| `git push origin main` | 推送（SSH，禁止 force push）                    |
| 双击 `启动管理面板.bat`        | 一键启动管理面板 + 打开浏览器                         |

**关键信息**

- 本地路径：`C:\Users\AnAcretiondisk\Documents\个人博客`
- 仓库：`git@github.com:AnAcretiondisk9986/AnAcretiondisk9986.github.io.git`（SSH，ED25519 密钥已配置）
- 线上：`https://anacretiondisk9986.github.io/`
- 技术栈：Astro (static) + Markdown Content Collections + GitHub Actions + GitHub Pages
- 部署：push `main` → Actions (Node 22) → `npm ci` → `npm run build` → deploy `dist/`
- 包管理器：npm
- `.nojekyll` 已就位，禁用 Jekyll 解析

---

## 当前状态快照

```
HEAD: 9ea6b19 通过管理面板更新博客
origin/main: 9ea6b19 通过管理面板更新博客
本地 ahead 0，behind 0
工作区：
  M .gitignore                  ← 忽略 .mock-waline/
  M admin/index.html            ← 管理面板新增「留言」模式（Waline 连接/列表/删除）
  M package.json                ← 新增 npm run mock:waline
  M src/layouts/BaseLayout.astro ← 主导航新增「V 留言」
  M src/styles/global.css       ← 留言页样式（B 站评论区版式）
  ?? src/pages/guestbook.astro  ← 留言页（第五页）
  ?? scripts/mock-waline.mjs    ← 本地 Waline 兼容服务（预览用）
  ?? docs/WALINE_DEPLOY.md      ← Waline 线上部署指引
  ?? reasonix.toml              ← 未跟踪（Reasonix 配置）
  （注：admin-server.mjs、gallery.astro 等图志相关改动为上一轮遗留，尚未提交）
```

**文章：5 篇**

| 文件                                          | 标题                    |
| ------------------------------------------- | --------------------- |
| `apurupai.md`                               | 补一下昨天到的苹果乐。Apurupai!  |
| `HealthCN2030.md`                           | 关于健康中国2030战略          |
| `social-paper.md`                           | 我如何自动化生产WMU暑期实践调研论文   |
| `write-social-practice-reflection-SKILL.md` | 我如何自动化生产WMU暑期实践心得体会   |
| `论文代写这个事情看的出来学生之间还蛮参差的.md`                  | 论文代写这个事情看的出来学生之间还蛮参差的 |

> **注意**：Astro glob loader 会对 `post.id` 做 slugify（大写→小写）。例如文件 `HealthCN2030.md` 的博客 URL 是 `/blog/healthcn2030/`，而管理面板返回的 slug 是文件名原样 `HealthCN2030`。这是已知不一致，暂不修改 Astro 层。

---

## 变更日志

### 2026-07-31（留言）

**✍ 新增「留言」第五页面（B 站评论区版式 + Waline）**

- **文件**：`src/pages/guestbook.astro`、`src/layouts/BaseLayout.astro`、`src/styles/global.css`、`admin/index.html`、`scripts/mock-waline.mjs`、`docs/WALINE_DEPLOY.md`、`.gitignore`、`package.json`
- 新增 `/guestbook/`（导航「V 留言」），延续私人档案视觉；版式仿 B 站评论区：左侧圆形字母头像（按昵称哈希取色）、昵称、楼层号、相对时间、正文；发送区为头像 + 可编辑昵称 + 300 字计数 + 发送按钮。
- **不可附加图片**：前端无任何图片上传/粘贴入口，渲染时用 DOMParser 剥离 img/svg/script/iframe 等全部媒体元素。
- **300 字限制**：前端 `maxlength` + 计数校验；服务端由 Waline `WORD_LIMIT=0,300` 强制。
- **IP 属地**：Waline 服务端用内置 ip2region 解析发送端 IP（中国显示省份、国外显示国家），以次级要素「IP属地：××」标签展示在昵称旁；管理员视角另可见原始 IP。
- **后端选型**：Waline 评论服务（部署到 Vercel，见 `docs/WALINE_DEPLOY.md`）。前端按 Waline 官方 API 契约实现（GET/POST `/api/comment`），`?server=` 参数可临时指定服务地址并记忆（localStorage）。
- **管理面板**：新增「留言」模式——填 Waline serverURL + 管理员邮箱/密码换 token，列出留言（属地/原始 IP/邮箱/时间）并可删除（`Authorization: Bearer`）。
- **本地预览**：`scripts/mock-waline.mjs` 提供与 Waline API 契约一致的本地服务（`npm run mock:waline` → `http://127.0.0.1:8765`，管理员 `admin@acretiondisk.local`/`admin123`），数据存 `.mock-waline/`（已 gitignore）。
- 验证：`npm run build` 11 页成功；mock 全链路通过（UTF-8 发布/301 字拒绝/列表属地/管理登录/删除/401）；dev 服务器 `/guestbook/` 200；admin 面板脚本语法检查通过。

### 2026-07-31（图志）

**🖼 新增「图志」页面与双图像档案**

- **文件**：`src/pages/gallery.astro`、`src/data/gallery.json`、`src/layouts/BaseLayout.astro`、`src/styles/global.css`、`admin-server.mjs`、`admin/index.html`
- 新增 `/gallery/`，延续现有私人档案/编目册视觉语言；主导航加入「III 图志」，「关于」顺延为 IV。
- 「随文图像」自动扫描所有已发布 Markdown 文章中的图片，当前索引 7 张；显示日期、说明、来源文章，并支持原生 `<dialog>` 大图预览。
- 「独立收藏」读取 `src/data/gallery.json`，当前已有 3 条记录，并保留完整空状态和非空渲染逻辑。
- 两个子页使用 ARIA 标签页，支持点击、左右方向键切换，并通过 `#journal` / `#independent` 保存当前子页。
- 新增共用展示顺序控件，默认「从新至旧」，可切换「从旧至新」；排序会同步卡片编号，并以 `?order=oldest` 保存状态。同日图像以入藏顺序作为第二排序键。
- 独立收藏数据项字段：`id`、`src`、`alt`、`title`、可选 `caption`、`date`、`sourceUrl`、`sourceTitle`。无日期项排在有日期项之后。
- 管理面板新增「文章 / 画廊」模式切换及独立收藏的新增、编辑、删除、图片上传；后端新增 `/api/gallery` 与 `/api/gallery/:id`，直接读写 `src/data/gallery.json`。
- 验证：`npm run build` 成功生成 10 个页面；当前自动索引 7 张随文图像和 3 张独立收藏；桌面 1440×1000 与手机 390×844 均无横向溢出；排序反转、双子页、预览图片加载和关闭均通过浏览器实测。

**🐛 修复：slug 仅改大小写时文章被静默删除**

- **文件**：`admin-server.mjs`
- **原因**：Windows 文件系统不区分大小写。PUT /api/posts 重命名时仅按字符串比较 `filePath`，导致 `HealthCN2030` → `healthcn2030` 被判为"重命名"，执行 `writeFile(小写) + unlink(大写)` 两个操作落在同一文件上——写完后立刻删除，文章丢失且 API 返回 `success: true`。
- **修复**：用 `toLowerCase()` 做大小写不敏感比较判断"是否为同一文件"，仅大小写不同的改名走原地覆盖分支；同时检查重命名目标是否被其他文章占用，占用时返回 409 而非覆盖。

**📝 文档重构**

- **文件**：`AGENT_HANDOFF.md`
- 全文重构为变更日志格式：顶部快速启动 → 当前状态快照 → 变更日志 → 架构地图 → 下一位 Agent 指南。

---

### 2026-07-30

**⬆ 管理面板添加一键推送**

- **文件**：`admin-server.mjs`、`admin/index.html`
- 左侧边栏新增「⬆ 推送」按钮，调用 `/api/push`：`git add` → `git commit` → `git push`。区分网络故障与一般推送错误，toast 提示。

**🖼 管理面板图片上传**

- **文件**：`admin-server.mjs`、`admin/index.html`
- 拖放/粘贴/点击上传 → `public/image/`，自动插入 Markdown `![name](url)`。MIME 白名单（PNG/JPEG/GIF/WebP/SVG），20MB 限制。

**✏️ 管理面板 CRUD**

- **文件**：`admin-server.mjs`、`admin/index.html`
- 完整的 Express API：`/api/posts`（GET/POST 列表与新建）、`/api/posts/:slug`（GET/PUT/DELETE 读写删）。纯 HTML/CSS/JS 前端，暗色主题，Ctrl+S 快捷键。
- 认证：`x-admin-token` header（默认 `acr-admin`，环境变量 `ADMIN_TOKEN` 可覆盖）。路径穿越防护、YAML 转义安全处理。

**🔧 Git 远程切换为 SSH**

- 远程从 HTTPS 切为 `git@github.com:...`，ED25519 密钥已添加 GitHub。管理面板推送走 22 端口，不再受 443 阻断。

**🏠 首页「近期入藏」修复**

- 移除 `.slice(0,3)` 硬编码，展示全部已发布文章。

**📊 同天文章排序稳定**

- 排序键：`pubDate` 降序 → slug 字母降序。首页与目录页统一。

**📚 管理面板初始化**

- 启动脚本 `启动管理面板.bat`，依赖 `express`、`gray-matter`、`multer`。`admin-server.mjs` 绑定 127.0.0.1:4322。

---

### 2026-07-29 及之前

**🐛 修复多个早期问题**

| 问题                                       | 修复                                                |
| ---------------------------------------- | ------------------------------------------------- |
| Obsidian 模板 `_templates/` 被当作文章导致构建失败    | 模板放入子目录，Content Collection 配置 `!_templates/**` 忽略 |
| `hello-world.md` 字段名 `drafts` 拼写错误       | 修正为 `draft`                                       |
| test-visible.md 合并冲突                     | 手动解决                                              |
| GitHub Pages 尝试用 Jekyll 解析 `.astro` 文件报错 | 添加 `.nojekyll`（根目录 + `public/`）                   |
| 管理面板 POST 保存报「服务器内部错误」                   | 添加 `express.urlencoded` 中间件解析表单体                  |

**🏗 项目初始化**

| 事项                     | 说明                                                                              |
| ---------------------- | ------------------------------------------------------------------------------- |
| Astro 静态博客             | `output: 'static'`，用户主页仓库无 `base` 路径                                            |
| Content Collection     | `src/content.config.ts` 定义 schema（title/description/pubDate/tags/draft）         |
| GitHub Actions 部署      | `push main → Node 22 → build → deploy`                                          |
| `.githooks/pre-commit` | 提交前自动跑 `npm run build`，构建失败阻止提交                                                 |
| Obsidian 集成            | Vault = `src/content/blog`，附件 `image/`，模板 `_templates/`，`.obsidian` 已 gitignore |

---

## 架构地图

```
项目根
├── astro.config.mjs              Astro 配置（site + static output）
├── admin-server.mjs              Express 管理面板后端 ⚠ 本次有修改
├── admin/index.html              管理面板前端（纯 HTML/CSS/JS）
├── 启动管理面板.bat               双击启动脚本
├── .githooks/pre-commit          提交前构建保护
├── .github/workflows/deploy.yml  GitHub Pages 部署
├── .nojekyll                     禁用 Jekyll
│
├── src/
│   ├── content.config.ts         Content Collection schema
│   ├── content/blog/             Obsidian Vault（文章 .md + 模板 _templates/ + 附件 image/）
│   ├── data/
│   │   └── gallery.json          独立收藏图片数据源（待管理系统适配）
│   ├── pages/
│   │   ├── index.astro           首页
│   │   ├── blog/index.astro      文章目录
│   │   ├── blog/[...id].astro    文章详情（静态路由）
│   │   ├── gallery.astro         图志（随文图像 + 独立收藏）
│   │   ├── about.astro           关于页
│   │   └── 404.astro             404
│   ├── layouts/BaseLayout.astro  公共布局（导航/页脚/主题切换）
│   ├── styles/global.css         全站样式
│   └── components/
│       ├── ArchiveSeal.astro     印章组件
│       └── SpecimenPlate.astro   首页标本图版
│
└── public/
    ├── favicon.svg
    ├── .nojekyll
    └── image/                    管理面板上传的图片
```

> **Obsidian 附件 vs 管理面板图片**：Obsidian 附件在 `src/content/blog/image/`；管理面板上传在 `public/image/`。目前文章引用统一用 `/image/` 路径（指向 `public/image/`）。

---

## 下一位 Agent 指南

1. **检查状态**

   ```powershell
   git status --branch --short
   git fetch origin main
   git log --oneline --max-count=10 --all
   ```

2. **如果有 ahead 提交（如本次）→ 推送**

   ```powershell
   git push origin main         # 禁止 force push
   ```

3. **如果远端有新提交 → 合并再推送**

   ```powershell
   git pull --no-edit origin main
   npm run build
   git push origin main
   ```

4. **提交本次修改**（待提交：图志页面、排序功能、`admin-server.mjs` slug 修复）

5. **验证**

   - `npm run build` 通过
   - `/gallery/` 自动索引随文图片，两个子页及新旧排序均可用
   - `npm run admin` 管理面板可启动
   - 线上首页文章数与本地一致
