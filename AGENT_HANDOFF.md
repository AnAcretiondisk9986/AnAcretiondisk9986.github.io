# 个人博客 — Agent 变更日志

> 本文件已在用户授权下公开于 GitHub 仓库。每位 Agent 完成工作后在此记录变更。

**🐛 修复除首页外昼夜模式切换按钮失效（v3.0.1）**

- 症状：通过 View Transitions 导航进入的任何页面（卷册/图志/关于/留言/文章页），昼夜按钮点击无反应；导航后页面丢失已保存主题（`data-theme` 被 swap 移除且初始化脚本不重跑）。
- 根因 1：Astro `ClientRouter` 的 `deselectScripts`/`detectScriptExecuted` 按脚本内容（内联脚本取 `textContent`）去重——全站同文本的主题初始化与按钮绑定脚本在首页首次执行后，后续所有 VT 导航都被跳过，新 DOM 按钮无监听器。
- 根因 2（修复过程踩坑）：给打包 `<script>` 直接加 `data-astro-rerun` 会隐式 `is:inline`（Astro 文档原话），TS 泛型（`querySelector<HTMLButtonElement>`）与 `import` 原样内联进 HTML，浏览器解析成比较运算/语法错误，脚本全部失效——含 `import`/TS 的脚本不能走 `data-astro-rerun`。
- 根因 3：内联脚本加 `data-astro-rerun` 后每次导航重新执行，顶层 `const` 与首次执行留下的全局词法声明冲突，抛 `SyntaxError: Identifier 'x' has already been declared`，脚本整体被丢弃——内联脚本必须 IIFE 包裹（busuanzi 统计脚本原本就是 IIFE 故无恙）。
- 修复：`src/layouts/BaseLayout.astro` 两个脚本 → `is:inline data-astro-rerun` + IIFE + 去 TS 泛型；页面/组件脚本（index、blog/index、gallery、guestbook、WordCloud、PostComments）→ 改注册 `astro:page-load` 监听器驱动初始化（模块只执行一次、事件每次导航触发）；`order-toggle.ts` 加 WeakSet 幂等（首页与卷册页两模块注册同一函数，防重复绑定致排序来回切换）；文章页 busuanzi 脚本加 `data-astro-rerun`。
- 附带发现：本机 `python -m http.server`（Python 3.14）对 `.js` 返回 `text/plain`，浏览器严格 MIME 检查拒绝执行全部 module 脚本，导致本地复现时 VT 从未真正发生——新增 `scripts/static-server.mjs`（MIME 正确）与 `scripts/verify-vt-theme.mjs`（VT 导航回归测试）。
- 验证：`npm run build` 19 页成功；headless Chrome 真实 VT 导航全链路（首页→文章页→留言页→图志页→首页，含往返、主题保持、按钮双向切换、排序/词云/留言/画廊初始化）全部通过。
- 发布：README 新增 3.0.1 条目；模板仓库（blog-template）已同步本次全部源码改动。

**🎠 广告牌改为线性轨道轮播（v2.2.3）**

- 取消环形设定（用户要求）：`buildBillboard` 重写——每张 slide 静态定位 `left: centers[i]`（间距逐对自适应：`max(w)×1.2/2 + min(w)×0.82/2 + GAP`），切换时整个轨道 `translateX` 平移（560ms），焦点图对齐视口中心；不再按 `active` 重排每张图位置（不再是环状滚筒）。
- 末→首瞬移：`goTo` 中 `|target-active|>1`（末→首 / 首→末 / 指示点远跳）先 `setTransitions(false)` + 强制 reflow 再设置，`requestAnimationFrame` 恢复过渡；自动轮播线性前进 `goTo(active+1)`，最后一张播完直接切回第一张。
- `ResizeObserver`：slide 宽度变化（图片头部到达/解码）→ `layoutTrack` 重排；viewport 尺寸变化（面板隐藏时宽 0、窗口缩放）→ `applyTrack` 重新对齐。
- CSS：`.gallery-billboard-track` 增加 `transition: transform 560ms cubic-bezier(0.22,0.9,0.3,1)` 与 `will-change`。
- 验证：`npm run build` 19 页成功；headless Chrome 实测——焦点对齐偏差 0、空隙恒 18px、线性定位单调；末→首 `transition:'none'` 瞬移、100ms 稳定、首张精确对齐；构造 900/300px 与真实图片均无重叠；自动轮播逐张前进正常。
- 发布：提交已推送，tag `v2.2.3` + GitHub Release（README 更新日志新增 2.2.3 条目，模板仓库未同步，沿用既有约定）。

**🎠 广告牌轮播间距逐对自适应布局（v2.2.2）**

