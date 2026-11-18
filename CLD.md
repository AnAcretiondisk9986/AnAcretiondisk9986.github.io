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

- **Phase 1.6（文章内页全比例居中 + 可收起/展开侧栏 + 移除文内封面展示）已完成**：
  - [entry.css](src/styles/hz/entry.css) 与 [EntryView.astro](src/components/hz/EntryView.astro) 将 `.hz-entry__grid` 改为对称三栏布局（`minmax(196px, 1fr) minmax(0, var(--measure)) minmax(196px, 1fr)`）并居中 `.hz-entry__head-main`，解决超宽屏下文章整体右偏问题；
  - 新增标准可收起/展开侧栏交互（[EntryView.astro](src/components/hz/EntryView.astro)、[entry.ts](src/scripts/hz/entry.ts)）：支持侧栏顶部按钮、页头工具条按钮、收起后桌面左侧悬浮 `展开侧栏` 入口及快捷键 `[`，`localStorage` 持久化折叠状态并防闪烁初始化，窄屏端折叠保留手风琴开关；
  - 移除文章阅读页内部 `.hz-entry__cover` 封面图块（列表页悬浮透镜与移动端左侧封面保持不变）。
- **Phase 1.5（纯净黑洞天球 + 学业中英文/罗马数字/字重重塑 + 图像场滚轮双指缩放与去编号 + 首页随机图版 + 全站 Dela Gothic One 日语体系）已提交推送（`da44d26`）**：
  - **首页黑洞 & 透镜图版**（[index.astro](src/pages/index.astro)、[disk.ts](src/scripts/hz/disk.ts)、[home.css](src/styles/hz/home.css)）：移除首页前景图引力透镜折射映射，改为纯净深空暗底 + 双层锐利星场；Section 02 图版条取消标题与 `PL.XX` 编号，嵌入 99 图静态池并在前端挂载时随机抽取 4 张展示。
  - **学业板块**（[academics.json](src/data/academics.json)、[academics.ts](src/lib/academics.ts)、[academics.astro](src/pages/academics.astro)、[academics.css](src/styles/hz/academics.css)、[fonts.css](src/styles/hz/fonts.css)）：新增 `formatCourseTitle()`，统一将课程括号数字及尾随编号替换为真 Unicode 罗马数字（`Ⅰ`/`Ⅱ`/`Ⅲ`/`Ⅳ`），将 `（实践）`/`（理论）`/`（D）`/`（体能素质）`/`（毕业考）` 等括号说明脱壳为小字号浅色轻字重附属标签；转专业后（`clin`）77 门课程全部补充英文译名并用自托管 `Google Sans Italic` 变体渲染，中文标题使用从本地提取的 `Noto Serif SC Black`（900），转专业前（`orig`）采用粗斜体，`clin` 网格适当拔高行高避免裁切。
  - **图像页透镜场**（[gallery.astro](src/pages/gallery.astro)、[gallery-field.ts](src/scripts/hz/gallery-field.ts)、[gallery.css](src/styles/hz/gallery.css)）：移除 `.hz-field-lock` 左下角浮框及所有图版标题/`PL.` 编号系统；新增以光标/捏合中点为锚的鼠标滚轮与双指捏合 `ZOOM 20%–240%` 视场缩放以调节画框内可见图片数量。
  - **全站日语标识与字体**（[tokens.css](src/styles/hz/tokens.css)、[base.css](src/styles/hz/base.css)、[Hud.astro](src/components/hz/Hud.astro)、[Foot.astro](src/components/hz/Foot.astro) 等）：将 `[lang="ja"]` 统一切换为 `Dela Gothic One`，并在首页降下提示、全屏菜单、页脚、光谱图、图像场、关于页、学业分隔线、文章遥测、门禁与额度页补充少量日语观测角标。
