---
title: "WezTerm 介绍、推荐与实战配置：Agent CLI 时代的终端驾驶舱"
description: "在 Claude Code、Google Antigravity CLI、Codex 与 Pi Agent 成为日常开发主力后，为什么我把主力终端换成了 WezTerm？深度解析其在 Agent CLI 场景下的核心优势，并附上 Windows 11 亚克力毛玻璃、胶囊标签栏与 Shift+Enter 多行输入的完整 ~/.wezterm.lua 实战配置。"
pubDate: "2026-11-21"
dayIndex: 1
cover: "/images/wezterm-guide/cover.webp"
tags:
  - WezTerm
  - 终端
  - Agent CLI
  - 效率工具
  - Windows
  - Lua
draft: false
access: public
---

<h1 style="text-align: center"><u><span style="color: #cba6f7; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">WezTerm</span></u> 介绍、推荐与实战配置</h1>

<p style="text-align: center; color: #9399b2">当开发主力从传统 IDE 回归命令行，给 Agent CLI 找一个配得上它的「终端驾驶舱」。</p>

前几天陆续把本机正在用的几套主力编码智能体——[Claude Code CLI](/blog/claude-code-cli-使用手册/)、[Google Antigravity CLI](/blog/google-antigravity-cli-使用手册/)、[Codex CLI](/blog/codex-cli-使用指南/) 和 [Pi Agent](/blog/pi-agent-完全指南/)——整理成了系列使用手册。写完之后回头看自己的日常工作流，突然意识到一个最容易被忽略、却每天盯着看七八个小时的底层基础设施：**终端模拟器本身**。

在过去，终端只是偶尔敲几条 `git push`、`npm run dev` 或 `ssh` 的黑框框；但到了 **Agent CLI 时代**，终端的角色彻底变了——它同时承载着：

- 2～6 个并行运转的 AI Agent 会话（规划、改代码、跑测试、查日志同时进行）；
- 每秒几百行的高吞吐流式 Markdown、语法高亮 Diff、TUI 进度条与表格渲染；
- 动辄上万行的上下文回滚、频繁的多行提示词编辑、以及海量文件路径与 Commit Hash 的来回复制。

这时候再回头看传统终端，痛点就会瞬间放大：高吞吐输出掉帧闪烁、多行输入按 `Shift+Enter` 直接误发提示词、多个分屏看不清焦点导致指令发错窗口、Windows 下想做多路复用又不得不折腾 WSL + tmux。

折腾了一圈之后，我最终稳定在了 **WezTerm**（本机实测版本 `20240203-110809-5046fc22`）。这篇文章把 **为什么推荐 WezTerm、它在 Agent CLI 场景下不可替代的优势、以及我当前主力 `~/.wezterm.lua` 的完整配置和使用说明** 一次讲透。

![传统终端与 WezTerm Agent 驾驶舱对比](/images/wezterm-guide/legacy-vs-wezterm.webp)

---

## 一、WezTerm 是什么？为什么值得推荐

