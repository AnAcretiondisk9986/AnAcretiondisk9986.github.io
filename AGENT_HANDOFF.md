# 个人博客技术交接文档

> 本地交接资料：仓库为 Public。在用户明确授权前，不要将本文件推送到远端。

最后更新：2026-07-30

## 1. 项目概况

- 本地路径：`C:\Users\AnAcretiondisk\Documents\个人博客`
- GitHub 仓库：`https://github.com/AnAcretiondisk9986/AnAcretiondisk9986.github.io`
- 线上地址：`https://anacretiondisk9986.github.io/`
- 当前分支：`main`
- 技术栈：Astro 静态站点、Markdown Content Collections、GitHub Actions、GitHub Pages
- 包管理器：npm
- GitHub Actions Node.js 版本：22
- Astro 配置为 `output: 'static'`，且站点是用户主页仓库，因此没有额外 `base` 路径。

常用命令：

```powershell
npm install
npm run dev
npm run build
npm run preview
```

## 2. 当前 Git 状态

本文档最后更新时的状态：

```text
HEAD: d177dfe Merge remote visibility test metadata
origin/main: 8364769 Update blog post metadata for visibility test
main 相对 origin/main ahead 4、behind 0
工作区：本文档有尚未提交的状态更新
```

四个尚未推送的本地提交：

```text
f506a08 Configure Obsidian publishing workflow
2fe9ef0 Merge remote blog update and fix publishing template
c5f5acf Add technical handoff documentation
d177dfe Merge remote visibility test metadata
```

`d177dfe` 已合并远端提交 `8364769`，当前没有未解决冲突，不要使用 `git push --force`。最后一次 Fetch 成功，HTTPS 网络已经可以连接 GitHub。

重要：提交 `c5f5acf` 包含本交接文档。仓库为 Public，而用户只要求生成本地交接文档，尚未明确授权将其公开。直接执行 `git push origin main` 会同时公开本文档，因此当前推送被安全检查拦截。下一位 Agent 不得直接推送，必须先获得用户对以下一种方案的明确选择：

1. 推荐：交接文档仅保留本地。安全整理尚未推送的本地历史，使代码修复可以推送、但 `AGENT_HANDOFF.md` 不进入远端，同时保留一份本地文档。
2. 用户明确同意将本文档公开到 Public 仓库，然后才可以直接推送当前 `main`。

下一位 Agent 应先执行：

```powershell
git status --branch --short
git fetch origin main
git log --oneline --decorate --graph --max-count=10 --all
```

处理交接文档的公开范围后，如果远端又有新增提交，应先安全合并，禁止强制覆盖：

```powershell
git merge origin/main
npm run build
git push origin main
```

推送成功后，需要等待 GitHub Actions 完成，再验证：

```text
https://anacretiondisk9986.github.io/
https://anacretiondisk9986.github.io/blog/test-visible/
```

## 3. 本次故障与根因

GitHub Actions 的报错不是 Git 本身没有提交，而是提交已经到达远端后，Astro 构建失败：

```text
[InvalidContentEntryDataError] blog -> blog-post data does not match collection schema
description: Expected type "string", received "object"
pubDate: Expected type "date", received "object"
```

远端曾存在 `src/content/blog/blog-post.md`。它是 Obsidian 模板，却位于正式文章目录根部，因此 Astro 将其识别为 ID 为 `blog-post` 的文章。模板中的空值和未展开表达式被 YAML 解析为对象，最终不符合 Content Collection schema。

同时，用户在 GitHub 网页修改了 `test-visible.md`，本地也修改了同一个文件，Obsidian Git Pull 后产生未解决冲突。冲突辅助文件为 `src/content/blog/conflict-files-obsidian-git.md`，现已删除；`test-visible.md` 已保留本地的合法 Frontmatter 和正文版本。

已完成的修复：

- 删除正式文章路径中的 `src/content/blog/blog-post.md`。
- 将模板迁移到 `src/content/blog/_templates/blog-post.md`。
- Content Collection 显式忽略 `_templates/**` 和所有 `.obsidian/**`。
- 模板日期写法修正为 `pubDate: "{{date:YYYY-MM-DD}}"`，避免 Obsidian YAML 解析错误。
- `hello-world.md` 的错误字段 `drafts:false` 已修正为 `draft: false`。
- `test-visible.md` 已使用合法 YAML，并设置 `draft: false`。
- 合并冲突已经解决并提交。

2026-07-30 17:24 的本地 `npm run build` 成功，共生成 8 个页面。

## 4. 内容系统

内容配置位于 `src/content.config.ts`。文章目录为 `src/content/blog/`，支持 `.md` 和 `.mdx`。

当前 schema：

```yaml
title: string
description: string
pubDate: date
updatedDate: optional date
tags: string array, default []
draft: boolean, default false
```

标准 Frontmatter：

```yaml
---
title: "文章标题"
description: "一句完整的文章简介"
pubDate: 2026-07-30
tags:
  - 标签
draft: false
---
```

注意事项：