- **Phase 1.4（全站液态玻璃 HUD + 黑洞/白洞着色器升级 + 学业坐标轴圆角排版 + 图像/文章/关于精细打磨）已提交推送（`c3c84e0`）**：
  - **学业页**（[academics.json](src/data/academics.json)、[academics.ts](src/lib/academics.ts)、[academics.astro](src/pages/academics.astro)、[academics.css](src/styles/hz/academics.css)）：互认课程归入 `completed`（已修 38 门）；左侧新增与网格行严格对齐的纵向年份/学段坐标轴；方块改为圆角矩形并按卡片宽高与字数自动放大课程标题以撑满版面；
  - **全站外壳与首页**：[shell.css](src/styles/hz/shell.css) 将顶栏从 `mix-blend-mode: difference` 升级为 VOID/PLATE 双模式液态玻璃导航栏；[Foot.astro](src/components/hz/Foot.astro) 与 [shell.css](src/styles/hz/shell.css) 将「回到视界之外」改为 `50×50px` 圆形按钮；[disk.ts](src/scripts/hz/disk.ts) 与 [home.css](src/styles/hz/home.css) 提升光线步进精度（112 步）、多尺度涡旋与多普勒对比及 ACES + 饱和度，优化 VOID 黑洞与 PLATE 白洞呈现，并补充左侧局域径向文字护底渐变以兼顾视界绚丽度与文案对比度；
  - **图像页**（[gallery.astro](src/pages/gallery.astro)、[gallery-field.ts](src/scripts/hz/gallery-field.ts)、[gallery.css](src/styles/hz/gallery.css)）：移除透镜场 32 张分扇区限制，改为容纳全集图片（近视口懒加载）并按原始宽高比例展示，新增「随机跳转 ↗」按钮；
  - **文章列表**（[PostRow.astro](src/components/hz/PostRow.astro)、[log.css](src/styles/hz/log.css)、[lens.ts](src/scripts/hz/lens.ts)）：桌面悬浮封面缩小至 `204×132`，移动端/触控端在列表左侧直接展示圆角封面；
  - **关于页**（[about.astro](src/pages/about.astro)、[about.css](src/styles/hz/about.css)）：移除「编目原则」引语块。
- **Phase 1.3（新增 `/academics/`「学业」二级页：纵向连续课程拼贴墙与原地翻转卡片）已完成**。
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

### 2026-11-18 · 光效收敛、P1/P2 无缝过渡、极向相对论喷流与协调圆角抛光

- **P1/P2 硬切边界消除与全动画无缝循环**：
  - [home.css](src/styles/hz/home.css) 移除 `.hz-hero` 底部分割实线并加大底部留白，为 `.hz-hero__canvas`、`.hz-hero__fallback` 与 `.hz-hero__scrim` 添加底部纵向渐变遮罩（`mask-image: linear-gradient(...)`），配合 [motion.ts](src/scripts/hz/motion.ts) 在首页滚屏时提前淡入背景星场，消除黑洞首屏底部的水平硬切线（P1）；
  - [shell.css](src/styles/hz/shell.css) 为 `.hz-foot__word` 的 `::before`/`::after` 光效伪元素添加上下双向垂直渐隐遮罩并用 `width: 200%` 双周期 `translate3d(-50%)` 替代 `background-position` 扫光，彻底消除页脚巨型字标顶部的矩形发光截断边（P2）；
  - 将全站可动光效统一升级为真正无跳变循环：固定星云 `hz-aurora-drift` 闭合椭圆轨道、[base.css](src/styles/hz/base.css) `hz-rule-beam`、[shell.css](src/styles/hz/shell.css) `hz-hud-sweep`、[motion.css](src/styles/hz/motion.css) `hz-tracer-sweep`、[home.css](src/styles/hz/home.css) `hz-domain-shimmer`、[log.css](src/styles/hz/log.css) `hz-spec-sweep` / `hz-lens-scan`、[schedule.css](src/styles/hz/schedule.css) `hz-now-sweep` 及 [ai-quota.css](src/styles/ai-quota.css) `aq-bar-flow`。
