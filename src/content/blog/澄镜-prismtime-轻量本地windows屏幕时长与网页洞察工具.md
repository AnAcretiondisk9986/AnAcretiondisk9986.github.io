---
title: "澄镜 PrismTime：7.59 MB 原生内存、100% 本地优先的 Windows 屏幕时长与网页洞察工具"
description: "用 Rust + Tauri v2 + React 19 打造一款「无感 · 轻盈 · 本地化」的 Windows 桌面屏幕使用时长、精确时段轨迹、浏览器网页洞察与 WebDAV / GitHub 跨设备同步工具。7.59 MB 监控核心内存、0.02% CPU 占用、全手绘几何 SVG 双主题，现已开源发布 V0.3.0。"
pubDate: "2026-11-25"
dayIndex: 1
cover: "/images/prism-time/cover.webp"
tags:
  - PrismTime
  - Rust
  - Tauri
  - React
  - Windows
  - 效率工具
  - 开源项目
categories:
  - tech
draft: false
access: public
---

<h1 style="text-align: center"><u><span style="color: #8fb3ff; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">澄镜 · PrismTime</span></u>：像三棱镜一样，把浑浊的屏幕时间折射成清晰光谱</h1>

<p style="text-align: center; color: #9399b2">7.59 MB 监控核心内存 · 0.02% 平均 CPU · 100% 本地优先 · 浅层 UIA 网页洞察 · WebDAV / GitHub 双向无损同步</p>

每天在 Windows 电脑前坐八到十个小时，切过十几个终端、IDE、浏览器标签页与通讯软件之后，你是否也会产生一种恍惚感：**「我今天到底把时间花在了哪里？」**

市面上并不缺屏幕时间统计工具，但用过一圈之后，我始终找不到一款真正契合自己工程洁癖的作品：

- **有的后台极其臃肿**：一个用来统计时长的辅助小工具，自己却带着一整套重型运行时和数据库服务，常驻内存动辄两三百兆，甚至比被它监控的编辑器还吃资源；
- **有的进程列表杂乱无章**：把 `svchost.exe`、`ApplicationFrameHost.exe`、`RuntimeBroker.exe`、输入法守护和一堆带 `.exe` 后缀的底层子进程原样甩给用户，报表根本没法看；
- **有的把浏览器当成一个「黑盒」**：一天下来只告诉你「Edge 用了 5 小时」，却分不清这 5 小时究竟是在查 Rust 文档、刷 B 站、跟 Claude 对话，还是在看 arXiv 论文；而如果装浏览器扩展，又要在每个浏览器里折腾一遍且容易拖慢页面；
- **有的隐私边界模糊**：强制注册云端账号、后台静默上传完整的窗口标题与含 Token 的 URL 路径。

既然没有趁手的，那就自己造一面足够澄澈、足够克制的镜子。

