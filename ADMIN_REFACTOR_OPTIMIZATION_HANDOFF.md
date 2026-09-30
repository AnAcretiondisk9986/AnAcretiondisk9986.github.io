# 个人博客后台管理系统重构优化报告与实施方案

> **文档类型**：临时交接文档
> **生成日期**：2026-09-29（2026-09-30 四次更新）
> **当前阶段**：P0/P1 与可落地 P2 已完成；编辑器已升级为 Vditor，待用户验收
> **适用范围**：博客管理面板、管理面板后端、媒体上传与 Git 同步流程

---

## 0. 本轮实施记录（2026-09-29）

已完成“文章编辑 dirty 状态 + 本地恢复草稿 + 版本哈希/原子写入”第一组改造，暂未改动公共博客页面。

### 已修改

- `admin/index.html`
  - 文章编辑器增加 `pristine / dirty / saving / error` 的基础状态反馈。
  - 文章字段和 Toast UI 编辑器内容统一纳入 dirty 检测。
  - 切换文章、点击新建、切换后台模块时，未保存内容会被拦截确认。
  - 浏览器刷新/关闭前自动写入本地恢复草稿。
  - 本地草稿按文章 slug 隔离，新建文章使用独立草稿键。
  - 重新打开文章时可选择恢复草稿；草稿基于旧版本时会额外提示。
  - 保存成功后清理对应本地草稿；版本冲突时保留当前编辑内容。

- `admin-server.mjs`
  - 文章列表和单篇文章 API 增加 `contentHash`。
  - 文章更新要求携带 `expectedHash`。
  - 文件已被其他来源修改时返回 HTTP 409，不再静默覆盖。
  - 文章新建、更新、删除增加串行写入队列。
  - 文章 Markdown 使用临时文件 + rename 的原子写入方式。
  - 新建文章补充 slug 重复检查。

- `admin/atomic-file.mjs`
  - 新增 SHA-256 和原子文件写入工具。

- `scripts/admin-storage.test.mjs`
  - 新增 SHA-256、覆盖写入、失败保护测试。

- `package.json`
  - 新增 `npm run test:admin-storage`。

### 验证结果

- `node --check admin-server.mjs`：通过。
- 管理后台内联脚本解析检查：通过。
- `npm run test:admin-storage`：3 项通过。
- 管理 API 手动验证：
  - 创建临时文章、读取 hash、携带正确 hash 更新、确认内容和 hash 改变、删除临时文章：通过。
  - 携带错误 hash 更新现有文章：返回 HTTP 409，原文章未被修改。
- 浏览器级管理面板冒烟验证：文章切换拦截、本地草稿写入、切回文章后恢复：通过。
- `npm run build`：通过，97 个静态页面构建完成。
- 临时 API 验证文章已删除，未留下测试内容。

### 当前边界

- 本轮只保护文章编辑链路；画廊、关于、前端定制等模块暂未接入统一 dirty 状态。
- 当前本地草稿使用浏览器 `localStorage`，后续可在安全/凭据阶段统一迁移策略。
- 版本冲突目前先阻止保存并保留编辑内容，尚未实现可视化 diff 或三方合并。

---

## 0.1 本轮实施记录（2026-09-30）：发布中心、配置写入安全与测试基线

已完成「阶段 4 发布中心与 Git 同步」与「阶段 0 剩余部分：JSON 配置原子写入/校验/备份/冲突」，并将管理测试补齐到可重复执行。

### 已修改 / 新增

- `admin/git-service.mjs`（新增）
  - 受控 Git 命令封装：白名单子命令、`execFile` 参数化（不经 shell）、超时、输出上限、敏感信息脱敏。
  - `status()`（解析 `--porcelain=v2 --branch`）、`previewCommit()`（只读差异摘要）、`commitAndPush()`、`fetchRemote()`、`previewPull()`、`pullFastForward()`、`recentCommits()`。

- `admin/json-store.mjs`（新增）
  - JSON 配置存储：原子写入、结构校验、轮换备份、`contentHash`/`expectedHash` 冲突检测、同 store 写入串行化。
  - 导出 `VersionConflictError`、`InvalidDataError`、`parseExpectedHash`。

- `admin-server.mjs`
  - 新增 `GET /api/sync/status`、`GET /api/sync/preview`、`GET /api/sync/pull-preview`、`GET /api/operations`。
  - 全局 `requestId` 中间件；发布中心错误响应统一包含 `code/error/detail/requestId`。
  - 操作日志（内存环形缓冲，最多 50 条）。
  - 启动默认只检查状态，`ADMIN_AUTO_PULL=1` 才自动拉取。
  - `pushGitChanges` / `pushImageRepo` / `syncFromRemote` 改用 Git 服务，移除字符串 `exec()` 拼接。
  - 画廊/关于/前端定制/访问控制读写改走 JSON 存储；画廊经 `x-content-hash`、关于与前端定制经响应体 `contentHash` 暴露版本，保存要求 `expectedHash`（缺失 428、冲突 409）。
  - 支持测试隔离环境变量：`ADMIN_DATA_DIR`、`ADMIN_BLOG_DIR`、`ADMIN_BACKUP_DIR`、`IMG_REPO_DIR`。

