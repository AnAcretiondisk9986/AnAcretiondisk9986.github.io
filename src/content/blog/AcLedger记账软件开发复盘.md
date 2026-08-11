---
title: AcLedger 开发复盘：双端记账软件从 0 到 1 的难点、交接与方法论
description: 一款 Electron + React 记账软件如何在两天内从零走到发布：白屏排查、CORS 桥接、GBK 编码、乐观锁同步、性能优化……把 17 条踩坑记录提炼成可复用的开发方法论，并拆解「交接文档」如何让 AI 协作开发持续高效。
pubDate: "2026-08-11"
dayIndex: 1
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-01-setup.webp"
tags:
  - 技术
  - 复盘
  - Electron
  - React
  - TypeScript
  - 方法论
draft: false
---

# AcLedger 开发复盘：双端记账软件从 0 到 1 的难点、交接与方法论

前阵子把博客从零搭起来之后，我又顺手做了一款记账软件——**AcLedger（Ac记账）**：Electron 桌面端 + Web 端共用一套 React 前端，数据存在 GitHub 私有仓库 / WebDAV / 本机文件夹里，支持微信、支付宝账单导入和月度统计。

这个项目从第一行代码到双端上线，只用了**两天、22 次提交**：`packages/core`、`packages/storage`、`packages/bill-import` 三个包 + `apps/web`、`apps/desktop` 两个应用，**67 项测试全绿**，桌面版 `v0.1.0` Release 和 Web 版 GitHub Pages 都已发布。

这篇不写教程（怎么复刻它），写**方法论**：开发中真实踩过的坑、怎么排查、沉淀成了什么规则，以及那个让整个项目两天迭代 22 个提交而从不迷路的「交接文档」是怎么运作的。

> 文中截图均为 AcLedger 桌面版真实窗口（Electron 无边框），界面数据为虚构演示数据。

## 一、总体技术栈：一个 monorepo，五种角色

```
┌─ 桌面版 (Electron 33 壳) ─┐   ┌─ Web 版 (Vite + React，GitHub Pages) ─┐
│           同一套 React 前端（antd + zustand + recharts）           │
└────────────┬───────────────────────────────┘
             ▼
  packages/core            记账核心（纯 TS）：数据模型、金额、分类、统计、自动分类
             ▼
  packages/storage         存储适配层：StorageAdapter 接口 + GitHub / WebDAV / Local / 内存
             ▼
  packages/bill-import     账单解析：微信 CSV/xlsx + 支付宝 GBK CSV（真实样本测试）
```

| 层 | 技术 | 职责 |
|---|---|---|
| 工程组织 | npm workspaces + TypeScript strict | 三包两应用，纯 TS 核心零运行时依赖 |
| 核心逻辑 | `@ac-ledger/core` | 交易模型、分类树、统计、商户名自动分类 |
| 存储抽象 | `@ac-ledger/storage` | `StorageAdapter` 统一接口，GitHub（blob sha 乐观锁）/ WebDAV（etag）/ 本地 / 内存四套适配器 |
| 账单导入 | `@ac-ledger/bill-import` | 微信（CSV + xlsx，exceljs）与支付宝（GBK CSV）解析，按交易单号去重 |
| Web 端 | Vite 5 + React 18 + antd 5 + zustand + recharts | 记账 / 账单 / 导入 / 统计 / 设置五个页面，HashRouter |
| 桌面端 | Electron 33（contextIsolation + sandbox，preload 桥） | 主进程转发网络与文件 IPC，无边框自绘窗口 |
| 测试 | vitest（67 项） | 含真实账单样本 fixture、协议模拟、动态 XLSX 端到端 |
| CI | GitHub Actions ×2 | `pages.yml` 推 Web 版；`release.yml` 打 tag 自动打包发布 |

一个贯穿始终的设计原则：**核心包纯 TS、零依赖**，浏览器能跑；所有「不安全」的能力（网络、文件系统）都收在 Electron 主进程后面，渲染进程只通过 preload 桥调用。

## 二、难点拆解：八个坑，八条方法论

### 坑 1：桌面版白屏三连 —— 环境判断要用 API，不要用环境变量

打包后双击，白屏。排查出三个叠加原因：

1. **用 `NODE_ENV` 判断开发/生产**：双击启动的进程根本没有这个变量，应用误以为自己在开发模式，去连 `localhost:5173` → 白屏。修复：用 Electron 官方 API `app.isPackaged`。
2. **装了新版但点的是旧快捷方式**：安装版目录（`AppData\Local\Programs\...`）里的 asar 是旧包，新包没覆盖上去。修复：打包后必须全渠道覆盖。
3. **多开进程 + 无单实例锁**：残留窗口 + 新窗口打架。修复：`requestSingleInstanceLock()`，二次实例聚焦。

