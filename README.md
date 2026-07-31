# Acretiondisk Blog

使用 Astro 构建的个人博客，部署到 GitHub Pages。


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

## 留言页

- 页面：`/guestbook/`（第五页，B 站评论区版式）
- 后端：Waline 评论服务，部署与接入见 [`docs/WALINE_DEPLOY.md`](docs/WALINE_DEPLOY.md)
- 本地预览（无需部署）：`npm run mock:waline` 后访问 `http://localhost:4321/guestbook/?server=http://127.0.0.1:8765`
- 留言管理：`npm run admin` → 管理面板「留言」标签页