- `admin/index.html`
  - 侧栏新增同步状态卡（状态、分支、ahead/behind、待提交数量）。
  - 新增发布中心弹窗：推送文件清单、拉取提交清单、操作日志、失败重试与复制错误。
  - 推送/拉取改为「先预览后确认」，不再点击即执行。
  - 画廊/关于/前端定制保存携带 `expectedHash`，并在冲突时保留当前表单内容。

- `scripts/`
  - `admin-sync.test.mjs`：11 项 Git 服务测试（临时裸仓库，无网络）。
  - `admin-json-store.test.mjs`：7 项 JSON 存储测试。
  - `admin-api-smoke.mjs`：隔离临时目录 + 随机端口的管理 API 冒烟（30 项）。
  - `sync-center-e2e.mjs`：发布中心浏览器冒烟（拦截 `/api`，不产生真实推送）。

- `package.json`：新增 `test:admin-sync`、`test:admin`、`test:admin-api`、`test:admin-ui`、`test:admin-all`。
- `.gitignore`：新增 `.admin-backups/`。

### 验证结果

- `node --check admin-server.mjs`：通过。
- `npm run test:admin`：21 项通过。
- `npm run test:admin-api`：30 项通过。
- `npm run test:admin-ui`：11 项通过。
- `npm run build`：通过，97 个静态页面。
- 真实 `src/data/*.json` 与 `src/content/blog/*` 未被测试修改（测试使用临时目录）。

### 本轮边界

- `syncing` 状态由前端同步操作期展示，服务端状态接口不单独输出。
- 私密文章密码保存仅做原子写入 + 校验 + 备份，尚未强制 `expectedHash`。
- API 冒烟尚未覆盖上传失败路径与远程 URL 导入失败路径。
- 服务端其余接口的错误结构仍未统一（仅发布中心接口统一）。

---

## 0.2 本轮实施记录（2026-09-30 第二批）：文章管理效率升级

已完成「阶段 2 文章管理效率升级」的列表部分（搜索/筛选/排序/视图/快速操作），以及支撑它的公开链接与短链后端字段。

### 已修改 / 新增

- `admin-server.mjs`
  - `/api/posts` 与 `/api/posts/:slug` 新增：`updatedAt`（mtime）、`excerpt`（正文摘要）、`astroId`、`hasPublicPage`、`publicUrl`、`shortUrl`。
  - 用 `github-slugger` 生成 Astro 内容集合 id，短码与 `src/lib/shortlink.ts` 一致（`sha256(id) 前 8 位 → base36`）；`draft` 与 `access: admin` 不生成公开链接。
- `admin/index.html`
  - 侧栏列表控件：关键词搜索、草稿/已发布、访问权限、标签、日期范围、7 种排序、紧凑/卡片视图、结果计数、清除筛选；偏好写入 `localStorage`。
  - 快速操作：继续编辑、预览、复制公开链接、复制短链、发布/撤回、删除；改用事件委托。
  - 非公开文章隐藏预览/链接操作；切出「文章」模块时隐藏列表控件。
- `scripts/post-list-e2e.mjs`（新增，20 项浏览器冒烟）。
- `scripts/run-admin-e2e.mjs`（新增，自动复用/启动管理面板并依次运行两组浏览器冒烟）。
- `package.json`：新增 `test:post-list`、`test:admin-e2e`；`test:admin-all` = 单元 + API 冒烟 + 浏览器冒烟。
- `package.json` / `package-lock.json`：新增依赖 `github-slugger@^2.0.0`。

### 验证结果

- `npm run test:admin-all`：单元 21 项、API 冒烟 30 项、浏览器冒烟 31 项全部通过。
- 真实服务 + 真实文章浏览器验证：48 篇加载、筛选/卡片/搜索正常，无页面错误。
- `npm run build`：97 页面通过。

### 本轮边界

- 文章编辑表单尚未分组，未提供模板/默认元数据与即时校验。
- 快速操作尚未提供「复制文章」与「归档」。
- 预览仅打开线上页面，草稿/管理员级文章无本地预览。

---

## 0.3 本轮实施记录（2026-09-30 第三批）：全量完成 P1 与可落地 P2

已完成：文章表单升级、媒体库、前端 ESM 拆分、安全/可观测性、质量收尾，以及可落地的 P2（批量操作、修订历史、定时发布元数据）。

### 已修改 / 新增

