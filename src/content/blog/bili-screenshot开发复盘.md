---
title: Bili Screenshot 开发复盘：从 MV3 双截图管线到 macOS 下载降级
description: 一天 13 次提交，把一个 B 站快捷键截图想法做成可发布的 Chromium 扩展。完整拆解视频原帧采集、跨域回退、弹幕合成、连拍状态、快捷键冲突、下载终态检测与打包流程。
pubDate: "2026-08-05T23:25:00"
dayIndex: 1
cover: "/images/bili-screenshot/options.png"
tags:
  - 技术
  - Chrome扩展
  - JavaScript
  - 踩坑记录
draft: false
---

# Bili Screenshot 开发复盘：从 MV3 双截图管线到 macOS 下载降级

8 月 5 日，我把一个很具体的需求做成了浏览器扩展：在 B 站视频页按一下快捷键，当前画面直接保存到本地。不要浏览器边框，不要每次弹出“另存为”，尽量保留视频源分辨率，弹幕可选。

仓库是 [GitHub: AnAcretiondisk9986/Bili-Screenshot](https://github.com/AnAcretiondisk9986/Bili-Screenshot)。从第一笔提交到 `main` 上的 `v1.1.4`，时间是 18:09 到 22:59，共 13 次提交。下面不只列功能，而是从需求边界、架构、失败回退、版本演进到发布，把整个开发过程还原一遍。

![Bili Screenshot 的设置页，保存、画质、文件名、连拍和快捷键集中在同一处](/images/bili-screenshot/options.png)

## 一、先把问题收窄

这个工具没有做成通用网页截图器。它只服务一个高频动作：**截取 B 站播放器当前帧**。边界确定后，第一版需求也就很清楚：

- 快捷键触发，截图过程不打断播放；
- 优先导出视频源分辨率，而不是播放器在屏幕上的尺寸；
- JPEG / PNG 可选，JPEG 质量可调；
- 可以带弹幕，也可以只要干净画面；
- 文件自动进入下载目录下的指定子目录；
- 文件名能够带日期、时间、BV 号、标题和播放进度。

后续功能——连拍、复制到剪贴板、截图历史、页面内快捷键——都围绕这条主链路增加，没有改变它的核心。

## 二、为什么选 Manifest V3

项目是一个没有框架、没有构建步骤的 Chromium 扩展。浏览器直接加载源码，主要由五块组成：

```text
manifest.json          权限、快捷键、Service Worker 与内容脚本入口
content.js             在 B 站页面里找视频、合成画面、读取标题和 BV 号
background.js          调度截图、下载、连拍、通知和历史记录
options/               设置页
popup/ + history/      快捷入口与最近 100 条截图记录
```

`content script` 能接触页面里的 `<video>` 和弹幕层，却不能直接承担全部浏览器级能力；`background service worker` 能调用 `downloads`、`tabs`、`notifications` 等 API，却不能直接读取页面 DOM。于是两边通过消息协作：页面侧负责“取到画面”，后台侧负责“把它可靠地保存下来”。

```text
快捷键 / 页面按键
       ↓
background.js 找到当前 B 站标签页
       ↓  chrome.tabs.sendMessage
content.js 采集视频帧、标题、BV 号、播放进度
       ↓
background.js 生成路径与文件名
       ↓
chrome.downloads 保存 → 记录历史 → 角标或系统通知
```

清单只申请完成这些工作所需的权限：`storage`、`downloads`、`notifications`、`tabs`、`scripting`、`alarms` 和 `clipboardWrite`，站点权限限制在 `https://*.bilibili.com/*`。设置存在 `chrome.storage.sync`，可随浏览器账号同步；体积更大、只对本机有意义的截图历史放在 `chrome.storage.local`。

## 三、主截图管线：直接拿视频原帧

最理想的截图不是网页截屏，而是把 `<video>` 当前帧画进 canvas：

```js
const canvas = document.createElement("canvas");
canvas.width = video.videoWidth;
canvas.height = video.videoHeight;
canvas.getContext("2d").drawImage(
  video, 0, 0, video.videoWidth, video.videoHeight
);
```

这里故意使用 `video.videoWidth / video.videoHeight`，而不是 `clientWidth / clientHeight`。前者是视频源尺寸，所以 1080P 视频即使缩在一个小窗口里，仍能输出 1920×1080；后者只是页面布局尺寸，会把截图质量绑死在屏幕和窗口上。

如果用户选择“带弹幕”，内容脚本会先在新旧两套 B 站播放器容器中寻找已知弹幕 canvas；类名匹配失败，再从播放器内部挑选与视频显示尺寸接近、可见且面积最大的 canvas，最后按视频源尺寸叠加到输出画布。这个兜底很重要，因为站点改版时，完全依赖一个类名会非常脆弱。

完成合成后按设置执行：

```js
canvas.toDataURL("image/jpeg", quality); // JPEG
canvas.toDataURL("image/png");           // PNG
```

同时再生成一张宽度不超过 256px、JPEG 质量 0.55 的缩略图，只用于历史页。这样历史记录能快速打开，不必把每张原图再存一遍。

## 四、跨域污染：必须准备第二条截图管线

直接画 video 的方案质量最好，但视频 CDN 的跨域策略可能把 canvas 标记为 `tainted`。一旦污染，`getImageData()` 或 `toDataURL()` 会抛出 `SecurityError`。这不是换一种 canvas 写法能绕过的安全限制。

项目因此准备了视口回退：

1. 内容脚本读取播放器的 `getBoundingClientRect()`、视口大小和 `devicePixelRatio`；
2. 后台调用 `chrome.tabs.captureVisibleTab()` 捕获当前标签页；
3. 在 `OffscreenCanvas` 中按播放器矩形裁剪；
4. 再转换为用户选择的 JPEG 或 PNG。

如果设置为“不带弹幕”，内容脚本会先临时隐藏弹幕层，等待 120ms 让浏览器完成一次合成，再通知后台截屏；后台完成后立刻发消息恢复。另有 20 秒兜底定时器，即使后台流程异常退出，也不会让页面弹幕永久消失。

两条管线的取舍很明确：

| 管线 | 优点 | 代价 |
|---|---|---|
| video → canvas | 视频源原始分辨率，不受窗口大小影响 | 受跨域 canvas 安全策略限制 |
| captureVisibleTab → 裁剪 | 不读取跨域视频像素，兼容性更高 | 只能得到屏幕所见，播放器必须完整可见 |

这也是整个扩展最关键的设计：不是假设一种方案永远成功，而是在质量和兼容性之间安排一条可解释的降级路径。

## 五、文件名与路径：模板要自由，也要安全

默认文件名模板是：

```text
{date}_{time}_{bvid}_{title}_{progress}
```

可用变量还包括 `{duration}`、`{width}`、`{height}`。例如：

```text
20260805_221530_BV1xx411c7mD_示例标题_00_12_08.jpg
```

用户输入不能直接变成文件路径。实现中会把 `\ / : * ? " < > |`、换行等非法字符替换为下划线，折叠连续空格，标题最多保留 100 个字符；路径再按层拆分，过滤空段、`.` 和 `..`，最后统一用 `/` 交给 Chrome。这样既保留模板自由度，也避免路径穿越和系统非法文件名。

Chrome 扩展不能任意写磁盘，保存位置只能是浏览器下载目录内的相对路径。设置里的 `BiliScreenshots/{date}/` 最终对应“下载/BiliScreenshots/20260805/”，这是平台能力边界，不是扩展少做了一个目录选择器。

## 六、三种操作：单张、连拍、复制

### 单张截图

默认页面内快捷键和系统级快捷键都是 `Ctrl+Shift+Q`。后台确认当前是 B 站标签页，确保内容脚本已注入，然后请求一次采集、保存文件、写入历史并显示约 1.6 秒的蓝色勾角标。

### 连拍

默认 `Ctrl+Shift+X`，6 张、间隔 300ms，范围限制为 1–50 张和 100–5000ms。连拍中的第二次按键代表“停止”，因此状态不能只放在函数局部变量里。

Manifest V3 的 Service Worker 会被浏览器回收。项目把 `burstState.active` 写入 `chrome.storage.local`，每一轮截图前都重新读取；即使后台生命周期发生变化，也能继续理解下一次按键是停止还是启动。连拍期间不逐张弹通知，结束后只汇总成功数量，避免提示轰炸。

### 复制到剪贴板

复制在页面侧使用 `navigator.clipboard.write()` 写入无损 PNG，也可以选择“复制时同时保存”。跨域污染时，这条路径不会偷偷改成屏幕截图，而是明确提示改用保存功能，因为剪贴板写入仍要在页面安全上下文内完成。

## 七、快捷键为什么连续改了三次

快捷键看起来只是一个字符串，实际上同时受浏览器、系统和网页三层影响。项目先后经历了：

```text
Ctrl+Shift+S  →  Ctrl+Alt+S  →  Alt+Shift+S  →  Ctrl+Shift+Q
```

`Ctrl+Shift+S` 会撞上 Edge 自带网页截图；`Ctrl+Alt+S` 又不符合 Chrome 扩展命令允许的建议组合，改成 `Alt+Shift+S` 后，最终才落到更稳定的 `Ctrl+Shift+Q`。Mac 上 `Command+Shift+Z` 是“重做”，所以复制的系统级默认键单独设为 `Command+Shift+C`。

项目最后保留两套入口：

- **系统级快捷键**由 `chrome.commands` 接管，可靠，但只能去浏览器的扩展快捷键页面修改；
- **页面内快捷键**由内容脚本在捕获阶段监听 `keydown`，可以直接在扩展设置页录制和修改，但要求 B 站页面获得焦点。

两套组合相同时不会执行两遍：若浏览器命令层先截获按键，页面就收不到这次 `keydown`。`v1.1.4` 还把 popup 里写死的默认键改成动态读取：页面内值来自 `storage.sync`，系统级值来自 `chrome.commands.getAll()`，用户改过什么，界面就显示什么。

## 八、macOS 上“复制正常，保存没反应”

这是开发中最值得记录的一次排查。反馈现象是：macOS + Chrome 下复制正常，但保存没有文件，也没有错误提示。

复制和保存是两条独立链路。复制成功说明视频帧采集、canvas 合成和页面消息都没有问题，范围可以直接缩到 `chrome.downloads`。

原实现大致是：

```js
try {
  await chrome.downloads.download({ url, filename, saveAs: false });
} catch (error) {
  // 提示失败
}
```

问题在 API 语义：`downloads.download()` 的 Promise 成功，只表示**下载项已经创建**，不表示文件最终写入成功。子目录创建或文件权限错误发生在之后，下载项会进入 `interrupted`；外层 `try/catch` 根本接不到，所以用户看到的是“无事发生”。

`v1.1.4` 做了三层修复：

1. 用 `chrome.downloads.onChanged` 监听 `complete` / `interrupted` 真正终态；
2. 20 秒未收到事件时，用 `downloads.search({ id })` 再查一次，避免慢磁盘被误报；
3. 若错误码以 `FILE_` 开头且路径含子目录，去掉目录、改存下载根目录并重试一次。

因此 macOS 创建子目录失败时，截图不再静默丢失，而是落到下载根目录；如果第二次仍失败，提示中会带真实错误码。设置页的“测试保存一张”也接入同一套终态检测，不再出现按钮说成功、磁盘上却没有文件的假测试。

## 九、设置、历史与界面没有引入框架

设置页由原生 HTML、CSS、JavaScript 完成。除了普通表单，还做了一个文件名模板构建器：变量模块可以拖入、排序、删除，也能切换到原始模板字符串直接编辑。保存前统一写入 `storage.sync`，内容脚本监听 `chrome.storage.onChanged`，不用刷新页面就能拿到新快捷键。

历史记录最多保留 100 条，包含时间、最终保存路径、估算大小、BV 号、标题、尺寸和缩略图。列表超过上限直接截断，历史页提供清空操作。这里不保存原始截图文件本身，避免把扩展本地存储迅速塞满。

整个运行时没有第三方依赖。仓库里的 `playwright-core` 只服务开发期截图工具，不进入扩展发布包。

## 十、从安装器到纯 zip：一次主动删功能

第一版同时做了商店 zip 和 Windows 安装器，后来还把扩展内容嵌进单个 exe。思路是降低安装门槛，但浏览器扩展的加载、更新和信任链并不会因为套一层 exe 就真正变简单，反而带来平台限定、杀毒软件误报、维护两套产物等成本。

所以 `v1.1.0` 主动移除了安装器，回到 Chromium 通用的开发者模式安装：下载 zip、解压、打开扩展管理页、开启开发者模式、加载已解压目录。Chrome、Edge 和其他 Chromium 浏览器都能复用同一份包。

打包脚本采用明确白名单，只把清单、运行时代码、三个界面、图标和 README 放进 zip。zip 根目录直接包含 `manifest.json`，符合商店与“加载已解压扩展”的结构要求：

```bash
python tools/build_release.py
python tools/build_release.py --dir
```

第二条命令还会生成未压缩发布目录，方便本地验证或直接分发。版本默认从 `manifest.json` 读取，避免命令参数和扩展版本不一致。

## 十一、13 次提交实际发生了什么

![GitHub 上的 Bili Screenshot 提交时间线，快捷键兼容和 macOS 修复都保留了完整记录](/images/bili-screenshot/commit-history.png)

把 13 次提交按工程阶段归并，大致是这样：

| 阶段 | 版本 / 提交 | 主要变化 |
|---|---|---|
| 可用原型 | `1.0.0` | MV3 骨架、原帧截图、跨域回退、设置页、popup、打包脚本 |
| 分发试验 | 安装器相关提交 | Windows 安装器 → 单文件内嵌 → 评估后整体移除 |
| 工作流补全 | `1.1.0` | 剪贴板复制、独立历史页、文案与界面清理 |
| 兼容性修正 | `1.1.1`–`1.1.3` | 连续处理 Edge / Chrome 快捷键限制与默认键冲突 |
| 可靠性修正 | `1.1.4` | macOS 下载终态与根目录降级、快捷键真实值、未压缩发布目录 |

初始提交一次加入 3857 行，随后不是单纯堆功能：安装器被删除，popup 被收窄成入口，历史拆成独立页面，保存链路也从“API 调用成功”改成“磁盘写入终态成功”。这几次减法和返工，才是从能跑到可交付的过程。

## 十二、验证方式与仍然存在的限制

当前 JavaScript 文件都通过了 `node --check` 语法检查，发布目录和 zip 已生成。项目目前没有自动化测试，这是现阶段最明显的工程欠账；跨域、快捷键占用、macOS 文件权限都依赖真实浏览器和真实系统状态，至少应继续补一份按 Chrome / Edge / macOS 分组的回归清单。

已知限制也需要写在前面：

- 只能保存到浏览器下载目录及其子目录；
- 视口回退时，播放器必须完整处于可见区域；
- 复制到剪贴板不提供跨域视口回退；
- B 站播放器 DOM 或弹幕实现大改后，弹幕层识别可能需要更新；
- `dataURL` 会比二进制数据占更多内存，超高分辨率连拍仍有优化空间。

下一步如果继续做，我会优先把截图数据从 `dataURL` 改成 `Blob` / `ArrayBuffer` 传递策略，补充下载与模板函数的单元测试，再用一套固定视频页做真实浏览器回归。功能数量已经够用，后面更值得投入的是稳定性和可验证性。

## 结语

Bili Screenshot 的代码不算庞大，但它碰到了浏览器扩展开发里很典型的几类问题：页面与后台的权限边界、跨域 canvas、MV3 后台生命周期、系统快捷键冲突，以及“Promise 成功不等于任务完成”的异步 API 契约。

最终版本最重要的不是又多了几个选项，而是形成了一条完整链路：高质量方案失败时有兼容回退，后台被回收时状态仍可恢复，文件写入失败时能看到真实终态，发布包也能在不同 Chromium 浏览器里用同一套方式安装。一个小工具真正变得可靠，往往就是靠这些看不见的部分。
