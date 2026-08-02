# Acretiondisk Blog — 更新日志

> 使用 Astro 构建的个人博客，部署到 GitHub Pages（`https://anacretiondisk9986.github.io/`）。
> 当前版本：**2.1.0**（2026-08-02）

---

## 2.0.0-macOS（2026-08-02）

### 🍎 macOS 适配：双端一致运行，开箱即用

- **新增 macOS 双击启动器**（与 Windows `启动管理面板.bat` 等价）：仓库根目录新增 `启动博客管理面板.command`（管理后台）与 `启动博客预览.command`（本地预览），macOS 下双击即可运行，自动进入仓库目录并启动服务；终端 `Ctrl+C` 停止。
- **修复 `.githooks/pre-commit` 的 Windows 专属命令**：构建保护脚本由 `npm.cmd run build` 改为跨平台的 `npm run build`，此前 macOS/Linux 上提交会因找不到 `npm.cmd` 直接失败，现已双端可用。
- **macOS 运行方式**（与 Windows 逻辑完全一致，仅启动入口不同）：
  - 管理面板：`npm run admin` → `http://localhost:4322/admin`（或双击 `启动博客管理面板.command`）
  - 本地预览：`npm run dev` → `http://localhost:4321`（或双击 `启动博客预览.command`）
  - 部署不变：`git push origin main` 自动触发 GitHub Actions 构建并发布到 GitHub Pages
- **前置要求**：macOS 上安装 Node.js ≥ 20 与 Git 即可，无任何 Windows 专属依赖；管理面板上传的图片、Obsidian 写作、Waline 留言等功能与 Windows 端行为一致。

---

## 2.1.0（2026-08-02）

### 🔄 管理面板新增 Git 同步：启动自动比对 + 手动拉取

- **启动时自动比对**：管理面板启动时自动 `git fetch` 并与远端比对——本地与远端存在版本差异时自动拉取同步（快进合并，不产生 merge 提交）；无差异则忽略，不做任何操作。
- **手动拉取**：侧边栏工具栏新增「⇩ 拉取」按钮（位于「推送」左侧），随时手动拉取远端最新内容，拉取成功后自动刷新当前文章 / 画廊列表。
- **安全护栏**：仅当「远端领先、本地无未推送提交、工作区干净」可安全快进时才自动拉取；若本地有未推送的提交（含分叉）或工作区有未提交更改，自动跳过并打印原因，避免覆盖未推送内容或制造冲突——相关场景在 Windows / macOS 双端行为一致。
- 自动比对不阻塞面板启动：网络异常（无法连接 GitHub）时仅提示稍后可在面板手动「拉取」，服务器照常启动。
- 启动器等价说明：Windows `启动管理面板.bat` 与 macOS `启动博客管理面板.command` 启动后均会执行上述自动同步。

---

## 1.7.2b（2026-08-02）

### 🐛 修复：广告牌切换跳过一张（1.7.2 回归）

- 症状：独立收藏广告牌切换时偶发「从第 3 张直接跳到第 5 张、跳过第 4 张」——一次手势切了两张。
- 根因：`viewport` 上的触摸轻扫监听（位移 >48px 即切换）与图片的 `click` 监听叠加——鼠标点击带轻微位移或触摸轻扫时，一次操作同时触发轻扫切换 + 浏览器合成 click 切换，两次切换累计跳两张。
- 修复：轻扫仅对触摸 / 触控笔（`pointerType !== 'mouse'`）启用，鼠标点击完全交给 `click` 只切一次；触摸轻扫触发后置锁标记吞掉随后的合成 click。
- 验证：headless Chrome 虚拟时间采样确认自动轮播逐张（21 秒恰轮完一圈回到第 1 张）。

## 1.7.2a（2026-08-02）

### 🖼 管理面板画廊上传优化：原图自动归档 + 未填标题用文件名补全

- **原图归档，恢复「查看原图」**：管理面板图片上传 / URL 导入时，原图（png/jpg/jpeg）自动归档到图片仓库 `image/original/`，接口返回 `originalUrl`；画廊编辑器新增「原图地址 (original)」字段并在上传后自动填入。此前上传即转 WebP、原图被直接丢弃，导致新上传的独立收藏没有 `original` 字段，「加载原图」按钮失效（旧的 6 张原图是迁移时手动从 git 历史恢复的）；本次修复后新上传的图自动带原图，查看器可正常切换原图 / 压缩版。
- **标题自动补全**：画廊上传图片时若未填标题，自动用图片文件名（去掉扩展名）填入，如 `IMG_2024.JPG` → `IMG_2024`、`photo.webp` → `photo`。
- 画廊查看器无需改动：「加载原图 / 已显示原图」按钮按 `original` 字段自动显隐；手动改图源或旧图仍可在管理面板「原图地址」栏补填。
- 模板仓库同步（`blog-template` 管理面板同步更新）。

