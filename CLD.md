# CLD.md — 前端重写「HORIZON / 视界」更改日志与交接文档

> 这是一份**长期任务**的唯一交接文档。任何接手的 agent / 人，请先读完本文件再动手；
> 每次改动结束后，在「更改日志」顶部追加一条，并更新「当前状态」与「待办」。

---

## 0. 任务定义（来自站长原话）

> 全面、推翻重来地、极具创新地、极度风格化地重写个人博客的全站前端界面。
> 不要拿现有的方案做参考，就是要做差异化。

约束（我自己定的，保证「推翻视觉」不等于「推翻功能」）：

- **只重写前端表现层**：`src/layouts`、`src/components`、`src/pages`、`src/styles`、`src/scripts` 的界面部分。
- **不动数据契约**：`src/content.config.ts`、`src/data/*.json`、`admin-server.mjs`、`admin/`、`scripts/`（构建脚本）、内容 Markdown。
- **功能全部保留**：授权级 / 管理员级文章门禁、分享短链 `/s/<code>`、不蒜子阅读数、导出 PDF、音乐播放条、
  CDN 镜像降级、图像查看器（缩放 / 原图）、额度页与定价页的数据逻辑。

---

## 1. 设计概念：HORIZON（视界）

站名 **Acretiondisk = accretion disk（吸积盘）**。整站被设计成一台「观测黑洞的仪器」：

| 概念 | 落地 |
| --- | --- |
| **黑洞本体** | 首页首屏是**实时 WebGL 光线追踪的史瓦西黑洞**（引力透镜 + 多普勒增亮的吸积盘）。后台配置的首屏图 `stillHeroImage` 不再是背景图，而是被黑洞**引力透镜扭曲的天空**。向下滚动 = 相机向视界下潜。 |
| **仪器取景器 HUD** | 全站四角裁切标 + 固定读数：左下光标坐标 / 下潜深度，右下 UTC 时钟 + MJD（修正儒略日）。导航是右上角的编号通道。HUD 用 `mix-blend-mode: difference`，压在任何画面上都可读。 |
| **时间 = 红移** | 每篇文章都有 MJD 时间戳和「红移 z」（按发表距今的天数）。越旧的文章标题越偏红、越暗——**时间线被做成了光谱**。 |
| **文章目录 = 光谱仪** | `/blog/` 顶部是一条「光谱带」：每篇文章是一条谱线，横坐标是时间，高度是字数（质量）。与下方列表双向联动高亮。 |
| **图像 = 引力透镜场** | `/gallery/` 默认是一个**无限平铺、可拖拽的透镜场**：越靠近视野中心的图越大（鱼眼），中心有锁定准星。另有「索引」模式供键盘 / 读屏使用。 |
| **明暗 = VOID / PLATE** | 暗色「VOID」是默认。亮色「PLATE」是**照相底片**：首页黑洞画布整体反相，成为一张负片。 |

### 视觉语言

- 色：近黑 `#08080b` / 暖白 `#ece7dc` / **唯一强调色「等离子橙」`#ff5a1a`**；蓝移蓝 `#8fb3ff`、红移红 `#c2361b` 只用于数据语义。
- 字：
  - 展示：**Unbounded**（宽体几何，OFL，自托管 `public/fonts/unbounded-latin.woff2`，只含拉丁）+ 系统粗黑体兜中文；
  - 读数：**JetBrains Mono**（已有 `public/fonts/jetbrains-mono.woff2`）；
  - 正文：系统无衬线（PingFang / Noto Sans SC / 微软雅黑）。
- 线：全站只有 1px 发丝线，没有圆角卡片、没有阴影、没有玻璃拟态。
- 动：跨页使用**原生跨文档 View Transitions**（`@view-transition { navigation: auto }`），不再用 Astro `ClientRouter`——
  每页脚本都是普通的「加载即执行」，不需要 `astro:page-load` / `data-astro-rerun` 那一套。

---

## 2. 文件地图（新）

