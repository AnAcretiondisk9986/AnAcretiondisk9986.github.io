---
title: "wezmux-agent-mcp：让 WezTerm / Wezmux 里的多个 AI Agent 真正开口协作"
description: "继把主力终端换成 WezTerm 后，我整理并开源了 wezmux-agent-mcp——一套基于 Node.js 内置 SQLite WAL 与 MCP 协议的多窗格 Agent 协作插件。支持跨实例窗格发现、点对点/广播消息总线与空闲唤醒、TTL 咨询式文件锁、Windows/Unix OSC 7777 侧边栏状态桥接，以及「已有窗体优先」的三层新建权限护栏。"
pubDate: "2026-11-21"
dayIndex: 2
cover: "/images/wezmux-agent-mcp/cover.webp"
tags:
  - WezTerm
  - Wezmux
  - MCP
  - 多Agent协作
  - Claude Code
  - 效率工具
draft: false
access: public
---

<h1 style="text-align: center"><u><span style="color: #cba6f7; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">wezmux-agent-mcp</span></u>：让终端里的多个 AI Agent 真正开口协作</h1>

<p style="text-align: center; color: #9399b2">从「一个人盯四个窗格手动传话」，进化到「架构师、编码手、审查员在终端里直接对话与交接」。</p>

上一篇 [WezTerm 介绍、推荐与实战配置：Agent CLI 时代的终端驾驶舱](/blog/wezterm-终端推荐与使用说明-agent-cli-时代的终端驾驶舱/) 聊到，我把主力终端切换到了 WezTerm（以及支持侧边栏与 Workspaces 的衍生版 [vcabeli/wezmux](https://github.com/vcabeli/wezmux)），同时在分屏里并排跑起了 Claude Code、Codex、OpenCode 与 Antigravity CLI。

但用顺手之后，一个新的瓶颈很快浮现出来：**终端只是把多个 Agent「摆在了一起」，它们彼此依然是失明的孤岛。**

- 左屏的架构 Agent 刚出完方案，我得手动复制一段大长文粘贴给右屏的编码 Agent；
- 编码 Agent 改完代码，我又得切换焦点去通知测试窗格跑单测，或者肉眼盯着输出再把报错贴回去；
- 两个并行 Agent 凑巧要改同一个配置文件，稍不留神就会互相覆盖；
- 更让人头疼的是，如果给 Agent 直接开放终端控制权，它动不动就自己 `split-pane` 弹出一堆新分屏或新窗口，屏幕瞬间炸成蜘蛛网。

为了解决这套痛点，我写了一个轻量、零原生编译依赖的 MCP 服务与 Hook 桥接插件——**[wezmux-agent-mcp](https://github.com/AnAcretiondisk9986/wezmux-agent-mcp)**。今天把它的设计思路、核心能力、安全护栏以及在 Windows / Unix 下的完整接入手册一次讲清楚。

![wezmux-agent-mcp 封面：多窗格终端通过共享总线协作](/images/wezmux-agent-mcp/cover.webp)

---

## 一、它解决什么问题？核心设计哲学

`wezmux-agent-mcp` 的目标很克制：**不造又一个重型多智能体编排框架，而是把你已经在 WezTerm / Wezmux 里打开的每一个终端窗格，变成一个「可被发现、可收发结构化消息、状态可见、且受权限护栏约束」的协作节点。**

整个插件围绕四条核心原则设计：

1. **零原生编译，开箱即用**：基于 **Node.js `>= 22.5` 内置的 `node:sqlite`**（开启 WAL 模式与 `busy_timeout = 5000`），不需要装 Python、C++ Build Tools 或额外数据库进程，一个本地 SQLite 文件（`~/.wezmux-agent-mcp/broker.db`）就能撑起多进程并发消息总线。
2. **跨实例与多窗口全发现**：哪怕你开了多个独立的 WezTerm / Wezmux GUI 窗口进程，它也能扫描全部存活的 GUI Socket（包括 Windows 下的 `AF_UNIX` socket，并自动剔除已退出的残留 PID），一次列出所有窗口、Workspace、标签页与分屏。
3. **已有窗体优先（Existing-Pane-First）**：Agent 应当优先操作你**已经打开并排好布局的窗体与分屏**，而不是随手给你拉一堆新窗口。
4. **Windows 与 Unix 一视同仁的侧边栏联动**：通过 `wezmux-hook.mjs` 将 Claude Code 的生命周期事件翻译为 **OSC 7777** 状态指令和 **OSC 9** 桌面通知，在 Windows 上直接写入 `\\.\CONOUT$`（Unix 上写入 `/dev/tty`），让 Wezmux 侧边栏在 Windows 11 下同样丝滑联动。

---

## 二、整体架构与 13 个 MCP 工具全景

先看整体架构图，数据流非常清晰：

![wezmux-agent-mcp 系统架构图](/images/wezmux-agent-mcp/architecture.webp)

整个系统由三层组成：

- **表示与终端层（WezTerm / Wezmux）**：负责多窗格排布、侧边栏卡片渲染（OSC 7777 / OSC 9）以及底部/右上角 `pane:<id>` 状态提示。
- **能力与桥接层（`server.mjs` + `wezmux-hook.mjs` + `wezterm-cli.mjs`）**：
  - `server.mjs` 通过标准 stdio MCP 暴露 **13 个工具**；
  - `wezmux-hook.mjs` 对接 Claude Code 的 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Notification`、`Stop`、`SubagentStart`、`SubagentStop` 钩子。
- **持久层（`db.mjs` -> `broker.db`）**：SQLite WAL 模式维护三张核心表：`agents`（身份与实时状态）、`messages`（点对点与广播消息）、`file_locks`（TTL 咨询锁）。

### 暴露的 13 个 MCP 工具一览

| 分类 | 工具名 | 作用说明 |
| :--- | :--- | :--- |
| **已有窗体操作** | `list_panes` | 扫描所有存活的 WezTerm/Wezmux 实例，列出窗口、Workspace、标签、分屏及自动识别出的 CLI 类型（`claude-code`、`codex`、`opencode`、`gemini`、`aider`） |
| | `send_text` | 向指定 `pane_id` 发送文本或命令（默认 `no_paste=true` 适配交互式 CLI，`submit=true` 自动回车） |
| | `get_text` | 读取指定 `pane_id` 最近的终端输出（默认剥离 ANSI 转义序列，也支持 `start_line` 读回滚历史） |
| | `focus_pane` | 激活并聚焦到指定 `pane_id` |
| **受控生命周期** | `spawn_pane` | **严格受限**：新建分屏、标签页或窗口（受三层权限护栏保护，必须先获用户许可） |
| | `kill_pane` | 关闭指定 `pane_id` |
| **多 Agent 总线** | `register_agent` | 为当前或指定窗格注册易记的名称与角色（如 `architect`、`coder`、`reviewer`），同时更新 Wezmux 侧边栏标题 |
| | `list_agents` | 列出所有已注册 Agent、存活检查（`pane_alive`）、未读消息数，以及尚未注册但已打开的窗格 |
| | `send_message` | 按 Agent 名、`pane_id` 或 `*` 广播发送结构化消息（支持 `thread_id`、`reply_to` 与 `wake_pane=true` 空闲唤醒） |
| | `read_messages` | 读取收件箱里的未读或历史消息，可按发件人、线程过滤 |
| | `wait_for_message` | 阻塞轮询等待某条新消息或特定 `thread_id` 的回复（最长支持 `180` 秒） |
| **状态与并发安全** | `set_wezmux_status` | 手动向 Wezmux 侧边栏同步 `working` / `idle` / `needs_input` 状态、摘要与 OSC 9 提醒 |
| | `file_lock` | 申请（`acquire`）、释放（`release`）或查看（`list`）带 TTL（默认 300s，支持 10~3600s）的咨询式文件锁 |

---

## 三、多 Agent 协作实战：从发现窗体到消息唤醒

在实际使用时，你只需要在 WezTerm / Wezmux 里随手拆好 2～3 个分屏，剩下的调度都可以用自然语言完成：

![Wezmux 多 Agent 分屏协作与侧边栏状态联动](/images/wezmux-agent-mcp/multi-agent-workflow.webp)

### 1. 自动注册与身份无缝迁移

当任意窗格里的 Claude Code 启动时，`SessionStart` Hook 会自动把它登记进 `broker.db`（默认名字如 `pane-40072-25`），并往模型上下文里注入一段提示：当前所在的 `pane_id`、默认身份以及未读邮件提醒。

当你对它说：「**把你当前窗格注册为 `coder`，负责接口实现**」，它会调用 `register_agent`。更有意思的是，**如果此前已经有其他 Agent 给裸 `pane_id`（例如 `"25"` 或 `"pane-25"`）发过未读消息，`db.mjs` 会自动把历史消息的收件人/发件人迁移到新名字 `coder` 名下，一封也不会丢。**

### 2. 结构化通信 + `wake_pane=true` 唤醒闲置 Agent

很多多 Agent 方案的痛点在于：**消息发进数据库了，但对面那个 CLI 正处于空闲等待用户输入的光标状态，它压根不知道自己收到信了。**

`send_message` 提供了一个非常实用的开关 `wake_pane: true`：
1. 先把完整、带主题和线程 ID 的结构化正文写入 SQLite 消息总线；
2. 再通过 WezTerm CLI 向目标分屏投递一行极简唤醒提示并自动回车：
   ```text
   [wezmux-msg #42 from architect] Please call read_messages (agent_name="coder") to read and reply.
   ```
3. 对方窗格里的 Agent 被瞬间唤醒，调一次 `read_messages` 就能拿到完整任务上下文并开始干活；同时当它下一次在面板里接受用户输入时，`UserPromptSubmit` Hook 也会兜底检查并提醒它还有几封未读消息。

### 3. 给不支持 MCP 的老派终端也能协同

哪怕右侧分屏里跑的不是 Claude Code，而只是一个普通的 `pwsh` 测试窗口、构建日志、或者没有配 MCP 的命令行工具，主控 Agent 依然可以通过 `send_text` 往里面敲命令，过几秒再用 `get_text` 抓取剥离了 ANSI 控制符的干净终端输出。

### 4. 并行改代码不再踩踏：`file_lock`

当两个分屏分别在重构认证中间件和路由表时，可以在提示词或规则里约定改文件前先上锁：

- `file_lock(action="acquire", file_path="src/auth/jwt.ts", reason="重构 token 校验")`
- 若另一边的 Agent 同时申请同一文件，会直接返回锁冲突信息（包含持有者、原因和过期时间），避免静默覆盖。

---

## 四、安全机制：「已有窗体优先」与三层 Spawn Guard

用过终端自动化 MCP 的同学应该都有过阴影：一旦给模型开放了「创建分屏/窗口」的工具，它遇到需要跑个命令或开个副手时，很容易未经打招呼就开始狂开分屏，最后整个桌面全是孤儿终端。

`wezmux-agent-mcp` 把**「先用已有窗体、新建必须审批」**做成了从提示词到操作系统弹窗的三层防线：

![已有窗体优先与三层 Spawn Guard 安全机制](/images/wezmux-agent-mcp/spawn-guard-safety.webp)

1. **第一层（客户端与 Hook 拦截）**：
   - MCP Server Instructions、`SessionStart` 上下文以及 `~/.claude/CLAUDE.md` 均明确指示优先使用 `list_panes` / `list_agents` 操作已有窗格；
   - `~/.claude/settings.json` 中同时配置了 `permissions.ask` 与 `PreToolUse` `spawn-guard` Hook（命中 `mcp__.*wezmux-agent__spawn_pane` 时强制返回 `permissionDecision: "ask"`），请求新建前必先弹窗向你征求同意。
2. **第二层（服务端策略与参数校验）**：
   - 支持通过环境变量 `WEZMUX_SPAWN_POLICY` 控制策略：`ask`（默认）、`deny`（硬性禁止所有 `spawn_pane` 调用）、`native_dialog`；
   - 若工具传入 `user_approved: false`，服务端直接报错拒绝。
3. **第三层（Windows 原生二次确认弹窗）**：
   - 设置 `WEZMUX_SPAWN_OS_CONFIRM=1` 后，即使上层客户端配置了自动放行或 Skip Permissions，服务端在真正执行 `wezterm cli split-pane / spawn` 前，依然会拉起一个 **Windows 原生 `MessageBox`（「是 / 否」默认选中「否」）**，展示申请模式、原因与即将执行的命令，由你亲自拍板。

---

## 五、5 分钟安装与接入指南

### 1. 环境要求与克隆测试

确保本机已安装 **Node.js `>= 22.5`**（我本机实测为 `v24.14.1`）以及 **WezTerm** 或 **Wezmux**：

```powershell
git clone https://github.com/AnAcretiondisk9986/wezmux-agent-mcp.git
cd wezmux-agent-mcp
npm install
npm test
```

`npm test` 会运行内置的集成冒烟测试（[test-mcp.mjs](https://github.com/AnAcretiondisk9986/wezmux-agent-mcp/blob/main/test-mcp.mjs)），依次验证 13 个工具暴露、`spawn_pane` 拦截、`SessionStart` / `PreToolUse` / `UserPromptSubmit` Hook、消息迁移和文件锁冲突检测：

```text
Tools exposed: list_panes, spawn_pane, send_text, get_text, focus_pane, kill_pane, register_agent, list_agents, send_message, read_messages, wait_for_message, set_wezmux_status, file_lock
ALL MCP + MULTI-PANE + SPAWN-GUARD + HOOK SMOKE TESTS PASSED!
```

### 2. 注册到 Claude Code（或通过网关挂载）

最推荐给每个终端进程独立挂载 stdio MCP（这样每个进程能天然继承自己所在窗格的 `WEZTERM_PANE` 环境变量）：

```bash
claude mcp add-json --scope user wezmux-agent '{"type":"stdio","command":"node","args":["--no-warnings","C:/path/to/wezmux-agent-mcp/server.mjs"]}'
```

*(小贴士：如果你像我一样也通过统一 MCP Hub 网关来暴露工具，MCP 进程本身可能不带具体分屏的环境变量；此时只需配合下面的 Hooks，每个分屏里的 Agent 在启动时依然会从 `SessionStart` 拿到自己真实的 `pane_id`，调用 `register_agent` 绑定一下即可。)*

### 3. 启用 Hooks 与新建护栏

参考仓库里的 `examples/claude-settings.hooks.json`，将 `hooks` 与 `permissions.ask` 合并到 `~/.claude/settings.json`（把路径替换为你的本地克隆目录即可）。

### 4. 配套 `~/.wezmux.lua` / `~/.wezterm.lua` 状态栏增强

为了在多窗格协作时一眼看清每个分屏的 `pane_id`，建议在状态栏回调里把 `pane:pane_id()` 打出来（仓库内 `examples/wezmux.lua` 已提供完整模板）：

```lua
wezterm.on("update-right-status", function(window, pane)
  local workspace = window:active_workspace()
  local pane_id = pane and tostring(pane:pane_id()) or "?"
  window:set_right_status(wezterm.format({
    { Foreground = { Color = "#cba6f7" } },
    { Text = " pane:" .. pane_id .. " " },
    { Foreground = { Color = "#89b4fa" } },
    { Text = "| " .. workspace .. " " },
  }))
end)
```

如果用的是 **vcabeli/wezmux**，还可以顺手开启左侧栏及快捷键：`Ctrl+Shift+B` 切换侧边栏、`Alt+U` 一键跳到发出 `needs_input` / `stop` 提醒的未读窗格、`Alt+J/K` 切换 Workspace。

---

## 六、常用环境变量速查

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `WEZMUX_AGENT_DATA_DIR` | `~/.wezmux-agent-mcp` | `broker.db` 存储目录 |
| `WEZMUX_CLI_BIN` | 自动探测 | 手动指定 `wezterm` / `wezterm.exe` 路径 |
| `WEZMUX_SPAWN_POLICY` | `ask` | `ask`（询问）、`deny`（硬禁止）、`native_dialog`（强制系统弹窗） |
| `WEZMUX_SPAWN_OS_CONFIRM` | 未启用 | 设为 `1` 时强制弹出 Windows 原生确认框 |

---

## 七、写在最后

在「单兵一个 CLI 写代码」的时代，终端只要够快、字体够好看就够了；但当我们习惯了同时开着几个分屏，让不同的模型分别扮演**规划者、编码者、测试员与代码审查员**时，它们之间正缺一条轻量、透明、不破坏既有终端习惯的「神经总线」。

`wezmux-agent-mcp` 就是为了补上这块拼图而生：保留你完全掌控的 WezTerm 分屏布局，不绑架工作流，却让屏与屏之间的 Agent 真正能互相看见、传话、协作与避让。

项目已以 MIT 协议开源在 GitHub：**[AnAcretiondisk9986/wezmux-agent-mcp](https://github.com/AnAcretiondisk9986/wezmux-agent-mcp)**，欢迎下载试用，也欢迎一起提 Issue 或 PR 完善更多 CLI 适配！