## 1.7.2（2026-08-02）

### 🎠 独立收藏广告牌改为焦点轮播，画廊图片外框加轻微圆角

- **焦点轮播**：当前放映图居中放大至 1.2 倍成为焦点（透明度 1、最上层），两侧图片缩小至 0.82 倍并弱化（透明度 0.42、饱和度/亮度降低），`transform/opacity/filter` 以 560ms 缓动曲线平滑过渡。
- **自动播放**：每 3.8 秒自动切换下一张；悬停、聚焦、切到其他标签页、系统开启「减弱动态效果」时自动暂停。
- **交互**：点击两侧弱化图直接切换为焦点、点击焦点图打开大图查看器；左右箭头、底部指示点、触摸左右轻扫均可切换。
- 图片长宽比保持自适应——间距按焦点图与相邻图的实际布局宽度动态计算，竖图/横图均不裁切。
- **圆角**：时间线卡片与文章图集缩略图外框 `border-radius: 8px`，广告牌 `border-radius: 10px`。

## 1.7.1（2026-08-02）

### 🐛 修复：图志页全部交互失效（1.7.0 回归）

- 症状：`/gallery/` 页面脚本整体不执行——视图切换、排序、分页、广告牌、大图查看器全部按钮无响应，仅保持服务端渲染的默认状态。
- 根因：1.7.0 使用 `<script define:vars>` 注入独立收藏数据，该指令使 Astro 将脚本原样内联输出且**跳过 TypeScript 转译**（构建不报错，因为 Astro 不校验内联脚本语法），产物残留 `querySelector<HTMLButtonElement>` 等类型语法，浏览器解析 `SyntaxError` 导致整个画廊脚本中断。
- 修复：改用独立 JSON 数据标签（`<script type="application/json" id="gallery-pool">`）注入数据，脚本恢复正常打包转译；headless Chrome 实测分页（24 张分 3 页）、广告牌（随机 5 张 + 指示点）、视图切换均正常。

## 1.7.0（2026-08-02）

### 🖼 图志页升级：文章图集视图、随文图像分页、独立收藏随机广告牌

- **随文图像新增「文章图集」视图**：面板顶部新增 `时间线 / 文章图集` 切换条，两种展示方式可随时切换。图集视图为朋友圈式版式——按文章分组，每组大标题 + 日期/张数 + 阅览全文链接，下方一排小缩略图（带组内序号），点击缩略图直接打开大图查看器。
- **时间线视图分页**：随文图像每页最多展示 9 张，底部 `← 页码/总页数 →` 翻页器，首末页按钮自动置灰；FOLIO 编号跨页保持全局连续。
- 排序（从新至旧 / 从旧至新）与两种视图完全联动：切换排序后分页重置回第一页，图集分组顺序同步重排并重编 FOLIO。
- **独立收藏新增「广告牌」**：面板顶部横向滚动条带，每次加载从收藏中 Fisher–Yates 随机抽取 5 张；每张图按自身长宽比自适应（高度固定、宽度按比例，不裁剪），支持左右箭头、指示点跳转、触摸滑动，悬停/聚焦/切走标签页时自动暂停轮播（尊重 `prefers-reduced-motion`），点击图片打开查看器（独立收藏含原图可切换）。
- 移动端适配：切换条纵向堆叠、缩略图两列、广告牌高度压缩。

## 1.6.0（2026-08-02）

### 💬 文章页底部新增评论功能（Waline 同一后端，地区不可达时优雅降级）

