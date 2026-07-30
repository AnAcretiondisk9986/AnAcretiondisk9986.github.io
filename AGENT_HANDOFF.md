# 个人博客技术交接文档

> 本文件已在用户授权下公开于 GitHub 仓库。

最后更新：2026-07-30

## 1. 项目概况

- 本地路径：`C:\Users\AnAcretiondisk\Documents\个人博客`
- GitHub 仓库：`git@github.com:AnAcretiondisk9986/AnAcretiondisk9986.github.io.git`（SSH）
- 线上地址：`https://anacretiondisk9986.github.io/`
- 当前分支：`main`
- 技术栈：Astro 静态站点、Markdown Content Collections、GitHub Actions、GitHub Pages
- 包管理器：npm
- GitHub Actions Node.js 版本：22
- Astro 配置为 `output: 'static'`，站点为用户主页仓库，无额外 `base` 路径。
- 根目录 `.nojekyll` 禁用 GitHub Pages 默认 Jekyll 构建。
- **Git 远程协议**：SSH（`git@github.com:...`），本机已生成 ED25519 密钥并添加到 GitHub。

常用命令：

```powershell
npm install
npm run dev          # Astro 开发服务器
npm run build        # 生产构建
npm run preview      # 预览构建结果
npm run admin        # 启动博客管理面板
```

## 2. 当前 Git 状态

```text
HEAD: 669b974 改进推送错误提示：区分网络故障，延长 toast 显示
origin/main: a27a444 管理面板添加一键推送功能
main 相对 origin/main ahead 2、behind 0
工作区：干净（仅 reasonix.toml 未跟踪）
```

两个尚未推送的本地提交：

```text
a01e54c 通过管理面板更新博客
669b974 改进推送错误提示：区分网络故障，延长 toast 显示
```

> **Git 远程已切换为 SSH**。推送走 22 端口，不再受 HTTPS 443 端口阻断影响。管理面板的「⬆ 推送」按钮可正常使用。

下一位 Agent 应先执行：

```powershell
git status --branch --short
git fetch origin main
git log --oneline --max-count=10 --all
```

如果有 ahead 提交，直接推送（禁止 force push）：

```powershell
git push origin main
```

如果远端有新提交，先合并：

```powershell
git pull --no-edit origin main
npm run build
git push origin main
```

## 3. 博客内容

当前共 3 篇文章（已删除 hello-world、blog-user-guide、test-visible）：

| 文件 | 标题 | 标签 |
|------|------|------|
| `HealthCN2030.md` | 关于健康中国2030战略 | 医疗、政策 |
| `social-paper.md` | 社会实践调研论文写作skill | AI Agent |
| `write-social-practice-reflection-SKILL.md` | 社会实践心得体会的skills | 计算机、AI |

Content Collection schema（`src/content.config.ts`）：

```yaml
title: string          # 必填
description: string    # 必填
pubDate: date          # 必填，YYYY-MM-DD
updatedDate: date      # 可选
tags: string[]         # 默认 []
draft: boolean         # 默认 false
```

模板位于 `src/content/blog/_templates/blog-post.md`，Content Collection 已配置忽略 `_templates/**`。

排序规则：`pubDate` 降序 → 同天按 `slug` 字母降序。首页和目录页一致。

## 4. 博客管理面板（新增）

独立于 Astro 的本地 Web 管理工具。

### 启动方式

**双击** 项目根目录的 `启动管理面板.bat`，浏览器自动打开 `http://localhost:4322/admin`。

也可以命令行启动：

```powershell
npm run admin
```

### 功能

| 功能 | 说明 |
|------|------|
| 📋 文章列表 | 左侧边栏，显示标题/日期/草稿状态 |
| ✏️ 新建/编辑 | 标题、Slug、描述、日期、标签、草稿开关、Markdown 正文 |
| 🖼 图片上传 | 拖放/粘贴/点击上传 → `public/image/`，自动插入 Markdown |
| 🗑 删除 | 确认后删除 Markdown 文件 |
| ⬆ 一键推送 | git add → commit → push，自动同步到网站 |
| 💾 快捷键 | Ctrl+S 保存 |

