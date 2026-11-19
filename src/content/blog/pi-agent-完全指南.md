---
title: Pi Agent 完全指南
description: ""
pubDate: "2026-11-20"
dayIndex: 4
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/cover_1795110089516_1795110089520.webp"
draft: false
access: public
---

<h1 style="text-align: center"><u><strong><span style="color: #ff5a1a; font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)">Pi Agent</span></strong></u><span style="font-size: 36px; font-family: var(--f-serif, 'Noto Serif SC', serif)"> 完全指南</span></h1>

  

<img src="https://pi.dev/logo-auto.svg" alt="Pi Logo" style="width: 50%" data-align="center" />

  

> Pi 是一个最小化、可扩展的编码代理框架。它拥有强大的默认功能，但完全可根据你的工作流程定制。适配你的需求，而不是相反。

  

<p style="text-align: center"><strong>当前版本</strong>：1.5.2 | <strong>最后更新</strong>：2026-11-10</p>

  

---

  

## 目录

  

1. [什么是 Pi Agent](#什么是-pi-agent)
2. [核心特性](#核心特性)
3. [安装](#安装)
4. [快速开始](#快速开始)
5. [CLI 命令参考](#cli-命令参考)
6. [会话管理](#会话管理)
7. [模型与提供商](#模型与提供商)
8. [工具使用](#工具使用)
9. [实战案例](#实战案例)
10. [常见问题](#常见问题)

  

---

  

## 什么是 Pi Agent

  

Pi 是一个**编码代理框架**（Coding Agent Harness），让 AI 模型与你的代码库交互。它提供了一套完整的工具和接口，用于：

  

- 🔍 **代码理解**：读取、搜索、分析项目结构
- ✏️ **代码编辑**：精确地修改文件，应用重构
- 🔧 **命令执行**：运行 shell、编译、测试、部署命令
- 💾 **持久化**：自动保存会话，支持断点续传
- 🧩 **扩展性**：通过插件扩展功能（Extensions、Skills、MCP）
- 🎨 **定制化**：自定义主题、快捷键、提示词、工作流

  

### 关键设计理念

  

- **最小化默认值**：开箱即用，但不强加功能
- **适配工作流**：而不是强制适应 Pi 的工作流
- **完全本地**：代码永不上传，会话保存在本地
- **交互式优先**：完整的终端 UI，也支持 CLI 集成
- **开源社区**：MIT 许可，支持自定义和共享包

  

---

  

## 核心特性

  

### 内置工具集

  

| 工具 | 功能 | 示例 |
| --- | --- | --- |
| **read** | 读取文本文件和图片 | 查看源代码、分析截图 |
| **bash** | 执行 shell 命令 | 运行测试、编译、版本控制 |
| **powershell** | 执行 PowerShell 命令（Windows） | Windows 专用自动化 |
| **edit** | 精确文本替换（基于 diff） | 修改代码、配置文件 |
| **write** | 创建或覆盖文件 | 生成新文件、迁移 |
| **grep** | 全文搜索（支持 ripgrep） | 查找代码模式、定位问题 |
| **find** | 文件查找（支持 fd） | 递归查找、文件系统操作 |
| **ls** | 列表目录内容 | 浏览目录结构 |

  

### 多种交互模式

  

| 模式 | 场景 | 启动方式 |
| --- | --- | --- |
| **Interactive** | 交互式开发 | `pi` 或直接启动 |
| **Print** | 一次性任务 | `pi --print "任务"` |
| **JSON** | 程序集成 | `pi --mode json` |
| **RPC** | 长连接控制 | `pi --mode rpc` |
| **SDK** | TypeScript 集成 | 编程使用 |

  

### 会话管理

  

- 自动保存会话到 `~/.pi/agent/sessions/`
- 支持恢复（resume）、分支（fork）、导出（export）
- 支持会话压缩（compaction）以管理长对话
- 支持分享 OSS 开发会话

  

### 模型与提供商

  

支持 **15+** 个提供商：

  

- **OpenAI**：GPT-6.1 Sol、GPT-5.5 等
- **Anthropic**：Claude Opus 5.5、Sonnet 4.5 等
- **Google**：Gemini 2 Flash、Gemini 4 等
- **其他**：DeepSeek、Qwen、MiniMax、Llama.cpp 等

  

---

  

## 安装

  

### 标准安装（推荐）

  

**macOS / Linux**：

  

```bash
curl -fsSL https://pi.dev/install.sh | sh

```

  

**Windows (PowerShell)**：

  

```powershell
powershell -c "irm https://pi.dev/install.ps1 | iex"

```

  

安装器会自动：

  

- 检查 Node.js 22.19+（如需要则安装）
- 固定所有依赖版本（可重复使用）
- 配置 `pi` 命令到 PATH

  

### npm 安装

  

如果已有 Node.js 22.19+：

  

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

```

  

### Nix 安装（macOS / Linux）

  

```bash
nix profile add github:earendil-works/pi/stable

```

  

更新：`nix profile upgrade pi`

  

### 验证安装

  

```bash
pi --version

```

  

应输出版本号（当前 1.5.2）。

  

---

  

## 快速开始

  

### 1. 启动 Pi

  

```bash
cd /path/to/your/project
pi

```

  

您将看到交互式 UI，包含对话窗口、编辑器和状态栏。

  

### 2. 登录到模型提供商

  

在 Pi 中输入：

  

```
/login

```

  

选择提供商（OpenAI、Anthropic、Google 等），按提示登录或粘贴 API 密钥。

  

### 3. 选择模型（可选）

  

输入命令查看可用模型：

  

```
/model

```

  

搜索并选择，例如 `claude-opus-5-5`。

  

### 4. 给 Pi 一个任务

  

```
Summarize @README.md and save action items to action-items.md

```

  

或者：

  

```
Explain how this repository is structured and how to run tests

```

  

或者：

  

```
Fix the bug in src/utils.ts where the date parsing fails for ISO format

```

  

Pi 会自动：

  

- 读取相关文件（read）
- 搜索代码（grep）
- 运行命令测试（bash）
- 修改文件（edit/write）

  

### 5. 继续或结束

  

- **继续**：按 Enter 输入后续指令
- **结束**：按 Ctrl+D 或 Ctrl+C 退出

  

### 恢复会话

  

下次启动时：

  

```bash
pi --continue              # 继续最近的会话
pi --resume                # 选择要恢复的会话
pi --session <session-id>  # 恢复指定会话

```

  

---

  

## CLI 命令参考

  

### 基础用法

  

```bash
pi [选项] [消息...]         # 启动交互式会话
pi --help                    # 显示帮助
pi --version                 # 显示版本

```

  

### 模式选项

  

#### 交互式（默认）

  

```bash
pi

```

  

启动完整的终端 UI，支持实时编辑、命令执行、文件管理。

  

#### 一次性模式（Print）

  

```bash
pi --print "Summarize @README.md"
pi -p "Review this code"

```

  

执行任务后输出结果到 stdout 并退出。适合脚本集成。

  

#### JSON 模式

  

```bash
pi --mode json "Inspect this project" > session.jsonl

```

  

输出 JSONL 格式的事件流。适合程序集成和日志记录。

  

#### RPC 模式

  

```bash
pi --mode rpc

```

  

从 stdin 读取 JSONL 命令，输出响应。适合长连接场景。

  

### 输入选项

  

```bash
# 直接消息
pi "Generate a Makefile for this project"

# 从文件读取
pi "@requirements.txt" "Update dependencies to latest versions"

# 从 stdin 读取
git log -1 --stat | pi "Summarize this commit"

# 组合
git diff | pi "@CHANGES.md" "Integrate these changes into docs"

# 禁用选项解析
pi -- "-o" "negative flag in message"

```

  

### 模型选项

  

#### 选择模型

  

```bash
# 模糊搜索
pi --model sonnet              # 匹配 claude-sonnet-4.5
pi --model gpt-6               # 匹配 gpt-6.1-sol

# 精确 ID
pi --model anthropic/claude-opus-5-5

# 带提供商
pi --provider openai --model gpt-6.1-terra

# 指定思考模式
pi --model "opus:high"         # Opus + 高思考等级
pi --model "gpt-6:off"         # GPT-6 + 关闭思考

```

  

#### 查看可用模型

  

```bash
pi --list-models               # 列出所有模型
pi --list-models sonnet        # 搜索 sonnet 模型
pi --list-models "gpt-*"       # 搜索匹配的模型

```

  

#### 思考等级

  

```bash
pi --thinking max              # 启用最高思考等级
pi --thinking high             # 高思考
pi --thinking off              # 关闭思考

```

  

#### API 密钥

  

```bash
pi --api-key sk-... --model gpt-4o "Analyze this"

```

  

### 会话选项

  

#### 启动新会话

  

```bash
pi                             # 自动命名：会议时间戳
pi --name "bug-fix-001"        # 自定义名称
pi --no-session                # 内存会话（不保存）

```

  

#### 继续或恢复会话

  

```bash
pi --continue                  # 继续当前目录最近的会话
pi -c

pi --resume                    # 选择要恢复的会话
pi -r

pi --session abc123            # 恢复指定会话 ID
pi --session ~/path/to/file    # 恢复指定文件

pi --session-id custom-id      # 使用固定 ID（不存在则创建）

```

  

#### 分支会话

  

```bash
pi --fork abc123               # 分支某个会话到当前目录
pi --fork abc123 --name "branch-001"

```

  

#### 会话存储

  

```bash
pi --session-dir ~/.pi/custom  # 指定会话目录
pi --session-dir /tmp          # 临时会话目录

```

  

### 工具选项

  

#### 启用特定工具

  

```bash
# 只启用 read、grep、find
pi --tools read,grep,find "Search the codebase"

# 启用所有工具（包括扩展工具）
pi --tools "*" 

# 启用除 bash 外的所有工具
pi --exclude-tools bash

```

  

#### 禁用工具

  

```bash
# 禁用所有内置工具，保留扩展工具
pi --no-builtin-tools

# 禁用所有工具
pi --no-tools

# 动态调整（相对于默认值）
pi --tools "+codemode,-write"  # 添加 codemode，移除 write

```

  

#### MCP 工具

  

```bash
# 只启用 Radius MCP 的工具
pi --tools "read,bash,mcp__radius__*"

# 禁用所有 MCP 工具
pi --exclude-tools "mcp__*"

```

  

### 包管理命令

  

```bash
# 安装扩展包
pi install npm:package-name
pi install github:user/repo

# 列出已安装的包
pi list

# 移除包
pi remove npm:package-name
pi uninstall npm:package-name

# 更新所有内容
pi update --all               # 更新 Pi + 包 + 模型

pi update                     # 仅更新 Pi
pi update --extensions        # 仅更新包
pi update --models            # 仅刷新模型目录

pi update npm:specific-pkg    # 更新特定包

```

  

### 认证命令

  

```bash
# 登录提供商
pi auth login openai
pi auth login openai --api-key
pi auth login anthropic --no-browser

# 登出
pi auth logout openai

# 检查状态
pi auth check --provider openai
pi auth check --provider openai --json

# 打印凭证
pi auth print-api-key --provider openai
pi auth print-bearer-token --provider openai --min-expiry 30m

```

  

### MCP 服务器管理

  

```bash
# 添加 MCP 服务器
pi mcp add radius -- npx @radius-project/mcp

# 添加 HTTP 服务器
pi mcp add myserver --url http://localhost:3000

# 使用 OAuth
pi mcp add github --url https://api.github.com/mcp --oauth-client-id xxx

# 列出服务器
pi mcp list
pi mcp list --json

# 登录 MCP
pi mcp login radius

# 登出 MCP
pi mcp logout radius

```

  

### 配置管理

  

```bash
# 打开配置 UI
pi config

# 只查看本地项目配置
pi config -l

# 导出会话为 HTML
pi --export ~/path/to/session.jsonl ~/path/to/export.html

```

  

---

  

## 会话管理

  

### 理解会话

  

**会话** = 一个完整的对话记录，包括：

  

- 消息历史（你和 Pi 的对话）
- 文件修改记录
- 命令执行结果
- 模型选择和参数
- 思考块（extended thinking）

  

会话文件保存在 `~/.pi/agent/sessions/` 中，格式为 `.jsonl`（JSON Lines）。

  

### 会话生命周期

  

```
启动 Pi
  ↓
自动创建会话（或恢复）
  ↓
交互工作...
  ↓
退出（Ctrl+D 或 Ctrl+C）
  ↓
会话自动保存

```

  

### 会话操作

  

#### 查看会话列表

  

在 Pi 中输入：

  

```
/resume

```

  

显示可恢复的所有会话，按最近使用排序。

  

#### 命名会话

  

启动时：

  

```bash
pi --name "implement-auth"

```

  

或在 Pi 中使用 `/rename` 命令。

  

#### 分支会话

  

基于现有会话创建分支：

  

```bash
pi --fork abc123 --name "try-refactor"

```

  

或在 Pi 中输入：

  

```
/fork

```

  

#### 导出会话

  

作为 HTML（便于分享）：

  

```bash
pi --export ~/path/to/session.jsonl ~/output.html

```

  

或在 Pi 中：

  

```
/export

```

  

#### 查看会话历史

  

在 Pi 中输入：

  

```
/tree

```

  

显示会话的分支树，允许在历史中导航。

  

#### 压缩会话

  

当会话变得很长时，Pi 会自动压缩（summarize）旧消息以节省上下文：

  

```
/compact

```

  

或手动设置 `~/.pi/agent/settings.json`：

  

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}

```

  

#### 删除会话

  

手动删除：

  

```bash
rm ~/.pi/agent/sessions/session-id.jsonl

```

  

不过 Pi 不提供内置删除命令（防止意外）。

  

---

  

## 模型与提供商

  

### 支持的提供商

  

#### 主流云服务

  

| 提供商 | 认证方式 | 推荐模型 |
| --- | --- | --- |
| **OpenAI** | API Key、OAuth | GPT-6.1 Sol、GPT-5.5 |
| **Anthropic** | API Key、OAuth | Claude Opus 5.5、Sonnet 4.5 |
| **Google** | OAuth | Gemini 2 Flash、Gemini 4 Argon |
| **AWS Bedrock** | IAM | Claude Opus 5.5、Llama 3.1 |
| **Azure OpenAI** | API Key | GPT-6.1 Terra、GPT-4o |

  

#### 开源与本地

  

| 提供商 | 场景 |
| --- | --- |
| **Llama.cpp** | 本地 GPU 推理 |
| **Ollama** | 本地模型管理 |
| **Vllm** | 高性能推理服务 |
| **OpenAI 兼容** | 自托管服务 |

  

#### 专业提供商

  

| 提供商 | 特色 |
| --- | --- |
| **Radius** | MCP 集成伙伴 |
| **OpenRouter** | 多模型聚合 |
| **DeepSeek** | 开源优化 |
| **Qwen** | 国内支持 |

  

### 设置凭证

  

#### 环境变量

  

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# Google
export GOOGLE_API_KEY="AIza..."

# DeepSeek
export DEEPSEEK_API_KEY="sk-..."

```

  

#### 交互式登录

  

```
/login

```

  

选择提供商，按提示操作。凭证安全存储在 `~/.pi/agent/auth.json`。

  

#### 配置多个账户

  

编辑 `~/.pi/agent/models.json`：

  

```json
{
  "anthropic": {
    "apiKey": "sk-ant-...",
    "provider": "anthropic"
  },
  "openai-work": {
    "apiKey": "sk-...",
    "provider": "openai",
    "baseUrl": "https://api.openai.com/v1"
  }
}

```

  

### 思考模式（Extended Thinking）

  

某些模型支持**思考块**，允许模型在回答前进行推理：

  

```bash
# 最高思考等级
pi --model "opus:max" "Analyze this complex problem"

# 关闭思考
pi --model "gpt-6:off" "Quick answer please"

# 动态调整
pi --thinking high              # 在会话中改变

```

  

思考块会显示在 `<thinking>...</thinking>` 中，可用 Ctrl+O 展开/折叠。

  

### 模型成本估算

  

Pi 显示每个请求的估计成本：

  

```
$0.0024 in, $0.0156 out (gpt-4o)

```

  

基于官方定价，会话末尾显示累计成本。

  

---

  

## 工具使用

  

### Read - 读取文件和图片

  

#### 读取代码文件

  

```
用 read 工具查看 src/main.ts 的前 50 行

```

  

Pi 会调用：

  

```
read
  path: src/main.ts
  offset: 1
  limit: 50

```

  

#### 读取图片

  

```
分析这个屏幕截图 @screenshot.png

```

  

Pi 支持：PNG、JPG、WebP、GIF、BMP

  

#### 带行号和上下文读取

  

```
read
  path: config.json
  offset: 10
  limit: 5

```

  

输出包含行号和周围内容。

  

### Bash - 执行 Shell 命令

  

#### 运行测试

  

```
pi "Run the test suite and show me any failures"

```

  

Pi 会执行（在 Linux/macOS）：

  

```bash
npm test

```

  

#### 版本控制操作

  

```
Show me the last 5 commits with stats

```

  

转化为：

  

```bash
git log -5 --stat

```

  

#### 获取项目信息

  

```
What's the structure of this project? Show me the directory tree and file sizes

```

  

执行：

  

```bash
find . -type f | head -50
du -sh */
tree -L 2

```

  

#### 超时控制

  

```bash
pi --print "Run npm test" --model sonnet

```

  

命令超时默认 30 秒，可通过设置修改。

  

### Edit - 精确修改文件

  

#### 修复一个 bug

  

```
I found a bug in the date parser. Here's the fix:

In src/utils.ts line 42, replace:
  const date = new Date(dateStr);
with:
  const date = new Date(dateStr.replace('Z', '+00:00'));

```

  

Pi 会应用 diff：

  

```diff
- const date = new Date(dateStr);
+ const date = new Date(dateStr.replace('Z', '+00:00'));

```

  

#### 重构代码

  

```
Refactor the getUser function to use async/await instead of promises

```

  

Pi 会精确替换旧代码为新代码。

  

#### Edit 的优势

  

- ✅ 基于 diff，不覆盖整个文件
- ✅ 支持多个不相交的修改
- ✅ 保留原始行尾（CRLF/LF）
- ✅ 验证修改前的文本完全匹配

  

### Write - 创建或覆盖文件

  

#### 生成新文件

  

```
Create a Dockerfile for this Node.js project with multi-stage build

```

  

创建 `Dockerfile`。

  

#### 覆盖配置文件

  

```
Generate a .gitignore for Python projects with virtual env and IDE settings

```

  

覆盖 `.gitignore`。

  

### Grep - 全文搜索

  

#### 搜索代码模式

  

```
Find all console.log calls in the src directory

```

  

Pi 会运行：

  

```bash
rg "console\.log" src/

```

  

#### 带上下文搜索

  

```
grep
  path: src
  pattern: "TODO|FIXME"
  context: 3

```

  

显示匹配行及前后 3 行。

  

#### 性能优化

  

Pi 使用 `ripgrep` (rg) 而非 `grep`，速度快 **100 倍**以上。

  

### Find - 文件查找

  

#### 查找特定类型的文件

  

```
Find all .test.ts files in the project

```

  

转化为：

  

```bash
find . -name "*.test.ts"

```

  

或使用 `fd`（如果安装）：

  

```bash
fd ".test.ts$"

```

  

#### 按大小查找

  

```
Find files larger than 1MB in the project

```

  

#### 排除目录

  

```
find . -name "*.js" -not -path "*/node_modules/*"

```

  

### Codemode - 编程脚本

  

可在 Pi 中运行 JavaScript 代码：

  

```
使用 codemode 统计这个项目有多少行代码

```

  

Pi 执行内联脚本：

  

```javascript
const fs = require('fs');
const path = require('path');

function countLines(dir) {
  let total = 0;
  const files = fs.readdirSync(dir, { recursive: true });
  for (const file of files) {
    if (file.endsWith('.js') || file.endsWith('.ts')) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      total += content.split('\n').length;
    }
  }
  return total;
}

console.log(countLines('.'));

```

  

---

  

## 实战案例

  

### 案例 1：代码审查

  

```bash
cd ~/my-project
pi --print "Review this pull request and identify potential bugs" @changes.diff

```

  

Pi 会：

  

1. ✓ 读取 diff 文件
2. ✓ 搜索相关代码（grep）
3. ✓ 查阅文档
4. ✓ 提出建议

  

### 案例 2：项目迁移

  

```bash
pi --continue --model "opus:max"

```

  

第一次会话：

  

```
Analyze the current authentication system and design a new one using OAuth2.

```

  

Pi：

  

1. 读取当前实现
2. 搜索相关配置
3. 设计新方案
4. 生成实现代码

  

后续：

  

```
Now implement the OAuth2 provider integration in auth.ts

```

  

Pi 继续工作，利用之前的分析。

  

### 案例 3：bug 修复工作流

  

```bash
pi --name "bug-fix-#123"

```

  

```
The login endpoint returns 500 on invalid JSON. Debug and fix it.

```

  

Pi：

  

1. 搜索登录代码
2. 运行测试复现 bug
3. 添加日志调试
4. 修改代码
5. 验证测试通过

  

```
Great! Now add a unit test for this edge case.

```

  

Pi 分支继续。

  

### 案例 4：文档生成

  

```bash
pi --print "Generate a comprehensive README for this project including setup, usage, and contribution guidelines" > README.md

```

  

### 案例 5：性能分析

  

```bash
pi

```

  

```
/login                                # 登录 Anthropic
/model                                # 选择 opus:max

```

  

```
Profile the build time of this TypeScript project and suggest optimizations

```

  

Pi：

  

1. 运行 `npm run build` 并计时
2. 分析 tsconfig.json
3. 搜索瓶颈
4. 建议优化方案
5. 实施优化
6. 重新运行测试性能

  

---

  

## 常见问题

  

### Q1: Pi 会上传我的代码吗？

  

**A**：不会。Pi 在你的机器上运行，所有代码和会话默认保存在本地 `~/.pi/agent/sessions/`。

  

仅当你明确选择通过 API（如 OpenAI）发送时，才会上传内容给外部模型。即使如此，代码也不会被保存在 OpenAI 的服务器上（除非你启用了数据保留政策）。

  

### Q2: Pi 需要互联网连接吗？

  

**A**：

  

- 首次登录需要（验证凭证）
- 调用外部模型需要（如 OpenAI、Anthropic）
- 本地模型（Ollama、Llama.cpp）可离线使用

  

会话文件完全本地存储。

  

### Q3: 如何在多台机器上同步会话？

  

**A**：

  

1. 手动复制 `~/.pi/agent/sessions/` 文件夹
2. 或通过 Git 同步
3. 或通过云存储同步（iCloud、Dropbox 等）

  

Pi 不内置同步，但会话是纯 JSON，易于版本控制。

  

### Q4: 支持哪些编程语言？

  

**A**：所有语言。Pi 的工具是通用的：

  

- `read` 能读任何文本文件
- `bash` 能运行任何命令
- `edit` 能修改任何代码

  

不过最好的支持依然是文本类编程语言（Python、JavaScript、Go、Rust 等）。

  

### Q5: 如何离线使用 Pi？

  

**A**：

  

1. 安装本地模型推理（Ollama、Llama.cpp）
2. 配置 Pi 使用本地端点

  

```bash
pi --model http://localhost:8000 --provider openai-compatible

```

  

会话和工具完全离线运行。

  

### Q6: Pi 可以自动化吗（CI/CD）？

  

**A**：可以。使用 `--print` 或 `--mode json`：

  

```bash
# GitHub Actions
- name: Code Review with Pi
  run: |
    pi --print "Review this code for security issues" @main.py > review.txt
    cat review.txt

```

  

```bash
# 集成到脚本
pi --mode json "Analyze @data.csv" | jq '.[] | select(.type=="error")'

```

  

### Q7: 如何防止 Pi 修改重要文件？

  

**A**：

  

1. 使用版本控制（Git）
2. 在容器/VM 中运行
3. 使用文件权限（chmod 444 重要文件）
4. 运行在沙盒环境中

  

Pi 会显示所有将要修改的文件，但最终由你决定。

  

### Q8: Pi 支持哪些模型的思考模式？

  

**A**：支持 extended thinking 的模型：

  

- **Anthropic**：Claude Opus 5.5、Sonnet 4.5
- **OpenAI**：GPT-6系列（需要特定配置）
- **Google**：Gemini 2 Advanced

  

```bash
pi --model "opus:max"    # 启用最高思考
pi --model "gpt-6:high"  # 启用高思考

```

  

### Q9: 如何自定义 Pi 的快捷键？

  

**A**：编辑 `~/.pi/agent/keybindings.json`：

  

```json
{
  "editor.submit": "Enter",
  "editor.newline": "Shift+Enter",
  "chat.scrollUp": "PageUp",
  "chat.scrollDown": "PageDown",
  "model.select": "Ctrl+P"
}

```

  

参考官方文档了解所有可用快捷键。

  

### Q10: 如何扩展 Pi 的功能？

  

**A**：Pi 支持多种扩展方式：

  

#### Extensions（代码插件）

  

```bash
pi install npm:pi-tracker

```

  

#### Skills（提示词库）

  

在 `~/.pi/agent/pideck-skills/` 添加 Markdown 文件。

  

#### MCP Servers（工具集成）

  

```bash
pi mcp add github -- npx @modelcontextprotocol/server-github --token $GITHUB_TOKEN

```

  

#### Custom Providers（自定义模型源）

  

编辑 `~/.pi/agent/models.json`。

  

---

  

## 故障排除

  

### Pi 启动缓慢

  

**原因**：首次加载或模型下载。

  

**解决**：

  

```bash
pi --list-models    # 预加载模型目录

```

  

### 命令执行超时

  

**原因**：默认超时 30 秒。

  

**解决**：增加超时时间或优化命令。

  

### 文件编辑失败

  

**原因**：文本匹配不精确。

  

**解决**：使用 `write` 代替 `edit`，或让 Pi 重新尝试。

  

### 模型响应不准确

  

**原因**：上下文不足或模型选择不当。

  

**解决**：

  

- 尝试更强大的模型（opus, gpt-6）
- 增加 `--thinking` 等级
- 提供更多上下文（`@file`）

  

### 内存不足

  

**原因**：会话过长。

  

**解决**：运行 `/compact` 压缩会话。

  

---

  

## 资源与链接

  

- **官网**：[https://pi.dev](https://pi.dev)
- **文档**：[https://github.com/earendil-works/pi/tree/main/docs](https://github.com/earendil-works/pi/tree/main/docs)
- **Discord 社区**：[https://discord.com/invite/3cU7Bz4UPx](https://discord.com/invite/3cU7Bz4UPx)
- **GitHub 仓库**：[https://github.com/earendil-works/pi](https://github.com/earendil-works/pi)
- **NPM 包**：[https://www.npmjs.com/package/@earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

  

---

  

## 更新日志

  

### 1.5.2 (2026-11-10)

  

- ✨ 会话目录消失时支持 Fork（解决移动项目后的问题）
- 🐛 修复 `/import` 留下重复会话副本
- 🐛 修复 Anthropic OAuth 版本上报

  

### 1.5.1 (2026-11-09)

  

- ✨ Shell 登录命令：`pi auth login <provider>`
- ✨ Idle 模式 prompt cache 保温（30 分钟）
- ✨ Anthropic message threads（增量请求）
- ✨ 更丰富的 Mermaid 图表支持
- ✨ GitHub Copilot 分类器支持
- 🐛 修复 Windows 下 Ctrl+V 粘贴
- 🐛 修复大文件 OOM 问题（read、grep）
- 🐛 修复 OpenAI 兼容端点的 400 错误

  

### 1.5.0 (2026-11-02)

  

- ✨ 扩展包更新日志（Extension Updates）
- ✨ 大型工具调用增量解析（加快流式传输）
- ✨ 自定义 self-update 命令（$PI_SELF_UPDATE_COMMAND）
- ✨ GPT-6.1 Terra 支持（OpenAI、Azure、Codex）

  

---

  

**License**: MIT | **Current Version**: 1.5.2 | **Last Updated**: 2026-11-10