- 背景：v2.2.1 用「全局最宽图 × 0.82」统一所有 slide 间距，消除重叠但窄图间空隙过大、布局松散（用户反馈）。
- 修复（`src/pages/gallery.astro` `layoutSlides`）：改为逐对自适应——相邻两图中心距 = 各自缩放后半宽之和 + `GAP`，沿焦点两侧按序累加/累减得每张图 offset；宽图间自然更远、窄图间紧凑，无重叠也无多余空隙。
- 布局触发由 `load` 事件改 `ResizeObserver`（监听每个 slide）：图片头部下载完即定长宽比、宽度先于 `load` 变化，此前大图完整下载前按旧宽度（240 兜底）排布导致重叠；现在比例一到立即重排。
- 验证：`npm run build` 19 页成功；headless Chrome 构造 900/300px 交替——初始与连续切换无重叠、空隙恒 18px；真实 22 张（671/623/532/213px 混合）稳态无重叠、空隙 17.7~18.4px，懒加载过程自动重排正常，自动轮播正常。
- 发布：提交已推送，tag `v2.2.2` + GitHub Release（README 更新日志新增 2.2.2 条目，模板仓库未同步，沿用既有约定）。

**🐛 修复广告牌轮播宽图重叠（v2.2.1）**

- 症状：较宽的图片进入候播区（焦点两侧弱化区）时与相邻图片重叠。
- 根因：`layoutSlides()` 的步长（相邻 slide 中心距）仅按焦点图与 ±1 相邻图宽度计算，全部 slide 按 `d × 步长` 均匀分布——±2、±3 位置的宽图缩放 0.82 后仍向中心伸出，与更近的图重叠；v2.2.0 全量轮播后宽图出现概率大增，问题暴露。
- 修复（`src/pages/gallery.astro`）：步长取两类约束的最大值——① `maxW × 0.82`（任意两个候播图相邻不重叠）；② `focusW × 1.2 / 2 + maxW × 0.82 / 2`（焦点图与候播图相邻不重叠），再加固定间距 `GAP`。
- 验证：`npm run build` 19 页成功；headless Chrome 构造 900px/300px 宽窄交替实测——修复前 slide 0 与 21 重叠，修复后初始布局与连续切换均无重叠；真实图片（671/213/623px 混合）22 张无重叠、自动轮播正常。
- 发布：提交已推送，tag `v2.2.1` + GitHub Release（README 更新日志新增 2.2.1 条目，模板仓库未同步，沿用既有约定）。

**🎠 图志页：广告牌全量轮播 + 独立收藏分页（v2.2.0）**

- `src/pages/gallery.astro`（主仓库）：`buildBillboard()` 移除 `pool.slice(0, 5)` 抽取限制，Fisher–Yates 洗牌后全量渲染全部独立收藏（当前 22 张）；头部文案改为 `BILLBOARD / FULL COLLECTION` + 「轮播全部 N 张独立收藏」。
- 独立收藏面板新增每页 9 张分页：面板底部 `data-independent-pager` 翻页器（与随文图像同款样式），`renderIndependentPage()`（`INDEPENDENT_PAGE_SIZE = 9`，`is-off-page` 隐藏、页码/禁用态/无图时隐藏），排序切换后重置回第 1 页，INDEPENDENT 编号跨页全局连续。
- `src/styles/global.css`：`.gallery-masonry--independent` 底部留白 44px 与随文图像对齐；`.gallery-billboard-dots` 加 `flex-wrap: wrap` 容纳全量指示点。
- 验证：`npm run build` 19 页成功、bundle 无 `slice(0,5)` 残留；headless Chrome 实测——广告牌 22 张 slide 全量渲染、自动轮播正常；独立收藏 22 张分 3 页（9/9/4）翻页与首末页禁用态正确、排序后重置第 1 页；随文图像原有分页（27 张 01/03）未受影响。
- 发布：提交 `4549326` 已推送，tag `v2.2.0` + GitHub Release（README 更新日志新增 2.2.0 条目，模板仓库未同步，沿用既有约定）。

**🔄 管理面板新增 Git 同步：启动自动比对 + 手动拉取（v2.1.0）**

- `admin-server.mjs`（主仓库）：新增 `syncFromRemote()` 核心函数与 `POST /api/pull` 路由，`app.listen` 回调中调用 `autoSyncOnStart()` 实现启动时自动同步。
- 同步策略（安全护栏）：① `git fetch origin` → ② 用 `git rev-list --count` 计算本地/远端的 ahead、behind → ③ 均为 0 时判定「无差异，忽略」；④ ahead>0（本地有未推送提交 / 分叉）跳过并提示先「全量推送」；⑤ 远端领先且工作区干净时 `git merge --ff-only origin/<branch>` 快进拉取；⑥ 工作区有未提交更改（如刚保存未推送的文章）跳过，避免覆盖。
- 启动自动比对不阻塞面板启动，网络失败仅提示（稍后可手动拉取）；`PORT` 现支持环境变量覆盖（默认仍 4322，与 `ADMIN_TOKEN` 同款风格）。
- `admin/index.html`（主仓库）：侧边栏新增「⇩ 拉取」按钮（`pullFromRemote()`，位于「推送」左侧），拉取成功后自动刷新当前文章/画廊列表；tip-bar 新增「⇩ 拉取=同步远端最新内容」提示。
- 验证（Windows 实测，双端 git 命令跨平台）：`node --check` 通过；`PORT=4323` 启动真实服务器三场景全过——① 本地=远端 → 日志「本地与远端一致，无需同步」；② 远端领先+工作区干净 → `/api/pull` 返回 `status:"pulled"` 并快进拉取 macOS 适配提交 `1464bd0`（HEAD 与 origin/main 归零差异）；③ 远端领先+工作区脏 → 返回 `status:"skipped", reason:"dirty"` 不覆盖工作区；无 token 请求 401。stash/pop 往返验证改动无损。
- 本次拉取到用户已在 macOS 推送的 `1464bd0 feat: macOS 适配 (v2.0.0-macOS)`（含 `.command` 启动器与 `.githooks/pre-commit` 跨平台修复），与本次同步功能配合，Windows / macOS 双端行为一致。
- 模板仓库未同步（自 v1.4.0 起模板停止跟进主仓库架构，沿用既有约定）。