```
src/
  layouts/BaseLayout.astro         ← 全站外壳（重写；Props 与旧版兼容：title/description/bodyClass）
  components/hz/
    Hud.astro                      ← 顶部品牌 + 编号导航 + VOID/PLATE 切换 + 全屏菜单 + 四角读数
    Foot.astro                     ← 页脚（SVG 撑满全宽的巨型字标）
    PostRow.astro                  ← 文章行（首页 / 目录 / 私密目录共用）
    EntryView.astro                ← 文章阅读视图（公开 / 授权 / 私密 三种模式共用）
    Gate.astro                     ← 门禁「气闸」（授权：答网名；私密：SHA-256 口令）
  lib/horizon.ts                   ← MJD / 红移 / 字数 / 阅读时长 / 编号 / 封面 等纯函数
  styles/hz/
    tokens.css  base.css  shell.css  prose.css
    home.css  log.css  entry.css  gallery.css  about.css  misc.css
    legacy-bridge.css              ← 仅额度页 / 定价页引入：把旧 token 名映射到新色板
  scripts/hz/
    shell.ts                       ← 主题切换、菜单、HUD 读数（时钟 / MJD / 光标 / 深度）
    disk.ts                        ← 首页 WebGL 黑洞（自适应分辨率、离屏暂停、降级）
    lens.ts                        ← 文章行悬停时跟随光标的圆形封面「透镜」
    spectrum.ts                    ← /blog/ 光谱带 + 搜索 / 标签 / 排序
    entry.ts                       ← 目录、阅读进度、代码复制、表格滚动、短链、阅读数
    gate.ts                        ← 门禁逻辑
    gallery-field.ts               ← 透镜场 + 索引 + 查看器
```

仍在使用的旧文件（功能性，不属于视觉层）：`src/lib/{posts,post-cover,shortlink,safe-link,gallery,icons}.ts`、
`src/scripts/{cdn-fallback,song-player,ai-quota,pricing-sort}.ts`、`src/styles/{ai-quota,pricing}.css`。
（注意：`src/scripts/ai-quota.ts` 末尾补充了 `DOMContentLoaded`/就绪自启动，以兼容原生 MPA 跨文档 View Transitions，同时保留 `astro:page-load`。）

---

## 3. 当前状态

- **Phase 1.3（新增 `/academics/`「学业」二级页：纵向连续课程拼贴墙与原地翻转卡片）已完成构建与视觉复检**：
  - 在 [Hud.astro](src/components/hz/Hud.astro) 顶栏接入 `05 学业（TRAJECTORY）`，将 `额度` 顺延至 `06`；
  - 新增结构化课程数据 [academics.json](src/data/academics.json)（99 门去重课程 + 大四「医院见习」/ 大五「医院实习」巨型阶段方块，覆盖原·信息管理与信息系统大一至临床医学五年制全周期，预留 `grade` 字段）；
  - 在 [academics.ts](src/lib/academics.ts)、[academics.astro](src/pages/academics.astro)、[academics.css](src/styles/hz/academics.css) 与 [academics.ts](src/scripts/hz/academics.ts) 实现两段轨道的纵向连续无缝拼接（无学期分割线，中间以 `── 转专业 ──` 细线隔开），卡片正面仅展示课程名与学分，点击卡片在原地 3D 翻转为开课部门与成绩（未录入显示 `NULL`）。
- **Phase 1.2（字体体系收敛：Noto Sans/思源宋体 + Anthropic Fonts System + 溢出修复）已完成构建、视觉复检与推送**：
  - 中文严格限定为自托管 `Noto Sans SC`（400/700）与 `Noto Serif SC / 思源宋体`（600），已删除站酷黄油/小薇/马善政/霞鹜文楷等非 Noto 中文字体分片；
  - 英文主力全面采用站长提供的 `Anthropic Sans`、`Anthropic Serif`、`Anthropic Mono`（含全字重与斜体，沿用 `public/fonts/anthropic-*.woff2`）+ `JetBrains Mono`；`Unbounded` 收敛至品牌标、巨型页脚与序号；日文仅在 `[lang="ja"]` 徽标保留 `DotGothic16`；
  - 克制收敛衬线占比至引用、副标斜体、尾注与首字下沉等点缀位置；修复 `Syne` 等宽体英文在混排标题中溢出容器的问题。

