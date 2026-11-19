---
title: Google Antigravity CLI 使用手册
description: "面向第一次使用 Google Antigravity CLI（agy）的开发者。示例以 Windows PowerShell 为主，安装另附 macOS、Linux 和 WSL 命令。命令行参数按本机 agy 1.5.12 核对。交互命令和账号可用功能以当前版本为准，可用 agy --help 和 /help 确认。"
pubDate: "2026-11-20"
dayIndex: 3
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/cover_1795109443775_1795109443783.webp"
draft: false
access: public
---

<h1 style="text-align: center"><u><span style="color: #ff5a1a; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">Google Antigravity CLI</span></u> 使用手册</h1>

  

面向第一次使用 Google Antigravity CLI（`agy`）的开发者。示例以 Windows PowerShell 为主，安装另附 macOS、Linux 和 WSL 命令。命令行参数按本机 `agy` 1.5.12 核对。交互命令和账号可用功能以当前版本为准，可用 `agy --help` 和 `/help` 确认。

  

[安装和登录](#1-安装和登录) · [项目实操](#2-第一次在项目里工作) · [命令速查](#3-常用命令速查) · [项目规则和权限](#4-项目规则设置和权限) · [会话与回退](#5-恢复会话管理上下文和回退) · [脚本模式](#6-用脚本运行-antigravity-cli) · [扩展](#7-扩展能力) · [故障排查](#8-常见问题)

  

## 1. 安装和登录

  

### Windows PowerShell

  

在 PowerShell 中运行官方安装命令。

  

```powershell
irm https://antigravity.google/cli/install.ps1 | iex

```

  

安装后打开新的终端并运行 `agy --version`。Windows 的默认安装目录是 `%LOCALAPPDATA%\agy\bin`。

  

### macOS、Linux 和 WSL

  

在 Bash 或 Zsh 中运行下列命令。WSL 用户在 WSL 发行版的终端中安装和启动。

  

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version

```

  

macOS 和 Linux 的默认可执行文件路径是 `~/.local/bin/agy`。

  

### 登录和更新

  

切换到项目目录后启动 `agy`。以下路径为 PowerShell 示例，请替换成自己的项目路径。

  

```powershell
Set-Location C:\work\my-project
agy

```

  

没有可用的已保存凭据时，CLI 会打开默认浏览器，按提示登录 Google 账号。组织账号按管理员要求选择企业登录。通过 SSH 运行时，CLI 会在终端显示授权链接，按提示在本地浏览器完成登录。首次使用还可能提示选择主题、终端显示方式和工作区信任选项。

  

回到系统终端运行 `agy update` 检查并安装更新。需要切换登录账号时，在会话中输入 `/logout`，再重新启动 `agy` 登录。

  

[官方快速开始](https://antigravity.google/docs/getting-started?tab=cli) · [身份验证](https://antigravity.google/docs/install?tab=cli)

  

## 2. 第一次在项目里工作

  

从项目根目录启动 CLI。可以先用 `agy --mode=plan` 进入计划模式，调查现状并审阅方案。下面每个代码块都是一条发送到 `agy` 输入框的消息。

  

1. **了解项目。**
   ```text
先只读检查项目。列出主要入口、目录结构、本地启动命令和测试命令，并标出每项判断依据的文件路径。

```
2. **明确问题和验收条件。**
   ```text
搜索框清空后仍显示旧结果。请定位原因并提出方案。验收条件是清空输入后立即清除旧结果，正常查询行为保持一致。列出预计修改的文件和回归测试。

```
3. **确认方案并实施。** 审阅实现计划，按界面提示批准。也可以用 `Shift + Tab` 切换到所需的执行模式，再发送实施要求。
   ```text
按确认的方案修改，补充回归测试并运行相关测试。最后列出改动文件、实际运行的命令、测试结果和待验证事项。

```

  

用 `/diff` 查看变更。Git 项目也可在终端用 `git status --short` 检查有哪些修改和新增文件，再用 `git diff` 检查未暂存变更。`git diff --staged` 查看已暂存变更，未跟踪文件可按 `git status` 列出的路径单独检查。

  

## 3. 常用命令速查

  

### 在系统终端执行

  

| 命令 | 用途 |
| --- | --- |
| `agy` | 在当前目录启动交互会话 |
| `agy -i "说明项目目录结构"` | 带首条提示进入交互会话 |
| `agy -c` | 恢复当前工作目录最近的会话 |
| `agy --conversation <ID>` | 通过会话 ID 恢复指定会话 |
| `agy --mode=plan` | 以计划模式启动 |
| `agy models` | 列出可用模型，再用 `agy --model <模型>` 为本次启动指定模型 |
| `agy --add-dir <路径>` | 加入额外工作目录，可多次指定 |
| `agy -p "用一句话解释 Git 工作树"` | 运行一条提示并退出 |
| `agy --version`、`agy --help` | 查看版本或命令行帮助 |
| `agy update` | 更新 CLI |

  

命令中的 `<ID>`、`<模型>`、`<路径>` 是占位符，运行时替换为实际值。含空格的路径用引号括起。

  

### 在 agy 输入框中使用

  

| 命令或按键 | 用途 |
| --- | --- |
| `/help` | 查看命令和快捷键，输入 `/` 可打开命令补全 |
| `/config` 或 `/settings` | 打开设置界面 |
| `/permissions` | 查看和调整工具权限 |
| `/plan <任务>` | 针对当前任务调查代码并拟定实现计划 |
| `/model`、`/usage` | 选择模型或查看配额用量 |
| `/context` | 查看上下文用量 |
| `/diff` | 打开交互式变更列表 |
| `/rename <名称>` | 为当前会话命名 |
| `/resume` | 打开历史会话选择器 |
| `/fork` | 复制当前对话历史，开启一个独立会话 |
| `/rewind` | 打开对话回退功能 |
| `/clear` 或 `/new` | 开始新对话 |
| `/quit` 或 `/exit` | 退出交互界面 |
| `Shift + Tab` | 循环切换执行模式 |
| `Shift + Enter` 或 `Ctrl + J` | 在提示中插入换行 |
| `Ctrl + C` | 中断当前轮次 |

  

在提示中输入 `@` 可以选择文件或目录。排查问题时，可同时引用对应文件并附上实际报错和复现步骤。

  

[官方命令与快捷键参考](https://antigravity.google/docs/cli/reference) · [提示输入与文件引用](https://antigravity.google/docs/cli/prompting)

  

## 4. 项目规则、设置和权限

  

| 内容 | 路径 | 适用范围 |
| --- | --- | --- |
| 项目指令 | 项目根目录的 `AGENTS.md` 或 `GEMINI.md` | 项目约定，可随代码共享 |
| 细分规则 | `.agents/rules/*.md` | 在项目中按主题维护规则 |
| 个人指令 | `~/.gemini/AGENTS.md` 或 `~/.gemini/GEMINI.md` | 用户的多个项目 |
| CLI 个人设置 | `~/.gemini/antigravity-cli/settings.json` | 显示偏好、执行模式和工具权限。可用 `/config` 编辑 |

  

Windows 可用 `Join-Path $HOME '.gemini\antigravity-cli\settings.json'` 查看设置文件的完整路径。项目指令适合记录启动命令、风格约定和验收要求。下例可作为 `AGENTS.md` 的起点，命令按项目实际情况调整。

  

```markdown
# 项目约定

- 使用 `npm ci` 安装依赖，用 `npm test` 运行测试。
- 修改接口行为时，同时更新相应的回归测试。
- 交付时列出修改文件、实际运行的命令和测试结果。

```

  

### 执行模式

  

| 模式 | 行为 |
| --- | --- |
| `default` | 通常在写入文件或运行终端命令前要求确认 |
| `accept-edits` | 自动批准工作区内的常规文件编辑，终端命令仍按权限规则处理 |
| `auto` | 自动批准工作区编辑，默认在终端沙箱里运行命令，并评估需要在沙箱外运行的命令 |
| `plan` | 先调查代码并提交实现方案供审阅 |

  

从 1.5.7 开始，支持 `auto` 的账号和系统可能在启动时直接进入该模式。用底部状态栏确认当前模式。若希望逐项查看文件修改和终端命令，在 `/config` 将 **Agent Mode** 设为 `default`，并在 `/permissions` 检查工具预设和已有规则。`auto` 需要兼容的终端沙箱和个人账号。

  

### 工具权限

  

执行模式控制日常交互方式，`/permissions` 管理工具预设与 `allow`、`ask`、`deny` 规则。`request-review` 对文件写入、终端命令、网络和 MCP 操作按规则提示确认。`strict` 连文件读取也会询问。`proceed-in-sandbox` 允许在可用的终端沙箱内运行命令。明确的权限规则仍会影响操作结果。

  

下面的设置可作为希望逐项审查的起点。合并到已有 `settings.json` 时保留其他键，并在 `/permissions` 检查已有的自动允许规则。

  

```json
{
  "agentMode": "",
  "toolPermission": "request-review"
}

```

  

`agentMode` 的空字符串对应 `default`。如果需要终端隔离，可查阅官方沙箱要求。当前版本在系统沙箱不可用时会忽略 `--sandbox`，应核实设置和系统支持后再依赖该选项。

  

[自定义配置的发现路径](https://antigravity.google/docs/customization-discovery/) · [执行模式](https://antigravity.google/docs/cli/modes) · [工具权限](https://antigravity.google/docs/cli/commands/permissions) · [终端沙箱](https://antigravity.google/docs/sandbox)

  

## 5. 恢复会话、管理上下文和回退

  

- **接着做同一件事**时，从原来启动 `agy` 的目录运行 `agy -c`。要挑选历史会话，在会话里用 `/resume`，或在终端用 `agy --conversation <ID>`。
- **想尝试另一种方案**时，用 `/fork` 复制当前对话。新旧会话共享工作目录，若要同时试改文件，可用独立 Git 工作树隔离改动。
- **上下文积累较多**时，用 `/context` 查看占用。开始无关任务时，可用 `/clear` 开启新对话。
- **想回到较早的对话检查点**时，用 `/rewind` 并阅读界面提示。需要恢复代码时，先用 `git status` 和 `git diff` 核对文件状态，再按实际改动选择 Git 恢复操作。数据库和远端服务的改动需在对应系统处理。

  

[会话管理](https://antigravity.google/docs/cli/conversations) · [恢复会话](https://antigravity.google/docs/cli/commands/resume)

  

## 6. 用脚本运行 Antigravity CLI

  

`-p` 将一条提示发给代理并退出。先用交互会话完成登录，脚本可复用缓存的登录凭据。未完成认证的无终端环境会收到认证错误。

  

```powershell
agy -p "用一句中文解释 Git 工作树。无需读取文件或运行命令。"

```

  

`text` 将回答写到标准输出。`json` 在任务结束后输出一个结果对象。`stream-json` 按行输出 NDJSON 事件，终止事件的 `event` 字段为 `result`。错误和权限提示等诊断信息写到标准错误。

  

以下 PowerShell 示例分别检查进程退出码和结果状态，再读取回答所在的 `response` 字段。

  

```powershell
$agyJson = agy -p "用一句中文介绍 Git 工作树。无需使用工具。" --output-format json --print-timeout 60s
if ($LASTEXITCODE -ne 0) { throw "agy 退出码为 $LASTEXITCODE" }

$agyResult = $agyJson | ConvertFrom-Json
if ($agyResult.status -ne 'SUCCESS') { throw "agy 返回状态 $($agyResult.status)" }
$agyResult.response

```

  

需要固定结构时，可传入 `--json-schema .\output-schema.json`，再读取 JSON 对象的 `structured_output`。脚本如果依赖工具执行，还应检查预期产物或测试结果。上例的提示词只描述任务，实际工具访问由当前权限设置决定。

  

[官方 Headless 模式指南](https://antigravity.google/docs/cli/headless)

  

## 7. 扩展能力

  

| 能力 | 何时用 | 配置和检查入口 |
| --- | --- | --- |
| Skills | 复用发布说明、提测清单等工作流程 | `.agents/skills/<名称>/SKILL.md`，用 `/skills` 查看，修改后可用 `/skills reload` |
| MCP | 调用工单、设计或内部文档服务 | `/mcp` 打开管理面板，`agy mcp list` 从终端列出配置 |
| Hooks | 在工具使用等事件触发时执行脚本 | 项目的 `.agents/hooks.json`，用 `/hooks` 查看 |
| 自定义代理 | 将独立任务交给带专门指令的代理 | `.agents/agents/<名称>.md`，用 `/agents` 查看 |
| Plugins | 打包和安装一组扩展 | `/plugin` 打开管理面板，`agy plugin list` 列出已安装插件 |

  

例如新建 `.agents/skills/release-notes/SKILL.md`，内容如下。

  

```markdown
---
name: release-notes
description: 将用户提供的变更清单整理成简短的中文发布说明
---

按新增和修复分组，每项写一句话。只使用用户提供的变更，省略空分组。

```

  

在会话中输入 `/release-notes 修复搜索框清空后残留旧结果`。如果新 Skill 未出现，用 `/skills reload` 更新列表。

  

如果需要添加团队提供的 HTTP MCP 服务，可运行 `agy mcp add --type http team-docs https://example.com/mcp`，将示例地址换成团队给出的地址，再用 `agy mcp list` 或 `/mcp` 检查。终端参数要放在服务名称前，更多选项可用 `agy mcp add --help` 查看。

  

[自定义路径与加载顺序](https://antigravity.google/docs/customization-discovery/) · [CLI 插件与 Skills](https://antigravity.google/docs/cli/plugins/)

  

## 8. 常见问题

  

| 现象 | 处理步骤 |
| --- | --- |
| PowerShell 找不到 `agy` | 打开新终端，用 `Get-Command agy -All` 检查命令。若 `Test-Path "$env:LOCALAPPDATA\agy\bin\agy.exe"` 返回 `True`，检查用户 `Path` 是否包含安装目录。 |
| macOS、Linux 或 WSL 找不到 `agy` | 用 `command -v agy` 检查。若 `~/.local/bin/agy` 存在，可将 `export PATH="$HOME/.local/bin:$PATH"` 加到相应的 shell 配置中。 |
| 登录失败或模型不可用 | 在交互会话里检查账号，必要时用 `/logout` 后重新登录。用 `/model` 查看可用模型，用 `/usage` 查看配额。 |
| `Shift + Tab` 切不到 Auto | 检查账号类型、CLI 版本和终端沙箱支持。Windows 原生沙箱有单独的系统版本与更新要求。 |
| 找不到历史会话 | 回到创建会话时的目录，再用 `agy -c` 或 `/resume`。 |
| 脚本返回 `authentication required` | 在相同运行环境中检查认证。对本地脚本，可先用交互式 `agy` 登录，然后再运行脚本。 |
| Skills 未加载 | 检查工作区根目录以及 `.agents/skills/<名称>/SKILL.md`，然后用 `/skills reload` 查看。 |

  

[官方故障排查](https://antigravity.google/docs/cli/troubleshooting)