- **黑洞点击相对论极向喷流与背景粒子调优**：
  - [disk.ts](src/scripts/hz/disk.ts) 将 `u_pulse` 由同心扩张波纹重构为黑洞南北极沿磁轴爆发的准直相对论喷流（抛物磁喷嘴 + 切伦科夫蓝白核芯 + 等离橙外鞘 + 极区磁重联闪光）；[motion.ts](src/scripts/hz/motion.ts) 在 `[data-hero]` 内屏蔽 DOM 点击扩散特效，非首屏区域则由同心圆波改为精简的 34px 十字星芒闪光（[motion.css](src/styles/hz/motion.css)）；
  - [motion.ts](src/scripts/hz/motion.ts) 提升 `.hz-cosmos-canvas` 粒子数量至 86 颗并加快自由漂移速度；[tokens.css](src/styles/hz/tokens.css) 与 [motion.css](src/styles/hz/motion.css) 调低背景鼠标光晕范围与透明度（`220px`，降噪至低干扰体积晕光）。
- **克制协调的局部圆角化**：
  - 保留顶栏 HUD、四角取景框线、观测账簿分割线及课表网格内部矩阵的锐利几何骨架，将交互控件与独立卡面/容器协调圆角化：[base.css](src/styles/hz/base.css)（`.hz-btn` `10px`、`.hz-mini-btn` `8px`、`.hz-seg` `10px`、`.hz-ja-pill` `6px`）、[motion.css](src/styles/hz/motion.css)（`.hz-seg-glider` `7px`）、[home.css](src/styles/hz/home.css)（`.hz-hero__jp` / `.hz-hplate` / `.hz-dossier-teaser`）、[log.css](src/styles/hz/log.css)（`.hz-spec` / `.hz-search` / `.hz-tags-rail button` 胶囊）、[gallery.css](src/styles/hz/gallery.css)（`.hz-gal-tabs` / `.hz-gal-filter` / `.hz-field-stage` / `.hz-fplate` / `.hz-iplate` / `.hz-viewer`）、[about.css](src/styles/hz/about.css)、[entry.css](src/styles/hz/entry.css)、[prose.css](src/styles/hz/prose.css)、[schedule.css](src/styles/hz/schedule.css)（`.hz-sched-shell` 采用 `overflow: clip` 保全吸顶表头）、[exams.css](src/styles/hz/exams.css) 与 [legacy-bridge.css](src/styles/hz/legacy-bridge.css)。

### 2026-11-18 · 全站体积光场、相对论粒子与高动态交互光效升级

- **全站光场与交互引擎**（[BaseLayout.astro](src/layouts/BaseLayout.astro)、[tokens.css](src/styles/hz/tokens.css)、[motion.css](src/styles/hz/motion.css)、[motion.ts](src/scripts/hz/motion.ts)）：
  - 新增固定背景体积星云/底片光洗（`.hz-aurora`）与 2D 实时相对论粒子/引力弧线场（`.hz-cosmos-canvas`），随滚动速度产生翘曲光丝流，并在光标近域形成引力偏折与双主题（VOID / PLATE）色彩同步，在首页首屏自动淡出避让 WebGL 黑洞；
  - 新增光标体积光晕（`.hz-cursor-aura`）、全站点击爱因斯坦环引力冲击波（`.hz-shockwave`）、跨页高能等离子顶部扫光束（`.hz-nav-tracer`）、按钮磁吸微交互（`.hz-btn` / `.hz-foot__top`）、遥测数字锁定动画，以及覆盖动态渲染节点的双层边缘描边聚光灯（`[data-hz-spot]`）与 3D 光学倾角（`[data-hz-tilt]`）；
  - 强化跨文档 View Transitions 曝光过冲与方向性视差（[base.css](src/styles/hz/base.css)），升级 HUD 指针高光追踪、底边流光与页脚巨型字标日冕扫光（[shell.css](src/styles/hz/shell.css)）。