> **方法论：判断运行环境用平台 API，不依赖「我以为会有的变量」；发布不是「构建成功」，而是「每个分发渠道都实测过」**。这条坑后来直接写进了交接文档第 1 条。

### 坑 2：GitHub 设备流 CORS —— 认识平台边界，用桥接而不是对抗

Web 版「用 GitHub 账号授权」走 OAuth 设备流，渲染进程 `fetch` 直接报 `Failed to fetch`——因为 **`github.com/login/device/*` 根本不返回 CORS 头**，浏览器拦截是必然的，不是你代码的问题。

修复：设备流请求全部改走 Electron 主进程的 `net.fetch`（Chromium 网络栈，跟随系统代理、无 CORS 限制），通过 preload 桥暴露给渲染进程。WebDAV 在桌面端同样用主进程转发（`webdav-ipc.cjs` 限制方法/头/大小，最大 50MB）。

> **方法论：每个平台都有自己的边界（浏览器 CORS、沙箱、文件系统权限）。与其在边界内反复挣扎，不如把能力桥接到有权限的一侧，再给桥加上闸门（校验、限流）**。桌面端所有 IPC 桥都做了路径边界校验与大小限制——最小特权原则。

### 坑 3：账单解析的编码与格式战场 —— 真实样本是最好的测试

导入微信/支付宝账单是最「脏」的活，四个经典翻车：

| 问题 | 根因 | 修复 |
|---|---|---|
| 支付宝 CSV 乱码 | 文件是 **GBK 编码** | 解码时检测 UTF-8 替换符，回退 GBK |
| 尾部汇总解析失败 | 汇总行含逗号（`已支出:455笔,13727.52元`），过 CSV 解析后丢逗号 | 汇总从原始文本行解析 |
| 微信 xlsx 日期错一天 | exceljs 按本地时区解释 Date 对象 | 取本地字段拼 `YYYY-MM-DD HH:mm:ss` + `+08:00` |
| xlsx 提示「请使用 parseBill 并传入文件字节」 | `parseBill` 先把二进制按 UTF-8 解码，xlsx 是 ZIP 被误判 | 检测扩展名 / `PK\x03\x04` ZIP 签名 / `kind`，走二进制入口 |

这些坑没有一个靠「读文档」能发现，全是**真实账单样本**喂出来的：微信 983 笔、支付宝 611 笔作为测试 fixture，`parseBill` 解析后与样本头部统计对账（笔数、金额）。

> **方法论：解析外部格式，先收集真实样本当 fixture，再写解析器；单测断言「样本统计对得上」比断言「某行解析正确」可靠得多**。另外：隐私样本绝不进公开仓库（见坑 4）。

### 坑 4：隐私红线 —— fixtures 差点把全部真实账单推上公开仓库

真实样本测试很爽，但样本里是**用户全部交易数据**。差点 `git add -A` 一起推进公开仓库。

修复：`fixtures/*.xlsx|csv` 进 `.gitignore`，真实样本测试包一层 `describe.skipIf(!HAS_FIXTURE)`——本地有样本就跑，CI/他人克隆自动跳过，测试永远不红。

> **方法论：隐私数据默认不进仓库；「需要真实数据才能跑的测试」用 skipIf 优雅降级**。这条和「真实样本测试」不矛盾——测试逻辑常驻，样本数据隔离。

### 坑 5：打包分发 —— 网络镜像、依赖树、安全软件三座大山

`electron-builder` 打包三连坑：

1. **electron 二进制下载失败**：GitHub 直连不通 → 配置 `electronDownload.mirror` 指向 npmmirror 镜像（`.npmrc` 固化）。
2. **打包破坏 workspace 依赖树**：electron-builder 会在 appDir 里跑 `npm install --production` → 独立 `app/` 目录（`prepare-app.cjs` 构建），不带 devDependencies。
3. **便携版 exe 白屏**：自解压环节被系统安全软件静默阻断，英文路径也一样 → **放弃 portable，改分发 win-unpacked 目录版**。

> **方法论：工具链的环境约束（镜像、沙箱）直接写进配置而不是靠命令行备忘；打包产物每种形态都要真机实测，测不过的形态果断砍掉**。

### 坑 6：多端同步与并发 —— 乐观锁 + 合并重试 + 双线存储

这是全项目设计含量最高的部分：