- `admin-server.mjs`
  - 媒体库：`GET /api/media`、`DELETE /api/media`（引用保护）、`POST /api/media/archive`、`GET /api/health`（集中限制）。
  - 修订历史：保存/删除前快照到 `.admin-revisions/`（可用 `ADMIN_REVISIONS_DIR` 隔离），`GET /api/posts/:slug/revisions` 与 `/:id`。
  - 文章字段新增 `archived` / `scheduledAt`（写入 frontmatter，读取回传）。
  - 所有 `/api` 错误响应统一补 `code` 与 `requestId`；结构化 JSON 访问日志（脱敏）。
  - `LIMITS` 集中配置（上传/远程/Git/抓取/并发），供 UI 展示。
- `admin/index.html` + `admin/styles/*` + `admin/src/*`
  - HTML 仅保留壳与模态框；CSS 拆 4 份；JS 拆为 `main.js` + `api/{client,errors}.js` + `state/store.js` + `ui/{dom,toast,modal}.js`。
  - 文章表单分组折叠、模板、Slug 自动生成与即时校验、内容统计、富文本状态。
  - 快速操作：复制、归档/取消归档、管理面板内本地预览。
  - 媒体模式：搜索/筛选/分页、复制、插入正文、设为封面、引用查看、删除/归档、上传队列（进度/取消/重试/重复提示）、媒体选择器复用。
  - 批量操作栏（发布/撤回/归档/删除）；修订历史模态框（行级 diff + 恢复）；定时发布输入。
  - 会话：锁定/解锁、退出并清除凭据；Waline 凭据默认仅会话保存。
  - 模态框 aria + Tab 焦点锁定 + Esc；`:focus-visible`。
- `src/content.config.ts` / `src/lib/posts.ts` / `src/pages/{blog,s}`：新增 `archived`/`scheduledAt` 并在公开列表与路由中过滤。
- `scripts/`：新增 `media-library-e2e.mjs`、`post-form-e2e.mjs`、`quality-e2e.mjs`；`run-admin-e2e.mjs` 运行 5 组浏览器冒烟；`admin-api-smoke.mjs` 补定时/修订断言。

### 验证结果

- `npm run test:admin-all`：全部通过（单元 21 + API 冒烟 + 5 组浏览器冒烟）。
- `npm run build`：97 页面通过。
- 真实 `src/` 仅新增两字段的过滤逻辑；未删除/覆盖任何文章或媒体。

### 边界

- 未迁移 SPA、未引入数据库、未实现多人协作。
- 定时发布需到点后一次构建；修订历史为整文件快照 + 行级 diff。

---

## 0.4 本轮实施记录（2026-09-30 第四批）：编辑器升级（Toast UI → Vditor）

### 动机

旧 Toast UI 的富文本模式不支持对齐 / 高亮 / 下划线 / 视频 / 播放条等原始 HTML，切换后会被规范化改写。引入开源 **Vditor 4.0.0**：以 Markdown 为事实来源，即时渲染（IR）与分屏（SV）原样保留原始 HTML，同时提供所见即所得与源码模式。

### 已修改 / 新增

- `admin/vendor/vditor/`：vendor 精简版（保留 lute / highlight.js / katex / i18n / icons / css / images）。
- `admin/index.html`：加载 Vditor 资源，移除 Toast UI；新增 `styles/preview-site.css`。
- `admin/src/main.js`：Vditor 初始化与四视图切换、内置工具栏、上传 handler、媒体/视频/音乐/图宽/对齐按钮、本地预览改用 `Vditor.preview`、原生输入监听兜底脏状态、`window.editor` 兼容层。
- `admin/styles/editor.css`：Vditor 布局与暗色主题微调。
- `admin/styles/preview-site.css`（新增）：编辑区与预览统一使用贴近线上 `.prose` 的排版（§标题、引文、图片边框、iframe 16:9、song-player、表格/代码等）。
- 删除 `admin/vendor/toastui/`、`admin/vendor/turndown.js`；`package.json` 新增 `vditor@4.0.0`、devDependency `puppeteer-core`，移除 `turndown`。
- `scripts/editor-e2e.mjs` 重写；删除 `align-e2e.mjs`、`media-e2e.mjs`；`run-admin-e2e.mjs` 跑 6 组。

### 验证

- `npm run test:admin-all` 全部通过；`npm run build` 97 页。
- 真实 48 篇文章加载与 IR 渲染正常，无控制台错误。

### 边界

- Vditor 4 无公开 setMode，切换依赖内置 `edit-mode`，已将版本锁定为 4.0.0。
- 所见即所得对原始 HTML 块支持有限，默认用「即时渲染」。

---

## 0.5 本轮实施记录（2026-09-30 第五批）：测试补全与编辑器体验细化

- 私密文章密码接入 `contentHash` / `expectedHash`（GET 返回哈希；PUT 缺失 428、冲突 409；前端携带并处理冲突）。
- `scripts/admin-api-smoke.mjs` 补：上传未选文件 400、上传非法类型 400、远程导入缺少/非法/非 http(s)/本机地址（SSRF）失败路径，访问控制 428/409。
- `scripts/post-form-e2e.mjs` 补：刷新页面恢复本地草稿（标题 + 正文）。
- 编辑器：新增「☰ 大纲」与「⤢ 专注模式」（隐藏侧栏、localStorage 记忆），正文统计新增预计阅读时长。
- `package.json` 新增 `test:editor`。