**🐛 修复广告牌切换跳过一张（v1.7.2b）**

- 症状：广告牌切换时偶发"从第 3 张直接跳到第 5 张、跳过第 4 张"——一次手势切了两张。
- 根因：`viewport` 上的 `pointerup` 轻扫监听（位移 >48px 即 `goTo(active±1)`）与 slide 的 `click` 监听（`goTo(i)`/打开查看器）叠加——鼠标点击带轻微位移（>48px）或触摸轻扫时，一次操作同时触发 pointerup 切换 + 浏览器合成 click 切换，两次 `goTo` 累计跳两张。
- 修复：轻扫仅对非鼠标指针（`event.pointerType !== 'mouse'`）启用——鼠标点击完全交给 `click` 只切一次；触摸/触控笔轻扫触发后置 `swipeLock` 标记，`click` 回调检测到该标记则吞掉合成 click（`pointerdown` 时重置）。
- 验证：`npm run build` 18 页成功；headless Chrome 虚拟时间采样确认自动轮播逐张（21s 采样 active 回到 0,即 5 次切换恰一轮）；`pointerType` 逻辑已进 bundle。
- 发布：提交 `d5f701f` 已推送，tag `v1.7.2b` + GitHub Release（README 更新日志新增 1.7.2b 条目）。

**🎠 独立收藏广告牌改焦点轮播 + 画廊图片圆角（v1.7.2）**

- `src/pages/gallery.astro`（主仓库）：广告牌从 scroll-snap 横向滚动改为**焦点轮播**——当前放映图居中放大 `scale(1.2)`（透明度 1、z-index 10），两侧图 `scale(0.82)` + `opacity 0.42` 弱化显示，`transform/opacity/filter` 560ms cubic-bezier 过渡动画；间距按焦点/相邻图布局宽度动态计算（`offsetWidth`,图片长宽比仍自适应,竖图横图均不裁切）。
- 交互：自动轮播 3.8s（悬停/聚焦/面板隐藏/`prefers-reduced-motion` 时暂停,`billboardGoNext` 注入 `resumeBillboard`）；点击两侧弱化图切换为焦点、点击焦点图打开大图查看器（查看器打开逻辑抽取为 `openGalleryViewer(button)` 供卡片/缩略图/广告牌共用,批量绑定改为 `[data-gallery-open]:not(.gallery-billboard-slide)`）；左右箭头、指示点跳转、触摸左右轻扫（>48px）切换保留。
- 关键细节：布局宽度必须用 `offsetWidth`（`getBoundingClientRect` 含 transform 缩放值会算错间距）；slide 绝对定位 `left:50%` + `translate(calc(±step - 50%), -50%) scale(...)` 保证缩放不干扰平移量；slide 高度 `calc(100%/1.2)` 使焦点图 1.2x 后恰好占满画布。
- `src/styles/global.css`（主仓库）：`.gallery-image-button`、`.gallery-album-thumb` 加 `border-radius: 8px`，`.gallery-billboard-slide` 加 `border-radius: 10px`（轻微圆角,`overflow:hidden` 生效）。
- 验证：`npm run build` 18 页成功；headless Chrome 实测——焦点 slide `scale(1.2)/opacity 1/z-index 10`、两侧 `scale(0.82)/opacity 0.42`、5 张 slide 中 is-active 唯一；`#independent` 下 12s 虚拟时间自动轮播从第 1 张切至第 4 张（dots `false,false,false,true`）；CSS bundle 三处圆角与 transition 均存在。
- 发布：提交 `2eaf8ad` 已推送，tag `v1.7.2` + GitHub Release（README 更新日志新增 1.7.2 条目）。

**🐛 修复 v1.7.0 画廊全部按钮失效（define:vars 内联导致 TS 语法残留）**

