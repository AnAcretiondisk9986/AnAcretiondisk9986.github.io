# 个人博客性能优化报告

> 优化时间：2026-10-15 ｜ 范围：Astro 静态站（访客侧）+ `admin-server.mjs`（管理后台）+ 构建链路 + CDN 图片
> 所有数字均为**本机实测**（headless Chrome 155 + 本地静态服务器，首访语义、禁用浏览器缓存）；
> 复现方式见文末「如何验证」。

---

## 一、结论摘要

### 1.1 真实首访体积（站内 + CDN 全部计入，单位 KB）

早期测量只统计了站内资源，而本站 **294 处图片引用都在 jsDelivr 上**，真实成本远高于站内数字。
下表为补齐 CDN 统计后的真实值：

| 页面 | 优化前 站内 | 优化前 CDN | 优化后 站内 | 优化后 CDN | 真实总计降幅 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 首页 `/` | 192.0 | 2179.2 | **182.0** | **367.7** | 2371 → 550 KB（**−77%**） |
| 文章目录 `/blog/` | 178.0 | 2329.1 | **249.1** | **226.3** | 2507 → 475 KB（**−81%**） |
| 图库 `/gallery/` | 232.3 | 797.6 | **815.9** | **322.2** | 1030 → 1138 KB（CDN 波动，站内 −62%） |
| 关于 `/about/` | 175.0 | 163.6 | **191.8** | **163.6** | 339 → 355 KB（持平） |
| RAG 技术文 | 2309.3 | 77.3 | **219.8** | **77.3** | 2387 → 297 KB（**−88%**） |

### 1.2 站内资源与结构

| 指标 | 优化前 | 优化后 | 说明 |
| --- | ---: | ---: | --- |
| 全站 CSS（首屏阻塞） | 172.9 KB | **119.6 KB** | 未激活主题不再随页加载 |
| 图库页 HTML | 1319.8 KB | **651.3 KB** | 隐藏视图改为按需构建 |
| 图库页 DOM 节点 | 10 745 | **3 058** | −72% |
| 本地图片总体积 | 2687.3 KB | **416.6 KB** | −84.5% |
| `dist/` 总体积 | 6.11 MB | **3.32 MB** | −46% |
| 首页 wall time（含 CDN） | 6658 ms | **2401 ms** | −64% |
| 构建 | **失败**（不产出 dist） | **107 页 / 1.2 s** | 见 §2.5 |
| `GET /api/posts` | 61 ms | **7 ms** | 后台缓存命中 |

---

## 二、优化项明细

### 2.1 首页 hero 图：3840×2160 / 1.03 MB → 2560×1440 / 207 KB

**问题**：`frontend.stillHeroImage` 指向一张 **4K 全屏背景图**，单张 1057.8 KB，
占首页真实体积约 96%，而它只是带 30% 遮罩的背景层。

**修复**：等比缩放到 2560 宽 + WebP q82（画质经人工比对无损感知），
文件名追加 `_2560` 以规避 jsDelivr 对 `@main` 的路径缓存（同名替换会被 CDN 缓存挡住），
同步更新 `frontend.json`，旧的 4K 文件在图片仓库中删除。

### 2.2 文章封面：原图 → 480px 缩略图（首页 CDN −83%）

**问题**：`PostCatalog.astro` 直接引用封面**原图**。首页 9 张卡片的封面合计 **2179 KB**
（单张 185～645 KB），而卡片封面显示宽度只有约 300px。图库页早已在用 `thumb/` 缩略图，文章卡片却没有。

**修复**：对封面套用 `gallery.ts` 里既有的 `thumbOf()`（→ `image/thumb/*.webp`，平均约 20 KB），
并保留原图地址到 `data-original-cover`，由 §2.4 的回退逻辑兜底。
改动前已验证 **53/53 篇文章的封面都有对应缩略图**。

**结果**：首页 CDN 资源 2179 → **368 KB**；文章目录 2329 → **226 KB**。

> 文章详情页的头图（`.article-cover`，16:8、约 800–1000px 宽）**仍用原图**：
> 480px 缩略图在该尺寸下会明显发虚，需另做一档中等尺寸才有意义（见 §六）。

### 2.3 CSS：172.9 → 119.6 KB，且只加载当前主题

**问题**：5 套视觉主题的样式表**全部**随每个页面加载，浏览器实测 CSS 使用率仅 **11–15%**。

**修复**：