[WezTerm](https://wezterm.org/) 是由 Wez Furlong 用 **Rust** 编写的跨平台、GPU 加速终端模拟器与原生多路复用器（Multiplexer），原生支持 **Windows、macOS、Linux** 三大平台。

一句话概括它和其他现代终端的最大区别：

> **Alacritty 追求极简纯终端，Windows Terminal 止步于 JSON 静态配置，iTerm2 绑定 macOS，而 WezTerm 把「GPU 渲染引擎 + 内置 Multiplexer + 完整 Lua 编程能力」融进了一个跨平台二进制里。**

先看一张横向对比，定位会更直观：

| 特性维度 | WezTerm | Windows Terminal | Alacritty | Ghostty | iTerm2 |
| --- | --- | --- | --- | --- | --- |
| **跨平台一致性** | Windows / macOS / Linux 全覆盖 | 仅 Windows | 全平台 | macOS / Linux（Windows 滞后） | 仅 macOS |
| **GPU 渲染加速** | WebGPU / OpenGL | DirectX | OpenGL | Metal / OpenGL | Metal |
| **配置文件语言** | **Lua（图灵完备、热重载）** | JSON | TOML | Key-Value 文本 | 图形界面 / Plist |
| **原生分屏与 Mux** | **完整内置（含 Workspaces / SSH 域）** | 仅基础分屏 | 无（强依赖 tmux） | 基础分屏 | 完整内置 |
| **字体连字 & CJK 回退** | **HarfBuzz + 多字体精准回退栈** | 良好 | 无连字 | 优秀 | 优秀 |
| **Quick Select 零鼠标抓取** | **原生内置（正则可扩展）** | 无 | 仅基础 Hint | 无 | 需插件/配置 |
| **Windows Agent CLI 适配度** | **极高（一站式无痛）** | 中等 | 偏低（无标签/分屏） | 不适用 | 不适用 |

在我自己的 Windows 11 环境下，配合 Catppuccin Mocha 配色、Windows 11 原生 Acrylic 亚克力毛玻璃、Anthropic Mono 等宽字体以及用 Lua 写的胶囊标签栏，WezTerm 的日常主界面长这样：

![WezTerm Catppuccin Mocha 与亚克力毛玻璃主界面](/images/wezterm-guide/wezterm-ui-showcase.webp)

它既保留了原生应用级的轻量与流畅，又能通过不到 160 行 Lua 把界面视觉、快捷键、状态栏和多窗格交互打磨到和自己的工作流严丝合缝。

---

## 二、核心优势：为什么 WezTerm 天生契合 Agent CLI？

如果你只是偶尔敲几句 shell 命令，任何终端其实都能凑合；但一旦你开始重度使用 **Claude Code、Antigravity CLI（`agy`）、Codex CLI、Pi Agent** 这类交互式 Agent TUI，WezTerm 的六大优势会立刻拉开代差。

![WezTerm 赋能多 Agent CLI 并行协作的技术架构](/images/wezterm-guide/arch-agent-workflow.webp)

### 1. GPU 渲染管线 + HarfBuzz：高吞吐 TUI 与长输出稳如磐石

现代 Agent CLI 早已不是纯白字黑底——它们大量使用 24-bit TrueColor、Unicode 盒绘边框、Nerd Font 状态图标、实时刷新的 Spinner 动画、以及折叠展开的代码 Diff。

- WezTerm 底层采用 Rust + GPU 渲染（支持 WebGPU / OpenGL），在 Agent 一次性输出几百行代码修改或编译日志时，屏幕刷新依然丝滑，几乎看不到传统终端常见的行撕裂或滚动卡顿。
- 内置 **HarfBuzz** 文本塑形引擎，支持编程连字（`=>`、`!==`、`===`、`->`）和精细的字体回退链表——英文等宽字体、Nerd Font 图标、中文字体和 Emoji 各司其职，不会出现 Agent 输出表格框线错位、图标变方框的问题。
- 配合 `config.scrollback_lines = 20000`，哪怕一个 Agent 会话连续跑了半小时重构、吐出上万行工具调用日志，随时往上滚依然完整保留。

### 2. 一行 Lua 彻底解决 `Shift+Enter` 换行误发

用过 Windows 终端跑 Claude Code / Codex / Antigravity CLI 的人几乎都踩过同一个坑：**想在输入框里换行写一段带编号的复杂提示词，习惯性按下 `Shift+Enter`，结果直接把半截话发给了模型，白烧一轮 Token。**

原因在于传统终端协议下，`Shift+Enter` 和普通 `Enter` 默认发送的都是同一个 `\r`（CR），CLI 根本区分不出来。

在 WezTerm 里，不需要改系统键盘布局，也不需要折腾复杂的终端转义补丁，在 `~/.wezterm.lua` 里加一行快捷键映射即可全局搞定：

```lua
{ key = "Enter", mods = "SHIFT", action = act.SendString("\x1b\r") },
```

发送 `ESC + CR`（`\x1b\r`）后，Claude Code、Antigravity CLI、Codex CLI 等主流 Agent 输入框都会精准识别为「插入换行」而非「提交消息」。此外 WezTerm 也原生支持 Kitty Keyboard Protocol（`enable_kitty_keyboard = true`）和 `CSI u` 扩展按键编码，对未来新一代 TUI 的组合键兼容性同样拉满。

### 3. Windows 原生分屏 + 非焦点窗格自动压暗：多 Agent 并行不再发错指令

用 Agent 干活最爽的姿势不是干等着一个模型吐字，而是 **多窗格并行**：

- 左侧大窗格跑 **Claude Code** 写核心功能或审阅架构计划；
- 右上窗格跑 **Antigravity CLI（`agy`）** 或实时 `git log --graph` / `git diff` 盯变动；
- 右下窗格跑 **Pi Agent**、**Codex CLI** 或开发服务器构建日志。

在 macOS / Linux 上很多人靠 `tmux` 实现这套拓扑，但 Windows 原生 PowerShell 环境没有好用的 tmux。WezTerm 直接把**分屏、标签页、缩放、工作区（Workspaces）**全部做进了原生内核，并且通过 `inactive_pane_hsb` 提供了一项对多 Agent 工作流堪称神器的视觉能力：

```lua
config.inactive_pane_hsb = {
  saturation = 0.85,
  brightness = 0.65,
}
```

**当你切到左侧 Claude Code 窗格输入指令时，右侧两个非活动窗格会自动降低亮度与饱和度。** 哪怕一个屏幕里同时开着 4～6 个 Agent，你的视线也能在 0.1 秒内锁定当前光标所在位置，彻底杜绝「以为自己在跟 A 对话、结果把 `rm` 或部署指令发给了 B」的惊悚事故。

![WezTerm 多 Agent CLI 三分屏协作与非焦点压暗效果](/images/wezterm-guide/wezterm-multi-agent-cockpit.webp)

更顺手的是 **`Alt+Z` 窗格全屏缩放（TogglePaneZoomState）**：当某个 Agent 吐出一份几十行的重构 Plan 或大段报错堆栈，在小分屏里折行看不清时，按一下 `Alt+Z` 瞬间铺满整个窗口，标签栏还会自动挂上 `[Z]` 徽标提醒你当前处于缩放态；看完再按一下 `Alt+Z`，瞬间还原多窗格监控布局。

### 4. Quick Select (`Ctrl+Shift+Space`)：零鼠标抓取路径、Hash 与报错链接

Agent CLI 输出的内容里，最高频需要二次复用的东西就是四类字符串：
1. 修改过的文件路径（如 `src/content/blog/wezterm-agent-cli-guide.md`）
2. Git Commit Hash（如 `5173d45`）
3. 本地预览 URL 或文档链接（如 `http://localhost:4321/...`）
4. 构建摘要、IP 地址与端口

传统做法是伸手摸鼠标、小心翼翼拖选、经常多选一个空格或少选一个后缀。

WezTerm 原生内置了 **Quick Select 模式**（默认快捷键 `Ctrl+Shift+Space`）：按下之后，终端会自动用正则扫描当前屏幕里的所有路径、URL、SHA/Git 哈希、IP 和引号内容，在每一项旁边贴上高亮字母标签（`a`、`s`、`d`、`f`……）：

- **按小写字母**：直接将该内容复制到剪贴板；
- **按大写字母（`Shift + 字母`）**：复制并**直接粘贴回当前 Agent 输入框**！

![Quick Select 零鼠标抓取与窗格全屏缩放 [Z]](/images/wezterm-guide/wezterm-quick-select.webp)

全程双手不离键盘，半秒把报错文件路径或 Commit Hash 塞回给 Agent，用过一次就真的回不去了。

### 5. Lua 热重载：改配置绝不中断正在干活的 Agent

当你的 Claude Code 或 Antigravity CLI 正在跑一个耗时 10 分钟的复杂重构任务时，突然觉得字号小了点、行距紧了点、或者想临时加一条快捷键——传统终端往往需要重启窗口才能让配置生效，直接把跑了一半的上下文杀掉。

WezTerm 开启 `config.automatically_reload_config = true` 后，**只要保存 `~/.wezterm.lua`，字体、配色、透明度、快捷键、状态栏脚本全部毫秒级热重载生效，所有正在运行的 Agent 进程纹丝不动。**

### 6. `wezterm cli` 可编程控制：连 Agent 自己都能调度终端

WezTerm 不仅给人用，它的 CLI 接口本身就是自动化利器。通过 `wezterm cli`，你可以用脚本（甚至让 Agent 自己）完成窗格编排：

- `wezterm cli list`：列出当前所有窗口、标签、窗格、工作区与进程标题；
- `wezterm cli split-pane --right --percent 45 -- <命令>`：一键按比例开分屏并启动指定 Agent 或服务；
- `wezterm cli set-tab-title` / `zoom-pane` / `activate-pane`：脚本化管理工作流布局；
- `wezterm cli get-text --pane-id <id>`：直接抓取指定窗格的终端文本内容。

如果你平时经常在多个项目仓库之间切换，还可以利用 WezTerm 原生的 **Workspaces（工作区）** 把「个人博客」、「课程项目」、「工具脚本」隔离成独立工作区，互不干扰。

---

## 三、安装与快速开始

### Windows（推荐 WinGet 或 Scoop）

打开 PowerShell 执行以下任一命令：

```powershell
# 方式一：WinGet（官方推荐）
winget install wez.wezterm

# 方式二：Scoop
scoop bucket add extras
scoop install wezterm
```

安装完成后重新打开终端，验证安装版本：

```powershell
wezterm --version
```

### macOS 与 Linux

```bash
# macOS (Homebrew)
brew install --cask wezterm

# Arch Linux
sudo pacman -S wezterm

# Ubuntu / Debian / Fedora 等可直接参考官方仓库源或 AppImage / Flatpak
# https://wezterm.org/install/linux.html
```

### 配置文件放在哪里？

WezTerm 启动时会自动按优先级查找配置文件，最通用的位置是用户主目录下的单文件：

- **Windows**：`C:\Users\<你的用户名>\.wezterm.lua`
- **macOS / Linux**：`~/.wezterm.lua`（也支持 `~/.config/wezterm/wezterm.lua`）

只需要新建这个文件，写完保存即可自动生效。

---

## 四、我的主力 `~/.wezterm.lua` 完整拆解

下面这套配置就是我现在每天在 Windows 11 上跑 Claude Code / Antigravity CLI / Codex / Pi Agent 的主力方案。我把它拆成 6 个模块讲清楚每一行的设计意图，文末附完整源码可直接复制。

### 模块 1：基础环境与 20,000 行超长回滚

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()
local act = wezterm.action

config.automatically_reload_config = true
config.default_prog = { "pwsh.exe", "-NoLogo" }
config.scrollback_lines = 20000
```

- 用 `wezterm.config_builder()` 而不是裸表 `{}`，这样配置项拼写错时 WezTerm 会弹出清晰报错提示。
- `default_prog` 指定 PowerShell 7（`pwsh.exe -NoLogo`），比 Windows 自带的旧版 PowerShell 5.1 启动更快、UTF-8 支持更干净；macOS/Linux 用户删掉这一行用默认 zsh/bash 即可。
- `scrollback_lines = 20000` 专门应对 Agent CLI 的长上下文与长日志输出。

### 模块 2：等宽字体 + Nerd Font + 中文回退栈

```lua
config.font = wezterm.font_with_fallback({
  { family = "Anthropic Mono", weight = "Regular" },
  "Symbols Nerd Font Mono",
  "Microsoft YaHei UI",
  "Segoe UI Emoji",
})
config.font_size = 11.5
config.line_height = 1.2
config.harfbuzz_features = { "calt=1", "clig=1", "liga=1" }
```

- 主字体我用了 **Anthropic Mono**，字形紧凑克制、数字与符号辨识度极高；如果你本机没有这款字体，直接换成 `JetBrains Mono`、`Maple Mono` 或系统自带的 `Cascadia Mono` 一样非常舒服。
- WezTerm **本身内置了 `Symbols Nerd Font Mono`**，所以哪怕你的主字体不是 Nerd Font 魔改版，也能完美渲染 Git 分支、文件夹、状态勾叉等所有 TUI 图标，不用到处找 patched 字体！
- 中文回退到 `Microsoft YaHei UI`（如果你之前照着我那篇[把 Windows 系统字体换成 Google Sans SC](/blog/抛弃微软雅黑-把-windows-系统字体换成-google-sans-sc/)折腾过，这里实际渲染出来就是超清爽的 Google Sans SC）。
- `line_height = 1.2` 给中英混排和 Agent 输出的 Markdown 留出呼吸感。

### 模块 3：Catppuccin Mocha + Windows 11 亚克力毛玻璃 + 一体化标题栏

```lua
config.color_scheme = "Catppuccin Mocha"
config.window_background_opacity = 0.82
config.text_background_opacity = 0.95
config.win32_system_backdrop = "Acrylic"
config.window_decorations = "INTEGRATED_BUTTONS|RESIZE"
config.integrated_title_button_style = "Windows"
config.window_padding = { left = 14, right = 14, top = 10, bottom = 10 }
config.initial_cols = 120
config.initial_rows = 34
```

- `INTEGRATED_BUTTONS|RESIZE` 砍掉了 Windows 传统的白色粗标题栏，把最小化/最大化/关闭按钮直接融合到标签栏右侧，纵向多赚出近两行有效终端视野。
- **小细节**：`window_background_opacity = 0.82` 搭配 `text_background_opacity = 0.95`，这样既能透出 Windows 11 Acrylic 的高级毛玻璃质感，又保证了语法高亮和 Diff 色块的对比度，长时间盯着代码不累眼。

### 模块 4：丝滑光标与非焦点窗格降噪

```lua
config.default_cursor_style = "BlinkingBar"
config.cursor_blink_rate = 550
config.cursor_blink_ease_in = "EaseOut"
config.cursor_blink_ease_out = "EaseOut"
config.cursor_thickness = "2px"
config.enable_scroll_bar = false

config.inactive_pane_hsb = {
  saturation = 0.85,
  brightness = 0.65,
}
```

- 竖线缓动光标（`BlinkingBar` + `EaseOut`）在 Agent 输入框里打字时非常像现代编辑器；
- 关掉右侧丑陋的滚动条，把视觉空间全留给内容；
- `inactive_pane_hsb` 让多 Agent 分屏的焦点层次一目了然。

### 模块 5：Lua 自定义胶囊标签栏与右上角状态栏

这是 WezTerm 的灵魂所在——通过监听 `format-tab-title` 和 `update-right-status` 事件，我们可以像写前端组件一样定制标签栏：

- 当前激活标签渲染成 Catppuccin Mocha 标志性的 **薰衣草紫胶囊（`#cba6f7`）**，未激活标签为暗灰胶囊；
- 自动提取前台进程名（去掉 `.exe` 后缀），比如 `1:pwsh`、`2:claude`、`3:agy`；
- 如果某个标签里有窗格按了 `Alt+Z` 放大，标签名自动追加 **`[Z]`** 徽标；
- 标签栏最右侧常驻显示 **当前工作区名（蓝色）│ 实时时间（绿色）**。

### 模块 6：面向 Agent CLI 的顺手快捷键

```lua
config.keys = {
  { key = "Enter", mods = "SHIFT", action = act.SendString("\x1b\r") },
  { key = "\\", mods = "ALT", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
  { key = "-", mods = "ALT", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },
  { key = "w", mods = "ALT", action = act.CloseCurrentPane({ confirm = true }) },
  { key = "LeftArrow", mods = "ALT", action = act.ActivatePaneDirection("Left") },
  { key = "RightArrow", mods = "ALT", action = act.ActivatePaneDirection("Right") },
  { key = "UpArrow", mods = "ALT", action = act.ActivatePaneDirection("Up") },
  { key = "DownArrow", mods = "ALT", action = act.ActivatePaneDirection("Down") },
  { key = "z", mods = "ALT", action = act.TogglePaneZoomState },
  { key = "t", mods = "CTRL|SHIFT", action = act.SpawnTab("CurrentPaneDomain") },
}
```

全套分屏与导航统一收敛在 **`Alt` 键** 下，完全不跟 Agent CLI 内部常用的 `Ctrl+C`、`Ctrl+R`、`Ctrl+D`、`Ctrl+L` 抢快捷键！且关闭窗格故意开启了 `confirm = true`，防止手滑关掉正在跑任务的 Agent。

<details>
<summary>点击展开：完整可一键复制的 <code>~/.wezterm.lua</code> 源码（156 行）</summary>

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()
local act = wezterm.action

-- 1. 基础与持久化配置
config.automatically_reload_config = true
config.default_prog = { "pwsh.exe", "-NoLogo" }
config.scrollback_lines = 20000

-- 2. 字体配置：主等宽字体使用 Anthropic Mono，配合内置 Nerd Font 图标与中文回退
config.font = wezterm.font_with_fallback({
  { family = "Anthropic Mono", weight = "Regular" },
  "Symbols Nerd Font Mono",
  "Microsoft YaHei UI",
  "Segoe UI Emoji",
})
config.font_size = 11.5
config.line_height = 1.2
config.harfbuzz_features = { "calt=1", "clig=1", "liga=1" }

-- 3. 配色、半透明窗体与 Windows 11 亚克力毛玻璃效果
config.color_scheme = "Catppuccin Mocha"
config.window_background_opacity = 0.82
config.text_background_opacity = 0.95
config.win32_system_backdrop = "Acrylic"
config.window_decorations = "INTEGRATED_BUTTONS|RESIZE"
config.integrated_title_button_style = "Windows"
config.window_padding = { left = 14, right = 14, top = 10, bottom = 10 }
config.initial_cols = 120
config.initial_rows = 34

-- 4. 光标与分屏视觉层次
config.default_cursor_style = "BlinkingBar"
config.cursor_blink_rate = 550
config.cursor_blink_ease_in = "EaseOut"
config.cursor_blink_ease_out = "EaseOut"
config.cursor_thickness = "2px"
config.enable_scroll_bar = false

config.inactive_pane_hsb = {
  saturation = 0.85,
  brightness = 0.65,
}

-- 5. 一体化标签栏样式
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = false
config.tab_bar_at_bottom = false
config.tab_max_width = 32
config.switch_to_last_active_tab_when_closing_tab = true

config.colors = {
  cursor_bg = "#f5e0dc",
  cursor_border = "#f5e0dc",
  split = "#45475a",
  tab_bar = {
    background = "rgba(17, 17, 27, 0.55)",
    new_tab = {
      bg_color = "rgba(49, 50, 68, 0.65)",
      fg_color = "#bac2de",
    },
    new_tab_hover = {
      bg_color = "#45475a",
      fg_color = "#cdd6f4",
    },
  },
}

-- 胶囊形标签页标题格式化
local SOLID_LEFT_ROUND = utf8.char(0xe0b6)
local SOLID_RIGHT_ROUND = utf8.char(0xe0b4)

local function get_tab_title(tab)
  local title = tab.tab_title
  if title and #title > 0 then
    return title
  end
  local proc = tab.active_pane.foreground_process_name or ""
  local name = proc:match("([^/\\]+)$") or tab.active_pane.title or "shell"
  name = name:gsub("%.exe$", "")
  return name
end

wezterm.on("format-tab-title", function(tab, tabs, panes, cfg, hover, max_width)
  local bar_bg = "rgba(17, 17, 27, 0.55)"
  local pill_bg = "#313244"
  local pill_fg = "#a6adc8"

  if tab.is_active then
    pill_bg = "#cba6f7"
    pill_fg = "#11111b"
  elseif hover then
    pill_bg = "#45475a"
    pill_fg = "#cdd6f4"
  end

  local zoomed = ""
  for _, pane in ipairs(tab.panes) do
    if pane.is_zoomed then
      zoomed = " [Z]"
      break
    end
  end

  local title = get_tab_title(tab)
  local label = string.format(" %d:%s%s ", tab.tab_index + 1, title, zoomed)
  local available = math.max(max_width - 2, 4)
  if wezterm.column_width(label) > available then
    label = wezterm.truncate_right(label, available - 1) .. "…"
  end

  return {
    { Background = { Color = bar_bg } },
    { Foreground = { Color = pill_bg } },
    { Text = SOLID_LEFT_ROUND },
    { Background = { Color = pill_bg } },
    { Foreground = { Color = pill_fg } },
    { Attribute = { Intensity = tab.is_active and "Bold" or "Normal" } },
    { Text = label },
    { Background = { Color = bar_bg } },
    { Foreground = { Color = pill_bg } },
    { Text = SOLID_RIGHT_ROUND },
    { Text = " " },
  }
end)

-- 右侧状态栏：显示当前工作区与时间
wezterm.on("update-right-status", function(window, pane)
  local workspace = window:active_workspace()
  local time_str = wezterm.strftime("%H:%M")

  window:set_right_status(wezterm.format({
    { Foreground = { Color = "#89b4fa" } },
    { Text = " " .. workspace .. " " },
    { Foreground = { Color = "#585b70" } },
    { Text = "│ " },
    { Foreground = { Color = "#a6e3a1" } },
    { Text = time_str .. "  " },
  }))
end)

-- 6. 快捷键设置（分屏、缩放与 Shift+Enter 换行）
config.keys = {
  { key = "Enter", mods = "SHIFT", action = act.SendString("\x1b\r") },
  { key = "\\", mods = "ALT", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
  { key = "-", mods = "ALT", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },
  { key = "w", mods = "ALT", action = act.CloseCurrentPane({ confirm = true }) },
  { key = "LeftArrow", mods = "ALT", action = act.ActivatePaneDirection("Left") },
  { key = "RightArrow", mods = "ALT", action = act.ActivatePaneDirection("Right") },
  { key = "UpArrow", mods = "ALT", action = act.ActivatePaneDirection("Up") },
  { key = "DownArrow", mods = "ALT", action = act.ActivatePaneDirection("Down") },
  { key = "z", mods = "ALT", action = act.TogglePaneZoomState },
  { key = "t", mods = "CTRL|SHIFT", action = act.SpawnTab("CurrentPaneDomain") },
}

return config
```

</details>

---

## 五、日常高频快捷键与进阶用法速查

### 1. 常用快捷键（结合内置默认与上述自定义配置）

| 快捷键 | 功能说明 | Agent CLI 高频使用场景 |
| --- | --- | --- |
| `Shift + Enter` | 发送 `\x1b\r` 换行 | 在 Claude Code / `agy` / Codex 输入框里写多行结构化提示词 |
| `Alt + \` | 向右水平分屏 | 一边跑主 Agent，一边开副 Agent 或 Git 状态栏 |
| `Alt + -` | 向下垂直分屏 | 在右侧再拆一个窗格跑测试或 `npm run dev` |
| `Alt + ↑/↓/←/→` | 按方向切换焦点窗格 | 在多个并行 Agent 之间零鼠标跳转 |
| `Alt + Z` | 窗格全屏缩放 / 还原（`[Z]`） | 全屏细看 Agent 输出的长 Diff 或规划文档 |
| `Alt + W` | 关闭当前窗格（带二次确认） | 结束闲置任务，防误关在跑中的 Agent |
| `Ctrl + Shift + T` | 新建标签页 | 给不同子项目或独立任务开新标签 |
| `Ctrl + Shift + Space` | **Quick Select 快速抓取** | 单键复制或回填路径、Commit Hash、报错 URL |
| `Ctrl + Shift + X` | **Copy Mode（Vim 键位）** | 纯键盘翻阅 2 万行历史输出、精准选段复制 |
| `Ctrl + Shift + F` | 终端内搜索（支持正则） | 在超长日志里秒搜报错关键词或函数名 |
| `Ctrl + Shift + P` | **Command Palette 命令面板** | 忘了快捷键时像 VS Code 一样模糊搜索一切动作 |
| `Ctrl + Shift + L` | 调试浮层（Debug Overlay） | 配置写错或排查按键码时的排错利器 |
| `Ctrl + +` / `-` / `0` | 临时放大 / 缩小 / 还原字号 | 演示录屏或高分屏下快速调节阅读舒适度 |

### 2. 三个值得顺手用起来的进阶能力

1. **命令面板（`Ctrl+Shift+P`）**：记不住冷门操作没关系，按下 `Ctrl+Shift+P` 就能直接模糊搜索分屏、重命名标签页、切换工作区、重载配置等全部内建动作。
2. **自定义 Quick Select 规则**：如果你经常需要抓取特定格式的文本（比如工单号、特定前缀的测试 ID），可以在配置里追加 `config.quick_select_patterns`，把业务规则直接编进快捷键里。
3. **SSH / WSL 原生连接域（Domains）**：如果你同时在 Windows 和 WSL2 / 远程 Linux 服务器上跑 Agent，可以直接在 `.wezterm.lua` 里配置 `config.wsl_domains` 或 `config.ssh_domains`。WezTerm 会通过内置 Multiplexer 保持远端会话连接，本地网络抖动重连后窗格布局照旧。

---

## 六、踩坑记录与适配建议

如果你打算直接照搬上面的配置，有几个小细节提前知道能省不少时间：

1. **非 Windows 平台需要删掉两个系统专属项**：`config.default_prog = { "pwsh.exe", "-NoLogo" }` 和 `config.win32_system_backdrop = "Acrylic"` 是 Windows 专属的；在 macOS 上可以把毛玻璃换成 `config.macos_window_background_blur = 20`，同样非常通透。
2. **字体缺失不会报错，但建议换成你电脑里有的好字体**：Anthropic Mono 不是系统默认预装字体，如果本机没装，WezTerm 会自动往下回退。推荐开源免费替代：`JetBrains Mono`、`Maple Mono NF CN`（自带中文等宽对齐）或微软的 `Cascadia Mono`。
3. **Windows 11 老版本或核显上的毛玻璃卡顿**：如果开启 `Acrylic` 后拖动窗口感觉发粘，把 `win32_system_backdrop` 改成 `"Mica"` 或 `"Tabbed"`，或者干脆关掉半透明（`window_background_opacity = 1.0`），流畅度会立刻拉满。
4. **验证你的键盘发送了什么码**：如果碰到某个小众 TUI 里快捷键没生效，按 `Ctrl+Shift+L` 打开 Debug Overlay，或者在配置里临时开启 `config.debug_key_events = true`，就能亲眼看到每次按键究竟发出了什么转义序列，排查效率比盲猜高十倍。

---

## 七、结语

工具本身不会替你写代码，但当你的日常工作已经变成 **同时指挥两三个 AI Agent 并行推进、高频审阅 Diff、在十几个文件和日志流里来回穿梭** 时，终端的流畅度、视觉层次和键盘人体工学，直接决定了你一天下来是游刃有余还是精疲力竭。

WezTerm 让我最满意的地方，是它既不强迫你接受一套封闭的观念，也不把你扔进一堆繁琐的插件泥潭——一份干净的 `~/.wezterm.lua`，跨三端同步、热重载零打断、对 Agent CLI 的每一处高频痛点都有原生解法。

如果你最近也在重度使用 Claude Code、Antigravity CLI、Codex 或 Pi Agent，强烈建议花十分钟装上 WezTerm 试一试。把你的终端打磨顺手，整个 AI 编码工作流的体感都会立刻上一个台阶。