- 症状：`/gallery/` 页面脚本整体不执行——视图切换、排序、分页、广告牌、查看器全部按钮无响应，仅保持服务端渲染的默认状态。
- 根因：`<script define:vars={{ ... }}>` 会让 Astro 把脚本**原样内联输出、不做 TS 转译**（构建仍通过，因为 Astro 不校验内联脚本语法），产物中出现 `querySelector<HTMLButtonElement>`、`type GalleryOrder` 等 TypeScript 语法 → 浏览器 SyntaxError → 整个脚本中断。
- 修复：去掉 `define:vars`，改为独立数据标签 `<script type="application/json" id="gallery-pool" set:html={JSON.stringify(standaloneImages).replace(/</g, '\\u003c')}>` 注入数据，打包脚本内 `JSON.parse(...textContent)` 读取——脚本恢复正常打包/转译流程。
- **教训：凡含 TS 类型注解的 Astro `<script>` 禁用 `define:vars`**（它只适用于无类型的 `is:inline` 脚本）；注入数据一律走 JSON 标签。
- 验证：`node --check` 通过；模拟浏览器环境执行 bundle 无顶层抛错；headless Chrome 实测——分页器可见（24 张分 3 页、15 张 `is-off-page`）、广告牌 5 张 slide + 5 指示点、视图切换按钮状态正确。
- 发布：提交 `2ab12bc` 已推送，tag `v1.7.1` + GitHub Release（补丁版本，README 更新日志新增 1.7.1 条目）。

**🖼 图志页升级：文章图集视图、随文图像分页、独立收藏随机广告牌（v1.7.0）**

- `src/pages/gallery.astro`（主仓库）：随文图像面板新增 `时间线 / 文章图集` 视图切换条（`data-gallery-view`）。时间线视图按每页 9 张分页（`renderJournalPage`，分页器 `data-gallery-pager`，首末页按钮 disabled，FOLIO 编号跨页全局连续）；图集视图由 frontmatter 按 `sourceUrl` 分组（`journalGroups`）预渲染，朋友圈式版式——组头大标题 + 日期/张数 + 阅览全文链接，组内小缩略图按钮（复用 `data-gallery-open` 数据属性直接打开查看器）。
- 排序联动：`setGalleryOrder` 重置 `journalPage = 1` 后依次 `renderJournalPage()` + `reorderAlbums()`（图集组按与卡片相同的比较器重排并重编 FOLIO）。
- 独立收藏面板顶部新增广告牌（`buildBillboard`）：`define:vars` 注入 `standalonePool`，每次加载 Fisher–Yates 洗牌随机抽 5 张构建 scroll-snap 横向滚动条带；每张图高度固定、宽度按自身长宽比自适应；左右箭头、指示点（`getBoundingClientRect` 差值定位，图片 load 后刷新）、触摸滑动、自动轮播 4.2s；悬停/聚焦/面板隐藏（`selectGalleryTab` 联动 `pauseBillboard`/`resumeBillboard`）/`prefers-reduced-motion` 时暂停；点击打开查看器（含原图切换）。
- `src/styles/global.css`（主仓库）：新增 `.gallery-view-bar`、`.gallery-pager`、`.gallery-albums/.gallery-album/.gallery-album-thumb`、`.gallery-billboard` 全套样式与 640px 响应式适配。
- 验证：`npm run build` 18 页成功；dist 产物确认 8 个图集分组、24 个缩略图、standalonePool 注入；内置 review 审查 3 项修复（翻页 disabled、隐藏面板轮播暂停、dots 定位解耦）后二次复查通过。
- 提交：`9fa9f35`（功能），本次 `docs` 提交 + tag `v1.7.0` + GitHub Release。模板仓库未同步（自 v1.4.0 起模板停止跟进主仓库架构，README 历史条目中「模板同步发布」说法与实际不符，本次不再沿用）。

**💬 文章底部新增评论功能（Waline 同一后端，地区不可达时优雅降级）**

- `src/components/PostComments.astro`（新增，主仓库 + 模板）：文章页底部评论组件，复用留言页同一套 Waline 服务（`https://comment-sys-ashen.vercel.app`）与 B 站评论区视觉（独立 `pc-*` 类名，样式内联于组件，互不干扰）；`path` 取 `location.pathname`，按文章 URL 隔离评论。
- `src/pages/blog/[...id].astro`（主仓库 + 模板）：`article-endmark`（FINIS）之后、`</article>` 前引入 `<PostComments />`。
- **地区降级**：按用户要求不迁就大陆网络——fetch 带 8 秒 AbortController 超时，加载/提交失败一律显示「当前地区暂不支持评论」提示（附技术细节小字）；评论失败不影响正文阅读。
- 功能与留言页一致：300 字上限、昵称记忆（localStorage 与留言页共用键）、字母头像哈希取色、IP 属地标签、相对时间、`#N 楼`、分页加载更多、内容净化（剥离媒体/事件属性）；保留 `?server=` 覆盖参数便于本地 mock 联调。
- 打印样式：`@media print` 隐藏评论区，导出 PDF 不受影响。
- 验证：`npm run build` 19 页成功；headless Chrome + mock-waline 端到端三用例全过——列表加载（empty 状态）、发布评论后列表刷新含新评论、不可达服务显示「当前地区暂不支持评论」。