- **写文件带乐观锁**：GitHub 用 blob `sha`，WebDAV 用 `etag`（`If-Match` 条件写），语义一致。
- **冲突自愈**：`LedgerRepository` 冲突时自动重新拉取远端 → 按 `id`/`refId` 合并 → 重试（最多 2 次）。
- **导入幂等**：按交易单号去重，同一份账单重复导入不会产生重复记录。
- **双线存储（桌面版）**：日常操作只写本地缓存目录（快、离线可用），GitHub 只在「打开时双向同步」和「退出时提交」两个时机访问——打开时按文件比对（本地 blob sha vs 远端 tree sha），交易文件按月**并集合并**，配置取较新；退出提交失败弹窗三选（重试 / 仍然退出下次补交 / 取消），30 秒超时兜底。

> **方法论：同步设计的三板斧——乐观锁做并发控制、合并重试做冲突自愈、本地工作副本做体验兜底。把「同步」从每次操作中摘出来，只在打开/退出两个边界做，复杂度就锁住了**。

### 坑 7：保存性能 —— 从 19 个请求降到 1-2 个

早期每次保存（导入/编辑/删除/补分类）都 `refreshAll()` 全量重拉：GitHub 模式下是 N 个月文件 + 元数据 + tree 列表 ≈ N+5 个串行请求；且每次写前还额外 GET 一次查 sha。

修复两刀：
1. **内存合并**：`addTransactions` / `updateTransaction` / `removeTransaction` 改为按 `id`/`refId` 去重、月份列表收窄，保存后不再全量刷新。
2. **sha 缓存**：GET 时记录、PUT 成功后用响应更新、冲突/404 时清除，写前免查询；「读→写」连续操作从 2 个请求变 1 个。

> **方法论：性能问题先数请求数，别急着上缓存框架。全量刷新 → 增量合并、重复查询 → 缓存失效策略，往往就是全部答案**。

### 坑 8：桌面化体验 —— 无边框窗口与「网页感」的对抗

`frame: false` 去掉系统标题栏后，窗口控制按钮自绘（最小化/最大化/关闭，关闭悬停变红）；顶部标题栏区域设 `-webkit-app-region: drag` 拖拽区（交互元素 `no-drag`），双击空白切换最大化；`Menu.setApplicationMenu(null)` 去掉默认菜单栏，拦截 Ctrl+滚轮缩放，保留 F12 DevTools。

配套布局改造：侧栏固定、内容区独立滚动（`height: 100vh + overflow: hidden` + `flex: 1 + overflow: auto`），`user-select: none` 去掉网页感。

> **方法论：桌面化的本质是「接管系统的部分职责」（标题栏、缩放、滚动），接管的每一块都要给出等价交互，否则就是在给用户挖洞**。

## 三、交接机制：HANDOFF.md 怎么让 22 次提交不迷路

这个项目最「方法论」的部分，可能是根目录那份 **`HANDOFF.md`（24KB 交接文档）**。它把 AI 协作开发中最大的成本——**上下文重建**——降到了零。接手者（人或 AI）读这一份文件就能开工，结构是固定的十节：

| 章节 | 内容 | 为什么有用 |
|---|---|---|
| 1. 项目是什么 | 一句话定位 + 全部线上地址（已验 HTTP 200） | 5 秒建立全局认知 |
| 2. 架构与技术栈 | monorepo 目录树 + 每个包的职责 + 安全基线 | 不用翻代码猜结构 |
| 3. 常用命令 | 开发/测试/打包/发布全命令表 | 免去试错 |
| 4. 本机环境特性 | **网络代理、npm 11 approve-scripts、镜像配置** | 「接手者必读，否则会踩坑」 |
| 5. 踩坑记录 | **17 条表格：问题/根因/修复** | 前人用真金白银换来的 |
| 6. 关键业务约定 | 数据布局、Transaction 字段、并发策略、各账单语义 | 业务规则不靠口口相传 |
| 7. 诊断手段 | 主进程日志路径、SMOKE 模式、DevTools | 出问题知道去哪看 |
| 8. 当前状态与待办 | 已完成验收清单 + 待办 + 数据仓库状态 | 接手的起点是「现状」而非「文档」 |
| 9. 原交接之后的变更 | 每次大改按主题追加提交记录 | 交接文档自身也在迭代 |
| 10. 交接给 AI 的建议开场 | 一段可以直接复制的话术 | 把「怎么用这份文档」也交接了 |

几处细节很关键：