### 验证

- `npm run test:admin-all` 全部通过（单元 21 + API 冒烟 + 6 组浏览器冒烟）。
- `npm run build` 97 页。

---

## 0.6 本轮实施记录（2026-09-30 第六批）：发布前检查与编辑器辅助

- 新增 `admin/src/features/preflight.js`（纯函数）：标题/描述长度、Slug 合法性与查重、发布日期、标签、封面、缺失 alt、字数与阅读时长、归档/草稿/权限提示，返回 error/warn/ok/info。
- 编辑器头部新增「✓ 发布检查」按钮与弹窗（`#preflightModal`），Esc / 点遮罩关闭。
- 本地草稿自动保存状态提示（`#postDraftStatus`）。
- 新增 `scripts/preflight-e2e.mjs`；浏览器冒烟 7 组；`package.json` 新增 `test:preflight`。
- 新增 `admin/src/features/` 目录（业务模块拆分起点）。

### 验证

- `npm run test:admin-all` 全部通过；`npm run build` 97 页。

---

## 0.7 本轮实施记录（2026-09-30 第七批）：拆分起始（共享模块 + access/guestbook）

- 新增共享模块 `api/app-client.js`（API 单例 + 可变口令）、`ui/app-toast.js`（toast 单例）、`util/format.js`。
- 抽出 `features/access.js`（访问控制）与 `features/guestbook.js`（Waline 留言），`main.js` 4006 → 约 3750 行。
- 编辑器：含块级 HTML 的文章首次打开自动用「分屏」；富文本状态提示更新。
- `editor-e2e` 适配 Vditor 语义（源码保真 + 模式切换）。

### 验证

- `npm run test:admin-all` 全部通过；`npm run build` 97 页。

---

## 0.8 本轮实施记录（2026-09-30 第八批）：侧栏滚动 + 发布中心拆分

- 侧栏改为整体纵向滚动容器（`overflow-y:auto` + 主题细滚动条），`.post-list` 取消独立滚动；短窗口/窄屏下可上下滑动。
- 抽出 `features/sync-center.js`（发布中心），`initSyncCenter({getMode,reloadPosts,reloadGallery})` 注入依赖；`main.js` 4006 → 约 3435 行。
- `quality-e2e` 补侧栏滚动检查。

### 验证

- `npm run test:admin-all` 全部通过；`npm run build` 97 页。

---

## 0.9 本轮实施记录（2026-09-30 第九批）：编辑器打字机模式与 Markdown 帮助

- 新增「⌨ 打字机」开关（运行时切换 Vditor `typewriterMode`，localStorage 记忆）。
- Vditor 工具栏加入 `help`（Markdown 语法帮助）。
- `editor-e2e` 补打字机开关检查。
- 验证：`npm run test:admin-all` 全绿；`npm run build` 97 页。

---

## 1. 执行摘要

当前后台并不是功能不足，而是功能长期叠加后形成了“单页集成式管理台”：文章、画廊、关于页、前端定制、访问控制、留言管理、图片/音频上传、Markdown 编辑、远端导入和 Git 同步都已经具备，但状态管理、信息架构、错误恢复和发布安全没有同步升级。

本次重构建议遵循以下原则：

1. **保留现有数据源**：继续以 Markdown、JSON 和 Git 为事实来源，不立即引入数据库。
2. **先保证不丢稿，再提升效率**：未保存变更保护、草稿恢复、保存状态和同步状态优先级最高。
3. **先拆分再换技术**：第一阶段不强行迁移 React/Vue，先把单文件拆成 ESM 模块并建立状态边界，降低回归风险。
4. **把“编辑”和“发布”分开**：保存本地文件、预览站点、推送 Git 应该是三个清晰可理解的动作。
5. **保留现有视觉气质**：延续当前深色、档案感、青铜色强调的视觉语言，但降低信息密度和操作歧义。

推荐的最终定位是：**安全的本地写作工作台 + 可解释的内容发布控制台**。

---

## 2. 现状基线

### 2.1 技术结构

- 公共博客：Astro 静态站点 + Markdown Content Collections + GitHub Pages。
- 管理后端：`admin-server.mjs`，Express，默认绑定 `127.0.0.1:4322`。
- 管理前端：`admin/index.html`，原生 HTML/CSS/JavaScript，Toast UI Editor 通过 vendor 文件加载。
- 内容源：
  - 文章：`src/content/blog/*.md`
  - 画廊：`src/data/gallery.json`
  - 关于页：`src/data/about.json`
  - 前端定制：`src/data/frontend.json`
  - 访问控制：`src/data/private-access.json`
  - 媒体：独立 `blog-images` 仓库，经 jsDelivr 引用。
