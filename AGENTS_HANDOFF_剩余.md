# 博客后台重构：剩余任务交接

> **文档日期**：2026-09-30（本轮更新）  
> **当前阶段**：P0 发布中心/Git 同步透明化、P0 配置数据写入安全、P0 测试基线（API 冒烟 + Git 服务测试）已完成并验证  
> **用途**：给下一位 Agent 直接接续实施，避免重复审计和遗漏原始目标  
> **上位文档**：`ADMIN_REFACTOR_OPTIMIZATION_HANDOFF.md`、`AGENT_HANDOFF.md`

---

## 0. 本轮更新（2026-09-30）

### 已完成

- 新增 `admin/git-service.mjs`：受控 Git 命令封装（白名单子命令、参数化 `execFile`、超时、输出上限、敏感信息脱敏、`status/previewCommit/commitAndPush/fetchRemote/previewPull/pullFastForward/recentCommits`）。
- `admin-server.mjs` 接入发布中心：
  - 新增 `GET /api/sync/status`（默认只读本地引用；`?fetch=1` 才访问远端）、`GET /api/sync/preview?kind=content|full`、`GET /api/sync/pull-preview`、`GET /api/operations`。
  - 全局 `requestId` 中间件（响应头 `x-request-id`，同步接口错误响应回传 `requestId`）。
  - 内存操作日志（push / push-full / pull / push-image-repo / auto-pull），含时间、动作、结果、错误原因、耗时。
  - 启动流程改为默认只检查状态，自动拉取需显式设置 `ADMIN_AUTO_PULL=1`。
  - `pushGitChanges` / `pushImageRepo` / `syncFromRemote` 全部改用受控 Git 服务，删除字符串 `exec()` 拼接。
- 管理面板（`admin/index.html`）新增同步状态卡与发布中心弹窗：状态、分支、ahead/behind、待提交数量；推送前展示文件差异摘要并要求确认；拉取前展示远端提交清单；失败提供重试与复制错误；操作日志展示。
- 新增 `admin/json-store.mjs`：JSON 配置存储（原子写入、结构校验、轮换备份、`contentHash` + `expectedHash` 冲突检测、同 store 写入串行化）。
- 画廊 / 关于 / 前端定制 / 访问控制全部改走存储服务；画廊通过 `x-content-hash` 响应头、关于与前端定制通过响应体 `contentHash` 暴露版本，保存要求携带 `expectedHash`（缺失 428、冲突 409）。
- 新增可隔离运行的测试：
  - `npm run test:admin-sync`（11 项 Git 服务测试）
  - `npm run test:admin-api`（隔离临时目录 + 随机端口的 API 冒烟）
  - `npm run test:admin-ui`（发布中心浏览器冒烟，拦截 `/api`，不产生真实推送）
  - `npm run test:admin`（storage + json-store + sync 单元测试，共 21 项）
  - `npm run test:admin-all`（依次运行以上三组）
- 数据/内容目录支持环境变量隔离：`ADMIN_DATA_DIR`、`ADMIN_BLOG_DIR`、`ADMIN_BACKUP_DIR`、`IMG_REPO_DIR`。
- `.gitignore` 增加 `.admin-backups/`。
- 验证：`node --check admin-server.mjs`、`npm run test:admin`（21 项）、`npm run test:admin-api`（30 项）、`npm run test:admin-ui`（11 项）、`npm run build`（97 页面）全部通过。

### 尚未完成（见下文复选框）

- 上传失败路径、远程 URL 导入失败路径的 API 冒烟。
- 私密文章密码（`private-access.json`）的 `expectedHash` 冲突校验（当前仅原子写入 + 校验 + 备份）。
- `syncing` 状态由前端操作期展示，服务端状态接口未单独输出。
- 文章列表搜索/筛选/排序、统一媒体库、前端 ESM 拆分、凭据会话与可观测性收尾。

---

## 0.2 本轮更新（2026-09-30 第二批）：文章列表搜索/筛选/排序与快速操作

### 已完成

