---
title: 这座博客的完整使用说明
description: 从本地预览、Markdown 写作和图片管理，到 Git 提交、自动部署与常见故障排查的完整指南。
pubDate: 2026-07-30
tags:
  - 博客
  - 使用说明
  - Astro
  - GitHub Pages
draft: false
---

这篇文章是这座博客的维护手册。即使不借助 AI，也可以按照本文完成日常写作、前端文字修改、本地预览和线上发布。

博客使用 [Astro](https://astro.build/) 构建，文章以 Markdown 文件保存，代码托管在 GitHub，并通过 GitHub Actions 自动发布到 GitHub Pages。

## 一、博客是怎样工作的？

整个发布过程可以概括为：

```text
编写 Markdown 或修改前端
        ↓
在本地启动 Astro 预览
        ↓
使用 Git 创建提交
        ↓
推送到 GitHub 的 main 分支
        ↓
GitHub Actions 自动构建
        ↓
GitHub Pages 更新网站
```

平时不需要手动上传 `dist` 文件夹，也不需要在 GitHub 网页中逐个上传文件。

## 二、项目目录说明

博客项目位于：

```text
C:\Users\AnAcretiondisk\Documents\个人博客
```

常用目录如下：

```text
个人博客/
├─ public/                      图片、图标等静态资源
│  └─ images/                  建议将文章图片放在这里
├─ src/
│  ├─ components/              印章、图版等可复用组件
│  ├─ content/blog/            Markdown 文章
│  ├─ layouts/                 全站公共布局
│  ├─ pages/                   首页、文章目录、关于页等页面
│  └─ styles/global.css        全站颜色、字体与排版
├─ astro.config.mjs            Astro 配置
├─ package.json                项目命令和依赖
└─ .github/workflows/          GitHub Pages 自动部署流程
```

以下目录由工具自动生成，不要手动修改：

```text
dist/
node_modules/
.astro/
```

## 三、启动本地预览

打开 PowerShell，进入博客目录：

```powershell
cd "C:\Users\AnAcretiondisk\Documents\个人博客"
```

启动开发服务器：

```powershell
npm.cmd run dev
```

浏览器访问：

```text
http://localhost:4321
```

保存 Markdown、Astro 或 CSS 文件后，浏览器通常会自动刷新。

结束预览时，在 PowerShell 中按：

```text
Ctrl+C
```

如果提示端口已经被使用，可能是另一个开发服务器仍在运行。关闭旧终端，或者在旧终端中按 `Ctrl+C`。

## 四、创建一篇新文章

在下面的目录中新建 Markdown 文件：

```text
src/content/blog/
```

例如：

```text
src/content/blog/clinical-study-note.md
```

文件名会成为文章网址的一部分，因此建议：

- 使用小写英文；
- 单词之间使用连字符；
- 不使用空格；
- 尽量不要随意修改已经发布的文件名。

一篇文章的基本格式如下：

```markdown
---
title: 我的文章标题
description: 用一两句话介绍这篇文章的主要内容。
pubDate: 2026-07-30
tags:
  - 医学
  - 学习笔记
draft: false
---

这里开始写正文。

## 二级标题

这里是一个段落。

- 第一项
- 第二项

> 这里是一段引用。
```

文章头部两个 `---` 之间的内容称为 Frontmatter。

### 必要字段

`title` 是文章标题：

```yaml
title: 我的文章标题
```

`description` 是文章简介，会显示在首页和卷册目录中：

```yaml
description: 用一两句话介绍文章内容。
```

`pubDate` 是发布日期：

```yaml
pubDate: 2026-07-30
```

`tags` 是文章标签：

```yaml
tags:
  - 博客
  - 技术
```

`draft` 控制文章是否公开显示：

```yaml
draft: false
```

- `false`：显示并参与构建；
- `true`：作为草稿保存，不显示在网站上。

修改旧文章时，可以增加修订日期：

```yaml
updatedDate: 2026-08-02
```

## 五、为什么新 Markdown 没有显示？

如果已经把文件放进 `src/content/blog`，但页面没有出现，依次检查以下项目。

### 1. 文件是否已经保存

编辑器标签上如果存在圆点，通常代表文件还没有保存。按 `Ctrl+S` 保存。

### 2. 文件扩展名是否正确

文件必须以 `.md` 或 `.mdx` 结尾。例如：

```text
correct-name.md
```

注意 Windows 可能隐藏已知扩展名，文件实际名称有可能是：

```text
correct-name.md.txt
```

这种文件不会被识别为文章。

### 3. Frontmatter 是否完整

当前博客至少需要以下字段：

```yaml
title:
description:
pubDate:
tags:
draft:
```

冒号后应保留一个空格，日期建议使用 `年-月-日` 格式。

### 4. 是否设置成了草稿

如果写成：

```yaml
draft: true
```

文章会被主动隐藏。正式发布时改成：

```yaml
draft: false
```

### 5. 开发服务器是否仍在运行

检查 PowerShell 中是否仍然显示 Astro 开发服务器。如果服务器已经停止，重新运行：

```powershell
npm.cmd run dev
```

### 6. 终端中是否出现构建错误

Frontmatter 缺少字段、日期格式错误或 Markdown 语法异常时，终端通常会显示错误信息。

可以运行生产构建进行完整检查：

```powershell
npm.cmd run build
```

看到 `Complete!` 表示全部页面能够正常生成。

## 六、在文章中插入图片

建议在 `public/images` 下为每篇文章创建独立目录：

```text
public/images/clinical-study-note/
```

例如放入图片：

```text
public/images/clinical-study-note/cover.webp
```

在 Markdown 中引用：

```markdown
![文章封面](/images/clinical-study-note/cover.webp)
```

图片建议：

- 照片优先使用 WebP 或 JPG；
- 截图和透明图可以使用 PNG；
- 文件名使用小写英文和连字符；
- 单张图片尽量控制在 1 MB 以内；
- 发布他人图片前确认具有使用权。

## 七、修改网站上的固定文字

网站上不是文章正文的文字通常位于以下文件中。

### 网站名称、导航和页脚

```text
src/layouts/BaseLayout.astro
```

### 首页标题、按钮和介绍

```text
src/pages/index.astro
```

### 卷册目录标题和说明

```text
src/pages/blog/index.astro
```

### 文章页面固定标签

```text
src/pages/blog/[...id].astro
```

### 关于页面

```text
src/pages/about.astro
```

### 404 页面

```text
src/pages/404.astro
```

### 首页右侧原创图版文字

```text
src/components/SpecimenPlate.astro
```

如果不知道文字位于哪个文件，可以在 VS Code 中按 `Ctrl+Shift+F`，搜索网页上显示的原文字。

## 八、修改颜色、字体和布局

全站视觉样式主要位于：

```text
src/styles/global.css
```

文件开头的 CSS 变量控制主要颜色：

```css
:root {
  --paper: #e9e1cd;
  --ink: #221d17;
  --red: #8d302b;
  --gold: #9a7b40;
}
```

夜间主题位于：

```css
:root[data-theme='dark'] {
  /* 夜间颜色 */
}
```

修改 CSS 前建议保持本地预览开启，每次只修改少量内容，确认效果后再继续。

## 九、发布文章到线上

发布前先进行生产构建：

```powershell
npm.cmd run build
```

查看当前修改：

```powershell
git status
```

如果只发布一篇文章，可以只添加对应文件：

```powershell
git add src/content/blog/clinical-study-note.md
```

如果文章包含图片：

```powershell
git add public/images/clinical-study-note
```

创建提交：

```powershell
git commit -m "Publish clinical study note"
```

推送到 GitHub：

```powershell
git push origin main
```

推送后，GitHub Actions 会自动构建网站。通常等待几十秒，然后刷新：

```text
https://anacretiondisk9986.github.io/
```

## 十、修改已经发布的文章

打开对应 Markdown 文件，修改正文，并在 Frontmatter 中加入或更新：

```yaml
updatedDate: 2026-08-02
```

然后重复发布流程：

```powershell
npm.cmd run build
git add src/content/blog/文章文件名.md
git commit -m "Update article title"
git push origin main
```

## 十一、撤销尚未提交的错误修改

首先查看修改：

```powershell
git status
git diff
```

如果只是编辑器中尚未保存，可以直接撤销或关闭文件。

如果需要让某个文件恢复到最近一次提交状态，务必先确认文件中没有需要保留的内容，再运行：

```powershell
git restore 文件路径
```

不要在不了解影响时运行：

```text
git reset --hard
```

它可能永久丢弃尚未提交的修改。

## 十二、常见发布问题

### 推送后网站没有变化

可能原因包括：

- GitHub Actions 仍在运行；
- 浏览器缓存了旧页面；
- 修改没有被 `git add` 和 `git commit`；
- 推送到了错误分支；
- 构建失败。

可以先检查：

```powershell
git status
git log -1 --oneline
```

如果本地状态显示：

```text
main...origin/main
```

通常表示本地和远程已经同步。

浏览器仍显示旧内容时，可以按 `Ctrl+F5` 强制刷新。

### GitHub 连接超时

先确认浏览器能否访问 GitHub，再重新运行：

```powershell
git push origin main
```

不要随意将 GitHub 密码或访问令牌复制到陌生软件或网站中。

### 网站出现 404

检查：

- 仓库名称是否仍为 `AnAcretiondisk9986.github.io`；
- GitHub Pages 是否启用；
- GitHub Actions 最近一次部署是否成功；
- 访问的网址是否正确。

## 十三、安全注意事项

这个仓库目前是公开仓库，任何提交进去的内容都有可能被其他人看到。

不要提交：

- 密码；
- GitHub Token；
- Cookie；
- 身份证件和其他隐私材料；
- `.env` 配置文件；
- 未经处理的医疗隐私数据。

即使之后删除文件，敏感信息仍可能存在于 Git 历史中。因此应当在提交前检查：

```powershell
git diff --staged
```

## 十四、推荐的日常工作流程

每次写作可以按照这份简表执行：

```powershell
cd "C:\Users\AnAcretiondisk\Documents\个人博客"
git pull --ff-only
npm.cmd run dev
```

写完并预览后：

```powershell
npm.cmd run build
git status
git add src/content/blog/文章文件名.md
git add public/images/对应图片目录
git commit -m "Publish article title"
git push origin main
```

只要生产构建成功、提交内容正确，并成功推送到 `main`，其余发布工作都会由 GitHub 自动完成。

> 写作是博客真正重要的部分。工具和流程的意义，只是让记录能够稳定、长久地保存下来。