- **首页黑洞与全板块定向光效**（[disk.ts](src/scripts/hz/disk.ts)、[home.css](src/styles/hz/home.css)、[log.css](src/styles/hz/log.css)、[spectrum.ts](src/scripts/hz/spectrum.ts)、[lens.ts](src/scripts/hz/lens.ts)、[gallery.css](src/styles/hz/gallery.css)、[gallery-field.ts](src/scripts/hz/gallery-field.ts)、[about.css](src/styles/hz/about.css)、[academics.css](src/styles/hz/academics.css)、[academics.ts](src/scripts/hz/academics.ts)、[entry.css](src/styles/hz/entry.css)、[prose.css](src/styles/hz/prose.css)、[schedule.css](src/styles/hz/schedule.css)、[exams.css](src/styles/hz/exams.css)、[ai-quota.css](src/styles/ai-quota.css)、[pricing.css](src/styles/pricing.css)、[legacy-bridge.css](src/styles/hz/legacy-bridge.css)、[misc.css](src/styles/hz/misc.css)）：
  - 首页黑洞着色器新增极区同步辐射等离子微流、降临/点击触发的相对论引力波冲击环（`u_pulse`）、光标临近视界增亮（`u_flare`）与下潜径向速度流线；标题域名流光渐变、Section 02 图版棱镜炫光与 Section 03 弧光轨道环同步升级；
  - `/blog/` 光谱仪增加悬停垂直激光准星（`--spec-x`）与邻域谐波涌浪，悬浮预览 `.hz-lens` 增加速度倾斜与扫描光束；`/gallery/` 透镜场加入光标引力焦点与光箱曝光切换；`/academics/` 课程方块支持 3D 指针倾角与翻转边缘爆闪；`/schedule/` 修复关闭抽屉阴影右缘溢出问题并升级当前时间激光线与课程高光；`/ai-quota/` 与 `/ai-quota/pricing/` 解除阴影屏蔽并新增流光进度条与脉冲状态环；`/404` 新增反旋吸积涡旋环。

### 2026-11-17 · 新增 06 日程三级页 `/schedule/exams/`（重构原独立仓库 `/et/` 期末考试安排）

- **全量重构接入**：将原独立仓库 `AnAcretiondisk9986/et` 的 2026–2027 学年第一学期期末考试安排（含 12-12 `六级笔试（CET6）`、01-10 `英语（3）` 共 10 场）归档至 [exams.json](src/data/exams.json)，抛弃原有玻璃拟态圆角渐变风格，依据 HORIZON 视界双主题（VOID / PLATE）设计规范重写为 [exams.astro](src/pages/schedule/exams.astro)、[exams.css](src/styles/hz/exams.css) 与 [exams.ts](src/scripts/hz/exams.ts)（含实时倒计时、33 天日期矩阵筛选、同课多考短时自动标注「实验考核」徽标、开课学院分布、时间轴/卡片/表格三视图、右侧详情抽屉、信息复制、`.ics` 日历导出与打印样式）。
- **双向导航与旧链兼容**：在 `06 日程`（[schedule.astro](src/pages/schedule.astro)、[schedule.css](src/styles/hz/schedule.css)）页头新增高对比等离子橙「本学期考试安排」入口按钮，在三级页顶部增设「返回 06 日程」按钮；同时新增 [et.astro](src/pages/et.astro) 将 `/et/` 重定向至 `/schedule/exams/`，并同步更新 [about.json](src/data/about.json) 与 [academics.json](src/data/academics.json) 中的链接。

### 2026-11-16 · Phase 1.6：文章内页全比例居中、可收起侧栏与移除文内封面