- 认证：`x-admin-token` 请求头；未设置环境变量时，口令生成并持久化到 `.admin-token`。

### 2.2 已有管理能力

当前侧栏包含 6 个模块：

- 文章：新建、编辑、删除、草稿/发布、访问权限、封面裁剪、Markdown/分屏/富文本视图、视频/音乐/图片尺寸插入。
- 画廊：独立收藏图片的增删改、原图与来源信息管理。
- 关于：头像、身份档案、段落、兴趣、项目等内容编辑。
- 前端定制：主题、站点文案、首页图片、颜色、玻璃材质和圆角等配置。
- 访问控制：私密文章密码管理。
- 留言：Waline 连接、留言加载和删除。

后端 API 已覆盖文章、画廊、关于、前端配置、访问控制、媒体上传、音频探测、远程 URL 导入、Git 推送和 Git 拉取。

### 2.3 已完成的基线验证

- `node --check admin-server.mjs`：通过。
- `npm run build`：通过，当前构建生成 **97 个静态页面**。
- 当前 Git 分支：`main`，与 `origin/main` 同步。
- 现有工作区中有一个用户已有的未跟踪图片文件：`public/images/医学招生-中国新闻网-2026-09-14.jpg`；本次审计未修改该文件。
- 本文档不替换旧的 `AGENT_HANDOFF.md`；旧文档的状态快照为 2026-08-03，已明显落后于当前内容规模，后续交接应以本文档和实际代码为准。

---

## 3. 关键问题诊断

### P0：数据安全与状态反馈

| 问题 | 当前表现 | 风险 | 建议 |
| --- | --- | --- | --- |
| 未保存变更保护不足 | 切换文章、切换模块或点击新建时，没有统一的 dirty 状态拦截 | 正文或配置可能被直接覆盖 | 建立 `pristine/dirty/saving/saved/error` 状态机，离开前统一确认 |
| 缺少草稿恢复 | 没有本地自动保存和异常恢复流程 | 浏览器崩溃、误刷新、切换页面后内容丢失 | 按文章/模块保存本地草稿快照，提供恢复和清除入口 |
| 保存反馈过于轻量 | 主要依赖 Toast，按钮没有完整的保存中/成功/失败状态 | 用户不确定是否已经写入文件 | 顶部显示“未保存/保存中/已保存于 xx:xx/失败，重试” |
| 并发覆盖保护不足 | API 直接读取并写回文件，没有版本号或内容哈希校验 | 外部编辑、第二个窗口或 Git 拉取可能覆盖当前内容 | 返回 `version/contentHash/updatedAt`，保存时携带版本，冲突返回 409 |
| 写文件缺少统一事务边界 | 文章和 JSON 配置直接写目标文件 | 写入中断时可能产生半写文件 | 使用临时文件 + rename，并在关键数据写入前做备份 |

### P0：Git 同步与发布边界不清

- 顶部同时放置“拉取”“推送”“全量推送”，但当前界面没有持续显示工作区 dirty、ahead/behind、远端差异和上一次操作结果。
- 后端启动时会自动比对并尝试同步远端。虽然已有“工作区脏、分叉、本地领先时跳过”的保护逻辑，但对用户来说仍然是一个隐式副作用。
- 内容推送和全量推送的差异需要记忆，出错信息主要以 Toast 呈现，缺少可追溯的操作日志和重试入口。

**建议**：把 Git 能力收敛到独立“发布中心”，默认启动只检查状态，不自动拉取；拉取前显示差异和影响范围，推送前显示待提交文件摘要。

### P1：信息架构和日常效率

- 6 个模块共用一个侧栏和一个编辑区，模块切换后工具栏、保存按钮和列表行为会动态变化，学习成本高。
- 文章列表目前没有搜索、标签筛选、草稿/已发布筛选、权限筛选、日期排序、批量选择和快速操作。
- 删除操作存在，但归档、复制、快速切换发布状态、复制链接等高频动作没有形成统一操作体系。
- 侧栏列表适合文章数量较少时使用；当前构建已经有几十篇文章，继续增长后查找成本会明显上升。

### P1：文章编辑器体验

- `admin/index.html` 目前约 2545 行、约 145 KB，CSS、模板、状态和所有功能逻辑集中在一个文件中。
- Toast UI 的源码、分屏、富文本三种模式已经存在，但视频、音乐、对齐、颜色、高亮等能力对模式有约束，用户需要先理解内部规则。
- 当前在富文本模式切换前会提示部分 HTML 可能被改写，这是必要的防护，但属于事后提醒，应该改成更清晰的“兼容性状态”和“安全模式”提示。
- 文章元数据、正文工具、封面、媒体上传全部放在同一长表单，缺少“基本信息 / 发布设置 / 正文 / SEO 与分享 / 媒体”的分组折叠。
- Slug、日期、同日序号、标签、访问权限缺少统一的即时校验和可视化错误定位。