**🔗 关于页链接可跳转（静默推送，无 Release）**

- `src/pages/about.astro`（主仓库 + 模板）：新增通用 `linkify()` 函数——先做 HTML 转义（`& < > "`）再按 RFC 3986 URL 字符集识别 `http(s)://` 链接，转成 `<a target="_blank" rel="noopener noreferrer">`；仅识别 http/https（`javascript:` 等协议原样输出），尾部成对标点自动剥离。所有经管理面板可编辑的文本字段统一走此函数：身份表 `value`、开头段 `lead`、正文段落 `paragraphs`、引用 `quoteText`、关联网站 `note`——后续管理面板往任意字段粘贴链接都会自动可跳转。
- `src/styles/global.css`（主仓库 + 模板）：新增 `.dossier a` 链接样式（红色 `--red-dark` + 下划线 + hover 加深 + `word-break` 防长 URL 溢出）；`.interest-index li small a` 覆盖灰字显示链接色。引用标签 `span` 选择器改为 `.quote-label`，`quoteText` 拆为 `.quote-text` 块渲染。
- `admin/index.html`（主仓库 + 模板）：关联网站「备注」输入框 placeholder 改为「链接/备注（粘贴 http(s) 链接自动可跳转）」。
- 验证：`npm run build` 17 页成功；产物中 4 个关联网站均为可点击 `<a>`；linkify 单测 6 用例全过（XSS 转义、引号注入、中文标点剥离、协议白名单、多链接+查询参数、真实 B 站链接）。
- 提交：本次为静默推送，不打 tag、不发 Release（commit hash 见 `git log`）。

**🔤 文章页标题字号调小（静默推送，无 Release）**

- `src/styles/global.css`（主仓库 + 模板）：文章页大标题 `.article-header h1` 字号由 `clamp(2.8rem, 6.5vw, 5.5rem)`（最大约 88px）改为 `2rem`，与正文一级标题（`.prose h1` 默认 2em）同大；`max-width: 640px` 断点内的覆盖值同步由 `clamp(2.45rem, 14vw, 4rem)` 改为 `2rem`。
- 打印样式（`@media print`，25pt）为独立设计的 A4 档案版式，未改动。
- 验证：`npm run build` 通过；本地 dev 实测文章页标题与正文 `#` 一级标题字号一致。
- 提交：本次为静默推送，不打 tag、不发 Release（commit hash 见 `git log`）。

**🖼 头像自适应 + 压缩（v1.3.2）**

- `global.css`：`.portrait-placeholder.has-avatar` 去掉固定 4:5 比例与网格底纹，`img` 改为按原图比例完整显示（`max-width:100%; max-height:540px; object-fit:contain`），不再 cover 裁切；无头像时原样回退。
- `about.astro`（主仓库 + 模板）：头像 URL 走 `optimizeImageUrl()` 与文章图同一压缩管线（sharp WebP q78、>1920px 等比缩放）。实测 2500² 的 2.1MB JPEG → 164KB WebP；产物在 `public/image/opt/`（gitignore，Actions 构建时重新生成）。
- 提交：主仓库 `8c0311b`、模板 `fc63ca5`。
- 用户反馈背景：线上兴趣表并非空——`cea2633` 部署后兴趣被清空，`6f191d7` 已恢复并部署，用户看到的空表是浏览器缓存；需强制刷新。面板内编辑兴趣条目需重启管理面板（旧面板保存会再次清空）。

**🎬 文章内嵌流媒体视频（B站 / YouTube / 通用 iframe）**

- `admin/index.html`（主仓库 + 模板）：文章编辑器工具栏新增「▶ 视频」按钮，弹出对话框粘贴视频链接或嵌入代码，一键生成响应式 iframe 代码插入正文光标处；支持 B站完整链接（含 `?p=N` 分P、纯 BV 号）、YouTube（watch / youtu.be / shorts / live）、b23.tv 短链提示展开、以及官网 iframe 嵌入代码（自动提取 src 重建，丢弃事件属性）。
- 预览渲染器 `mdRenderVideo`：先保护围栏代码块（其中的 `<iframe>` 不提取），再提取正文 iframe 重建为干净标签（丢弃 `on*` 事件属性、拒绝非 http(s) src），其余文本沿用轻转义；`mdParse` 新增 `\u0000K` / `\u0000V` 占位符块级分支。
- `src/styles/global.css`（主仓库 + 模板）：新增 `.prose iframe` 响应式样式（`width:100%` + `aspect-ratio:16/9` + `height:auto` 覆盖 B站嵌入代码的固定高度），移动端不溢出；管理面板预览同步加 `.markdown-preview .video-embed` 样式。
- 使用方式：文章 Markdown 正文直接写 `<iframe src="...">`（satteri 原样保留），或管理面板「▶ 视频」按钮自动生成；B站推荐 `player.bilibili.com/player.html?bvid=…` 播放器地址。
- 安全加固：预览只提取「闭合完整」的 iframe（未闭合回退为文本显示，不吞正文）；重建标签丢弃 `on*` 事件属性、src 限 http(s)；`mdInline` 捕获组排除 `\u0000` 占位符防止属性注入；`buildVideoEmbed` 对粘贴的 iframe 同样校验协议白名单；重建 iframe 补 `title` 无障碍属性。
- 验证：27 项函数单测全过（含 XSS、未闭合 iframe、属性注入、连续多 iframe 用例）；`npm run build` 16 页成功；临时文章端到端构建产物含完整 iframe；管理面板冒烟测试 /admin 与 /api/posts 均 200。