- **文章居中重构**（[entry.css](src/styles/hz/entry.css)、[EntryView.astro](src/components/hz/EntryView.astro)）：将 `.hz-entry__grid` 由原先受 `justify-content: space-between` 推向右缘的双栏结构重构为对称三栏（`minmax(196px, 1fr) minmax(0, var(--measure)) minmax(196px, 1fr)`）并加入 `.hz-entry__head-main` 居中包裹，使标题与正文在 16:9、21:9、32:9 等超宽比例下始终水平居于视口中央；中等桌面端（`1021–1219px`）与收起态均保持安全居中。
- **可收起 / 展开侧栏**（[EntryView.astro](src/components/hz/EntryView.astro)、[entry.ts](src/scripts/hz/entry.ts)）：遵照通用文档阅读习惯，在侧栏顶部、文章工具栏及桌面收起后的左上角分别提供收起/展开开关，并支持 `[` 快捷键与 `localStorage`（`hz-entry-rail`）无闪烁状态记忆；移动端/平板端（`<= 1020px`）收起时保留手风琴开关条；打印模式强制忽略折叠以输出完整元信息。
- **取消文章内封面展示**（[EntryView.astro](src/components/hz/EntryView.astro)、[entry.css](src/styles/hz/entry.css)）：移除文章头部的 `.hz-entry__cover` 大图区块及无用封面解析依赖，文章列表页的桌面悬浮预览与移动端左侧封面不受影响。

### 2026-11-16 · Phase 1.5：纯净黑洞天球、学业字体/罗马数字/译名重塑、图像场缩放与全站 Dela Gothic One 日语体系

- **黑洞折射底图清理**：
  - [index.astro](src/pages/index.astro) 移除画布 `data-sky-src` 绑定，[disk.ts](src/scripts/hz/disk.ts) `sampleSky()` 改为纯净深空暗底 + 引力增亮双层星场（保留 `frontend.json` 数据契约不改动）。
- **学业课程命名规则与双轨字体重塑**：
  - [academics.ts](src/lib/academics.ts) 新增 `formatCourseTitle()`：括号数字与尾随编号（含 `体育3`/`体能测试4` 等）全部转写为真 Unicode 罗马数字 `Ⅰ`–`Ⅳ`（禁用拉丁 `I`）；`（实践）`/`（理论）`/`（D）`/`（体能素质）`/`（毕业考）` 等括号说明脱壳为小字号、常规字重、浅色的 `.hz-tile__sub` 附属标签。
  - [academics.json](src/data/academics.json) 为转专业后 `clin` 阶段全部 77 门课程及见习/实习节点补充英文译名；生成自托管变体字体 [google-sans-italic.ttf](public/fonts/google-sans-italic.ttf) 与 [noto-serif-sc-black-acad.ttf](public/fonts/noto-serif-sc-black-acad.ttf)（`Noto Serif SC` `wght=900` 实裁），并在 [fonts.css](src/styles/hz/fonts.css)、[academics.astro](src/pages/academics.astro) 与 [academics.css](src/styles/hz/academics.css) 实现：转专业前 `orig` 使用粗斜体，转专业后 `clin` 使用中文粗 Serif Black（`900`）+ 较小字号 `Google Sans Italic` 英文译名，并适当扩大 `clin` 行高（桌面 `134px`、平板 `126px`、手机 `118px`）防止溢出。
- **图像页与首页透镜图版交互重塑**：
  - [gallery.astro](src/pages/gallery.astro)、[gallery-field.ts](src/scripts/hz/gallery-field.ts) 与 [gallery.css](src/styles/hz/gallery.css)：移除透镜场左下角 `.hz-field-lock` 信息框与所有图版的标题/`PL.` 编号系统；新增以指针/双指中点为锚的鼠标滚轮与双指捏合缩放（`ZOOM 20%–240%`）以动态调节画框内可见图版数量，网格背景跟随缩放与偏移联动。
  - [index.astro](src/pages/index.astro) 与 [home.css](src/styles/hz/home.css)：首页 Section 02 引力透镜图版去除 `.hz-hplate__meta` 标题与 `PL.XX` 编号，并在客户端加载时对 99 图全集池做 Fisher-Yates 随机洗牌抽样 4 张展示。
