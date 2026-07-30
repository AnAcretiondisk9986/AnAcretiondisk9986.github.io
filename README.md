# Acretiondisk Blog

使用 Astro 构建的个人博客，部署到 GitHub Pages。

## 本地开发

```powershell
npm.cmd install
npm.cmd run dev
```

## 写新文章

在 `src/content/blog/` 新建 Markdown 文件，并填写：

```yaml
---
title: 文章标题
description: 文章简介
pubDate: 2026-07-30
tags:
  - 标签
draft: false
---
```

## 自定义前端

- 页面：`src/pages/`
- 公共布局：`src/layouts/BaseLayout.astro`
- 全局样式：`src/styles/global.css`
- 图片等静态资源：`public/`