- **踩坑记录不是流水账，是决策记录**：每一条都写「根因」，因为根因才是可迁移的知识；第 17 条甚至记录了「用户看到错误提示时发生了什么」。
- **环境特性写进文档而不是口头交代**：本机 `github.com` 直连不通、要走 `127.0.0.1:7890` 代理、Node fetch 不走代理会失败——这些不写下来，下一个接手者会白耗一小时。
- **「交接给 AI 的建议开场」**：一段固定的 prompt 模板，把文档、环境注意点、隐私红线一次性传给下一个 AI 会话。文档的最高形态是**连「怎么交接」都交接了**。

> **方法论：交接文档的五要素——现状快照、命令表、环境特性、踩坑表（含根因）、诊断手段。其中「环境特性」和「根因」最容易被忽略，也最值钱**。

## 四、方法论精炼：可迁移的九条

把上面的坑收拢成清单，任何项目都适用：

1. **验证驱动**：构建通过 ≠ 能用。每类功能配 headless 实测 / 单测 / 真实样本 fixture，验证脚本进仓库。
2. **真实样本优先**：解析外部格式先收集样本，断言「样本统计对得上」。
3. **最小特权**：渲染进程不碰网络和文件系统，全走主进程桥；桥必有边界校验与大小限制。
4. **乐观锁 + 自愈**：并发写用版本号（sha/etag），冲突自动合并重试，导入幂等去重。
5. **边界时机做同步**：把重操作从每次交互中摘出，收敛到打开/退出两个边界，配超时与降级。
6. **环境判断用 API**：`app.isPackaged` 而非 `NODE_ENV`；平台边界（CORS/沙箱）用桥接解决，不硬刚。
7. **隐私默认隔离**：真实数据不进公开仓库，需要真实数据的测试用 `skipIf` 降级。
8. **性能先数请求**：全量刷新 → 增量合并，重复查询 → 缓存与失效策略。
9. **文档即交接**：现状快照 + 命令 + 环境特性 + 踩坑根因 + 诊断手段，固定结构持续更新，连 AI 的开场白都写好。

## 五、截图与现场

下面是 AcLedger 桌面版（Electron 无边框窗口）的实际运行截图，数据为虚构演示数据（真实账单不进公开场合）：

**数据源配置页**——GitHub 一键连接（OAuth 设备流）/ WebDAV / 本机文件夹三种存储，对应坑 2 和坑 6 的设计：

![AcLedger 数据源配置页](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-01-setup.webp)

**记账页**——手动记一笔，类型/分类/账户/对方/备注，保存后自动清空表单连续录入：

![AcLedger 记账页](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-02-add.webp)

**账单页**——按月浏览、筛选、行内编辑；工具栏的「按商户补分类（N）」一键把存量未分类交易按商户名匹配到分类（140 笔演示数据里 16 笔待补）：

![AcLedger 账单页与按商户补分类](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-03-transactions.webp)

**导入页**——微信/支付宝账单拖拽上传，自动识别类型、解析预览、按交易单号去重后批量入库（对应坑 3）：

![AcLedger 账单导入页](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-04-import.webp)

**统计页**——日期范围全局联动：月度/年度收支、支出商户 Top 榜、收支趋势（柱状/折线切换）、分类占比（饼图/横向柱状切换）：

![AcLedger 统计页](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-05-stats.webp)

**设置页**——账户与分类管理、自动分类自定义规则（自定义优先于内置 140 关键词，规则存数据仓库多设备同步）：

![AcLedger 设置页](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/acledger-06-settings.webp)

## 六、还没完：路线图与诚实清单

交接文档里的「待办」同样值得记录——它让项目知道自己在哪里：

- Web 版 GitHub 授权受 CORS 限制只能手动 PAT，如需设备流要加 Serverless 中转（Cloudflare Worker 持 client_secret 做授权码流）
- 桌面版自动更新（electron-updater）未做
- 导入时分类自动映射（按商品名猜分类）已做一半（补分类做了，导入时映射待做）
- 移动端 / PWA、CSV 导出
- portable 打包形态被安全软件拦了，可选深究或直接移除 target

两天 22 个提交不是「快」的证明，而是**验证驱动 + 文档交接 + 最小依赖**这套纪律的证明。把坑写进文档而不是记在脑子里，下一个版本、下一个项目都会感谢你。

---

*本文截图来自 AcLedger 桌面版 v0.1.0 开发窗口；项目开源在 [github.com/AnAcretiondisk9986/ac-ledger](https://github.com/AnAcretiondisk9986/ac-ledger)，Web 版在线体验：[anacretiondisk9986.github.io/ac-ledger](https://anacretiondisk9986.github.io/ac-ledger/)。*