最后更新：2026-08-02（文章底部评论）

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
HEAD: d21ff97 新增留言页（Waline 后端，B站评论区版式）并收尾图志功能
origin/main: d21ff97 已推送（970e9e1..d21ff97）
线上：/guestbook/ 已部署，Waline 服务 https://comment-sys-ashen.vercel.app 已接入（默认地址已写死）
工作区：
  ?? reasonix.toml              ← 未跟踪（Reasonix 配置，不提交）
  M admin/index.html           ← 本次：文章编辑实时 Markdown 预览
  M AGENT_HANDOFF.md           ← 本次推送记录
  M docs/WALINE_DEPLOY.md      ← 先前遗留未提交改动（非本次）
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

### 2026-08-01（关于页纳入管理）

**📄 「关于」页全部文本与头像纳入管理系统编辑**

- **文件**：`src/data/about.json`（新增）、`src/pages/about.astro`、`src/styles/global.css`、`admin-server.mjs`、`admin/index.html`
- 关于页内容从硬编码改为数据源 `src/data/about.json`（沿用画廊 `gallery.json` 模式）：眉题 / 大标题 / 副标题 / 身份档案表（动态行）/ 开头段 / 正文段落（多行）/ 引用标签与内容 / 兴趣列表标题与条目（动态行）全部可编辑；字段缺失时页面有默认兜底。
- 原先的书本标记区域（`ArchiveSeal` + ACR）改为可编辑头像：`about.avatar` 有值时显示全幅 `img`（`object-fit: cover`，`.has-avatar` 隐藏网格装饰层、保留外框作相框），为空时回退书本标记。
- 管理面板新增「关于」模式：头像拖放/点击/URL 导入上传（复用 `/api/upload`）带实时预览，身份表与兴趣条目支持「＋ 添加」与逐行删除；`Ctrl+S` 保存。
- 后端新增 `/api/about` GET/PUT（数组字段以 JSON 字符串传输，`parseJsonArray` 解析；清洗后与旧数据 merge 保证结构完整）；「推送」的 `git add` 加入 `src/data/about.json`，头像文件本身在 `public/image/` 已覆盖。
- 验证：`node --check` 通过；node fetch 实测 GET/PUT/再 GET 全链路 UTF-8 中文完好（curl 在 Windows 会转 GBK，不可用）；`npm run build` 15 页成功，`dist/about/index.html` 分别实测有头像（`has-avatar` + `<img>`）与无头像（书本标记回退）两种渲染。

**🐛 修复（v1.3.1）：关于页保存时身份表与兴趣列表被静默清空**

- 根因：`saveAbout()` 的 `collect` 用 `.label`/`.value`/`.index`/`.name`/`.note` 选择器，但行输入框类名是 `ai-*` 前缀，匹配不到 → 整表清空。用户全量推送提交 `cea2633` 中 `identity: []`、`interests: []` 即此 bug 所致。
- 修复：collect 改为「提交键名 → 类名」映射（`[['label','ai-label'],...]`），主仓库 `6f191d7`、模板 `9e3ada1` 同步修复；新增回归测试 `/tmp/collect-test.mjs`（vm 执行 `aboutRowTemplate` 源码 + 类名匹配模拟，验证渲染→收集闭环）。
- 数据恢复：`src/data/about.json` 从 `3225a93` 恢复 identity（5 行）/ interests（4 行），保留用户修改（avatar、lead、interestsTitle）；线上 `/about/` 实测恢复。
- 提醒：管理面板需重启加载修复后的 `admin/index.html`；旧版面板在修复前保存会再次清空表格。

**🚀 发布 v1.3.0（双仓库 + Release）**

- 主仓库 `AnAcretiondisk9986/AnAcretiondisk9986.github.io`：提交 `3225a93`（功能）+ `8da0da8`（同步 blog-template 指针），tag `v1.3.0` 已推送；README.md（更新日志）顶部新增 1.3.0 条目。
- 模板仓库 `AnAcretiondisk9986/blog-template`：同步 `admin-server.mjs`、`admin/index.html`（保留模板占位 `<title>` 与 `btnSite` 的 `your-username.github.io`）、`src/styles/global.css`（差异仅头像样式）、`src/pages/about.astro`（与主仓库同构），新增 `src/data/about.json`（占位文案：记录名「你的名字」、兴趣「待补充」）；提交 `610953d`，tag `v1.3.0` 已推送。模板构建 7 页成功。
- GitHub Release（均非草稿，notes 引用 1.3.0 更新日志）：
  - https://github.com/AnAcretiondisk9986/AnAcretiondisk9986.github.io/releases/tag/v1.3.0
  - https://github.com/AnAcretiondisk9986/blog-template/releases/tag/v1.3.0