- 三个主题文件移出主 bundle → `public/themes/*.css` 独立资源；
- 新增 `src/styles/theme-shared.css`：把原先混在 `minimal-theme.css` 里、
  却**并非 minimal 专属**的规则（文案切换、`.sr-only`、关于页主题选择器 UI、legacy hero 隐藏）
  抽出常驻加载 —— 否则用 cyanotype 的用户会丢掉这些基础样式；
- `BaseLayout.astro`：默认主题由服务端直出 `<link id="theme-css">`（无 JS 也可用），
  内联脚本按 `localStorage` 校正，并对 ClientRouter 导航做 link 去重；
- 只有关于页（唯一有主题切换器的页面）在空闲时 `prefetch` 其余主题。

> ⚠️ **关键坑（已修复）**：主题改为独立 `<link>` 后，其**加载顺序**排到了 Astro 主样式表之前。
> `tokens.css` 的 `:root[data-theme='dark'] { --paper }` 与主题的
> `:root[data-visual-theme='x'] { --paper }` 特异性相同（0,2,0），后加载者获胜 ——
> 表现为「切主题后底色不再变化」。
> 修复：`scripts/normalize-theme-specificity.mjs` 把主题文件中**纯 `:root` 变量块**
> 提升为 `:root:root[...]`（0,2,0 → 0,3,0），**不触碰后代选择器**，
> 以免改变主题与 `fusion-theme.css` 的覆盖关系。幂等，可重复运行。

### 2.4 CDN 镜像降级扩展到全站（功能修复）

**问题**：站点 294 处图片引用都在 `cdn.jsdelivr.net`，而**该项目已知国内访问该域名缓慢/被墙**。
但镜像降级逻辑此前**只存在于图库页**，且绑定在 `astro:page-load` 回调内 ——
首页 hero、文章正文图片一旦被墙就是白图，且每次客户端导航都会重复注册一个监听器。

**修复**：抽出 `src/scripts/cdn-fallback.ts`，由 `BaseLayout` 在 `<head>` 引入（早于图片加载），
全站共用一份委托监听：`cdn → fastly → gcore → testingcf`；
镜像全部失败且该图是缩略图时，回退到 `data-original-cover` 的原始封面。

**顺带修掉一个真实缺陷**：降级判断原用 `img.currentSrc`，而它在 `src` 刚变更、
新资源尚未加载完成时仍指向旧地址，会导致「重试了却没换镜像」。
改用 `img.src` 后降级链才能可靠推进（`scripts/verify-cdn-fallback.mjs` 有专项断言）。

### 2.5 构建链路：从「构建不出产物」到 107 页 / 1.2 s

**问题**：`npm run build` 表面 exit 0，但 `dist/` 一直停留在旧日期——项目**实际构建不出新产物**。

**根因**：`astro sync` 报 `GenerateContentTypesError: require is not defined`，
栈顶是 `eval (node_modules/picomatch/index.js:6)`。`picomatch@4.0.5` 是纯 CJS
（`package.json` 既无 `"type"` 也无 `"exports"`），而 astro 7.1.6 + vite 8.1.5 的
SSR module runner 会按 ESM 语义求值它，`require()` 直接抛错，构建在写 `dist/` 前中断。

**处理过程（两步）**：

1. **先止血**：给 picomatch 补 ESM 入口（`createRequire` 包装）并声明 `"module"` 字段，
   由 `postinstall` 自动应用。`module` 只被打包器读取，Node 运行时不受影响。
2. **再根治**：确认 `picomatch@4.0.7` 的入口字段与 4.0.5 完全一致（升级它无效），
   问题在 Vite 侧；于是升级 **astro 7.1.6 → 7.4.0**（带来 **vite 8.3.4**）。
   实测**删除补丁后构建照常成功**，因此补丁与 `postinstall` 钩子已**整体移除**。

另将 `"astro": "latest"` 固定为 `^7.4.0`，避免不可复现的依赖漂移。

### 2.6 管理后台服务端（`admin-server.mjs`）

**问题**：`readPosts()` 零缓存，每次调用都 `readdir` + 全量 `readFile` + `gray-matter` 解析
+ `sha256` + 摘要正则；`express.static` 用默认 `maxAge: 0`，3.7 MB 的 `lute.min.js` 每次都要条件请求。

**修复**：

- `readPosts()` 加**文件级 + 列表级**双层缓存（`mtimeMs + size` 校验），
  并提供 `invalidatePostCache()`；**所有写路径**（新建 / 保存 / 改名 / 删除 / 拉取 / 启动同步）均已接入失效。