## 4. 待办 / 已知问题

1. **旧版冗余表现层文件待清理**：原版旧样式（`src/styles/{global,home,home-cinematic,folio,...}.css`）、旧组件（`src/components/{AboutTeaser,PostCatalog,...}.astro`）及旧页面脚本（`src/scripts/{appearance,header-bar,home-cinematic,...}.ts`）目前未再被页面引入（不进入 `dist/` 构建产物），待站长确认新视觉方向后再统一归档或删除。
2. **旧验证脚本与 `admin` 前端预览联动**：`scripts/verify-*.mjs` 中的部分历史视觉回归脚本仍检查旧类名（如 `.f-hero`）；若后续长期沿用 HORIZON，可按新 DOM 钩子重编回归脚本；另可考虑在 `admin/` 面板的「前端定制」页对齐 HORIZON 的文案/天空底图说明。
3. **长期演进方向（可选）**：
   - `/blog/` 光谱图支持鼠标刷选时间区间；
   - 文章阅读页 `.song-player` 波形可视化联动 Web Audio API（仅同源音频）；
   - 首页黑洞滚动下潜加入粒子拖尾或自定义吸积盘倾角配置。

---

## 5. 更改日志（新的在上）

<!-- 新条目追加在这里 -->

### 2026-11-16 · Phase 1.3 迭代：纵向无缝拼接 + 极简「转专业」横线 + 原地翻转卡片

- **纵向无缝融合与极简降噪**：
  - [academics.ts](src/lib/academics.ts) 新增 `packTrackWall()`，将原专业（2 学期共 24 块）与临床专业（10 学期/阶段共 77 块）分别在纵向上无间断拼接成两面连续拼贴墙，去掉所有学期标题块、冗余统计卡与说明文字。
  - [academics.astro](src/pages/academics.astro) 与 [academics.css](src/styles/hz/academics.css) 将轨道过渡简化为一条水平细线上的「转专业」三字，并在筛选按钮中内联底纹示例。
- **原地 3D 翻转卡片**：
  - 去除详情抽屉，卡片正面仅保留课程名称与学分（及学分互认/提前标记），点击后在原地执行 `rotateY(180deg)` 翻转展示「开课部门」与「成绩」（未录入显示 `NULL`）。

### 2026-11-16 · Phase 1.3：新增 `/academics/`「学业」二级页（Bento 课程拼贴墙）

- **结构与数据**：
  - 清洗并归档 99 门本科课程至 [academics.json](src/data/academics.json)（区分 `orig` 原·信管大一 24 门 / 55.5 学分与 `clin` 现·临床医学五年制 75 门 / 169.5 学分，覆盖 `completed` / `active` / `recognized` / `planned` 与 6 门 `2026-2027 提前修读`，新增大四「医院见习」与大五「医院实习」阶段方块，预留 `grade`/`gpa` 字段）。
  - 更新 [Hud.astro](src/components/hz/Hud.astro) 与 [shell.css](src/styles/hz/shell.css) 在「关于」与「额度」之间新增 `05 学业` 导航通道并防止窄桌面端换行。
- **排布与视觉语义**：
  - 在 [academics.ts](src/lib/academics.ts) 实现 24 列（桌面）/ 12 列（平板）/ 6 列（手机）满幅 Bento 拼版算法，优先保障各学期无空隙、无重叠对齐，同时依据学分权重突出核心大课并保证中文课程名横向易读；为大四「医院见习」（2 行满宽）与大五「医院实习」（4 行满宽，尺寸显著大于见习）分配纪念碑式阶段方块；支持大小写无关地关联公开/门禁博客文章。
  - 在 [academics.css](src/styles/hz/academics.css) 为 12 个学期/阶段区块分配光谱色相，以 4 种底纹区分修读状态（实色已修 / 45° 斜纹在修 / 交叉网格互认 / 点阵虚框待修），以右下切角与 `//` 前缀区分原信管轨道、以 `+` 刻度标记临床轨道，并于两段轨道间设立纯文本「2026.09 转专业变轨」分隔带（不挂转专业文章直链）。
