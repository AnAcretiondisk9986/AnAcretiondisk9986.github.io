---
title: Claude Code CLI 使用手册
description: "适合第一次使用 Claude Code 的开发者。安装以 Windows PowerShell 为主，也提供 macOS、Linux 和 WSL 命令。启动参数以 Claude Code 2.1.328 为参考，实际可用项可用 claude --help 和会话中的 /help 查看。"
pubDate: "2026-11-20"
dayIndex: 1
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/Gemini_Generated_Image_b85d1lb85d1lb85d_1795108770610.webp"
draft: false
access: public
---

<h1 style="text-align: center"><u><span style="color: #ff5a1a; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">Claude Code CLI</span></u><span style="color: #ff5a1a; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)"> </span>使用手册</h1>

适合第一次使用 <span style="color: #ff5a1a">Claude Code</span> 的开发者。安装以 Windows PowerShell 为主，也提供 macOS、Linux 和 WSL 命令。启动参数以 Claude Code `2.1.328` 为参考，实际可用项可用 `claude --help` 和会话中的 `/help` 查看。

[安装和登录](#1-%E5%AE%89%E8%A3%85%E5%92%8C%E7%99%BB%E5%BD%95) · [项目实操](#2-%E7%AC%AC%E4%B8%80%E6%AC%A1%E5%9C%A8%E9%A1%B9%E7%9B%AE%E9%87%8C%E5%B7%A5%E4%BD%9C) · [命令速查](#3-%E5%B8%B8%E7%94%A8%E5%91%BD%E4%BB%A4%E9%80%9F%E6%9F%A5) · [设置与权限](#4-%E9%A1%B9%E7%9B%AE%E6%8C%87%E4%BB%A4%E8%AE%BE%E7%BD%AE%E5%92%8C%E6%9D%83%E9%99%90) · [会话与回退](#5-%E6%81%A2%E5%A4%8D%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86%E4%B8%8A%E4%B8%8B%E6%96%87%E5%92%8C%E5%9B%9E%E9%80%80) · [脚本](#6-%E7%94%A8%E8%84%9A%E6%9C%AC%E8%BF%90%E8%A1%8C-claude-code) · [扩展](#7-%E6%89%A9%E5%B1%95%E8%83%BD%E5%8A%9B) · [故障排查](#8-%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98)

## 1. 安装和登录

### Windows 原生环境

在 PowerShell 中选择一种方式安装。

```powershell
irm https://claude.ai/install.ps1 | iex

```

也可以使用 WinGet。

```powershell
winget install Anthropic.ClaudeCode

```

### macOS、Linux 和 WSL

在 Bash 或 Zsh 中运行。WSL 用户请在 WSL 发行版的终端中安装和启动。

```bash
curl -fsSL https://claude.ai/install.sh | bash

```

### 验证、登录和更新

安装后打开新的终端。先确认命令可用，再进入你信任的项目目录并启动。下面以 PowerShell 为例，请替换项目路径。

```powershell
claude --version
cd C:\work\my-project
claude

```

首次启动按提示在浏览器中登录。也可以在系统终端运行 `claude auth login` 使用 Claude 订阅，或运行 `claude auth login --console` 使用 Claude Console 的 API 用量计费。运行 `claude auth status` 查看登录状态。企业环境按管理员提供的账号和配置接入。

通过官方脚本安装的原生版本通常会自动更新，也可运行 `claude update` 手动检查。通过 WinGet 安装的版本用 `winget upgrade Anthropic.ClaudeCode` 更新。已有 npm 安装可以用 `npm install -g @anthropic-ai/claude-code` 更新。

[官方安装指南](https://code.claude.com/docs/en/setup) · [身份验证](https://code.claude.com/docs/en/authentication)

## 2. 第一次在项目里工作

Claude Code 可以读取项目文件、编辑代码、运行命令和测试。启动目录决定初始工作范围，建议从项目根目录开始。首次打开项目时，先确认来源可信，再确认工作区信任提示。

下面是一轮从理解项目到验收改动的对话。每个代码块都是在 Claude Code 的输入框中发送的一条消息。

1. **先了解项目。**
   ```text

```

CODE_SLOT_4

如果项目用 Git 管理，交付前在终端运行 `git status --short` 和 `git diff`。新建的未跟踪文件会出现在 `git status` 中，需要单独检查内容。提交和推送可以作为明确的后续步骤。

## 3. 常用命令速查

### 在系统终端执行

| 命令 | 用途 |
| --- | --- |
| `claude` | 开始新的交互式会话 |
| `claude "说明项目目录结构"` | 带着首条提示进入交互会话 |
| `claude -c` | 继续当前目录最近的会话 |
| `claude -r` | 打开历史会话选择器 |
| `claude -r <会话ID或名称>` | 恢复指定会话，请替换占位内容 |
| `claude --name auth-fix` | 给新会话命名，便于查找 |
| `claude --permission-mode plan` | 以计划模式启动 |
| `claude --worktree search-fix` | 在 Git 仓库中创建独立工作树并启动会话，适合并行处理任务 |
| `claude --model opus` | 用 `opus` 别名启动，模型可用性取决于账号和接入方式 |
| `claude -p "概述这个项目"` | 运行一次并输出结果，适合脚本 |
| `claude doctor` | 检查本机安装和配置 |
| `claude --help` | 查看当前安装版本支持的命令和参数 |

### 在 Claude Code 会话输入框中使用

| 命令或按键 | 用途 |
| --- | --- |
| `/help` | 查看本会话可用命令 |
| `/status` | 查看版本、模型和账号等状态 |
| `/model` | 查看或切换会话模型 |
| `/config` | 打开设置界面 |
| `/permissions` | 查看或管理工具权限规则 |
| `/context` | 查看当前上下文使用情况 |
| `/compact` | 压缩会话上下文。可附一句说明哪些信息要保留 |
| `/clear` | 清除当前上下文，开始新任务。磁盘文件保持原样 |
| `/resume` | 查找并恢复其他会话 |
| `/rewind` 或连续按两次 `Esc` | 打开回退界面，按可用选项处理对话或文件 |
| `/init` | 为当前项目生成起始 `CLAUDE.md`，生成后检查内容 |
| `/mcp` | 查看和管理当前会话的 MCP 连接 |
| `Esc` | 中断正在进行的操作 |
| `! git status --short` | 在会话里执行终端命令，并把结果加入对话 |

在提示中输入 `@` 可以选择文件或目录，例如 `@src/search.ts`。定位错误时，给出报错、复现步骤和相关文件，有助于缩小调查范围。

[CLI 参数参考](https://code.claude.com/docs/en/cli-reference) · [交互式命令和快捷键](https://code.claude.com/docs/en/interactive-mode)

## 4. 项目指令、设置和权限

`CLAUDE.md` 用来描述项目约定，`settings.json` 用来配置 CLI 行为和工具权限。

| 内容 | 路径 | 适用范围 |
| --- | --- | --- |
| 个人指令 | `~/.claude/CLAUDE.md` | 当前用户的多个项目 |
| 项目指令 | `CLAUDE.md` 或 `.claude/CLAUDE.md` | 当前项目，可随代码共享 |
| 个人设置 | `~/.claude/settings.json` | 当前用户的多个项目 |
| 团队设置 | `.claude/settings.json` | 当前项目，可随代码共享 |
| 本地设置 | `.claude/settings.local.json` | 当前项目的个人覆盖，保持在版本控制之外 |

`~` 指用户主目录。Windows 用户可在 PowerShell 以 `$HOME` 找到它。企业托管的设置还可能限制本地可用选项。

项目指令可以从三条具体约定开始，命令要换成项目实际使用的版本。 CODE_SLOT_5

日常操作可用默认交互模式审查工具请求。需要先讨论实现时用 `plan`。`acceptEdits` 会自动批准部分文件编辑操作，其他工具仍按权限规则判断。检查 `/permissions` 中已有的允许与拒绝规则。提示词和 `CLAUDE.md` 适合表达约定，需要强制限制时使用工具权限规则。

将下面的规则合并到项目的 `.claude/settings.local.json` 后，Claude Code 可以直接运行 `git status` 和 `git status --short`。 CODE_SLOT_6

这条规则适用于 Claude Code 的 Bash 工具。如果会话使用其他 shell 工具，请按该工具的权限语法配置。

[项目指令和记忆](https://code.claude.com/docs/en/memory) · [设置](https://code.claude.com/docs/en/settings) · [权限](https://code.claude.com/docs/en/permissions)

## 5. 恢复会话、管理上下文和回退

- **接着做同一件事**时，在项目目录运行 `claude -c`，或用 `claude -r` 选择会话。需要保留原会话再尝试另一种方案时，可以用 `claude --resume <会话ID> --fork-session` 创建分支会话。
- **继续同一任务但上下文变长**时，先用 `/context` 查看占用，再用 `/compact 保留已确认的方案、修改范围和未通过的测试` 压缩。切换到无关任务时可用 `/clear`。
- **撤回代码编辑**时，用 `/rewind` 查看可恢复的检查点，恢复前确认范围。Shell 命令产生的文件变化以及数据库、远端等外部操作需要用对应工具处理。Git 可用于检查和恢复纳入版本控制的文件。

[检查点与回退](https://code.claude.com/docs/en/checkpointing)

## 6. 用脚本运行 Claude Code

`-p` 或 `--print` 运行一条任务并退出。下面的例子适用于 PowerShell 和 Bash。`--tools=` 传入空工具列表，`--strict-mcp-config` 将 MCP 配置限定在命令行指定的范围内。这里未指定 MCP 服务，任务只需处理传入的文本。 CODE_SLOT_7

脚本读取结果时，可以加 `--output-format json` 获取 JSON 结果对象。例如，在 PowerShell 中可用 `ConvertFrom-Json` 解析，再读取 `result` 字段。 CODE_SLOT_8

需要实时处理事件时用 `--output-format stream-json`，并查阅 CLI 参考了解流式输出的搭配参数。要约束生成内容的字段与类型，可加 `--json-schema`。

`-p` 会跳过工作区信任对话框，请从受信任的目录运行。上例限制了内置工具和 MCP，已配置的 Hooks 仍可能执行。用于 CI 时，通过平台的密钥管理注入凭据，并检查命令退出码和输出内容。

[脚本运行指南](https://code.claude.com/docs/en/headless) · [CLI 参数参考](https://code.claude.com/docs/en/cli-reference)

## 7. 扩展能力

| 能力 | 何时使用 | 从哪里开始 |
| --- | --- | --- |
| Skills | 把常用流程写成可复用的指导，例如生成发布说明 | 项目中创建 `.claude/skills/release-notes/SKILL.md`，在会话中调用 `/release-notes` |
| MCP | 让 Claude 调用外部系统提供的工具，例如查询工单 | 用 `claude mcp --help` 查看配置命令，`claude mcp list` 查看配置，`/mcp` 检查会话连接 |
| Hooks | 在特定事件发生时自动执行操作，例如文件编辑后运行格式化 | 用 `/hooks` 查看配置入口，按官方指南在 `settings.json` 中配置事件和操作 |
| 子代理 | 将独立的调查任务交给带专门指令和工具范围的代理 | 用 `/agents` 查看可用代理，或在 `.claude/agents/` 定义项目代理 |
| Plugins | 安装和分发一组扩展配置 | 用 `/plugin` 查看管理界面，安装前检查发布者和包含的组件 |

例如，在项目中创建 `.claude/skills/release-notes/SKILL.md`，把发布说明的写法记录下来。 CODE_SLOT_9

在会话中输入 `/release-notes 修复搜索框清空后残留旧结果`。将扩展配置共享给团队前，检查其中会执行的命令、访问范围和凭据来源。

[Skills](https://code.claude.com/docs/en/skills) · [MCP](https://code.claude.com/docs/en/mcp) · [Hooks](https://code.claude.com/docs/en/hooks-guide) · [子代理](https://code.claude.com/docs/en/sub-agents) · [Plugins](https://code.claude.com/docs/en/plugins)

## 8. 常见问题

| 现象 | 处理步骤 |
| --- | --- |
| Windows 找不到 `claude` | 打开新终端，运行 `Get-Command claude -All` 检查 PATH 和是否存在多套安装。macOS、Linux 或 WSL 可用 `command -v claude`。 |
| PowerShell 提示执行策略阻止 `claude.ps1` | 如果通过 npm 安装，先用 `Get-Command claude.cmd` 确认 CMD 入口，再运行 `claude.cmd --version` 验证。也可以使用第 1 节的原生安装方式。 |
| Windows 启动时提示找不到 Git Bash | 确认已安装 Git for Windows，再按官方安装指南中的 Windows 说明检查路径配置。 |
| 登录后仍提示无权限或模型不可用 | 用 `claude auth status` 检查登录状态，在会话中用 `/status` 查看账号和模型。核对组织授权和账号的计费方式。 |
| Claude 找不到目标文件 | 确认启动目录和文件路径。确有跨目录需求时，使用 `--add-dir` 指定需要的目录。 |
| MCP、Hooks 或插件导致启动异常 | 在信任的目录运行 `claude doctor`。如果当前版本支持 `claude --safe-mode`，可用它暂时停用本地自定义内容以缩小排查范围。 |
| 模型忘了某条任务要求 | 用 `/context` 检查上下文占用，在当前提示中重申验收条件。团队长期约定可写入项目的 `CLAUDE.md`。 |
| Claude 报告“测试通过”，但输出没有测试证据 | 让它列出实际运行的命令和通过、失败、跳过的结果。必要时在终端重复执行。 |

[官方故障排查](https://code.claude.com/docs/en/troubleshooting)