### 2026-07-31（编辑实时预览）

**✍ 管理面板文章编辑新增 Markdown 实时预览（含图片）**

- **文件**：`admin/index.html`
- 正文编辑区改为「编辑 / 分屏 / 预览」三态视图（默认分屏，选择记忆在 localStorage `admin-editor-view`）：分屏时左侧源码右侧实时渲染，纯预览模式仅渲染结果。
- 输入防抖 150ms 实时渲染；图片上传、外部 URL 导入、粘贴插入 Markdown 后自动刷新预览。
- **零依赖手写 Markdown 渲染器**（延续项目无依赖风格）：标题、粗体/斜体/删除线、行内代码、围栏代码块（带语言标注）、引用（支持嵌套）、无序/有序列表（支持缩进嵌套、任务列表 `- [x]`）、表格（含对齐）、分割线、图片、链接、自动链接。图片输出 `<img loading="lazy">`，本地 `/image/` 由 admin-server 静态托管可直接显示。
- 安全：文本层轻转义（`&`、`<`）保留 `>`/`"` 不破坏结构语法，输出到 HTML 属性时单独转义引号（`mdAttr`），`<script>` 与属性注入均不可执行。
- 细节修复：斜体 `_` 正则加单词边界，避免误伤文件名下划线（如 `31_16-45-36_`）；代码块去除末尾换行；admin 页补 `<link rel="icon">` 消除 favicon 404。
- 验证：渲染器 23 项断言单测全过（含 XSS 用例）；headless Chrome 端到端实测：打开文章默认分屏、实时渲染标题/加粗/斜体/代码/图片/列表/引用、真实图片加载成功、三态切换、画廊↔文章模式往返、插入图片后预览自动刷新，页面 0 JS 错误；`npm run build` 13 页成功。

**🐛 修复：编辑器无法纵向滚动、Markdown 预览区不可滚动**

- **文件**：`admin/index.html`
- **根因**：`#editorContainer` 是非 flex 普通 div，`.editor{flex:1;overflow-y:auto}` 因父容器非 flex 而失效——编辑器高度随内容增长，超出 `.main`（`overflow:hidden`）被裁剪，整页无法纵向滚动、正文区被挤到可视区下方；正文 `editor-wrap` 的 `min-height:auto` 又取预览渲染内容高度（max-content），把预览区撑到与内容等高，`overflow-y:auto` 永不触发。
- **修复**：`#editorContainer{flex:1;display:flex;flex-direction:column;min-height:0}` 使 `.editor` 参与 flex 布局并撑满剩余高度；`.editor-wrap{min-height:300px}` 覆盖 `min-height:auto`，让 flex 分配主导、预览区高度受容器约束。
- **验证**：headless Chrome 实测——矮窗口（500px）编辑器整体滚动且滚动后正文可见、正常窗口（900px）正文区占满无整体滚动、预览区（382px 视口 vs 2929px 内容）内部滚动生效、仅预览模式同样可滚动、画廊矮窗口表单可滚动，0 错误；`npm run build` 13 页成功。

### 2026-07-31（文章导出 PDF）

**📄 文章页新增「导出 PDF」：A4 档案版式打印样式**

- **文件**：`src/pages/blog/[...id].astro`、`src/styles/global.css`
- 文章侧栏新增「⤓ 导出 PDF」按钮（档案红描边样式，移动端占整行），点击触发 `window.print()`，浏览器「另存为 PDF」即可导出——不引入任何依赖，文字矢量可选、无中文乱码问题。
- 打印版式（`@media print`，A4）：
  - 页眉页脚用 `@page` margin boxes（Chrome/Edge/Safari 支持，Firefox 优雅降级）：左上站点名、右上 FOLIO 编号（文章页注入）、左下文章 URL、右下「第 X 页 · 共 Y 页」；`@page` 嵌套 at-rule 需用 `<style is:inline>` 绕过 lightningcss 压缩器。
  - 侧栏化为四栏「档案登记条」（条目编号/分类标签/记录者/状态）置于标题上方；隐藏站点导航、页脚、纸张纹理、按钮。
  - 强制浅色配色（覆盖暗色主题变量，暗色模式下打印仍是米白纸面），`print-color-adjust: exact` 保留品牌红金装饰；首段首字下沉、§ 章节标记、FINIS 结束标记保留。
  - 分页控制：标题 `break-after: avoid`，图片/代码块/引用/表格/列表项/结束标记 `break-inside: avoid`，段落 `orphans/widows: 3`；图片去除屏幕滤镜原样输出。
  - 正文外链自动附注完整 URL（`a::after`），便于纸面溯源；代码块白底红条、表格合并边框。