- `admin-server.mjs`：
  - `/api/posts` 与 `/api/posts/:slug` 增加 `updatedAt`（文件 mtime）、`excerpt`（正文摘要）、`astroId`、`hasPublicPage`、`publicUrl`、`shortUrl`。
  - 公开链接与短链与 `src/pages/blog/[...id].astro`、`src/pages/s/[id].astro` 保持一致：用 `github-slugger` 生成 Astro 内容集合 id，再用 `sha256(id) 前 8 位 → base36` 生成短码；`draft: true` 与 `access: admin` 不生成公开链接。
  - 新增依赖 `github-slugger@^2.0.0`（与 Astro 内部一致），并同步 `package-lock.json`。
- `admin/index.html`：
  - 侧栏新增列表控件：关键词搜索（标题/描述/Slug/正文摘要）、草稿与已发布筛选、访问权限筛选、标签筛选、发布日期范围、7 种排序、紧凑/卡片视图切换、结果计数与清除筛选；偏好写入 `localStorage`。
  - 每篇文章快速操作：继续编辑、预览、复制公开链接、复制短链、发布/撤回（草稿切换，需二次确认）、删除；使用事件委托，不再用行内 `onclick`。
  - 非公开文章（草稿 / 管理员级）自动隐藏预览与复制链接按钮。
  - 切换到非「文章」模块时隐藏列表控件。
- 新增 `scripts/post-list-e2e.mjs`（20 项浏览器冒烟，拦截 `/api`）与 `scripts/run-admin-e2e.mjs`（自动复用或启动管理面板后依次跑两组浏览器冒烟）。
- `package.json` 新增 `test:post-list`、`test:admin-e2e`；`test:admin-all` 现在为 `test:admin + test:admin-api + test:admin-e2e`，单命令可重复执行。

### 验证结果

- `npm run test:admin-all`：单元 21 项、API 冒烟 30 项、浏览器冒烟 31 项全部通过。
- 真实服务 + 真实文章浏览器验证：48 篇加载、筛选/卡片/搜索正常，无页面错误。
- `npm run build`：97 页面通过。
- 真实 `src/` 未被测试修改。

### 尚未完成

- 文章表单分组 / 模板 / 即时校验（§6.3）。
- 正文摘要仅用于搜索；尚未显示字数、图片数、外链数、缺失 alt。
- 预览仅打开线上页面；草稿/管理员级文章无本地预览能力。

## 0.3 本轮更新（2026-09-30 第三批）：全量完成 P1 + 可落地 P2

### 已完成

- **文章管理效率（§6）**：
  - 编辑器表单拆为「基本信息 / 发布设置 / 封面与分享 / 正文」四个可折叠分组。
  - 新建文章提供模板（日常/技术/论文/空白）与默认元数据。
  - Slug 随标题自动生成、可手改、即时校验（格式 + 重名）。
  - 标题、日期、同日序号、标签即时校验与错误定位。
  - 正文统计字数 / 图片数 / 缺失 alt / 外链数；富文本不兼容结构持续状态提示。
  - 快速操作补全：复制文章、归档/取消归档、管理面板内本地预览（Toast UI 只读渲染）。
  - `archived` 字段贯通后端与公开站点（草稿/归档均不出现在公开列表）。

- **媒体库与画廊（§7）**：
  - 新增 `GET /api/media`（图片/音频统一登记：名称/大小/时间/尺寸/CDN/原图/引用者）、`DELETE /api/media`（引用保护）、`POST /api/media/archive`（移入 `_archive`）、`GET /api/health`（运行限制）。
  - 媒体模式 UI：搜索/类型/引用筛选、分页、复制 CDN/原图、插入目标文章正文、设为封面、查看引用、删除/归档。
  - 上传队列：多文件、进度（XHR）、取消、单项重试、失败原因、重复提示、并发限制。
  - 引用扫描：文章正文与画廊全量扫描，删除前展示影响范围。
  - 媒体选择器复用到文章正文插入、封面、画廊。

