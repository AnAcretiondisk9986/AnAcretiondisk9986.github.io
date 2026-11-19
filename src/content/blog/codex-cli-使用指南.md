---
title: Codex CLI 使用指南
description: ""
pubDate: "2026-11-20"
dayIndex: 2
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/Gemini_Generated_Image_j2a0w2j2a0w2j2a0_1795109108875.webp"
draft: false
access: public
---

<h1 style="text-align: center"><u><span style="color: #ff5a1a; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">Codex CLI</span></u> 使用指南</h1>

  

适用于 Windows PowerShell。常用参数已按本机 Codex CLI `0.170.0` 核对。

  

## 安装与启动

  

新机器使用 npm 安装时，先安装 Node.js，再打开 PowerShell 执行以下命令。

  

```powershell
npm install -g @openai/codex
codex --version

```

  

本机已安装 Codex CLI。如果 PowerShell 提示找不到 `node.exe`，可执行以下命令。这只会修改当前终端的 `PATH`。长期使用时，可以把常用的 Node.js 安装目录加入用户 `PATH`。

  

```powershell
$codexNodeDir = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:Path = "$codexNodeDir;$env:Path"
codex --version

```

  

沿用本机已配置的本地网关时，进入项目目录后直接运行 `codex`。使用 ChatGPT 账号认证时，可运行 `codex login`，再用 `codex login status` 查看登录状态。

  

## 日常工作流

  

1. 进入项目目录，用 `git status --short` 查看已有改动。
2. 启动 Codex，写明任务目标、改动范围和验收方式。复杂任务可先用 `/plan` 讨论方案。
3. 完成后用 `git diff` 查看未暂存的改动，用 `git diff --cached` 查看已暂存的改动，再核对测试结果。需要代码审查时使用 `/review`。

  

```powershell
Set-Location -LiteralPath 'D:\Projects\my-app'
git status --short
codex -s workspace-write -a on-request

```

  

把示例路径换成自己的项目路径。下面是一条可直接改写的提示词。

  

> 登录页输入错误密码时没有提示。先定位原因，再做最小修复，保持现有接口和页面布局。修改后运行相关测试，列出改动文件、测试结果和未验证项。

  

## PowerShell 命令速查

  

| 命令 | 用途 |
| --- | --- |
| `codex` | 在当前目录启动交互界面 |
| `codex -C "D:\Projects\my-app"` | 指定项目目录后启动 |
| `codex -s read-only "梳理项目结构和启动方式"` | 用只读沙箱分析项目 |
| `codex -s workspace-write -a on-request` | 允许编辑工作区文件，需要时请求批准 |
| `codex resume` | 从列表选择之前的会话 |
| `codex resume --last` | 恢复当前目录下最近的交互会话 |
| `codex review --uncommitted` | 审查已暂存、未暂存和未跟踪的改动 |
| `codex mcp list` | 查看已配置的 MCP 服务 |
| `codex --help` 或 `codex exec --help` | 查看本机版本支持的命令和参数 |

  

### 非交互运行

  

在项目目录运行以下命令，将最终回复写入 `review.md`。脚本需要逐行读取运行事件时，可加 `--json` 输出 JSONL。

  

```powershell
codex exec -s read-only -o review.md "总结当前改动和测试缺口"

```

  

## 交互界面内的斜杠命令

  

在 Codex 输入框中键入 `/`，查看当前版本提供的命令。

  

| 命令 | 用途 |
| --- | --- |
| `/plan` | 进入计划模式，先讨论方案 |
| `/status` | 查看模型、批准策略、可写目录和上下文用量 |
| `/permissions` | 调整当前会话的权限设置 |
| `/model` | 切换当前提供方可用的模型 |
| `/review` | 审查代码改动 |
| `/new` | 开启新会话 |
| `/mcp` | 查看当前会话可用的 MCP 工具 |

  

## 配置与项目规则

  

| 要设置的内容 | 位置 |
| --- | --- |
| 本次任务的目标、范围和验收方式 | 当前提示词 |
| 构建命令、测试要求和代码约定 | 项目根目录的 `AGENTS.md` |
| 跨项目通用的个人习惯 | `~/.codex/AGENTS.md` |
| 默认模型、模型提供方、权限和 MCP 设置 | `~/.codex/config.toml` |
| 受信任项目的专属设置 | 项目下的 `.codex/config.toml` |

  

本机的对话和写码使用 `model_provider` 指定的本地网关。生图由 `imagegen` MCP 服务处理，生图密钥保留在该服务的配置中。

  

## 官方参考

  

- [CLI 命令与斜杠命令](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)
- [配置基础](https://learn.chatgpt.com/docs/config-file/config-basic)
- [AGENTS.md 指南](https://learn.chatgpt.com/docs/agent-configuration/agents-md)