- 验证：`npm run build` 12 页成功；headless Chrome 实测导出 3 篇：`social-paper` 6 页（页眉页脚/页码/登记条齐全）、`healthcn2030` 5 页（外链附注正常）、`apurupai` 6 页（4 张大图各占一页、FINIS 与结束标记同页）；暗色模式（--force-dark-mode）打印背景仍为 #FFFDF6。

### 2026-07-31（全量推送按钮）

**⬆ 管理面板新增「全量推送」，与内容推送区分**

- **文件**：`admin-server.mjs`、`admin/index.html`
- 原「推送」仅 `git add src/content/blog/ public/image/ src/data/gallery.json`（内容文件，不含代码）；新增「全量推送」`git add -A` 并排除 `reasonix.toml`，提交信息「通过管理面板全量推送」与内容推送（「通过管理面板更新博客」）区分。
- 后端将推送流程抽为 `pushGitChanges({ stageCmd, commitMsg })` 共用函数，`/api/push` 与 `/api/push-full` 两个端点复用；错误处理（网络失败区分）保持一致。
- 前端侧边栏工具栏新增琥珀色「⬆ 全量推送」按钮（toolbar 加 `flex-wrap` 防挤压），tip 栏更新为「推送=内容 / 全量推送=含代码」。
- 验证：`node --check` 与前端脚本语法通过；实测 `/api/push` 无内容改动时报「没有需要推送的更改」；`/api/push-full` 将本轮代码改动提交为 `22356ae` 并成功推送（`git show` 确认仅含 admin-server.mjs + admin/index.html，reasonix.toml 未被纳入）。

### 2026-07-31（日内索引号 dayIndex）

**🔢 同日条目增加发表顺序索引号**

- **文件**：`src/content.config.ts`、`src/data/gallery.json`、`src/pages/gallery.astro`、`src/pages/blog/index.astro`、`src/pages/index.astro`、`src/pages/blog/[...id].astro`、`admin-server.mjs`、`admin/index.html`、`_templates/blog-post.md`、6 篇博客 frontmatter
- 博客 schema 新增可选 `dayIndex`（同一天内的发表顺序，1 = 当天第一篇）；模板已加默认值，6 篇现有文章按 git 首次提交时间推导写入（07-30：HealthCN2030=1、social-paper=2、write-SKILL=3；07-31：论文代写=1、apurupai=2、观梦限大=3）。
- 画廊「从新至旧/从旧至新」的同日第二排序键从「初始位置」改为 `dayIndex`；卡片新增日内序号标签 `D.03/05`；独立收藏 6 条已按 `id` 内嵌毫秒时间戳推导 dayIndex（07-31：Yuri=1、ui=2、洁尔佩塔=3、Amiya=4、小羊=5）。
- 博客目录页与首页同日排序改用 dayIndex（缺省按文件名兜底）；目录页同日多篇时日期旁显示 `DAY 02`，首页显示 `· #02`；文章详情页条目编号在同日多篇时带序号（如 `2026—0731—03`）。
- 管理面板：文章与画廊表单新增「同日序号」输入框（留空自动推导为同日最大 +1），列表 meta 显示 `#N`；`GET /api/posts` 排序同步加入 dayIndex。
- 验证：`npm run build` 12 页成功；API 实测新建自动推导 / 手动修改 / 清空重推导 / 删除全部通过（node fetch 实测，curl 在 Windows 下会转 GBK 不可用）。

**🔄 主页与卷册目录页新增「从新至旧 / 从旧至新」切换**

- **文件**：`src/scripts/order-toggle.ts`（新增，两页共用）、`src/pages/index.astro`、`src/pages/blog/index.astro`
- 与画廊同一套控件样式（`.gallery-order-bar` 复用）；排序键：日期 → `dayIndex` → 初始位置兜底；`?order=oldest` 记忆状态；条目 FOLIO 编号随排序重编（目录页 2 位、首页 3 位），同日序号 `DAY NN` / `· #NN` 不随排序变化。
- 验证：`npm run build` 12 页成功；node 模拟比较器实测从旧至新为从新至旧的完全反转。
- **部署备注**：管理面板「推送」仅 `git add src/content/blog/ public/image/ src/data/gallery.json`（内容文件），**不包含页面代码**——用户推送 dayIndex 数据后线上无变化即因此。本次代码改动已手动提交 `59b4eed` 并 push（SSH），线上由 Actions 重新构建部署。

### 2026-07-31（推送与线上接入）

- 提交 `d21ff97` 已推送至 `main`（含留言页 + 图志遗留改动，12 文件 +1495/-26），pre-commit 构建通过。
- Waline 服务部署于 `https://comment-sys-ashen.vercel.app`（Vercel + Neon PostgreSQL），存储已验证（测试留言含 IP 属地解析）。
- `DEFAULT_SERVER` 已写死进 `src/pages/guestbook.astro`；线上 `/guestbook/` 已部署验证（导航含「V 留言」）。
- 国外 IP 属地按 ip2region 省级字段显示（如「伦敦」），与用户确认保持 Waline 默认行为。

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