- **前端 ESM 拆分（§8）**：
  - `admin/index.html` 仅保留页面壳与模态框；CSS 拆为 `admin/styles/{tokens,layout,components,editor}.css`，JS 拆为 `admin/src/{main.js,api/client.js,api/errors.js,state/store.js,ui/dom.js,ui/toast.js,ui/modal.js}`。
  - 建立全局 store（同步状态等）、统一 API 客户端（注入口令、JSON 校验、错误解析）。
  - 模态框统一 `role=dialog` / `aria-modal` / Tab 焦点锁定 / Esc 关闭；新增编辑器本地预览入口。
  - 列表模块增加 loading/empty/error/retry 视图（`loadPosts` 失败可在面板内重试）。

- **安全与可观测性（§9）**：
  - Waline 凭据默认仅存会话（sessionStorage），可选「记住到本机」，提供「断开并清除凭据」。
  - 新增「锁定/重新验证」与「退出管理面板」。
  - 运行限制集中为 `LIMITS` 并在发布中心/媒体库展示。
  - 所有 `/api` 错误响应统一补充 `code` 与 `requestId`；新增结构化 JSON 访问日志与敏感信息脱敏。

- **质量收尾（§10）**：`:focus-visible` 样式、模态焦点锁定、对比度与窄屏检查、错误/空/重试状态。
- **可落地 P2（§11）**：批量发布/撤回/归档/删除；文章修订历史（保存前快照 + 行级 diff + 恢复）；定时发布元数据 `scheduledAt`（未到时间不加入公开列表，到时间后需一次构建/推送）。

### 新增测试

- `scripts/media-library-e2e.mjs`、`scripts/post-form-e2e.mjs`、`scripts/quality-e2e.mjs`；`scripts/run-admin-e2e.mjs` 现依次运行 5 组浏览器冒烟。
- `admin-api-smoke.mjs` 补充定时发布与修订历史断言。

### 验证结果

- `npm run test:admin-all`：单元 21 项 + API 冒烟（含定时/修订）+ 浏览器冒烟 4 份全部通过。
- `npm run build`：97 页面通过（schema 新增 `archived` / `scheduledAt`）。

### 已知边界（未做）

- 未迁移到 React/Vue/SPA，未引入数据库（属 §11 暂缓项）。
- 定时发布依赖一次到点后的构建/推送，服务端无排程器（静态站点限制）。
- 修订历史为整文件快照 + 行级 diff，非三方合并。
- 留言凭据可“记住到本机”时仍以明文存于浏览器 localStorage（已提供清除入口）。

## 0.4 本轮更新（2026-09-30 第四批）：编辑器升级为 Vditor

- 引入开源 **Vditor 4.0.0**（vendor 到 `admin/vendor/vditor/`），替换 Toast UI：
  - 四视图：**即时渲染 IR（默认）/ 分屏 SV / 所见即所得 / 源码**，均以 Markdown 为事实来源。
  - **原始 HTML 保真**：IR/SV 原样保留 `<div align>`、`<mark>`、`<u>`、iframe、`song-player`（旧 Toast UI 会改写）。
  - 内置工具栏（标题/加粗/斜体/删除线/列表/任务/缩进/引用/分割线/代码/链接/表格/上传/前景色/背景色/撤销重做/全屏/大纲）。
  - 保留博客专属按钮：视频/音乐/媒体库/图宽/对齐；图片/音频上传仍走原 `/api/upload` 与媒体库。
- **排版体验**：新增 `admin/styles/preview-site.css`，编辑区与本地预览统一使用贴近线上 `.prose` 的排版；本地预览改用 `Vditor.preview`。
- 兼容层：`window.editor.getMarkdown()/setMarkdown()`，测试与旧调用无感迁移。
- 清理：删除 `admin/vendor/toastui/`、`admin/vendor/turndown.js` 与 `turndown` 依赖；新增 devDependency `puppeteer-core`（之前为隐式依赖）。
- 测试：`scripts/editor-e2e.mjs` 重写；`run-admin-e2e.mjs` 现跑 **6 组**浏览器冒烟。
- 验证：`npm run test:admin-all` 全绿；`npm run build` 97 页。