- **全站日语标识升级**：
  - [tokens.css](src/styles/hz/tokens.css) 与 [base.css](src/styles/hz/base.css) 将 `--f-jp` 与 `html [lang='ja']` 统一切换为 `Dela Gothic One`；并在 [Hud.astro](src/components/hz/Hud.astro)、[Foot.astro](src/components/hz/Foot.astro)、[index.astro](src/pages/index.astro)、[blog/index.astro](src/pages/blog/index.astro)、[gallery.astro](src/pages/gallery.astro)、[about.astro](src/pages/about.astro)、[academics.astro](src/pages/academics.astro)、[EntryView.astro](src/components/hz/EntryView.astro)、[Gate.astro](src/components/hz/Gate.astro)、[private/index.astro](src/pages/private/index.astro)、[404.astro](src/pages/404.astro) 与 [ai-quota.astro](src/pages/ai-quota.astro) 增设风格统一的日语观测小标识。

### 2026-11-16 · Phase 1.4：全站液态玻璃 HUD 与 5 个板块定向精修

- **学业板块**：
  - 将原专业互认的 14 门课程统一并入 `completed`（已修共 38 门），简化筛选条为 `全部 / 已点亮 / 已修 / 在修 / 提前 / 待修`。
  - 在 [academics.ts](src/lib/academics.ts) 中于 `packTrackWall()` 输出分段坐标轴 `axis`，与网格行共享同一套 `grid-row` 轨道渲染左侧纵向年份/学段坐标轴。
  - 方块改为 `12px/16px` 圆角矩形并放宽拼贴间距；新增构建期标题字号求解器 `computeTitleRem()`，使课程名在零裁剪前提下尽量撑满方块版面。
- **整站与首页**：
  - [shell.css](src/styles/hz/shell.css) 将固定顶栏从纯差值反色改为双主题半透明液态玻璃（`backdrop-filter: blur(22px) saturate(190%)` + 顶部高光描边与光泽渐变），保证在黑洞、拼贴墙与图片上方始终清晰可读。
  - [disk.ts](src/scripts/hz/disk.ts) 与 [home.css](src/styles/hz/home.css) 将黑洞光线积分步数提至 112 步、提升 HiDPI 分辨率上限至 `1.65`、强化开普勒旋涡细节、双层光子环、多普勒蓝/红移及 ACES 饱和度，并重构 PLATE 模式下的白洞光谱反相渲染。
  - [Foot.astro](src/components/hz/Foot.astro) 与 [shell.css](src/styles/hz/shell.css) 将「回到视界之外」改为 `50×50px` 圆形按钮。
- **图像 / 文章列表 / 关于页**：
  - [gallery.astro](src/pages/gallery.astro)、[gallery-field.ts](src/scripts/hz/gallery-field.ts) 与 [gallery.css](src/styles/hz/gallery.css)：透镜场改为加载当前池全部图片（视口附近按需水合图片 `src` 并剔除远端节点），取消 `4:3` 裁剪改为按原图比例自然尺寸展示，并用「随机跳转 ↗」替代分扇区翻页。
  - [PostRow.astro](src/components/hz/PostRow.astro)、[log.css](src/styles/hz/log.css) 与 [lens.ts](src/scripts/hz/lens.ts)：桌面悬浮封面尺寸由 `288×186` 缩小至 `204×132`，并在 `<= 720px` 及触控设备上于文章行左侧直接显示圆角封面。
  - [about.astro](src/pages/about.astro) 与 [about.css](src/styles/hz/about.css)：去除「编目原则」引语块。

### 2026-11-16 · Phase 1.3 数据校对：调整下学期提前修读课程状态

- 将 [academics.json](src/data/academics.json) 中下学期才修读的《马克思主义基本原理概论》与《体育4》由 `active` 调整为 `planned`（保留 `early: true` 标记），使在修课程准确收敛为本学期 12 门（新·大一上 8 门 + 大二上提前修读 4 门）。

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