- YAML 字段名后的英文冒号必须带一个空格。
- 标题或简介包含英文冒号时，整个值需要放在引号中。
- `description` 不能留空。
- `pubDate` 必须是可解析日期，建议使用 `YYYY-MM-DD`。
- `draft: true` 的文章不会出现在首页、目录页或静态文章路由中。
- 文件名会成为文章 URL，建议使用稳定的英文小写名称和连字符。
- 模板必须保留在 `_templates/`，不要移动回文章目录根部。

## 5. 前端结构

主要文件：

```text
src/pages/index.astro             首页
src/pages/blog/index.astro        文章目录
src/pages/blog/[...id].astro      文章详情静态路由
src/pages/about.astro             关于页
src/pages/404.astro               404 页面
src/layouts/BaseLayout.astro      公共 HTML、导航、页脚、主题切换
src/styles/global.css             全站视觉样式
src/components/ArchiveSeal.astro  印章组件
src/components/SpecimenPlate.astro 首页标本图版组件
public/                            静态资源
```

前端使用“私人档案、博物志、编目册”方向的视觉语言。首页和文章列表都会先过滤 `draft: true`，再按 `pubDate` 从新到旧排序。明暗主题保存在浏览器 `localStorage` 的 `theme` 键中。

## 6. GitHub Pages 部署

工作流文件：`.github/workflows/deploy.yml`

流程：

```text
push main
  -> actions/checkout
  -> Node.js 22
  -> npm ci
  -> npm run build
  -> 上传 dist
  -> GitHub Pages 部署
```

“Obsidian 显示 commit 成功”只代表本地提交成功，不代表以下步骤全部成功：

```text
本地 commit -> pull/merge -> push -> GitHub Actions build -> GitHub Pages deploy
```

排错时应分别检查 `git status`、Push 输出、GitHub Actions 和线上 URL。

## 7. Obsidian 集成

Obsidian Vault 目录：

```text
C:\Users\AnAcretiondisk\Documents\个人博客\src\content\blog
```

本机配置：

- 内部链接使用标准 Markdown 格式。
- 链接使用相对路径。
- 附件目录为 `image`。
- 模板目录为 `_templates`。
- Obsidian Git 的 `basePath` 为 `../../..`，即 Git 仓库根目录。
- 启动时自动 Pull。
- Commit-and-sync 前 Pull，提交后 Push。
- `syncMethod` 为 `merge`。
- 自动提交、自动 Pull 和自动 Push 的定时间隔均为 `0`。
- 提交信息为 `通过 Obsidian 更新博客：{{date}}`。
- 提交正文列出修改文件。

本地 `.obsidian` 已加入 `.gitignore`，不会继续推送插件、工作区布局或个人设置。配置文件仍保留在本机。

日常发布流程：

1. 在 Obsidian 中新建英文文件名的文章。
2. 插入 `_templates/blog-post.md` 模板。
3. 填写标题、简介、日期、标签和正文。
4. 准备公开时将 `draft: true` 改为 `draft: false`。
5. 执行 `Obsidian Git: Commit-and-sync`。
6. 等待 GitHub Actions 和 Pages 部署完成。

不要在本地存在未推送改动时，再通过 GitHub 网页编辑同一个 Markdown 文件；这会再次产生合并冲突。

## 8. 提交前构建保护

仓库包含 `.githooks/pre-commit`，本机已执行：

```powershell
git config core.hooksPath .githooks
```

每次本机 Git 提交前都会执行：

```powershell
npm.cmd run build
```

构建失败时提交会被阻止。`.gitattributes` 强制 `.githooks/*` 使用 LF，避免 Windows shell 脚本行尾问题。

注意：`core.hooksPath` 是本机 Git 配置，不会随仓库克隆自动生效。换电脑后需要重新执行配置命令。当前 hook 使用 `npm.cmd`，面向 Windows 环境；在 macOS/Linux 上应改用 `npm` 或增加跨平台判断。

## 9. 隐私与仓库历史

仓库目前为 Public，因此任何人都能查看仓库文件和提交历史，但只有有写入权限的人才能直接修改 `main`。

`.obsidian` 已从当前版本停止跟踪，但旧提交历史中仍存在这些文件。尚未执行历史重写和强制推送，因为这会改写公开仓库历史。若需要彻底移除，应在用户明确授权后使用 `git filter-repo` 等工具，并通知所有本地副本重新同步。

## 10. 下一位 Agent 的完成标准

- 确认没有未解决冲突或意外未提交文件。
- 根据用户明确选择，将交接文档仅保留本地或公开到仓库。
- 成功将包含 `f506a08`、`2fe9ef0` 和 `d177dfe` 的功能修复推送到 `origin/main`。
- GitHub Actions 的 build 和 deploy 两个 job 均成功。
- 线上 `/blog/test-visible/` 返回 HTTP 200。
- 线上目录能够显示测试文章，且不显示 `_templates/blog-post`。
- 最终 `git status --branch --short` 与 `origin/main` 同步。
- 不使用强制推送，不覆盖用户新产生的远端文章。