---

## 0.5 本轮更新（2026-09-30 第五批）：测试补全与编辑器体验细化

- 私密文章密码接入 `contentHash` / `expectedHash`（GET 返回哈希；PUT 缺失 428、冲突 409）。
- API 冒烟补：上传未选文件/非法类型 400、远程导入缺少/非法/非 http(s)/本机地址失败路径、访问控制 428/409。
- 浏览器冒烟补：刷新页面恢复本地草稿。
- 编辑器：大纲开关、专注模式（隐藏侧栏）、预计阅读时长。
- 验证：`npm run test:admin-all` 全绿；`npm run build` 97 页。

---

## 1. 当前基线

### 1.1 已完成（含上一轮）

- 文章编辑器 dirty 状态、切换/刷新保护、本地恢复草稿。
- 文章 `contentHash`、更新要求 `expectedHash`、冲突返回 409、串行写入、原子写入。
- 发布中心与 Git 同步状态透明化（本轮）。
- JSON 配置原子写入、结构校验、备份、版本冲突（本轮）。
- 管理 API 冒烟 + Git 服务单元测试 + 发布中心浏览器冒烟（上一轮）。
- 文章列表搜索/筛选/排序/视图 + 快速操作（发布/撤回、复制公开链/短链、预览）+ 公开链接与短链后端字段（本轮）。

### 1.2 当前未提交变更

以下文件存在未提交修改或新增（`git status --short` 为准）：

```text
M  .gitignore
M  admin-server.mjs
M  admin/index.html
M  package.json
M  package-lock.json
M  AGENT_HANDOFF.md
?? admin/atomic-file.mjs
?? admin/git-service.mjs
?? admin/json-store.mjs
?? scripts/admin-storage.test.mjs
?? scripts/admin-json-store.test.mjs
?? scripts/admin-sync.test.mjs
?? scripts/admin-api-smoke.mjs
?? scripts/sync-center-e2e.mjs
?? scripts/post-list-e2e.mjs
?? scripts/run-admin-e2e.mjs
?? ADMIN_REFACTOR_OPTIMIZATION_HANDOFF.md
?? AGENTS_HANDOFF_剩余.md
```

工作区中原有的未跟踪文件不得删除、覆盖或重新生成：

```text
?? public/images/医学扩招-中国新闻网-2026-09-14.jpg
```

### 1.3 关键约束

- 管理后台默认只绑定 `127.0.0.1:4322`，不要改成公网监听。
- 管理 API 使用请求头 `x-admin-token`，口令由 `.admin-token` 或环境变量提供。
- `.admin-token`、`.admin-backups/` 已被 `.gitignore` 忽略，不得提交。
- 不执行 `git reset --hard`、`git checkout --`、强制推送等破坏性操作。
- 公共博客页面本轮不要求修改；后台改造优先。
- 继续保留 Markdown、JSON 和 Git 作为数据事实来源，暂不引入数据库。
- 自动拉取默认关闭，仅 `ADMIN_AUTO_PULL=1` 时启用。

---

## 2. 剩余任务总览

| 优先级 | 任务组 | 当前状态 |
| --- | --- | --- |
| P0 | 发布中心与 Git 同步透明化 | 已完成 |
| P0 | 其余配置数据的原子写入、版本校验和备份 | 基本完成（私密密码待补冲突校验） |
| P0 | 自动化 API 冒烟测试和浏览器关键流程测试 | 基本完成（上传/远程导入失败路径待补） |
| P1 | 文章列表搜索、筛选、排序和快速操作 | 已完成 |
| P1 | 文章编辑表单分组、默认值、模板和即时校验 | 已完成 |
| P1 | 统一媒体库、上传队列和资源引用追踪 | 已完成 |
| P1 | 前台 ESM 拆分和全局状态管理 | 已完成 |
| P1 | 凭据、会话、错误协议和可观测性 | 已完成 |
| P1 | 管理面板键盘、焦点和窄屏可用性 | 已完成 |
| P2 | 批量操作、修订历史、定时发布 | 已完成（不做 SPA/数据库迁移） |
| P2 | 完整前端框架迁移、数据库和多人协作 | 暂缓 |