- **交互**：
  - 在 [academics.ts](src/scripts/hz/academics.ts) 实现 `/` 搜索、聚光灯筛选（压暗非匹配块而不撕裂拼贴）、`观测视图 / 全景拼贴` 切换、跨轨互认课程悬停同步高亮，以及可前后翻阅课程、跳转关联课程与文章的详情抽屉。

### 2026-11-16 · Phase 1.2：收敛至 Noto Sans/思源宋体 + Anthropic Fonts System，修复长英文标题溢出

- **字体收敛与清理**：
  - 删除 `public/fonts/slices/{zcool-qingke,ma-shan-zheng,lxgw-wenkai}/` 及 `public/fonts/{syne-*,instrument-serif-*}.woff2`；新增自托管 `Noto Sans SC`（400/700）分片至 `public/fonts/slices/noto-sans-sc/`。
  - 更新 [fonts.css](src/styles/hz/fonts.css)、[tokens.css](src/styles/hz/tokens.css) 与 [BaseLayout.astro](src/layouts/BaseLayout.astro) 预加载项：
    - 中文仅允许 `Noto Sans SC`（主轴）与 `Noto Serif SC / 思源宋体`（点缀）；
    - 英文主力采用 `Anthropic Sans` / `Anthropic Serif` / `Anthropic Mono`（均含 300–800 可变字重与斜体）+ `JetBrains Mono`，仅保留 `Unbounded` 于品牌标、数字序号与全宽页脚字标；
    - 日文专属点阵字 `DotGothic16` 严格限定在 `[lang="ja"]` 观测徽标（如 `事象の地平線`、`観測記録`）。
- **克制衬线体用量**：
  - 全站主标题、列表行（`.hz-row__title`）、文章页 `<h1>`/`<h2>`/`<h3>`、导语、图志卡面与按钮全面回归清爽的 `Anthropic Sans + Noto Sans SC`；
  - `Anthropic Serif + 思源宋体` 仅保留在区块斜体英文副标、文章引用块 `blockquote`、首段首字下沉、页脚尾注与词频墙稀疏 20% 点缀位置。
- **修复英文溢出容器问题**：
  - 移除会造成长英文词汇横向超宽的 `Syne` 展示体，在 [prose.css](src/styles/hz/prose.css)、[entry.css](src/styles/hz/entry.css)、[home.css](src/styles/hz/home.css)、[gallery.css](src/styles/hz/gallery.css) 中补充 `max-width: 100%; min-width: 0; overflow-wrap: anywhere;` 并校对 `h2` 阶梯字号。
  - 在无头浏览器对 `/blog/订阅google-ai-pro的一个小记录/` 的实测标题 `当我兴冲冲下载Gemini Desktop和Antigravity的时候` 复检中，`1440px` 与 `390px` 均 `h2Clipped: false`、`overflow: 0`。

### 2026-11-16 · Phase 1.1：圆角矩形文章封面与中/日/英多语种风格化分区排印

- **文章封面形态改造**：
  - [log.css](src/styles/hz/log.css) 与 [lens.ts](src/scripts/hz/lens.ts)：将文章行悬停封面预览 `.hz-lens` 从 `210×210` 圆形透镜改为 **`288×186`（16:10）圆角矩形**（`border-radius: 14px`），配内嵌虚线框（`9px` 圆角）、右下角渐变景深阴影与左下角 `DotGothic16` 日期徽标，同步调整视口边界防裁切边距。
  - [entry.css](src/styles/hz/entry.css)：文章详情页主封面 `.hz-entry__cover` 同步改为 `border-radius: 14px; overflow: hidden;`，与悬浮封面预览统一语言。