### P1：媒体和画廊工作流

现有 HEIC/HEIF、音频解析、封面裁剪、CDN 预热和远程导入能力较完整，但操作反馈仍偏弱：

- 上传没有统一的队列、进度、失败重试和取消机制。
- 图片、音频、封面、画廊独立收藏的入口分散，缺少统一媒体库。
- 外部 URL 导入需要用户手动输入 Referer，缺少来源预览、文件类型/尺寸/大小检查和导入结果摘要。
- 缺少“该资源正在被哪些文章使用”的引用追踪，删除或替换媒体时容易产生悬挂引用。

### P1：安全与凭据管理

已有安全措施包括仅接受请求头 token、默认随机口令、绑定本机地址、远程 URL 的 DNS/IP 私网拦截和重定向限制，这些应继续保留。

仍建议补强：

- Waline token、邮箱等信息目前写入浏览器 `localStorage`，应改为内存会话或可选的本机加密配置，并提供明确的“断开并清除凭据”。
- 上传大小、请求体大小、远程下载大小、超时和并发数应集中配置并在 UI 中显示限制。
- Git 命令执行应从字符串 `exec` 逐步迁移到参数化调用或受控命令封装，统一输出脱敏和超时处理。
- 增加会话锁定/重新验证、状态失效提示和“退出管理面板”动作；即使面板只允许本机访问，也应避免长时间无感持有管理员能力。
- 所有 API 返回统一错误码、用户可读消息和 request id，避免前端各函数自行猜测错误格式。

### P2：可维护性与测试能力

- 前端大量使用全局变量、字符串模板、动态 ID 和行内 `onclick`，新增功能容易互相影响。
- 后端路由、文件读写、媒体处理、远程抓取、Git 操作集中在一个文件中。
- 当前没有针对管理 API、Markdown 保存、冲突处理、上传和 Git 状态的专门测试脚本；现有 `scripts/` 主要是公共站点和媒体流程验证。
- 缺少管理面板的浏览器级冒烟测试，无法稳定验证“编辑 → 保存 → 切换 → 再打开”的关键链路。

---

## 4. 目标体验

### 4.1 工作台首页

打开后台后先看到一个轻量工作台，而不是直接落入某一篇文章：

- 未保存草稿数、最近编辑、待发布文章数。
- 本地工作区状态：干净 / 有未提交修改 / 本地领先 / 远端领先 / 已分叉。
- 最近一次保存、拉取、推送的结果和时间。
- 快速入口：新建文章、继续编辑、打开媒体库、查看待处理留言。

### 4.2 文章管理

- 列表支持关键词搜索、标签、草稿/已发布、访问权限、日期范围和排序。
- 支持紧凑列表与卡片视图，保留当前档案感但减少无效留白。
- 每篇文章提供快速操作：继续编辑、预览、复制、发布/撤回、复制短链、删除/归档。
- 文章编辑页采用固定顶部操作栏：保存状态、预览、保存、发布、更多操作。

### 4.3 安全写作

- 任何离开当前编辑上下文的动作都经过 dirty 检查。
- 自动保存本地恢复草稿，但不自动写入正式 Markdown 文件。
- 保存成功后显示明确时间；保存失败保留表单内容并提供重试。
- 从 Git 或其他窗口发现版本变化时，不直接覆盖，先提示“远端版本 / 当前版本 / 对比”。

### 4.4 发布中心

将“保存文件”和“发布到线上”拆开：

1. **保存**：写入本地 Markdown/JSON。
2. **预览**：构建或打开本地预览，确认页面效果。
3. **提交/推送**：查看文件摘要、提交说明、远端状态后执行。
4. **结果**：显示 commit、推送结果、图片仓库结果和后续部署提示。

### 4.5 媒体库

- 图片、音频、封面和画廊素材统一展示。
- 上传队列支持进度、取消、失败重试和重复文件提示。
- 每个资源显示类型、尺寸、大小、CDN 地址、原图地址和引用文章。
- 资源删除前显示引用影响，默认只允许“移除引用”或“归档”，不直接物理删除。

---

## 5. 推荐的重构架构

### 5.1 前端目录建议

第一阶段保留原生技术栈，拆分成浏览器原生 ESM；后续如功能继续增长，再评估迁移到 Vite + TypeScript。建议结构：

```text
admin/
├── index.html                 # 仅保留壳、挂载点和 vendor 引用
├── styles/
│   ├── tokens.css
│   ├── layout.css
│   ├── components.css
│   └── editor.css
├── src/
│   ├── main.js
│   ├── state/store.js
│   ├── api/client.js
│   ├── api/errors.js
│   ├── ui/toast.js
│   ├── ui/modal.js
│   ├── ui/confirm-leave.js
│   ├── features/dashboard.js
│   ├── features/posts.js
│   ├── features/gallery.js
│   ├── features/media.js
│   ├── features/about.js
│   ├── features/frontend.js
│   ├── features/access.js
│   ├── features/guestbook.js
│   └── features/sync-center.js
└── vendor/
```