---

## 3. P0：发布中心与 Git 同步

### 3.1 任务

- [x] 启动后台时只检查同步状态，不自动拉取。
- [x] 将自动拉取改为明确设置，例如 `ADMIN_AUTO_PULL=1` 或后台开关。
- [x] 新增同步状态接口 `GET /api/sync/status`。
- [x] 状态至少覆盖 `clean / dirty / ahead / behind / diverged / sync-error`（另含 `unknown`；`syncing` 由前端同步操作期展示，服务端不单独输出）。
- [x] 顶部或独立区域显示工作区状态、ahead/behind、待提交文件数量。
- [x] 推送前展示内容推送、全量推送的文件差异摘要（`/api/sync/preview?kind=content|full` + 确认弹窗）。
- [x] 拉取前显示远端提交数和影响范围（`/api/sync/pull-preview`）。
- [x] 分叉时显示可执行的下一步建议（预览与拉取结果返回 `reason=diverged` 的可读提示）。
- [x] 增加操作日志，记录时间、动作、结果和错误原因（`/api/operations`）。
- [x] 增加 `requestId`，便于错误追踪。
- [x] 失败操作提供重试按钮和结果复制入口。
- [x] 将 Git 字符串 `exec()` 收敛到受控命令封装，限制命令集合、超时、输出长度和敏感信息输出。

### 3.2 验收标准

- 打开后台不会在用户不知情的情况下修改工作区。
- 用户能看到当前工作区是否 dirty、是否领先、是否落后、是否分叉。
- 推送前能确认将提交哪些文件。
- 拉取前能确认远端有哪些提交以及影响范围。
- 失败后能知道发生了什么，并可以重试或复制错误信息。

---

## 4. P0：配置数据写入安全

### 4.1 任务

- [x] 将画廊、关于页、前端定制、访问控制的读写逻辑整理为可调用服务（`admin/json-store.mjs`）。
- [x] 让 JSON 配置写入使用临时文件加 rename（复用 `atomicWriteFile`）。
- [x] 为 JSON 写入增加格式校验，避免写入无效结构。
- [x] 为 JSON 写入增加基础备份（`.admin-backups/`，按 label 轮换保留）。
- [x] 为配置数据增加 `contentHash`（`updatedAt` 尚未提供）。
- [x] 配置保存支持版本冲突检查（画廊/关于/前端定制强制；私密密码暂未强制，待补）。
- [x] 保留现有 Markdown 文章原子写入逻辑。
- [x] 将 `admin-server.mjs` 中分散的配置 `writeFile` 调用统一到存储服务。

### 4.2 涉及数据

```text
src/data/gallery.json
src/data/about.json
src/data/frontend.json
src/data/private-access.json
src/content/blog/*.md
```

### 4.3 验收标准

- 写入中断不会留下半写 JSON。
- 非法 JSON 不会覆盖已有有效文件。
- 外部修改配置后，后台保存能够发现版本变化。
- 现有保存结果和公共博客构建结果保持一致。

---

## 5. P0：测试基线

### 5.1 管理 API 冒烟测试（`npm run test:admin-api`）

- [x] 列表文章。
- [x] 读取单篇文章。
- [x] 新建文章。
- [x] 带正确 hash 更新文章。
- [x] 带错误 hash 更新文章，确认返回 409。
- [x] 删除文章。
- [x] 保存画廊配置（含 428/409 冲突路径）。
- [x] 保存关于页配置（含 428/409 冲突路径）。
- [x] 保存前端定制配置。
- [ ] 上传失败路径。
- [ ] 远程 URL 导入失败路径。

测试使用隔离临时目录（`ADMIN_DATA_DIR`/`ADMIN_BLOG_DIR`/`ADMIN_BACKUP_DIR`）和随机端口，不修改真实文章或图片仓库。

### 5.2 浏览器关键流程