- 文章页正文底部（FINIS 之后）新增评论区，与留言页共用同一套 Waline 评论服务（`https://comment-sys-ashen.vercel.app`），评论按文章 URL 隔离；视觉沿用留言页的 B 站评论区版式（字母头像哈希取色、昵称、IP 属地、相对时间、楼层号）。
- **地区降级**：不迁就大陆网络——请求带 8 秒超时，加载/提交评论失败一律显示「当前地区暂不支持评论」提示，不影响正文阅读；导出 PDF 时评论区自动隐藏。
- 功能与留言页一致：300 字上限、昵称记忆、分页加载更多、内容净化（剥离图片/脚本/事件属性）；保留 `?server=` 参数覆盖服务地址，便于本地 mock 联调。
- 模板仓库同步发布（`blog-template` v1.6.0）。

## 1.5.0（2026-08-02）

### 🖼 图片迁移至独立图床仓库（blog-images + jsDelivr CDN）

- 新建独立公开仓库 `AnAcretiondisk9986/blog-images` 专门存储图片，博客仓库不再保留 `public/image/`：31 张原图 41MB 压缩为 WebP 后仅 2.9MB 出库，仓库瘦身、clone 更快。
- 文章 / 头像 / 画廊图片引用全部改为 jsDelivr CDN 外链（`https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/*.webp`），境内访问走 jsDelivr 国内节点，速度优于 github.io，且图片不再占用 Pages 带宽。
- 管理面板图片上传 / URL 导入改造：图片自动写入本地 `../blog-images/image/`，png/jpg/jpeg 转 WebP（quality 78、超 1920px 缩放）后 git 推送图片仓库，返回 jsDelivr 外链；「内容推送」不再包含图片（图片在各自上传时已单独推送）。
- 迁移脚本保留于 `scripts/migrate-images.mjs`、`scripts/replace-image-refs.mjs` 供复用。
- 构建期压缩插件 `src/plugins/optimize-images.mjs` 已随本次清理移除：图片全部外链后「预览压缩图 / 点开原图」双层机制失去意义（线上只有一份 WebP，平均 96KB/张），gallery / about 直接引用外链 src，构建不再依赖 sharp。
- 注意：上传/推送图片仓库走 SSH（HTTPS 直连 GitHub 会被重置）；jsDelivr 首次访问从 GitHub 拉取后缓存，更新同名文件需访问 `https://purge.jsdelivr.net` 强制刷新。

## 1.4.0（2026-08-02）

### 🎬 文章内嵌流媒体视频播放器（B站 / YouTube / 通用 iframe）

- 文章 Markdown 正文可直接写 `<iframe>` 嵌入视频播放器（satteri 原样保留），页面端新增 `.prose iframe` 响应式样式（16:9 比例、宽 100%、`height:auto` 覆盖 B站嵌入代码的固定高度），移动端不溢出。
- 管理面板文章编辑器工具栏新增「▶ 视频」按钮：粘贴 B站视频链接（含 `?p=N` 分P、纯 BV 号）、YouTube 链接（watch / youtu.be / shorts / live）、或任意视频网站官网 iframe 嵌入代码，一键生成响应式嵌入代码插入正文光标处；b23.tv 短链接提示先展开。
- 编辑器实时预览同步支持 iframe 渲染：仅提取闭合完整的 iframe（未闭合回退为文本显示，不吞正文）、重建标签丢弃 `on*` 事件属性、src 限 http(s) 协议、围栏代码块内的 `<iframe>` 不误提取；YouTube 嵌入走 `youtube-nocookie.com` 隐私域名。
- 模板仓库同步发布（`blog-template` v1.4.0）。

## 1.3.2（2026-08-01）

### 🖼 关于页头像：按原图比例自适应 + 接入 WebP 压缩管线

- 头像不再被强制裁剪进 4:5 相框（`object-fit: cover`），改为按上传图片的原始宽高比完整显示（`max-width: 100%` / `max-height: 540px`），方形、横图、竖图均不失真；有头像时隐藏网格底纹与装饰框，保留外边框作相框。
- 头像接入与文章图片相同的压缩管线（`optimizeImageUrl` → `sharp` WebP quality 78、超 1920px 等比缩小）：实测 2500×2500 的 2.1MB JPEG 压缩为 164KB WebP（约 12.6 倍），构建时生成于 `/image/opt/`，非生产构建自动回退原图。

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
- Git 远程切换为 SSH（ED25519，走 22 端口）；Windows 双击 `启动管理面板.bat`、macOS 双击 `启动博客管理面板.command` 一键启动 + 自动打开浏览器。

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

`npm run admin` → `http://localhost:4322/admin`（Windows 双击 `启动管理面板.bat`，macOS 双击 `启动博客管理面板.command`）

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