拆分时不改变已有接口和数据格式，先建立兼容层，确保每次只迁移一个模块。

### 5.2 后端目录建议

```text
server/
├── app.mjs
├── auth.mjs
├── config.mjs
├── routes/
│   ├── posts.mjs
│   ├── gallery.mjs
│   ├── media.mjs
│   ├── settings.mjs
│   └── sync.mjs
├── services/
│   ├── markdown-store.mjs
│   ├── json-store.mjs
│   ├── media-service.mjs
│   ├── remote-fetch.mjs
│   └── git-service.mjs
└── validation/
    ├── post-schema.mjs
    └── settings-schema.mjs
```

`admin-server.mjs` 可以先保留为入口，按依赖从底部逐步抽出服务，不建议一次性大规模移动。

### 5.3 状态模型

前端至少需要明确以下状态：

```text
页面状态：loading | ready | empty | error
编辑状态：pristine | dirty | saving | saved | save-error
同步状态：unknown | clean | dirty | ahead | behind | diverged | syncing | sync-error
上传状态：queued | uploading | processing | ready | failed | cancelled
```

所有按钮、离开确认、错误提示和重试操作都基于状态渲染，而不是由各个函数单独修改按钮文字。

### 5.4 API 演进原则

- 保留现有接口作为兼容层，新增接口统一 JSON 请求/响应。
- 统一返回结构，例如：

```json
{
  "ok": true,
  "data": {},
  "requestId": "..."
}
```

失败时：

```json
{
  "ok": false,
  "error": {
    "code": "POST_VERSION_CONFLICT",
    "message": "文章已被其他来源修改，请先对比后保存"
  },
  "requestId": "..."
}
```

- 文章列表接口增加筛选参数和轻量摘要；单篇文章返回 `version` 或 `contentHash`。
- 保存接口带上客户端读取到的版本；版本不一致返回 HTTP 409，而不是静默覆盖。
- 增加 `/api/health`、`/api/sync/status` 和 `/api/operations`，让界面能够展示实际状态。
- 文件写入采用原子写入；JSON 写入增加格式校验；Markdown front matter 通过统一 schema 校验。

---

## 6. 分阶段实施方案

### 阶段 0：建立安全基线（P0）

**目标**：在任何 UI 重构前，先确保现有流程不会因为拆分而丢稿。

**工作项**：

- 把文章、画廊、关于、前端配置的读写逻辑整理成可调用服务。
- 为文章保存建立临时文件 + rename 和基础备份策略。
- 增加 `contentHash/updatedAt`，为后续冲突检测准备。
- 增加管理 API 冒烟测试：列表、读取、新建、编辑、删除、配置保存、上传失败路径。
- 增加管理面板关键链路测试：打开 → 编辑 → 切换 → 返回 → 保存 → 重新加载。

**验收**：现有文章、画廊、关于页和前端配置的保存结果与重构前一致；`npm run build` 持续通过。

### 阶段 1：统一外壳和状态管理（P0/P1）

**目标**：先解决“不知道当前状态”和“误操作丢内容”。

**工作项**：

- 将 `admin/index.html` 的 CSS、API、状态、模块逻辑拆成 ESM。
- 建立全局 store 和模块生命周期：进入、离开、加载、卸载。
- 增加 dirty 状态、离开确认、刷新前警告、本地恢复草稿。
- 顶部固定操作栏增加保存状态、预览入口和当前模块上下文。
- 增加统一 loading、empty、error、retry 状态。
- 模态框补充焦点管理、Esc 关闭、键盘操作和 `aria` 标签。

**验收**：编辑正文后切换文章、切换模块、刷新页面都会得到明确保护；网络失败时表单内容不消失。

### 阶段 2：文章管理效率升级（P1）

**目标**：减少找文章、改状态和重复填写的成本。

**工作项**：

- 文章列表增加关键词搜索、标签筛选、草稿/已发布/权限筛选、日期排序。
- 新建文章支持模板和默认元数据；Slug 自动生成但可手动修正。
- 元数据采用分组卡片：基本信息、发布设置、正文、封面/分享。
- 增加字数、图片数、外链数、缺失 alt 等轻量内容检查。
- 增加快速发布/撤回、复制文章、复制公开链接/短链、预览按钮。
- 对富文本兼容性做成编辑器状态提示，不再只在切换时弹一次确认。

**验收**：从几十篇文章中可在一次搜索或筛选内定位目标；新建文章不需要重复填写常用字段；发布状态有明确反馈。

### 阶段 3：媒体库和画廊工作流（P1）

**目标**：把“上传一个文件”和“让资源可被可靠使用”连成一条流程。

**工作项**：