- [x] 打开后台。
- [x] 选择文章、修改标题和正文、dirty 状态、离开提示、草稿恢复、保存与冲突（上一轮验证 + `scripts/editor-e2e.mjs`）。
- [x] 发布中心：状态卡渲染、推送预览、确认推送、拉取预览、确认拉取、失败状态（`npm run test:admin-ui`）。
- [ ] 刷新页面并确认恢复流程（需补充自动化）。

### 5.3 验收标准

- [x] 以上流程可以通过单个 npm 命令重复执行（`test:admin`、`test:admin-api`、`test:admin-ui`，或 `test:admin-all`）。
- [x] 测试不依赖真实远端推送（Git 测试使用临时裸仓库，UI 测试拦截 `/api`）。
- [x] 测试失败时能定位到具体接口或界面状态。

---

## 6. P1：文章管理效率

### 6.1 列表能力

- [x] 关键词搜索文章标题、描述、Slug、正文摘要。
- [x] 按标签筛选。
- [x] 按草稿/已发布筛选。
- [x] 按访问权限筛选。
- [x] 按日期范围筛选。
- [x] 按发布日期、更新时间、同日序号和标题排序。
- [x] 增加紧凑列表和卡片视图。

### 6.2 快速操作

- [x] 继续编辑。
- [x] 打开预览（草稿/管理员级无线上页面，给出明确提示）。
- [x] 复制文章。
- [x] 复制公开链接。
- [x] 复制短链。
- [x] 快速发布/撤回。
- [x] 删除。
- [x] 归档。

### 6.3 编辑表单

- [x] 按「基本信息 / 发布设置 / 封面与分享 / 正文」分组。
- [x] 新建文章支持模板和默认元数据。
- [x] Slug 自动生成并允许手动修正。
- [x] 标题、Slug、日期、标签、访问权限提供即时校验。
- [x] 显示字数、图片数、外链数。
- [x] 标记缺失 `alt` 的图片。
- [x] 富文本兼容性从一次性确认升级为持续状态提示。

### 6.4 验收标准

- [x] 几十篇文章中可在一个搜索或筛选动作内定位目标。
- [x] 新建文章不需要重复填写常用字段。
- [x] 发布状态和保存结果有明确反馈。

---

## 7. P1：媒体库和画廊

- [x] 图片、音频、封面、画廊素材统一登记（名称/大小/时间/尺寸/CDN/原图/引用）；压缩/HEIC/音频元数据/CDN 预热复用现有上传管线。
- [x] 上传队列（多文件、进度、取消、单项重试、失败原因、重复提示）。
- [x] 资源管理（缩略图/尺寸/大小/类型、复制 CDN、插入文章、设为封面、引用扫描、删除影响范围）。
- [x] 画廊编辑器复用媒体选择器（同时复用到封面与正文插入）。

---

## 8. P1：前端拆分和状态管理

已完成：CSS 拆为 `admin/styles/{tokens,layout,components,editor,preview-site}.css`；JS 拆为 `admin/src/{main.js,api/client.js,api/errors.js,state/store.js,ui/dom.js,ui/toast.js,ui/modal.js}`；建立全局 store、统一 API 客户端、模态焦点锁定与 aria，列表提供 loading/empty/error/retry 视图。编辑器已从 Toast UI 升级为 Vditor（IR/SV/WYSIWYG/源码）。

```text
页面：loading | ready | empty | error
编辑：pristine | dirty | saving | saved | save-error
同步：unknown | clean | dirty | ahead | behind | diverged | syncing | sync-error
上传：queued | uploading | processing | ready | failed | cancelled
```