于是有了 **澄镜（PrismTime）**——一款基于 **Rust + Tauri v2 + Win32 / UI Automation + React 19 + 纯手绘几何 SVG** 构建的 Windows 10/11 桌面屏幕时长、精确时段轨迹、网页浏览洞察与跨设备同步工具。目前项目已迭代至 **`V0.3.0`**，并以 MIT 协议完整开源在 GitHub：**[AnAcretiondisk9986/prism-time](https://github.com/AnAcretiondisk9986/prism-time)**。

![澄镜 PrismTime 宣传封面：7.59 MB · 100% 本地](/images/prism-time/cover.webp)

---

## 视频演示：B 站 4K 宣传片

项目配套制作了一支 4K 60fps 宣传演示视频，快速预览 **澄镜 · PrismTime** 的设计语言、双主题切换与多维可视化工作区：

<div class="video-embed">
  <iframe src="//player.bilibili.com/player.html?isOutside=true&aid=117676819161017&bvid=BV12aykz4E3S&cid=43914232749&p=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>
</div>

> **快速传送门**：
> - **GitHub 开源仓库**：[https://github.com/AnAcretiondisk9986/prism-time](https://github.com/AnAcretiondisk9986/prism-time)
> - **V0.3.0 单文件安装包下载**：[PrismTime-V0.3.0-windows-x64-setup.exe (GitHub Releases)](https://github.com/AnAcretiondisk9986/prism-time/releases/tag/V0.3.0)

---

## 一、三大工程准则：无感 · 轻盈 · 本地化

从第一行 Rust 探针代码到前端每一个手绘 SVG 像素，「澄镜」始终围绕 **无感、轻盈、本地化** 三条铁律构建：

![PrismTime 系统架构与数据流全景（Nano Banana 生成）](/images/prism-time/architecture.webp)

### 1. 无感（Unobtrusive & Zero-Intrusion）：安静地待在托盘里，绝不打扰你

一款合格的时间记录仪，首先应该做到**存在感为零**：

- **1 Hz 原生轻量探针 + 宿主进程自动穿透**：后台独立 Rust 线程每秒调用一次 `GetForegroundWindow` 探测活跃窗口；遇到 Windows UWP 宿主（`ApplicationFrameHost.exe`）或内嵌视图（`msedgewebview2.exe`）时自动向下穿透子窗口句柄，精准还原背后的真实应用。
- **智能空闲感知与影音 3 倍豁免**：基于 `GetLastInputInfo` 实时计算键鼠无操作时长。当你在全屏看视频、听音乐或演示文档时，系统会自动将空闲离开阈值**放宽 3 倍**（在 `V0.3.0` 中还支持针对任意软件单独设为 `1× / 2× / 3×` 甚至**「持续计时永不空闲」**），彻底告别看番到一半被判定为离开电脑的尴尬。
- **锁屏秒封存、跨午夜零点守恒切分、15 秒断点快照**：按下 `Win+L` 锁屏或弹出 UAC 安全桌面的瞬间立即封存当前会话；熬夜跨过 `00:00` 的连续会话自动按本地零点严格切分，绝不把熬夜时长算错日期；运行期每 15 秒原子更新一次 `active_session.json`，哪怕突然断电或强制重启，下次开机也能一秒不差地无损恢复。
- **默认不统计自身**：当你打开「澄镜」翻看报表时，这段查看报表的时间默认被静默排除，不污染客观工作数据。

### 2. 轻盈（Featherlight Footprint）：7.59 MB 核心内存，全手绘几何 SVG

在我的主力机（Windows 11 · i9-14900HX · 48 GB RAM）上连续运行 `40.30 分钟` 的实测基准如下：

| 核心指标项 | 实机实测数值 | 技术细节与说明 |
| :--- | :--- | :--- |
| **Rust 监控核心专用工作集** | **`7.59 MB`** | `prism-time.exe`（含采集线程、状态锁、目录缓存与 Tokio 运行时） |
| **Rust 监控核心平均 CPU** | **`0.02%`** | 连续运行 40.30 分钟累计消耗 CPU 时间仅 `15.64 秒` |
| **单条会话记录磁盘占用** | **`~271 Bytes`** | 当日 79 条完整时段记录仅占 `20.89 KB`，全年高强度使用仅约 `29 MB` |
| **前端生产包总体积（`dist/`）** | **`385.18 KB`** | Gzip 后仅 `108.66 KB`，零重型第三方图表库、零外部字体包 |
| **便携发布包体积** | **`7.89 MiB`** | 复用 Windows 系统内置 WebView2，彻底告别百兆 Chromium 冗余打包 |
| **全套自动化单元测试耗时** | **`0.03 秒`** | 涵盖跨日切分、整点守恒、本机 148 项注册表扫描等核心测试 |

为了把前端体积与渲染开销压到极致，**全仓坚持零 Emoji、零 ECharts/Chart.js 等重型图表库依赖**——所有导航图标、软件分类徽章、无边框窗口控制键以及全部多维交互式可视化图表，100% 由原生手绘几何 SVG 实现。

### 3. 本地化（100% Local-First & Privacy-Pure）：你的时间轨迹，只属于你

- **纯文本 JSONL 本地沙盒**：所有数据默认存放在本机 `%LOCALAPPDATA%\PrismTime`，会话按自然日分片为 `sessions/YYYY-MM-DD.jsonl`。没有加密黑盒数据库，用任意文本编辑器或脚本都能直接检视与备份，且所有配置写入均走 `.tmp` 临时文件原子替换（`ReplaceFileW`）。
- **默认零网络请求，按需绑定自有云端**：不设任何官方账号体系，不发一条遥测请求。需要多设备协同？你可以直接绑定**自己的坚果云 / Nextcloud / Alist（WebDAV）**或**自己的 GitHub 私有仓库**。

---

## 二、四级识别流水线与「不拖慢浏览器」的网页洞察

为什么很多屏幕统计软件的列表看着让人抓狂？因为它们只拿了 `GetWindowThreadProcessId` 的原始进程名，却没有做**「去噪、归一化与语义识别」**。

在 `PrismTime V0.3.0` 中，我设计了一套完整的 **四级软件与网页识别流水线**，并把**最高决策权（Tier 0）**交还给用户：

![四级识别流水线与浏览器浅层 UIA 隐私净化机制（Nano Banana 生成）](/images/prism-time/recognition-pipeline.webp)

### 1. 桌面软件四级识别（Tier 0 → Tier 3）

- **第零级（Tier 0 · 用户自定义进程/软件规则，最高优先级）**：
  - 在「软件识别库」点击 **「+ 自定义进程规则」**，可按无拓展名进程名（支持逗号分隔多个）、安装路径关键词或窗口标题关键词新建规则，甚至可以覆盖系统默认过滤策略。
  - 点击任意已有软件的编辑按钮，均可自由定制：**显示名称、软件类别、功能简介、自定义标签、自定义图标（PNG/SVG/JPG）、额外绑定子进程别名、将时长合并至其他软件、独立空闲判定倍率、强制开启/关闭网页识别**以及**统计忽略**，并支持一键恢复默认。
- **第一级（Tier 1 · 构建期内置 90+ 软件百科）**：
  - 预置 9 大类别（研发与终端、AI 与智能助手、网页浏览、设计创意、办公与学习、社交通讯、影音娱乐、游戏娱乐、效率与系统）共 90+ 款高频桌面软件规则。
  - 既涵盖 **微信、QQ、钉钉、飞书、WPS Office、剪映专业版、豆包、Kimi、网易云音乐、Folia** 等本土生态，也深度覆盖 **Google Antigravity、VS Code、OpenAI Codex、Cursor、WezTerm、ZCode、Qoder、WorkBuddy、EcoPaste、Obsidian、Blender、Steam** 等开发者与创作者工具。
  - 自动拦截数十类系统后台守护进程，仅允许真实的「文件资源管理器」窗口（`CabinetWClass` / `ExploreWClass`）计入统计，点击桌面壁纸或任务栏绝不混入脏数据。
- **第二级（Tier 2 · 本机注册表智能扫描与高清原生图标提取）**：
  - 自动遍历 `HKLM` / `HKCU` 卸载注册表分支，智能剔除 VC++ 运行库、驱动与安全补丁，并通过 Win32 `SHGetFileInfoW` 提取可执行文件的原生高清图标转为 Base64 缓存。
- **第三级（Tier 3 · 无拓展名纯净进程名兜底）**：
  - 遇到绿色单文件或自研小工具时，自动剥离 `.exe` / `.cmd` / `.scr` 后缀并保留原始大小写与内部点号（例如 `Flow.Launcher.exe` 自动记录为整洁的 `Flow.Launcher`）。

### 2. 拆解「浏览器黑盒」：浅层 UIA 探测 + 内存级隐私域名净化

对重度依赖浏览器的用户来说，「今天用了 4 小时浏览器」毫无信息量。但如果在不装任何浏览器插件的前提下，从桌面端直接识别浏览器里正在看什么网站，会遇到一个著名的性能陷阱：

> **一旦用常规 UI Automation 对 Chromium / Firefox 窗口发起无限制的深层子树搜索，就会强行唤醒目标浏览器的全量 DOM 无障碍树（Accessibility Tree），导致浏览器内存暴涨、页面滚动掉帧卡顿！**

为了彻底绕开这个雷区，「澄镜」在 `win_probe.rs` 中实现了一套**严格限深的浅层 UIA 探测 + 标题启发式双引擎**：

1. **绝不触碰网页 DOM 容器**：UIA 树遍历严格限制**最大深度 `7`、单次最多检查 `96` 个控件节点**；一旦遇到 `UIA_DocumentControlTypeId`（`50030`）或类名包含 `RenderWidgetHost` / `Chrome_RenderWidgetHostHWND` 的网页渲染区域，**立即剪枝跳过**，只读取浏览器顶栏的地址栏控件。
2. **内存级 URL 隐私剥离**：拿到的地址栏文本在内存中**即时丢弃路径（Path）、查询参数（Query，`?token=...`）与锚点（Hash）**，只保留干净的根域名或本地开发主机名（如 `github.com`、`bilibili.com`、`localhost:1420`），从源头杜绝敏感链接落盘。
3. **60+ 国内外网站百科 + 切站自动分段**：兼容 Edge、Chrome、Ego Browser、Firefox、Brave、Arc、Vivaldi、Opera、Zen、夸克、360、QQ 浏览器等几乎所有主流浏览器（以及通过自定义规则标记为浏览器的任意应用）。当你在同一个浏览器窗口里从 **GitHub** 切到 **哔哩哔哩** 再切到 **ChatGPT / 知乎 / LINUX DO** 时，探针会自动切分出独立的网站使用时段！

---

## 三、双主题视觉与五大工作区实机巡礼

「澄镜」提供日间纸感通透的 **澄白（Alabaster）** 与夜间低眩光沉静的 **曜石（Obsidian）** 两套原生主题，并内置了非破坏性的 **「图表演示」** 模式——刚装好软件还没有积累数据时，点一下顶栏的「图表演示」就能一键预览全天完整样本，且绝不触碰你的真实本地数据文件。

### 1. 今日概览：24 小时专注泳道与双主题对照

打开主界面，首先映入眼帘的是 4 张核心指标卡（总屏幕时长、主导软件类别、全天高峰窗口、最长单次连续专注），紧接着是纯手绘 SVG 渲染的 **24 小时应用专注泳道图（Swimlane）**——你今天在什么时间段集中写代码、什么时候碎片化回消息、每次专注持续了多久，在一张图上一目了然：

![今日概览（曜石 Obsidian 深色主题）：核心指标卡与 24 小时应用专注泳道](/images/prism-time/overview-dark.webp)

如果你偏爱日间清爽的高对比度纸感阅读体验，点击右上角即可毫秒级切换至 **澄白（Alabaster）** 主题：

![今日概览（澄白 Alabaster 浅色主题）：日间高通透纸感界面](/images/prism-time/overview-light.webp)

向下滚动概览页，则是 **24 小时分时分类堆叠柱状图**、**软件类别环形占比图** 以及按累计时长排序的 **高频软件与热门网站榜单**（支持点击图例单独高亮某一类别）：

![今日概览下半屏：24 小时分时活跃分布、类别环形图与软件排行](/images/prism-time/overview-charts-dark.webp)

### 2. 单软件深度洞察抽屉

在概览、排行或识别库中点击任意一款软件（例如 `Antigravity`），右侧会丝滑滑出该软件的专属洞察抽屉——展示当日总时长、活跃高峰小时、最长单次连续使用、24 小时微型分时柱，以及精确到秒（`HH:MM:SS - HH:MM:SS`）的每一次会话起止明细：

![单软件时段洞察抽屉：当日 24 小时分布与精确到秒的会话区间](/images/prism-time/app-drawer-open-dark.webp)

### 3. 时段趋势：五时段作息节律与 7 日 / 30 日演化

切换到 **「时段趋势」** 工作区，除了可以按日期前后翻阅历史每一天的泳道图谱外，系统还会将全天划分为 **深夜（00-06）、清晨（06-09）、上午（09-12）、下午（12-18）、夜晚（18-24）** 五个作息窗口，自动计算每个时段的主导软件类别，并配合右侧的 **近 7 日 / 近 30 日堆叠趋势柱状图** 呈现你的长期用屏规律：

![时段趋势工作区：五时段用屏节律分布与连续多日屏幕时长趋势](/images/prism-time/timeline-dark.webp)

### 4. 网页洞察：彻底看清浏览器里的每一分钟

在 **「网页洞察」** 专属工作区中，浏览器不再是一个笼统的图标：

- 顶部直接给出 **浏览器网页总时长及占总屏幕比例**、**最常访问网站**、**主导网页题材** 与 **宿主浏览器载体分流**；
- 中部通过 **24 小时网页内容分布柱状图** 与 **8 大网页类别环形图**（代码与技术、AI 与智能工具、文档与学术、视频与流媒体、社交与社区、资讯与阅读、设计与创意、综合网页），直观呈现你的线上注意力结构；
- 底部提供可按题材筛选、按域名/名称检索的 **网站访问排行榜與切站活跃时段胶囊**。

![网页浏览洞察工作区：24 小时网页题材分布、载体分流与站点排行榜](/images/prism-time/web-dark.webp)

### 5. 本机软件识别库与自定义进程规则（`V0.3.0` 重磅升级）

**「软件识别库」** 不仅是一张展示本机已安装软件和活跃进程的网格画廊，更是你掌控分类规则的中枢：

![本机软件识别库：自动聚合已识别软件、原生图标、分类标签与今日活跃时长](/images/prism-time/catalog-dark.webp)

在最新的 **`V0.3.0`** 版本中，点击右上角的 **「+ 自定义进程规则」**（或点击任意卡片右上角的编辑铅笔），即可唤出功能完备的规则定制弹窗——支持按进程名、路径关键词或窗口标题匹配，自定义空闲倍率（含永不空闲的持续计时模式）、合并统计至其他软件、上传自定义图标，或者勾选「作为浏览器识别网页」：

![V0.3.0 新增：新建自定义进程/软件规则弹窗](/images/prism-time/catalog-custom-rule-dark.webp)

### 6. 跨设备双向无损同步：WebDAV & GitHub 私有仓库（`V0.3.0` 重磅升级）

如果你同时拥有台式机与笔记本两台 Windows 设备，过去最大的遗憾就是两边的屏幕时间各自孤立。

在 **`V0.3.0`** 中，我用纯 Rust 基于 Windows 原生 **WinHTTP API**（`win_http.rs`，**零 C 语言 OpenSSL/curl 依赖，且自动遵循系统代理设置**）手写了一套跨设备双向同步引擎：

![V0.3.0 新增：监控设置中的 WebDAV 与 GitHub 私有仓库跨设备双向同步面板](/images/prism-time/settings-sync-dark.webp)

- **三种模式自由切换**：默认保持「仅本地离线」；可随时切换至 **WebDAV 同步**（内置坚果云、Nextcloud、Alist 快捷地址模板，自动执行 `MKCOL` 创建远端目录）或 **GitHub 仓库同步**（通过 Fine-grained / Classic PAT 调用 GitHub Contents REST API，配合 Blob SHA 乐观锁直推私有仓库）。
- **按日分片无损并集合并算法（Union Merge）**：多台电脑在同一天产生的数据**绝不会互相覆盖**！同步引擎会按自然日拉取远端与本地的 `.jsonl` 分片，基于会话唯一 ID 与 `(app_id, start_ts, end_ts, web_site_id)` 四元组智能去重取并集，并自动合并多端自定义软件规则（`custom_profile.json`）。
- **定时后台静默同步**：支持开启每 15 分钟 / 30 分钟 / 1 小时 / 3 小时的后台自动同步，也可随时点击「测试连接」与「立即双向同步」。

---

## 四、硬核工程细节：纯 Rust 单文件安装器与零 MSVC 编译闭环

除了应用本体，「澄镜」在 Windows 工具链与分发体验上也做到了极致自洽：

1. **纯 Rust 编写的单文件 Windows 安装向导（`PrismTime Setup`）**：
   - 位于 `src-tauri/installer/`，无需依赖 NSIS 或 WiX 等外部打包器，直接用纯 Rust + Win32 原生对话框构建出单文件安装程序 `PrismTime-V0.3.0-windows-x64-setup.exe`。
   - 双击即可免管理员权限部署至 `%LOCALAPPDATA%\Programs\PrismTime`，自动创建桌面与开始菜单快捷方式、注册 Windows「设置 → 已安装的应用」标准卸载项；覆盖升级时自动保留全部历史数据，还支持 `--silent` 静默安装参数。
2. **零 MSVC 依赖的纯 GNU Rust 编译闭环**：
   - 在 Windows `x86_64-pc-windows-gnu` 工具链下，很多 Rust GUI 项目会卡在 `dlltool.exe` 缺失或 `rc.exe` 资源编译失败。
   - 项目直接内置了自研的纯 Rust 导入库生成垫片 `src-tauri/tools/dlltool_shim.rs`（生成带唯一哈希前缀成员的 GNU 长格式 COFF 导入归档）与 `src-tauri/vendor/tauri-winres`，无需安装庞大的 Visual Studio C++ 生成工具，一行 `.\build-windows.ps1` 即可启用 `strip = true` 与 `lto = "thin"` 一键编译出精简主程序与单文件安装包。

---

## 五、立即下载体验与开源地址

**澄镜 · PrismTime `V0.3.0`** 现已正式发布，推荐直接下载单文件安装程序，双击 3 秒即可完成安装并开启无感记录：

- **GitHub 仓库主页（欢迎 Star 支持）**：[https://github.com/AnAcretiondisk9986/prism-time](https://github.com/AnAcretiondisk9986/prism-time)
- **V0.3.0 Release 下载页**：[https://github.com/AnAcretiondisk9986/prism-time/releases/tag/V0.3.0](https://github.com/AnAcretiondisk9986/prism-time/releases/tag/V0.3.0)
  - 推荐下载：**`PrismTime-V0.3.0-windows-x64-setup.exe`**（单文件安装向导，支持一键安装、升级与标准卸载）
  - 运行环境：Windows 10 / 11（64 位）及系统自带的 Microsoft Edge WebView2 运行时

如果你喜欢自己从源码编译，也只需要三步：

```powershell
git clone https://github.com/AnAcretiondisk9986/prism-time.git
cd prism-time
npm install
.\build-windows.ps1
```

---

## 结语

在这个连记事本和小工具都在疯狂接入云端遥测、动辄吞掉几百兆内存的年代，我依然相信**「克制」是桌面软件最高级的质感**。

`7.59 MB` 的常驻核心内存、`0.02%` 的 CPU 呼吸、不唤醒浏览器 DOM 树的浅层网页洞察、全部落在本地 `%LOCALAPPDATA%\PrismTime` 的纯文本 JSONL 分片，再加上完全由你自己掌控的 WebDAV / GitHub 私有仓库同步与自定义进程规则——**澄镜（PrismTime）** 不试图教育你该如何管理时间，它只做一块安静、剔透的三棱镜，把你每天在屏幕前度过的真实轨迹，诚实地折射成清晰可感的光谱。

欢迎下载试用，如果有任何想要补充进内置百科的软件、网站或新特性建议，欢迎在 B 站视频评论区或 [GitHub Issues](https://github.com/AnAcretiondisk9986/prism-time/issues) 留言交流！