- **自托管多语种风格化字体体系**：
  - 新增自托管字体文件与按 `unicode-range` 切分的 WOFF2 分片（位于 `public/fonts/` 与 `public/fonts/slices/`），汇总至 [fonts.css](src/styles/hz/fonts.css) 并在 [BaseLayout.astro](src/layouts/BaseLayout.astro) 顶部引入及预加载核心 Latin WOFF2：
    - 英文：`Unbounded`（纪念碑宽体展示） / `Syne` 700·800（先锋几何展示） / `Instrument Serif` 正体·斜体（高对比杂志衬线） / `JetBrains Mono`（数值与代码）；
    - 日文：`DotGothic16`（16px 点阵像素仪器字，涵盖假名/汉字/ASCII） / `Dela Gothic One`（重磅日系展示黑体）；
    - 中文：`站酷庆科黄油体（ZCOOL QingKe HuangYou）`（几何现代标题） / `思源宋体（Noto Serif SC 600）`（高对比文艺正文标题） / `霞鹜文楷（LXGW WenKai Lite）`（导语与副题人文楷体） / `马善政楷书（Ma Shan Zheng）`（毛笔书法签名与引语）。
  - **区域差异化映射**（[tokens.css](src/styles/hz/tokens.css) 及各页面样式）：
    - 顶栏导航、首屏中文主标与各页 Mega H1 采用 `Syne + ZCOOL QingKe HuangYou`；
    - 首页首屏增加日文点阵徽标 `事象の地平線`，各区块标题增配 `Instrument Serif` 斜体英文副标与 `DotGothic16` 日文观测代号（`観測記録` / `重力レンズ` / `観測者記録`）；
    - 文章列表与文章页 H1/引用使用 `Instrument Serif + Noto Serif SC 600`，导语使用 `LXGW WenKai Lite`，正文首段新增毛笔/斜体衬线首字下沉（`::first-letter`）；
    - 图志卡面与灯箱标题针对日/英画师名启用 `Syne + Dela Gothic One`，编号启用 `DotGothic16`；
    - 页脚尾注与关于页导语/原则使用 `Ma Shan Zheng` 毛笔体；关于页词频光谱墙按 `:nth-child(4n+...)` 交替混排 4 套中英字体 + `DotGothic16` 计数角标。
- **回归巡检发现并修复的排印缺陷**：
  - 排查并替换掉存在「回」字轮廓绕向填充缺陷（渲染成实心白块 `■`）的 `ZCOOL XiaoWei`，改用全字形稳定的 `Noto Serif SC 600` + `LXGW WenKai Lite`；
  - 调整首页 `.hz-hero__domain` 宽度与 `white-space: nowrap`，避免 `Syne 800` 下 `Blog.Acretiondisk.top` 末尾字母 `p` 单独换行；
  - 移除词频墙小字号汉字上的 `Dela Gothic One`，改用 `LXGW WenKai Lite` 与 `Noto Serif SC` 保持清晰呼吸感。

### 2026-11-16 · Phase 1：HORIZON（视界）全站前端重写完成与首轮视觉巡检修复

- **设计系统与核心基础设施**：
  - 引入自托管展示字体 `public/fonts/unbounded-latin.woff2`（OFL），建立 `src/styles/hz/{tokens,base,shell}.css`；实现 VOID（暗黑 `#08080b`）与 PLATE（照相底片 `#eae8e2`）双模式及等离橙 `#ff5a1a` 单强调色。
  - 重写 `src/layouts/BaseLayout.astro`，移除 Astro `ClientRouter`，启用原生 `@view-transition { navigation: auto }` 跨文档过渡；新增 `src/components/hz/{Hud,Foot}.astro` 与 `src/scripts/hz/shell.ts`（`mix-blend-mode: difference` 顶栏、移动端全屏通道菜单、外框四角裁切标与实时 UTC/MJD/坐标/深度读数）。
  - 新建 `src/lib/horizon.ts` 提供 MJD 修正儒略日、红移 `z` 与归一化年龄、有效字数（质量）、阅读时长、同日编号与 URL 转链接函数。