未做：未迁移到 React/Vue/Vite；部分业务逻辑仍留在 `main.js`（未进一步拆为 features/*.js）。

---

## 9. P1：安全、日志和可观测性

- [x] Waline token、邮箱与会话信息默认仅存会话（可选用「记住到本机」）；提供「断开并清除凭据」。
- [x] 会话锁定、重新验证、退出管理面板、口令失效提示（解锁时校验 `/api/health`）。
- [x] 上传/远程下载/Git 超时/抓取超时/并发限制集中配置并在 UI 显示。
- [x] 错误响应统一补充错误码与 `requestId`（成功响应保持原结构以兼容前端）。
- [x] 结构化服务端 JSON 访问日志与敏感信息脱敏。

---

## 10. P1：质量收尾

- [x] 管理面板键盘导航检查。
- [x] 焦点可见性检查（`:focus-visible`）。
- [x] 颜色对比度检查。
- [x] 窄屏和移动宽度检查。
- [x] 错误和空状态检查（列表 / 发布中心 / 媒体库）。
- [x] 版本冲突状态检查（文章 + JSON 配置）。
- [x] 本地草稿恢复检查。
- [x] `node --check admin-server.mjs`。
- [x] `npm run test:admin-storage`。
- [x] 新增管理 API 冒烟测试（`npm run test:admin-api`）。
- [x] 新增 Git 服务单元测试（`npm run test:admin-sync`）。
- [x] `npm run build`（97 页面）。

---

## 11. P2：暂缓事项

- [x] 批量编辑和批量发布（批量发布/撤回/归档/删除）。
- [x] 文章修订历史和可视化 diff（整文件快照 + 行级 diff + 恢复）。
- [x] 定时发布（`scheduledAt` 元数据 + 公开列表过滤；需到点后一次构建）。
- [ ] 完整迁移到 React、Vue 或其他 SPA 框架。
- [ ] 引入数据库。
- [ ] 多人协作和复杂权限系统。

说明：最后三项为架构级变更，未实施（保持本地单用户 + Markdown/JSON/Git 为事实来源）。

---

## 12. 推荐实施顺序

1. ~~完成 P0 发布中心和 Git 同步状态。~~（已完成）
2. ~~完成 P0 其余配置文件的原子写入、哈希和备份。~~（已完成）
3. ~~建立自动化 API 冒烟测试和浏览器关键流程测试。~~（已完成）
4. ~~完成文章列表搜索、筛选、排序和快速操作。~~（已完成）
5. ~~完成文章表单分组、模板和即时校验。~~（已完成）
6. ~~建立统一媒体库和上传队列。~~（已完成）
7. ~~拆分前端 ESM 和全局状态管理。~~（已完成）
8. ~~完成安全、日志、可观测性和可访问性收尾。~~（已完成）

P0/P1 目标已全部完成；可落地 P2（批量操作、修订历史、定时发布）也已完成。仅剩长期暂缓的架构级变更（SPA 迁移 / 数据库 / 多人协作）。

每完成一项，都应同步更新：

- `AGENT_HANDOFF.md`
- `ADMIN_REFACTOR_OPTIMIZATION_HANDOFF.md`
- 本文件的复选框和状态

---

## 13. 下一位 Agent 的第一步

原始目标（P0 + P1，以及可落地的 P2）已全部完成并通过测试。后续如需继续，建议按以下优先级：

1. ~~补全测试覆盖：上传失败路径、远程导入失败路径、刷新恢复本地草稿~~（已完成）。可继续补：编辑器上传队列失败重试、批量操作失败回滚。
2. 把 `admin/src/main.js` 继续拆为 `features/{posts,gallery,media,about,frontend,access,guestbook,sync}.js`，并把剩余状态迁入 `state/store.js`。
3. ~~私密文章密码保存接入 `expectedHash` 冲突校验~~（已完成）。
4. ~~编辑器体验（大纲 / 专注模式 / 阅读时长）~~（已完成）。可继续：打字机模式开关、Markdown 快捷键提示、粘贴图片自动上传反馈。
5. 定时发布若需要真正“到点自动上线”，需要 CI 定时重建（GitHub Actions schedule）或服务端排程；当前为元数据 + 到点后一次构建。
6. 只有在确认需要多人协作 / 线上后台时，再评估身份系统、数据库与 SPA 迁移（当前仍为本地单用户 + Markdown/JSON/Git 事实来源）。

在用户明确要求前，不要执行真实 GitHub 推送或重新部署线上站点。