### 技术细节

- 服务器：Express（`admin-server.mjs`），端口 4322，绑定 127.0.0.1
- 前端：`admin/index.html`，纯 HTML/CSS/JS，暗色主题
- API 端点：`/api/posts`（CRUD）、`/api/upload`（图片）、`/api/push`（Git 推送）
- 认证：HTTP Header `x-admin-token`，默认值 `acr-admin`，可通过环境变量 `ADMIN_TOKEN` 覆盖
- 安全：路径穿越防护、MIME 白名单（仅图片）、YAML 转义、错误脱敏

### 依赖

除 Astro 外新增了三个 npm 包：

```json
"express": "^5.2.1",
"gray-matter": "^4.0.3",
"multer": "^2.2.0"
```

## 5. 前端结构

```
src/pages/index.astro              首页
src/pages/blog/index.astro         文章目录
src/pages/blog/[...id].astro       文章详情静态路由
src/pages/about.astro              关于页
src/pages/404.astro                404 页面
src/layouts/BaseLayout.astro       公共 HTML、导航、页脚、主题切换
src/styles/global.css              全站视觉样式
src/components/ArchiveSeal.astro   印章组件
src/components/SpecimenPlate.astro 首页标本图版组件
public/image/                      上传的图片
public/.nojekyll                   禁用 Jekyll
```

项目根目录关键文件：

```
admin-server.mjs         管理面板服务器
admin/index.html         管理面板前端
启动管理面板.bat          双击启动脚本
.nojekyll                禁用 Jekyll
.githooks/pre-commit     提交前构建保护
```

## 6. GitHub Pages 部署

工作流：`.github/workflows/deploy.yml`

```text
push main → checkout → Node 22 → npm ci → npm run build → upload dist → deploy
```

`.nojekyll` 文件存在于根目录和 `public/`，确保 GitHub Pages 不会尝试用 Jekyll 构建 Astro 项目。

## 7. Obsidian 集成

Obsidian Vault 目录：`src/content/blog`

本机配置：

- 附件目录 `image`，模板目录 `_templates`
- Obsidian Git `basePath` 为 `../../..`（仓库根目录）
- `syncMethod` 为 `merge`
- 提交信息：`通过 Obsidian 更新博客：{{date}}`
- `.obsidian` 已加入 `.gitignore`

日常发布流程（两种方式任选）：

**方式一：管理面板**
1. 双击 `启动管理面板.bat`
2. 新建/编辑文章
3. 点击左侧「⬆ 推送」

**方式二：Obsidian + Git**
1. 在 Obsidian 中编辑 Markdown
2. `Obsidian Git: Commit-and-sync`
3. 等待 Actions 部署

两种方式可以混用，但注意避免同时编辑同一文件产生冲突。

## 8. 提交前构建保护

`.githooks/pre-commit` 已在本地配置：

```powershell
git config core.hooksPath .githooks
```

每次 `git commit` 前自动执行 `npm.cmd run build`，构建失败阻止提交。

## 9. 已解决的历史问题

| 问题 | 修复 |
|------|------|
| Obsidian 模板被当作文章导致构建失败 | 迁移模板到 `_templates/`，Content Collection 忽略 |
| `hello-world.md` 字段名错误 `drafts` | 修正为 `draft` |
| test-visible.md 合并冲突 | 手动解决 |
| GitHub Pages Jekyll 解析 .astro 报错 | 添加 `.nojekyll` |
| 首页「近期入藏」硬编码只显示 3 篇 | 移除 `.slice(0,3)` |
| 同天文章排序不稳定 | 添加 slug 二级排序键 |
| 管理面板保存报「服务器内部错误」 | 添加 `express.urlencoded` 中间件 |

## 10. 下一位 Agent 的完成标准

- `git status --branch --short` 工作区干净，与 `origin/main` 同步
- 如有 ahead 提交，成功推送到 `origin/main`
- `npm run build` 成功
- 线上首页正常显示，文章数与本地一致
- 管理面板 `npm run admin` 可正常启动
- 未使用 force push
