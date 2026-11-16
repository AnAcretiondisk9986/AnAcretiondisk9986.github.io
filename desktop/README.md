# ACR·BLOG 桌面版

把仓库里**现有的管理面板**包成独立的 Windows 桌面应用：编辑器（Vditor）、画廊、媒体、关于页、外观、访问控制、发布中心全部原样复用。不需要浏览器、不需要命令行窗口、不需要外部 Node。

## 使用

1. 解压 `ACR-BLOG-4.0.0-win.zip` 到任意本地目录（建议不要放在网络盘）。
2. 双击里面的 `ACR-BLOG.exe`。

首次启动会让你选择博客仓库目录（会自动尝试 `文档\个人博客`、`用户目录\Documents\个人博客`），选择后记住，之后直接进入界面。菜单「文件 → 更换博客目录…」可随时更换。

窗口会在 1 秒内先弹出来（一张「正在启动博客服务…」的启动页），随后替换成管理界面。**不会出现双击后毫无反应的情况**：任何阶段失败都会在窗口里显示原因，并写进日志。

应用会把配置和口令写在 `%APPDATA%\ACR-BLOG\config.json`，不写进仓库；博客内容仍然留在仓库里（`src/content/blog/*.md`、`src/data/*.json`），和命令行版本完全共用。

### 出问题时看日志

```
%APPDATA%\ACR-BLOG\logs\main.log
```

日志从主进程第一行代码开始记，包含 exe 路径、Electron 版本、每个启动阶段的耗时、页面加载失败、渲染进程崩溃等信息。菜单「帮助 → 打开日志文件夹」可直接打开。

### 关于打包的两个坑（都已修掉）

> **单文件便携版**：本质是 NSIS 自解压包，必须先把程序释放到 `%TEMP%` 再运行，遇到非 Windows 形式的 `TEMP`、杀软拦截或临时目录受限就会报
> `Error writing temporary file. Make sure your temp folder is valid.`。所以只提供 zip，zip 版原地运行。

> **`ACR-BLOG.exe` 一启动就崩（0xc0000005）**：electron-builder 默认会用 rcedit 改写 exe 的图标/版本/asar 完整性资源。在这台机器的 Windows 11 26200 + Electron 45 组合下，改写后的 exe 会在执行任何 JS 之前就崩溃（事件查看器里是 APPCRASH，Faulting module 就是它自己）。
> 现在构建配置里固定了 `"win": { "signAndEditExecutable": false }`，exe 保持 Electron 原始签名二进制，只保留 Electron 自带图标；窗口图标仍来自 `desktop/icon.ico`。

## 打包与开发

```bash
npm run build:desktop            # 产出 dist-desktop/ACR-BLOG-4.0.0-win.zip
npm run build:desktop:installer  # 可选：生成 NSIS 安装包（需要本机允许执行生成的安装包）
npm run desktop                  # 开发模式直接跑源码
npm run test:desktop             # 配置与进程控制的测试
```

## 工作原理

```
desktop/main.mjs            主进程：读配置 → 选目录 → 开窗(启动页) → 应用内启动服务 → 加载 /admin
desktop/config.mjs          配置读写、仓库识别、环境变量翻译（可单测）
desktop/log.mjs             启动日志（%APPDATA%\ACR-BLOG\logs\main.log），启动阶段全量记录
desktop/splash.html         启动页：窗口先显示，避免"双击没反应"
desktop/server-control.mjs  端口挑选、就绪探测、子进程启停（开发模式用）
desktop/make-icon.mjs       从 public/logo.webp 生成多尺寸 icon.ico
```

服务端 `admin-server.mjs` 在应用进程内以 `import` 方式启动，路径全部来自 `serverEnv()` 生成的环境变量：

| 变量 | 指向 |
| --- | --- |
| `ADMIN_REPO_ROOT` | 博客仓库根目录（git 提交/推送目标） |
| `ADMIN_BLOG_DIR` / `ADMIN_DATA_DIR` | 文章与 JSON 数据 |
| `ADMIN_BACKUP_DIR` / `ADMIN_REVISIONS_DIR` | 备份与修订快照 |
| `IMG_REPO_DIR` | 同级 `blog-images` 图片仓库 |
| `ADMIN_TOKEN` | 存于用户配置的口令（不再写 `.admin-token`） |

因此应用本身不含博客代码的副本，始终使用仓库里那份最新实现。

安全设置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；站外链接交给系统浏览器，窗口内只允许同源导航。

## 与命令行/终端版本的关系

三者共用同一套文件格式与目录，可以混用：

- 桌面版：图形界面
- `npm run blog`：命令行子命令
- `npm run tui`：终端界面
