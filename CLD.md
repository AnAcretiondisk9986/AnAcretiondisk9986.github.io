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

- **Phase 1（全站前端表现层重写）已完成并完成本地构建与浏览器巡检**：
  - `npx astro build` 生成 121 个静态页面，无报错；`node scripts/postbuild-rewrite.mjs` 正常运行。
  - 无头 Chrome 覆盖 `1440×900`（VOID 暗色 / PLATE 底片亮色）与 `390×844`（移动端），所有主路由横向溢出 `overflow = 0`，WebGL 黑洞首屏、光谱检索、文章目录/短链/门禁、图志透镜场/索引/灯箱、关于词频墙、私密暗房、AI 额度与定价页全部验证通过。

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