- 抽出统一媒体服务和媒体库 UI。
- 上传队列支持多文件、进度、取消、重试和失败原因。
- 统一处理图片压缩、HEIC 转换、音频元数据、CDN 预热反馈。
- 提供缩略图、尺寸/大小、复制 CDN 地址、插入文章、设为封面。
- 做资源引用扫描，删除/归档前显示影响范围。
- 画廊编辑器复用媒体选择器，减少重复输入。

**验收**：上传失败可以单项重试；插入资源后能看到最终 URL；删除资源前能知道哪些文章会受影响。

### 阶段 4：发布中心和 Git 同步（P0/P1）

**目标**：让拉取、提交、推送变成可解释、可恢复的操作。

**工作项**：

- 默认启动只检查同步状态，不自动拉取；自动拉取改为明确可开启的设置。
- 新增同步状态卡：工作区、ahead/behind、分叉、待提交文件。
- 推送前展示内容推送与全量推送的文件差异摘要。
- 拉取前显示远端提交数量与影响范围；分叉时给出下一步建议。
- 增加操作日志、request id、失败重试和结果复制。
- Git 命令统一封装，限制命令集合、超时、输出长度和敏感信息泄露。

**验收**：用户不会因为打开后台而意外改变本地工作区；每次同步操作都能回答“做了什么、改了什么、是否成功、失败后怎么继续”。

### 阶段 5：安全、可观测性与质量收尾（P0/P2）

**工作项**：

- 凭据改为内存会话或可选安全存储，增加断开/清除入口。
- 统一请求体、上传、远程下载大小限制和超时配置。
- 增加 API 结构化日志，敏感信息脱敏。
- 增加 Playwright 或等价浏览器级冒烟测试，并在本地验证管理面板关键路径。
- 增加键盘导航、焦点可见性、对比度和窄屏布局检查。
- 补充文档和新的交接记录，更新旧的 `AGENT_HANDOFF.md` 状态。

---

## 7. 优先级排序

### 必须先做

1. 未保存变更保护和本地恢复草稿。
2. 保存状态、失败重试和统一错误提示。
3. Git 同步状态可视化，关闭默认隐式拉取或改成明确设置。
4. 文章版本/哈希冲突检测和原子写入。
5. 管理 API 冒烟测试与文章关键链路测试。

### 第二批做

1. 文章搜索、筛选、排序和快速操作。
2. 文章表单分组和即时校验。
3. 媒体上传队列、重试、引用追踪。
4. 发布中心、差异摘要和操作日志。
5. 前端 ESM 拆分与统一状态管理。

### 可以后置

1. 批量编辑和批量发布。
2. 文章修订历史与可视化 diff。
3. 定时发布。
4. 更换完整前端框架。
5. 数据库或多人协作权限体系。

在确认后台仍以“单机单用户 + Git 发布”为主之前，不建议为了追求现代化而直接引入数据库或完整 SPA 框架。

---

## 8. 验收清单

### 文章

- [x] 能搜索、筛选、排序文章。
- [x] 编辑后切换文章/模块有未保存保护。
- [x] 刷新或异常重启后能恢复本地草稿。
- [x] 保存成功、保存中、保存失败状态清晰可见。
- [x] Slug、日期、标签、权限、正文等字段能定位错误。
- [x] 文章版本冲突不会静默覆盖。
- [x] 预览、保存、推送是三个清晰动作。

### 媒体

- [x] 图片/音频上传有进度、失败原因和重试。
- [x] HEIC、音频解析、CDN 预热均有结果反馈。
- [x] 资源可复制、插入、设为封面。
- [x] 删除资源前能查看引用。

### 同步

- [x] 能看到工作区 dirty、ahead/behind 和分叉状态。
- [x] 拉取/推送前有影响范围提示。
- [x] 失败时有下一步建议和重试入口。
- [x] 启动后台不会在用户不知情的情况下修改工作区。

### 质量

- [x] `node --check admin-server.mjs` 通过。
- [x] `npm run build` 通过。
- [x] 管理 API 冒烟测试通过。
- [x] 浏览器级关键流程通过。
- [x] 窄屏、键盘导航、焦点和错误状态可用。

---

## 9. 后续接手建议

1. 以本文档为方案基线，不直接在当前单文件上继续无边界堆功能。
2. 第一轮实现只做“阶段 0 + 阶段 1”，不要同时改公共博客页面。
3. 每完成一个模块就执行构建、API 冒烟和手动回归，不等到全部拆完再验证。
4. 保留现有数据格式和 API 兼容层，确认稳定后再删除旧实现。
5. 后续如用户确认需要多人协作、定时发布或线上后台，再单独评估身份系统、数据库和部署方式。

**建议的第一条实施任务**：先为文章编辑建立统一 dirty 状态与本地恢复草稿机制，并同步补上文章保存的版本哈希/原子写入；这是风险最低、收益最高、也最能验证新架构是否正确的一步。