- `/admin` 面板 HTML 按 `mtimeMs + size` 缓存 token 注入结果。
- 静态资源分级缓存：`vendor/**` 长缓存 + `immutable`；自建 `src/**`、`styles/**` 用 `no-cache`（保留 ETag 304）。
- `collectMediaUsage()` 加缓存，键 = 文章缓存代次 + `gallery.json` 的 mtime/size。
- `sharp.cache(false)` **保持关闭**：实测改为有界缓存对真实媒体库（431 张）无可见收益，
  而 `files > 0` 会重新引入句柄占用导致删除/覆盖 EBUSY。

**实测**：`GET /api/posts` 61 → **7 ms**；`GET /api/media` 77 → 35 ms（后者收益有限，
目录扫描与 192 KB JSON 序列化才是大头）。

---

## 三、新增工具（可重复运行）

| 脚本 | 用途 |
| --- | --- |
| `scripts/perf-baseline.mjs` | 性能基线：**站内 + CDN 双口径**传输量、DOM、FCP/LCP/CLS、覆盖率。`--allow-external` 才计入 CDN |
| `scripts/optimize-images.mjs` | 本地图片尺寸/格式优化，`--dry-run` 先看预估 |
| `scripts/normalize-theme-specificity.mjs` | 主题变量块特异性归一化（幂等） |
| `scripts/verify-gallery-perf.mjs` | 图库交互回归（30 项） |
| `scripts/verify-theme-split.mjs` | 主题按需加载回归（18 项） |
| `scripts/verify-cdn-fallback.mjs` | CDN 降级与封面回退回归（7 项） |

`npm run perf:verify` 一次跑完图库与主题两套；`npm run perf:baseline` 出基线。

---

## 四、验证结果

| 验证 | 结果 |
| --- | --- |
| `npm run build`（无补丁、astro 7.4.0） | ✅ 107 页 / 1.2 s |
| `npm run test:admin` | ✅ 25/25 |
| `npm run test:admin-api` | ✅ 全部通过 |
| `npm run perf:verify` | ✅ 图库 30/30、主题 18/18 |
| `scripts/verify-cdn-fallback.mjs` | ✅ 7/7 |
| 教材截图 WebP 画质 | ✅ 人工确认中文小字清晰 |
| hero 图 2560/q82 画质 | ✅ 人工比对无损感知 |
| 5 套主题视觉 | ✅ 截图确认配色/文案各自到位 |

---

## 五、注意事项（后续维护者请先读）

1. **改主题 CSS 后要跑 `npm run perf:normalize-themes`**：新增的
   `:root[data-visual-theme=…] { … }` 变量块若未提升特异性，会在暗色模式下被 `tokens.css` 反超（原因见 §2.3）。
2. **图库页隐藏视图是客户端构建的**：改 `gallery.astro` 的卡片结构时，
   必须同步改 `gallery-page.ts` 的 `buildGalleryCard()`，两者是**同构契约**。
3. **卡片封面必须走 `thumbOf()`**：正文原图 185～645 KB，直接引用会让首页多传 2 MB。
4. **`prefetch` 只放在关于页**：其他页面预取会让每次访问多下载约 74 KB。
5. **改了 CDN 图片后要换文件名**：jsDelivr 对 `@main` 路径有缓存，同名替换不会立即生效。
6. `.perf/` 与 `perf-reports/` 已在 `.gitignore`（存截图与 JSON 报告供对比）。

---

## 六、后续可选项（本次未做）

- **文章详情页头图**（约 800–1000px 宽）仍用原图，单张 77～178 KB。
  需在图片仓库补一档约 1280px 的中等尺寸才能真正受益。
- **文章正文 CDN 图片**平均 336 KB（325 张，合计 106.6 MB）、
  **图库独立照片**平均 566 KB（99 张，54.7 MB）：属批量压缩范畴，会明显影响画质，尚未执行。
- **`image/original/` 归档原图** 390 张、平均 **4.3 MB**：仅在查看器点「加载原图」时按需下载，
  单次点击要拉 4 MB；若要保留「原图」定位则不宜压缩。
- **`image/` 下 54 张未被引用的孤儿图片**（17.5 MB）：建议人工确认后清理。
- **`global.css` 93 KB 单体文件**：可按页面（文章 / 图库 / 关于）拆分，
  但交互态样式（hover / JS 触发的类）不会被覆盖率统计到，误删风险高，需人工逐条审查。
- **后台 `vditor` 懒加载**：实测首屏阻塞的只有 `index.css` 47 KB + `index.min.js` 297 KB
  （3.7 MB 的 `lute.min.js` 由编辑器内部按需加载），且后台是本地访问，收益有限。
- `blog-template/` 是独立模板目录，未纳入本次优化（内含原尺寸 LOGO 引用）。
