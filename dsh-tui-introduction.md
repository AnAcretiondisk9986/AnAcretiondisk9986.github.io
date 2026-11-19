# dsh-TUI 介绍与使用说明

> dsh-TUI 是 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 的终端智能体界面（TUI）插件：把 DSH 的 Agent、模型、会话、Shell、策略等能力装进一个像素鲸鱼迎宾的终端界面，并在其之上提供会话管理、时间回溯、侧栏面板、主题系统、图片预览、轨迹回放等一整套交互体验。
>
> 本文是面向新用户的介绍与快速使用指南，内容整理自 dsh-TUI 随包发布的官方用户手册。手册共十篇（安装、使用、交互、配置、Claude/Codex 后端、主题、迁移、CLI、VS Code、插件），完整版在安装后可用会话内命令 `/dsh-tui-guide <问题>` 查询，本文末尾附有各篇出处。

---

## 目录

1. [它是什么](#1-它是什么)
2. [前置条件与安装](#2-前置条件与安装)
3. [启动与首次使用](#3-启动与首次使用)
4. [核心心智模型](#4-核心心智模型)
5. [快捷键速查](#5-快捷键速查)
6. [常用命令](#6-常用命令)
7. [会话工作流](#7-会话工作流)
8. [界面与状态栏](#8-界面与状态栏)
9. [模型 / 预设 / 主题 / 语言](#9-模型--预设--主题--语言)
10. [配置](#10-配置)
11. [自动化 CLI（无界面执行）](#11-自动化-cli无界面执行)
12. [会话迁移：从其他编程代理导入](#12-会话迁移从其他编程代理导入)
13. [在 VS Code 中使用](#13-在-vs-code-中使用)
14. [切换内核：Claude 与 Codex 后端](#14-切换内核claude-与-codex-后端)
15. [插件生态](#15-插件生态)
16. [更新到最新版本](#16-更新到最新版本)
17. [常见问题](#17-常见问题)
18. [来源](#18-来源)

---

## 1. 它是什么

dsh-TUI 以一个 npm 包 `@deepseek-harness-tui/dsh-tui` 的形式，作为插件安装在 DSH 的 `dsh-tui` profile 中。启动顺序为：

```text
dsh-base -> 其他 bundle -> @deepseek-harness-tui/dsh-tui patch -> 用户 profile patch
```

- **base**（`@deepseek-ai/dsh-base`）提供 Agent、模型、会话、文件、Shell、策略和注册表等服务；
- **本插件**覆盖或插入 TUI 界面、Agent preset 名册、SQLite/JSONL 会话持久化与工作状态行。

也就是说：底层推理、工具调用、权限沙箱全部由 DSH 提供，dsh-TUI 负责你在终端里看到和操作的一切。

### 主要特性

- **全功能终端界面**：像素鲸鱼 Logo、流式回复、工具卡、diff 双栏、思考折叠、代码高亮、Mermaid 图、LaTeX 公式、终端图片预览（Kitty/Sixel）。
- **会话管理**：工作区 + 会话双栏浏览、实时筛选、固定、后台会话、多终端切换（切换只是"停放"，回合继续跑）。
- **消息投递三语义**：模型工作时 `Enter` 注入下一步（steer）、`Tab` 排队（follow-up）、`Ctrl+Enter` 打断并发送。
- **双击 Esc 时间回溯**：回到任意一条你自己的消息，改完重发，原分支保留。
- **侧栏面板**：todo / 任务 / 子代理 / 轨迹 / 信息 / 宠物等 8 个内置面板 + 插件面板。
- **主题系统**：内置雾蓝、樱两个色板族共六套主题 + `auto` 跟随终端背景，支持 JSON 自定义主题与 npm 插件主题。
- **多后端内核**：默认 DSH 内核，另可切换到实验性的 Claude 后端与 Codex 原生后端（界面不变）。
- **会话迁移**：一键导入 Claude Code / Codex / OMP / zcode / Grok Build 的历史对话。
- **自动化 CLI**：`dst run --json` 等无界面执行、流式 JSON 输出、管理命令。
- **VS Code 集成**：上架 Marketplace 的 companion 扩展 `dsh-tui-vscode`，支持 IDE 选区通道。
- **插件生态**：设置区块、全屏场景、底栏字段、侧栏面板、主题、`@` 提及等公开接缝。

---

## 2. 前置条件与安装

### 2.1 前置条件

- Node.js `^22.19 || >=24`（CI 使用 Node 24）；
- 官方 DeepSeek Harness CLI：`@deepseek-ai/dsh`；
- `pnpm` **10 或更高**（CI 使用 11）——首次启动初始化 profile 时需要，pnpm 9 会导致启动后立刻退出（issue #60）；
- 支持交互输入的终端 TTY（不支持把 stdout 重定向后启动）；
- 模型凭证，二选一：
  - `deepseek-official` 路由需要 `DEEPSEEK_API_KEY` 环境变量；
  - 或者首次启动时用引导里的「登录订阅账号（OAuth）」/「添加模型提供方（API key）」，写入 DSH 凭据库（`$DSH_HOME/.credentials.yaml`，默认 `~/.dsh/.credentials.yaml`）；
  - 自定义兼容端点还可设置 `DEEPSEEK_BASE_URL`。

macOS/Linux：

```sh
export DEEPSEEK_API_KEY='your-key'
```

PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = 'your-key'
```

### 2.2 安装

最快路径（全局安装后自带 `dsh-tui` 直达命令）：

```sh
# 官方 CLI + 本插件
npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui

# pnpm 未安装时任选一种方式
npm install -g pnpm
# 或：corepack enable pnpm

# 启动：首次运行自动初始化 dsh-tui profile
dsh-tui
```

手工分步（等价）：

```sh
npm install -g @deepseek-ai/dsh
npm install -g pnpm        # 或 corepack enable pnpm
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
dsh --profile dsh-tui      # 或 dsh-tui
```

### 2.3 启动

```sh
dsh-tui                    # 从当前目录启动，Agent 默认工作区即当前目录
dsh-tui --resume           # 恢复最近会话；-c / --continue 等价
dsh-tui --resume <id>      # 恢复指定会话
dsh --profile dsh-tui      # 与 dsh-tui 等价的手工启动方式（/update 仅此方式可用）
```

> 建议进入目标项目目录后再启动。DSH 0.2.1 起 Agent 可以用 `working_directory` 工具把会话切到别的目录，状态栏、Git 分支、`@` 补全和 `!` 命令会跟随该目录。

### 2.4 启动器子命令

| 命令 | 作用 |
| --- | --- |
| `dsh-tui update` | 一次对齐整套（profile 的 TUI、全局 dsh 引擎、全局启动器）并校验，不进入 TUI |
| `dsh-tui doctor` | 环境检查：dsh/pnpm、profile 安装与版本、API key 状态（只报状态不读值） |
| `dsh-tui safe` | 安全模式：只读诊断、插件清单与修复指引（`safe --rescue` 还会创建/校验干净的救援 profile） |
| `dsh-tui version` | 显示启动器与 profile 版本 |
| `dsh-tui help` | 显示用法（`dst` 别名接受相同命令） |

---

## 3. 启动与首次使用

### 3.1 首次启动你会看到

1. **首次引导**（首次安装或引导升级后出现）：四步向导——账号与模型接入 → 语言与主题 → 模型与工作区 → 快捷键与招式。`←/→` 换步骤、`Tab` 切面板、`↑/↓` 移动选择、`Enter` 执行、`Esc` 跳过（**跳过不记账**，下次启动还会问）；最后一步要在**键位卡**上按 `Enter` 才算完成。之后随时可用 `/setup` 重跑。
2. **落地页**（普通启动第一屏）：像素鲸鱼顶栏（版本号、`DEEPSEEK / HARNESS` 大字、当前模型与 effort、工作目录、启动提示行），下方是**真输入框**（第一句话回车直接发送）与参数行（模型 · 思考深度 · 模式 · 权限，四段可点开就地换值），再下方是快捷入口（继续「…」/ 会话与工作区 / 设置 / 条件位）。可在 `/settings` 里用 `launchpad` 关掉（默认开）。
3. **底部状态栏**：工作状态行、上下文分段进度条、TPS 仪表与各类实时指标。
4. **第一次普通启动**在落地页之后进入会话管理界面先挑工作区，之后启动直接进对话。
5. 输入 `/` 看命令菜单，按 `?` 看快捷键帮助。

### 3.2 核心心智模型

- 命令都可用 **Tab 补全**（带参数时先输入 `/命令 ` 再 Tab）；
- 非命令输入就是普通对话；**未知命令会作为普通消息发给模型**。

---

## 4. 核心心智模型

（承接上文，这里展开三个最重要的概念。）

### 4.1 消息投递三语义（模型工作时）

| 键 | 功能 |
| --- | --- |
| `Enter` | 空闲=发送；已知 `/` 命令（可带参数）=执行该命令；模型工作时=**steer**（注入下一步边界，不中断）；菜单打开=确认选中项 |
| `Tab` | 补全 `/` 命令或 `@` 文件；模型工作时=**follow-up**（排入当前回合之后） |
| `Ctrl+Enter`（⌘Enter） | 打断当前回合并立即发送输入 |
| `Shift+Enter` / `Ctrl+J` | 换行（`Option+Enter` 是 macOS Terminal.app 的兜底） |
| `Alt+Up` | 把最后一条未处理消息取回输入框编辑（不中断回合） |
| `Esc`（工作 + 有 pending） | 中断回合并立即重投 pending 消息 |
| 工作中的 `/btw …` | Enter 直接执行（侧问永不打断主回合） |

### 4.2 会话不是"打开文件"而是"停放"

切换会话只是**停放**——正在跑的回合继续跑；被其他终端占用的会话标红写 `占用 pid <pid>`、点不动。所以你可以在多个终端里各开一个 dsh-TUI，让多个会话并行工作。

### 4.3 三种"模式"别搞混

| 概念 | 入口 | 是什么 |
| --- | --- | --- |
| Agent preset（内核预设） | `/preset` | `standard` / `ptc` / `minimal` / `cordis` / `liangshen`，**决定模型能看到、能调用哪些工具**；已产生对话的会话不可切换 |
| 会话权限模式 | `Shift+Tab` | default（workspace-write + 审批）→ plan（只读）→ full（完全访问）循环 |
| 极简界面 Minimal UI | `/settings → 极简界面` | **纯界面开关**：隐藏开屏头部、emoji 与装饰配色，对模型能力没有任何影响 |

---

## 5. 快捷键速查

> 表内 `Ctrl` 在 macOS 上大多可换 `⌘`（`⌘V` `⌘O` `⌘R` `⌘T` `⌘L` `⌘Enter`）；`Ctrl+C`/`Ctrl+D` 不变。`⌘` 需扩展键盘协议，Terminal.app 用 Ctrl。

### 5.1 发送与投递

见 [4.1](#41-消息投递三语义模型工作时) 的表格。

### 5.2 中断 / 退出 / 系统

| 键 | 功能 |
| --- | --- |
| `Ctrl+C` | 工作中=中断；中断未收敛时再按=强制退出；空闲有输入=清空输入；空闲空输入=双击退出（3s 窗口） |
| `Ctrl+D` | 工作中=中断（未收敛再按=强制退出）；空闲时双击退出 |
| `Ctrl+L`（⌘L） | 清屏并强制重绘 |
| `Ctrl+O`（⌘O） | 展开/收起详情（思考全文、工具参数与输出） |
| `Ctrl+E` | 输入框=光标到行尾；转录中=展开/折叠隐藏的旧消息 |
| `Ctrl+P` | 切换启动时 loaded-context 面板 |
| `?` | 输入框为空时打开快捷键/命令帮助菜单 |

### 5.3 搜索

| 键 | 功能 |
| --- | --- |
| `Ctrl+R`（⌘R） | 历史消息搜索（只搜当前项目）；重复按或 `↓` 到下一匹配；`Enter` 回填输入框 |
| `/`（转录态） | 会话全文搜索；`n` / `N` 跳转（仅 Ctrl+O 展开态） |

### 5.4 输入编辑

| 键 | 功能 |
| --- | --- |
| `←` / `→` | 按字符移动光标 |
| `Ctrl+←` / `Ctrl+→`（⌘←/→） | 按单词跳转 |
| `Home` / `End` / `Ctrl+E` | 行首 / 行尾 |
| `Ctrl+U` / `Ctrl+K` | 删除光标前（至行首）/ 光标后（至行尾） |
| `Ctrl+W` / `Alt+Backspace` | 删除前一个单词（或已暂存的图片附件） |
| `Ctrl+Z` | 撤销草稿上一步「词级」编辑 |
| `↑` / `↓` | 多行时行间移动；单行时浏览输入历史（按项目隔离，最近 200 条） |
| `Ctrl+V`（⌘V）/ `Alt+V` | 粘贴：文本 / 文件路径（图片自动 `@` 引用）/ 剪贴板位图（`[Image #N]` 附件） |
| `Ctrl+G` | 用 `$VISUAL`/`$EDITOR` 外部编辑器编辑输入 |
| `Ctrl+Shift+E`（⌘⇧E） | 展开全屏草稿编辑器（行号、高亮当前行，`Ctrl+Enter` 发送、`Esc` 收起） |
| `/vim` | vim 编辑模式开关（`Esc` 切 NORMAL，`i/a/o` 回 INSERT） |
| `Esc`（输入框） | 一层层关：帮助 → 图片预览 → 命令菜单 → 文件菜单 → 清选区 → 收起草稿 → 展开折叠块 → 移除上下文附件 → 中断并暂存队列 → 清空输入 |
| 双击 `Esc`（空闲空输入） | **时间回溯 rewind**（3s 窗口内按两次） |

### 5.5 导航 / 模式

| 键 | 功能 |
| --- | --- |
| `Shift+Tab` | 循环会话模式（默认 → plan 计划 → full 完全访问；第三方权限预设排在末尾） |
| `Shift+↑` | 消息选择模式（`↑/↓` 移动，`Enter` 展开单条，`Esc` 退出） |
| `Ctrl+T`（⌘T） | 打开轨迹场景（同 `/trace`） |
| `Ctrl+B` | 展开/收起右侧栏（tmux 用户注意：`Ctrl+B` 是 tmux 默认前缀键，需在 `/settings → Shortcuts` 重映射） |
| `Ctrl+A` | 子代理面板（`Enter` 详情、`X` 中断运行中的子代理） |
| `Alt+R` | 落地页上继续最近一条会话 |

### 5.6 鼠标（fullscreen 全屏模式）

| 操作 | 功能 |
| --- | --- |
| 左键拖拽 | 选文本，**松开即复制**（OSC 52 + 系统剪贴板兜底） |
| 双击 / 三击 | 选词 / 选行，即选即复制 |
| 滚轮 | 滚动消息列表 |
| 单击 | 消息行=展开/收起 · 超链接=打开浏览器 · 「加载更早消息」=加载 |
| 悬停截断内容 | 停留约 600ms 浮层显示完整内容 |

### 5.7 各场景键位速记

- **问卷**（模型 ask_user_question）：`↑/↓` 选、`Space` 多选、`Tab` 切自定义回答、`Enter` 提交；`Esc` 第 2 题起返回、第 1 题取消整批。
- **计划评审**：`↑/↓` 移动、`1`/`2` 快选；直接打字 = 填反馈；**批准必须不带反馈**。
- **工具审批**：`↑/↓` 移动、`1` 允许（仅本次）、`2` 拒绝、`Enter` 提交；`Esc`/`Ctrl+C` 拒绝。
- **会话管理界面**（`/resume` 等）：`←/→` 换栏、打字实时筛选、`Enter` 进入、`Ctrl+N` 新建、`Ctrl+X` 停后台会话、`★` 固定。
- **大图预览**：`←/→` 上/下一张；底部按钮缩放 `适应`/`100%`–`800%`；拖动、滚轮平移。
- **轨迹场景**（`Ctrl+T`/`/trace`）：`[`/`]` 跳失败点 · `{`/`}` 跳轮次 · `m` 循环投影 · `Enter` 展开详情 · `/` 查询行（前缀 `tool:` `kind:` `turn:` `err:` `run:` `>10s` `tok>1k`）。
- **@ 文件补全**：`@` 在消息任意位置触发；`@src/` 只列该目录，普通片段**模糊匹配**（`@ink` 命中 `src/ink/Box.js`）；`@src/a.ts#L12-14` 精确引用行区间；图片路径自动变 `[Image #N]` 附件。

---

## 6. 常用命令

命令菜单 = 内置命令（含别名）+ DSH 注册表命令（`/plan` `/goal` 等）+ 技能目录。`/lang` 可切换中英文界面与命令描述。

### 6.1 会话

| 命令 | 作用 |
| --- | --- |
| `/new` | 新开会话（无二次确认；旧会话可 `/resume` 恢复） |
| `/resume` | 打开会话管理界面（工作区栏 + 会话栏、筛选、固定、跨工作区） |
| `/home` / `/agentview` / `/bg` | 同一个会话管理界面（`/bg`=转后台并打开） |
| `/tree` | 会话分叉树：悬停预览、点击回退 / 分叉 / 切换分支 |
| `/fork` | 把当前会话复制成可恢复的副本 |
| `/restart` | 重启进程并恢复本会话（回合运行中也可用，排队输入重启后暂存） |
| `/kernel` | 内核选择器：在 DSH、Codex 与实验性的 Claude 后端之间切换 |
| `/rename <新名称>` | 重命名当前会话 |
| `/recap` | 最近活动摘要 + 建议标题 |
| `/workspace resume\|rename <名>\|open <路径或URI>` | 管理工作区 |
| `/clear` | 清空当前会话视图（重置展开/选择状态，不动会话日志） |
| `/compact` | 压缩会话历史 |
| `/export` | 导出会话为 Markdown 到会话启动时的项目目录 |
| `/btw <问题>` | 侧问：单轮、无工具、不打断主回合、不写历史 |
| `/trace` | 打开轨迹场景（同 `Ctrl+T`） |
| `/rewind` | 回退选择器（同空输入双击 Esc） |
| `/exit`（别名 `/quit` `/q`） | 退出 dsh-tui |

### 6.2 状态与诊断

| 命令 | 作用 |
| --- | --- |
| `/context` | 已加载上下文明细 |
| `/status` | 模型+effort、工作/空闲、会话 id、目录+git 分支、token、缓存命中率、上下文百分比 |
| `/cost` | token 用量 + 缓存命中率 + 本会话估算（含子代理；**估算仅供参考，以平台账单为准**） |
| `/balance` | DeepSeek 官方账户余额（免费只读接口） |
| `/config` | 配置来源：`cordis.patch.yml` 路径、启动方式、模型路由 |
| `/doctor` | 环境自检 |
| `/migrate [agent] [--dry-run]` | 从其他编程代理导入对话历史 |
| `/init` | 在工作目录创建 `AGENTS.md` |
| `/agents` | 本会话子代理列表 |
| `/jobs` | 后台任务面板（`k` 停止；面板打开时 `Esc` 只关面板不打断回合） |
| `/settings` | 打开插件设置编辑器（改动自动保存） |
| `/setup` | 重跑首次引导向导 |
| `/help` | 快捷键 + 命令帮助菜单 |

### 6.3 模型 / 显示

| 命令 | 作用 |
| --- | --- |
| `/model` | 模型选择器；**同会话切换模型**（保留 session ID 和历史，下一次请求使用新路由） |
| `/effort [status\|<id>]` | 推理强度：无参滑杆（`←/→` 实时调整） |
| `/thinking` | 扩展思考显示开关 |
| `/tokens` | 本次请求 / 会话累计 / 上下文占用三段报数 |
| `/activity [frames <名>\|status]` | 工作状态行动画（默认 `moon8`，`random` 随机） |
| `/preset [<id>\|status]` | Agent 预设切换（**已开始的会话不可切换**） |
| `/theme [<名字>\|status]` | 主题切换 |
| `/color [<名>\|status\|reset]` | 会话强调色（`red/orange/yellow/green/blue/purple/pink/cyan`） |
| `/lang [en\|zh\|status]` | 界面语言热切换 |
| `/vim` | vim 编辑模式开关 |
| `/panel [toggle\|focus\|zoom\|<id>]` | 侧栏面板 |

### 6.4 账号 / 策略 / 扩展

| 命令 | 作用 |
| --- | --- |
| `/provider` | 交互式管理模型提供方（添加 / 编辑 / 删除；含订阅账号 OAuth 登录） |
| `/auth status\|login [provider]\|logout <provider>` | 账号状态、登录、登出 |
| `/login` / `/logout` | 凭证状态 / 登出说明 |
| `/permission [<preset>\|status]` | 查看/切换权限预设与策略 |
| `/add-dir` | 文件策略范围说明 |
| `/hooks` | 占位：DSH hooks 未挂载时给出说明 |
| `/mcp` | MCP 连接状态（工具按 `mcp__服务器__工具` 分组） |
| `/skills` | 技能目录选择器 |
| `/plugin` | 插件生命周期管理：`list` / `install <spec>` / `remove` / `enable` / `disable` / `check` / `info` / `registries` |
| `/update` | 一次对齐 TUI、引擎与启动器，校验后自动重启恢复会话 |
| `/terminal-setup` | 终端配置建议 |

### 6.5 注册表命令（来自 DSH 生态）

`/plan [off|message]`（计划模式）、`/goal`（会话目标）、`/feedback`（使用反馈）等，随组合动态并入 `/` 菜单。

---

## 7. 会话工作流

### 7.1 会话生命周期

| 操作 | 命令/键 | 要点 |
| --- | --- | --- |
| 新建 | `/new` | 无二次确认——旧会话已持久化，随时可 `/resume` 找回 |
| 恢复 | `/resume` 或 `dsh-tui --resume` | 切换只是**停放**，回合继续跑 |
| 重命名 | `/rename <标题>` | 立即改名并持久化 |
| 压缩 | `/compact` | 回合运行中拒绝；minimal preset 下不可用 |
| 导出 | `/export` | 从完整 session log 导出 Markdown，落在会话启动时的项目目录 |
| 停止后台会话 | 会话管理界面 `Ctrl+X` | 当前终端正在用的会话停不了 |
| 退出 | `/exit` | 空闲 `Ctrl+C` 双击或 `Ctrl+D` 双击也可退出 |

### 7.2 时间回溯 rewind（双击 Esc）

1. **空输入时连按两次 `Esc`**（或 `/rewind`），进入回退选择器；
2. 选择器列出**你自己的消息**（最新在前），`↑/↓` + `Enter` 选中；
3. 若模型正在工作：先取消回合并等落定（最长 30s）；
4. 系统 fork 新会话并回放历史到回退点，**原消息放回输入框**供修改重发；
5. 回退分支留在 `/resume` 列表里。

> 不能回退到第一条消息；`/rewind` 在回合运行中会先取消当前回合再回溯。

### 7.3 侧问 /btw

`/btw <问题>`：复用当前上下文做**无工具、单轮**回答，**不写历史、不计 token**，主回合照常。面板 `↑/↓` 滚动 · `c` 复制 · `Esc` 关闭。

### 7.4 模型切换与预设

- `/model`：同会话切换模型（保留 session ID 和历史）；持久化 `~/.dsh-tui/model.json`，下次启动沿用。
- `/preset` 可选：`standard`（默认全功能）、`ptc`、`minimal`（内核极简模式：只暴露一个持久 shell 工具，无 compaction、无计划模式，`/compact` 与问卷不可用）、`cordis`、`liangshen`（梁神模式）。**已产生对话的会话不能切换**（blank-only）：选择只保存为下次 `/new` 的默认。
- 会话模式用 `Shift+Tab` 循环：default → plan（read-only）→ full。
- 批准计划或 `/plan off` 之后，沙箱与审批策略回到进入计划模式之前的状态。

### 7.5 问卷与审批

- 问卷**最后一行是自由输入行**；计划评审**批准必须无反馈文本**；审批与问卷同时挂起时**审批优先**；后台会话发起的审批会标注来源。
- 等待中的授权/提问/计划评审可随 `/settings → 通知`（`taskNotifications`）走系统通知，Windows 上开启 `jumpBack` 后点击通知回到对应窗格。

### 7.6 Goals/Todos / MCP

- **Goals/Todos 面板自动出现**：模型写入 goal/todo 时在输入框上方实时渲染（🎯 目标 + phase 徽章 + 树形 todo），无需操作。
- `/mcp`：按服务器分组列出 `mcp__服务器__工具`；未配置时给出 `cordis.patch.yml` 插入示例。

---

## 8. 界面与状态栏

### 8.1 开屏

空会话顶部是鲸鱼 Logo 区（随对话滚动消失）：开场动画（约 3.4 秒，每次启动三选一，`/deepseek` 彩蛋重掷）、欢迎期闲置动画（空闲 10 秒入睡冒 Z，点击冒爱心唤醒）。鲸鱼右侧是版本号、`DEEPSEEK / HARNESS` 大字（按本地日期轮换 8 款字体，`/settings → 开屏大字字体` 可 pin 住某一款）、当前模型 + effort、工作目录与启动提示行。终端变窄时按内容区列数逐档降级。

### 8.2 底部状态栏（三行）

- **Row 1 — 上下文分段进度条**（`statusBar.contextBar`，默认开）：按 system / prompt / assistant / thinking / tools 五段着色，读数按占用率变色（<80% 灰蓝，≥80% 琥珀，≥95% 红）。
- **Row 2 — 状态字段行**（每字段独立开关）：模型 → TPS → thinking → mode → ctx（上下文占用）→ cache → tokens → cost（本会话估算，hover 拆主会话/子代理）｜git 分支（跟随工作树 HEAD）→ 工作目录 → 会话标题 → 短会话 ID。
- **Row 3 — 提示 / 工作活动 + 迷你轨迹条**：空闲显示 `? for shortcuts`、运行中 `esc to interrupt`；右侧 MiniWake 迷你轨迹条（默认关）。
- **TPS 仪表**（默认关）：速度 ≥50 绿 / ≥20 黄 / <20 红。

### 8.3 /settings 设置编辑器

`/settings` 打开设置编辑器，**改动自动保存**，`Esc` 直接退出。常用项（完整列表见 /settings 屏）：

| 字段 | 说明 |
| --- | --- |
| `lang` | 界面语言 zh/en |
| `fullscreen` | 全屏模式（默认开）；修改后 `/restart` 生效 |
| `launchpad` | 落地页开关（默认开） |
| `minimal` | 极简界面（纯界面开关，与内核 preset 无关） |
| `terminalImages` | 终端图片预览（默认开，需终端支持） |
| `whale` / `whaleIdle` | 开屏鲸鱼 / 闲置动画 |
| `whaleGirl` | 女仆娘立绘（默认关） |
| `diffLayout` | Edit/Write diff 布局：auto（≥110 列双栏）/ split / unified |
| `thinkingFold` | 思考块：preview（流式 2-3 行预览）/ full |
| `btw.contextBudget` / `btw.contextTurns` | `/btw` 携带的上下文预算 |
| `effortDefault` | 默认推理强度 |
| `smoothStreaming` | 流式平滑输出（默认开） |
| `taskNotifications` | 系统通知（默认「仅失焦时」） |
| `mermaidDiagrams` | Mermaid 字符图（默认开） |
| `mathRendering` | LaTeX 公式：auto（Unicode）/ image（MathJax 图片）/ unicode / source |
| `foldTerminalCommand` | 折叠终端多行命令（默认关） |
| `expandEditor` | 全屏草稿编辑（默认开） |
| `jumpBack` | 通知跳回（Windows，默认关） |

以下设置**不在 /settings 内**，需改 `$DSH_HOME/profiles/dsh-tui/cordis.patch.yml`：`provider` / `model` / `cwd` / `preset` / `workspace` / `sessionId` / `modes`，以及启动级 `effort` 键。

### 8.4 终端要求

- 必须交互 TTY；推荐 Windows Terminal（≥110 列、等宽、TrueColor）。
- macOS 的 ⌘ 修饰键需要扩展键盘协议（iTerm2 / kitty / WezTerm / ghostty / rio / tmux）；Terminal.app 用 Ctrl。
- 图片预览需要 Kitty graphics 或 Sixel（自动探测，Kitty 优先）；`DSH_TUI_IMAGE_PROTOCOL=auto|kitty|sixel|none` 覆盖协议。
- 粘贴剪贴板图片（`Ctrl+V`/`Alt+V`）：Linux 需要 `wl-paste`、`xclip` 或 `xsel` 之一。
- tmux 的 OSC 通知需要 `set -g allow-passthrough on`。
- 环境自检：`/doctor`。

### 8.5 安全模式（`dsh-tui safe`）

dsh 意外退出时，安全模式提供**只读**的环境诊断、profile 插件清单和修复指引；`safe --rescue` 会创建/复用干净的救援 profile（必须证明干净：无第三方插件、无 `cordis.patch.yml` 条目，证不出就拒绝）。修复命令需自行执行（安全模式只列出）。

---

## 9. 模型 / 预设 / 主题 / 语言

| 项 | 命令 | 说明 |
| --- | --- | --- |
| 模型 | `/model` | 同会话切换；持久化 `~/.dsh-tui/model.json`，优先于 cordis.yml/profile 里的 `provider`/`model`（后者只是首次启动的部署默认值） |
| 推理强度 | `/effort` | 滑杆（←/→ 实时）或 `/effort <id>`；`/effort status` 看当前 |
| Agent 预设 | `/preset` | `standard` / `ptc` / `minimal` / `cordis` / `liangshen`；**已开始会话不可切换** |
| 主题 | `/theme` | `auto`（OSC 11 跟随终端背景）/ `light` / `dark` / `dark-ansi` / `pink-day` / `pink-night` / `pink-ansi` |
| 自定义主题 | 手动 | `~/.dsh-tui/themes/<名>.json`，`{base, colors}` 格式，选中即热切换；命名为 `auto` 会被内置遮蔽 |
| 语言 | `/lang` | `en` / `zh` 热切换 |
| 状态行动画 | `/activity` | 选择器或 `/activity frames <名>`；默认 `moon8`，`random` 随机 |

**主题优先级**：`DSH_TUI_THEME` > `~/.dsh-tui/theme.json` > OSC 11 终端背景检测 > dark 回退。

自定义主题示例（`~/.dsh-tui/themes/sakura.json`）：

```json
{
  "name": "sakura",
  "displayName": "樱花粉",
  "base": "dark",
  "colors": {
    "accent": "#FF9EC7",
    "text": "#E8E6E0",
    "success": "#9CC7A8",
    "error": "#E08591"
  }
}
```

`base` 必填（`light` / `dark` / `dark-ansi`），`colors` 是部分覆盖。可用颜色键覆盖正文、diff、语法高亮、工具卡、状态点、上下文进度条等全部角色（完整键见手册主题篇）。颜色格式支持 `#rgb`、`#rrggbb`、`#rrggbbaa`、`rgb(r,g,b)`、`ansi256(n)` 与 16 色 ANSI 名称。

**`~/.dsh-tui/` 偏好文件**：`theme.json`、`model.json`、`agent-preset.json`、`effort.json`、`working-activity.json`、`lang.json`、`resume.txt` 等（均 best-effort，坏文件回退默认）。

---

## 10. 配置

### 10.1 Profile 与补丁层

用户覆盖文件位于：

```text
$DSH_HOME/profiles/dsh-tui/cordis.patch.yml
```

`DSH_HOME` 未设置时通常为 `~/.dsh`。该文件是顶层 YAML 数组，可使用 DSH 支持的 `!!js` 表达式。**覆盖某一行时 `config` 是整块替换，不是逐字段深合并**——需要继续生效的字段必须全部重写。

完整常用覆盖示例：

```yaml
- id: dsh-tui
  config:
    provider: deepseek-official
    model: deepseek-flash
    # cwd 不建议显式设置——默认解析为启动目录所在的 git worktree 根；
    # 确需固定工作区时写绝对路径（如 cwd: /repo/packages/app），
    # 不要用 `!!js process.cwd()`。
    effort: max
    activity: true
    activityFrames: moon8
    contextBar: true
    fullscreen: false
    terminalImages: true
    preset: !!js process.env.DSH_TUI_PRESET ?? undefined
    workspace: !!js process.env.DSH_TUI_WORKSPACE_TARGET ?? undefined
    sessionId: !!js process.env.DSH_TUI_RESUME_SESSION ?? undefined
```

### 10.2 MCP 配置

官方 `@deepseek-ai/dsh-mcp-client` 同时支持 stdio 与 streamable HTTP。在用户 `cordis.patch.yml` 中插入：

```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: context7
        command: npx
        args: ['-y', '@upstash/context7-mcp']

    - id: mcp-remote
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: remote
        url: https://example.com/mcp
        headers:
          Authorization: !!js process.env.MCP_TOKEN
```

运行 `/mcp` 查看已连接服务与工具数量。

### 10.3 常用环境变量

| 变量 | 用途 |
| --- | --- |
| `VISUAL` / `EDITOR` | `Ctrl+G` 打开的外部编辑器（`VISUAL` 优先，可带参数如 `code --wait`） |
| `DEEPSEEK_API_KEY` | DeepSeek 凭证 |
| `DEEPSEEK_BASE_URL` | 覆盖 DeepSeek 兼容 API 端点 |
| `DSH_HOME` | harness 家目录（profile、会话、凭据、附件）；默认 `~/.dsh` |
| `DSH_TUI_LANG` | 界面语言（优先于其他来源） |
| `DSH_TUI_THEME` | 锁定主题，优先于持久化选择 |
| `DSH_TUI_PRESET` | 覆盖新会话默认 Agent preset |
| `DSH_TUI_PERSONA` | 覆盖组合注入的 Agent persona |
| `DSH_TUI_BACKEND` | 会话后端（`dsh` / `claude` / `codex`） |
| `DSH_TUI_RESUME_SESSION` | 启动时恢复指定会话 |
| `DSH_TUI_WORKSPACE_TARGET` | 启动时解析的工作区路径或 URI |
| `DSH_TUI_DISABLE_MOUSE` | fullscreen 模式临时关闭鼠标处理 |
| `DSH_TUI_DISABLE_TERMINAL_IMAGES` | 强制关闭终端图片预览（`=1`） |
| `DSH_TUI_IMAGE_PROTOCOL` | `auto` / `kitty` / `sixel` / `none` |
| `DSH_TUI_PROGRAM_STATUS=0` | 停止 OSC 7501 会话状态报告 |
| `DSH_PERMISSION_MODE` | 非 Windows 平台覆盖 sandbox policy（如 `workspace-write`） |
| `DSH_TUI_UPDATE_ENGINE=0` | `/update` 跳过全局引擎自动安装 |
| `DSH_TUI_DEBUG` | 启用写往 stderr 的调试日志 |
| `DSH_TUI_RENDER_LOG` | 记录原始 ANSI 渲染帧用于取证（可能包含会话可见内容，勿上传公开 issue） |

数据目录分两层：harness 家目录 `$DSH_HOME`（profile、会话、凭据、附件）与 TUI 数据目录 `~/.dsh-tui`（偏好与 resume 指针）。

### 10.4 `/provider`：运行时管理模型提供方

`/provider` 打开交互向导，无需重启即可添加、编辑、删除模型提供方：内置 catalog 路由或自定义 API 端点；密钥写入 `~/.dsh/.credentials.yaml`（0600），界面只显示 `••••••`。标准 profile 的内置 OAuth 模块提供 **订阅账号登录**（ChatGPT/Codex、Claude、Grok 等，免 API key），DSH 0.2.0-rc.1+ 还可经浏览器授权登录 DeepSeek 账号（`/auth login deepseek-account`，与需要 `DEEPSEEK_API_KEY` 的 `deepseek-official` 是**不同路由**）。

---

## 11. 自动化 CLI（无界面执行）

`dst` / `dsh-tui` 的普通启动进入 TUI；显式 `run`、`-p` 或 `cli` 进入独立的无界面 CLI，适合脚本与 CI。

### 11.1 快速开始

```sh
dst -p "检查当前项目"
echo "完整任务正文" | dst run --json
echo "待分析材料" | dst run "总结以下材料" --output-format stream-json
dst run --cwd ./repo --provider deepseek-official --model deepseek-flash "检查类型"
dst run --session-id session-123 "继续"
dst run --continue "继续当前目录最近的兼容主会话"
dst cli --help
```

要点：

- 输入是位置提示词加 stdin（两者都有时以两个换行连接），stdin 上限 8 MiB；`--` 后都是字面提示词，单独 `-` 表示只读 stdin。
- `--cwd` / `--workspace` 指定子进程目录；`--profile` 默认 `headless`，不是 `dsh-tui`。
- `--permission-mode` 接受 `read-only` / `workspace-write` / `danger-full-access`；不继承 TUI 权限记忆。
- `--timeout <毫秒>` 覆盖输入等待与运行上限，默认 0 为无期限。

### 11.2 输出格式与退出码

| 输出格式 | 内容 |
| --- | --- |
| `text`（默认） | 最终答案 |
| `json` / `--json` | 一条 `schemaVersion: 1` 的 `result`，含 `ok` 与 `text/sessionId` |
| `stream-json` | 带版本的 session/status/text/thinking/tool_call/tool_result 事件，最后输出验证过的 result |

退出码：0 成功，1 任务/运行失败，2 用法或输入上限，3 宿主/能力/会话不可用，4 协议/输出上限，124 超时，130 中断，143 终止。

### 11.3 管理命令

```sh
dst session list --json                 # 当前 cwd，默认最多 50 条
dst session list --all --limit 100 --json
dst session show <id> --json            # 官方校验过的日志快照
dst session export <id> > session.md    # 当前可见 user/assistant 文字的 Markdown
dst models list --provider deepseek-official --json
dst skills list --json
dst mcp status --json
dst auth status --json
dst capabilities --json
```

---

## 12. 会话迁移：从其他编程代理导入

把 Claude Code、Codex、OMP、zcode、Grok Build 的本地对话历史导入 DSH 会话库，换代理不丢历史上下文。

```sh
dsh-tui migrate                # 列出各源可扫描的会话文件数（不写入）
dsh-tui migrate claude-code    # 导入 Claude Code 的全部对话
dsh-tui migrate codex --dry-run  # 只预览将落盘的内容，不写入
```

TUI 内等效入口：`/migrate`（多选源选择器 → 二次确认层 → 导入）。导入在子进程中运行，界面不卡顿。

**支持的源**：

| 源 | 本地存储 |
| --- | --- |
| `claude-code` | `~/.claude/projects/` |
| `codex` | `~/.codex/sessions/` |
| `omp` | `~/.omp/agent/sessions/` |
| `zcode` | `~/.zcode/v2/sessions/` |
| `grok-build` | `~/.grok/sessions/`（可用 `GROK_HOME` 重定位） |

行为契约：**只读源**（绝不修改源代理的本地存储）、**幂等**（重复导入跳过已存在项）、**结构保留**（思考、正文、工具调用及其结果都在所属的步里，导入的会话可以直接接着做事）、压缩边界写为原生压缩事务、机器注入文本被过滤、标题归一。

不想整批导入时，在会话管理界面按来源标签浏览，选中一条会话即**只导入这一条**并直接打开。TUI 启动约 12 秒后若检测到某源最近 20 分钟内有写入，会弹一次「刚刚从 xx 过来？/migrate 来快速迁移」。

---

## 13. 在 VS Code 中使用

### 方式一：companion 扩展 `dsh-tui-vscode`（推荐）

- 会话跑在 VS Code **真实的集成终端**里（编辑器区另一侧新开一列）；
- 支持多会话并存、侧边栏会话历史（按项目分组）、一键启动、恢复上次/指定会话；
- 已上架 VS Code Marketplace（发布者 `baobaolaodie`）。

安装：`Ctrl+Shift+X` 搜索 **`dsh-tui`** 一键安装，或打开 [Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=baobaolaodie.dsh-tui-vscode)。

**IDE 选区通道**（需扩展 ≥ 0.7.0）：编辑器选中代码 → TUI 输入框下方**实时**出现 `⧉ N lines selected` 徽标，提交时选中行**自动附加**进上下文（含未保存的修改）；没装/没连 IDE 时静默降级，不影响其他功能。

### 方式二：VS Code 集成终端直接运行

零安装：在集成终端（`` Ctrl+` ``）里直接跑 `dsh-tui`。dsh-TUI 对 xterm.js 有专门兼容路径（truecolor、OSC 8 链接、OSC 52 剪贴板）。想用 `Ctrl+G` 在 VS Code 里编辑当前输入，在 `settings.json` 里设置：

```jsonc
{
  "terminal.integrated.env.windows": { "VISUAL": "code -w" },
  "terminal.integrated.env.linux":   { "VISUAL": "code -w" },
  "terminal.integrated.env.osx":     { "VISUAL": "code -w" }
}
```

已知差异：内置终端里图片可能空白——需要在 VS Code 设置里打开 `terminal.integrated.enableImages` 并**重载窗口**；必要时设 `DSH_TUI_IMAGE_PROTOCOL=sixel`（companion 扩展 ≥ 0.7.5 会自动注入该变量）。

---

## 14. 切换内核：Claude 与 Codex 后端

dsh-TUI 界面不变，底层 Agent 内核可切换：启动页「内核」入口或 `/kernel` 打开内核选择器，选择后记住并重启。**一个进程只用一个后端，切换要重启，回合进行中不能切换**。也可用 `dsh-tui --backend claude|codex`（只对本次启动生效）或配置行 `backend: <id>`。

### 14.1 Claude 后端（实验性）

- 由 **Claude Agent SDK** 驱动 Claude Code CLI；项目里的 `CLAUDE.md`、设置、hooks、MCP 服务器和插件按 CLI 自己的方式加载。
- SDK 是可选依赖（默认不装，按平台约 230MB）：打开 `/kernel` 对「SDK 未就绪」的 Claude 行按 Enter，按引导一键安装。
- 登录顺序：`/channel` 激活的渠道 → dsh-auth 的 `anthropic` 订阅登录（会话里 `/login`）→ 环境里的 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` → 本机已有的 `claude login`。
- 可用（与 DSH 一致）：流式回复、思考、工具卡、`Ctrl+C` 中断、`/new`、`/status`、`/export`、IDE 选区等；由 Claude 提供：`/model`（Claude 自己的模型列表）、`/effort`、`/permission`、`/compact`、`/context`、`/mcp`（含 reconnect/toggle）、`/cost` 等。
- 不可用：`/tree`、`/home`、`/workspace`、`/preset`、`/provider`、`/balance`、`/config`、`/migrate`、`/skills`、`/plugin`、`/goal` 等（不出现在补全里）。
- 权限模式：`default`（逐个询问）、`acceptEdits`、`plan`、`bypassPermissions`；`Shift+Tab` 在 default → acceptEdits → plan 之间循环，永远不会进入 `bypassPermissions`（只能在 `/permission` 里明确选择，且只当前会话有效）。

### 14.2 Codex 原生后端（实验性）

- 会话由 `codex app-server` 驱动；Codex 自己加载配置、登录、`AGENTS.md`、skills、hooks 与 MCP；thread 与官方 CLI 共用，不需要迁移历史。
- 安装你自己的 Codex：`npm install -g @openai/codex@0.160.1`，然后 `dsh-tui --backend codex`。默认从 `PATH` 找 Codex，`CODEX_EXECUTABLE` 可指定。
- 恢复 thread：`dsh-tui --backend codex --resume <thread-id>`；换回官方前端用 `codex resume <thread-id>`（同一 thread 不能同时被两个 Codex 写进程打开）。
- 登录三种方式：内置 ChatGPT OAuth、Codex 设备码、OpenAI API key（会写入你自己的 Codex 凭据存储）；中转 key 应走 `/channel`（仅支持 OpenAI 兼容 Responses API）。
- 品牌外观：薰衣草紫整套主题、`CODEX` 大标题与淡紫立绘（可点击互动）。

---

## 15. 插件生态

- **生态组织**：[dsh-tui-ecosystem](https://github.com/dsh-tui-ecosystem)（社区插件与模板的家）。
- **模板仓库**：[plugin-template](https://github.com/dsh-tui-ecosystem/plugin-template)（5 分钟出一个插件）。
- **参考实现**：`dsh-working-activity`（实时工作状态行）。

公开接缝按成熟度分三档（正式状态与兼容性协定以 TUI Profile 的《终端交互生态插件准入与开发指南》为准）：

| 分级 | 接缝 |
| --- | --- |
| 稳定候选（形态冻结，破坏性变更先弃用告警再移除） | 设置区块 · 全屏场景 · 托管对话框 · 状态行（含底栏字段 `setField`）· 键盘快捷键 · 条目渲染器 |
| 实验性 | 决策事件 · toast 通知 · 侧栏 Panel（`ctx.tuiPanels`）· `@` 提及提供方（`ctx.tuiMentions`） |
| 跟随上游（稳定性由 cordis / dsh 官方机制决定） | 会话事件 · 官方 prompt 槽位 · 技能打包 · 主题 · system prompt 段 · profile 组合 |

用户在 TUI 内即可完成插件生命周期管理：`/plugin install <spec>`（装前提醒 + 信任确认）、`/plugin remove` / `enable` / `disable`（bundle 名精确匹配优先；提供本应用的 bundle、宿主层 dsh-base、本包自己的行会被门禁硬拒）。生态组织只维护收录与准入规则，不对社区插件的功能、质量或安全性作背书。

---

## 16. 更新到最新版本

一次 `/update`（或 `dsh-tui update`）会把**同一套互相兼容的版本**对齐到三层并校验：

1. **Profile 里的 TUI**：`dsh plugin --profile dsh-tui update @deepseek-harness-tui/dsh-tui@<版本>`。
2. **全局 `dsh` 引擎**：目标版本 = 目标 TUI 的 `dsh-app-boot` peer 范围里 registry 上已发布的最高版本。
3. **全局 `dsh-tui` 启动器**：best effort 对齐。

要点：

- TUI 内的 `/update` 校验后自动重启并恢复会话；`dsh-tui update` 只对齐、不进入 TUI、不重启。
- **永不降级**：引擎或启动器比目标新时保持原样，并提示漂移。
- 预检发现「TUI 要升级，而当前引擎不在新 TUI 的 peer 范围内」时，不拆树、不重启，文案给出下一步（先升级引擎再重新 `/update`；高于范围时等 TUI 适配）。
- 用户覆盖层 `cordis.patch.yml` 在更新中原样保留；会话数据不被删除。
- pnpm ≥11 默认不装发布不足 24 小时的版本，`/update` 会自动放开该窗口（手工 `pnpm add -g` 时需加 `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0`）。
- 逃生开关：`DSH_TUI_UPDATE_ENGINE=0` 跳过引擎自动安装；`DSH_TUI_UPDATE_LAUNCHER=0` 跳过启动器对齐。
- 确认生效：启动横幅右上角显示当前版本（`✦ dsh-TUI vX.Y.Z`）。

---

## 17. 常见问题

**`dsh-tui requires an interactive terminal`**
stdout 不是 TTY。请直接在终端中启动，不要把主进程输出管道到文件或其他命令。

**找不到 `dsh` 或 `pnpm`**
确认全局 npm bin 目录在 `PATH` 中，并重新打开终端。

**启动后立刻退回 shell，几乎没有报错（pnpm 9）**
pnpm 9 的传递依赖提升行为不同，导致 `dsh-working-activity` 解析不到（issue #60）。升级 pnpm 到 10+ 后重装：

```sh
npm install -g pnpm@latest
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@latest
```

**模型启动失败或提示没有凭证**
`deepseek-official` 路由确认启动 `dsh` 的同一个 Shell 中存在 `DEEPSEEK_API_KEY`；订阅模型用 `/auth status` 检查登录状态，必要时 `/auth login <provider>`。

**浏览器能访问、dsh-tui 连不上自建 HTTPS 端点（自签证书 / 私有 CA）**
Node.js 只信任内置 Mozilla CA bundle 与 `NODE_EXTRA_CA_CERTS` 指向的 PEM 文件（macOS Keychain 的信任设置对 Node 无效）。把根证书导出为 PEM 后在启动前设置：

```sh
export NODE_EXTRA_CA_CERTS=/path/to/your-ca-root.pem
dsh-tui
```

注意该变量受 DSH 启动器保护，只能由启动 dsh 的那个 Shell 环境继承，不能写进任何 `.env` 文件。

**工作状态行重复**
检查 profile 是否曾单独添加 `dsh-working-activity`——本包 patch 已自动插入，保留一个即可。

**Git URL 安装报错（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 等）**
Git URL 安装不受支持（workspace 依赖/子模块/pnpm ≥11 prepare 白名单三重阻断）。请安装 registry 包：`dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui`。

**TUI 显示错位或终端退出后状态异常**
先运行 `/doctor` 记录终端类型和模式；渲染问题可用 `DSH_TUI_RENDER_LOG` 采集原始帧（日志可能包含会话可见内容，应妥善处理）。

**从旧包（`dsh-cc-tui` / `cc-tui` profile）迁移**
新版本统一为 `@deepseek-harness-tui/dsh-tui` 与 `dsh-tui` profile，只读 `DSH_TUI_*` 环境变量与 `~/.dsh-tui` 数据目录，**不自动迁移旧数据**。创建新 profile 后，自行把旧目录（`~/.dsh-cc` 等）中的主题、配置与历史文件复制到 `~/.dsh-tui`。

---

## 18. 来源

本文整理自 dsh-TUI 随包官方用户手册（`@deepseek-harness-tui/dsh-tui` 包内 `guide/dsh-tui-guide/`，共十篇，中英各一份）：

| 主题 | 文档 |
| --- | --- |
| 安装、首次启动、排障 | `getting-started.md`（安装与快速开始） |
| 日常使用、键位、斜杠命令、会话与工作流、设置 | `user-guide.md`（dsh-TUI 使用说明） |
| 输入框、鼠标、选中复制、粘贴、图片、问卷与审批 | `interaction.md`（交互与命令） |
| 配置覆盖层、TUI 开关、agent preset、模型路由、MCP | `configuration.md`（配置参考） |
| Claude 后端 | `claude-backend.md` |
| Codex 后端 | `codex-backend.md` |
| 主题、配色、自定义主题 | `themes.md`（主题系统） |
| 从其他编程代理迁移会话 | `migrate.md` |
| 无界面执行、JSON 输出、CLI 会话查询 | `cli.md`（自动化 CLI） |
| VS Code 集成 | `vscode.md` |
| 插件生态、接缝稳定性分级 | `plugins.md` |

项目仓库：[ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)；生态组织：[dsh-tui-ecosystem](https://github.com/dsh-tui-ecosystem)；VS Code 扩展：[baobaolaodie/dsh-tui-vscode](https://github.com/baobaolaodie/dsh-tui-vscode)。

> 项目迭代很快，具体行为以随包手册与运行版本为准。遇到不确定的功能，直接问会话里的 AI：手册随包发布，`/dsh-tui-guide <问题>` 可指定走手册回答并给出处。