- **全站路由与专属交互实现**：
  - 首页 `src/pages/index.astro` + `src/scripts/hz/disk.ts` + `src/styles/hz/home.css`：实现实时 WebGL 史瓦西黑洞光线追踪（78 步自适应积分、广义相对论有效势偏折、相对论多普勒聚束吸积盘、光子环、`stillHeroImage` 引力透镜天球映射、滚屏下潜、离屏自动暂停、PLATE 底片反相及 CSS 日冕降级）；配合近期 8 篇观测账簿（`PostRow.astro` + `src/scripts/hz/lens.ts` 悬浮爱因斯坦环封面透镜）、4 幅不对称引力透镜图版条与观测者档案导览。
  - 文章目录 `src/pages/blog/index.astro` + `src/scripts/hz/spectrum.ts` + `src/styles/hz/log.css`：构建全站发射光谱可视化条（支持点击/悬停与下方列表双向锁定高亮、`?q=`/`?tag=` URL 初始化、`/` 快捷键检索、标签过滤及按时间/字数排序）。
  - 文章阅读与门禁 `src/components/hz/{EntryView,Gate}.astro`、`src/pages/blog/[...id].astro`、`src/pages/private/{index,[...id]}.astro`、`src/scripts/hz/{entry,gate}.ts`、`src/styles/hz/{prose,entry,misc}.css`：统一公开、授权（网名校验）与管理员（SHA-256 口令）文章结构，保留顶部进度条、目录生成与 `IntersectionObserver` 滚动高亮、代码块复制、横向表格容器、分享短链面板、不蒜子阅读计数、`.song-player` 音乐播放条及 A4 打印页眉页脚样式；解锁后自动重新增强正文与播放器。
  - 图像档案 `src/pages/gallery.astro` + `src/scripts/hz/gallery-field.ts` + `src/styles/hz/gallery.css`：实现「独立收藏 / 随文影像 / 全部」三标签、「引力透镜场（可拖拽惯性平移、近中心鱼眼放大、准星锁定、扇区切换）」与「接触印相分页索引」双模式，以及支持 `100%~400%` 缩放平移、无损原图升级与键盘切换的高清灯箱。
  - 关于页 `src/pages/about.astro` + `src/styles/hz/about.css`：融合观测者侧栏、关联网站/项目账簿与可点击跳转 `/blog/?q=` 的全站词频光谱墙。
  - 404 与短链跳转 `src/pages/{404,s/[id]}.astro`：重写为「信号越过视界」与 HORIZON 中继风格，保持短链重定向契约不变。
  - 额度与定价页适配 `src/pages/ai-quota.astro`、`src/pages/ai-quota/pricing.astro`、`src/styles/hz/legacy-bridge.css`、`src/scripts/ai-quota.ts`：映射全部语义变量至 HORIZON 直角高对比体系，修复离开 `ClientRouter` 后 `ai-quota.ts` 仅监听 `astro:page-load` 不自动启动的问题。
- **首轮无头浏览器巡检与修复**：
  - 将 `.hz-readout` 改为左右边框内侧竖排，消除 `1440px` 宽下左下角坐标读数与文章侧栏/关于页/定价页底部文字重叠；
  - 将 `.hz-seg` 分段按钮样式上提至 `base.css`，修复 `/gallery/` 工具栏按钮丢失边框问题；
  - 提升 `disk.ts` 光线步数（58→78）与赤道步长收敛边界，消除吸积盘右上远端裁切痕，优化 `/blog/` 光谱条黑体色阶；
  - 优化 `lens.ts` 切换行封面时替换 `<img>` 节点，避免 `cdn-fallback.ts` 的 `WeakSet` 耗尽标记影响后续文章悬浮预览。

