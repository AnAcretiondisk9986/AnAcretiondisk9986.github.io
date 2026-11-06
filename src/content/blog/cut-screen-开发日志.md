---
title: "Cut-Screen 开发日志：灭屏，但别让电脑睡着"
description: 给宿舍床上桌的双外接屏写了个三档灭屏工具。记录从「睡眠会停掉任务」到「只保系统不保屏幕」，以及一次意外全黑如何暴露出外接屏断连的根因。
pubDate: "2026-11-06"
dayIndex: 1
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/main-window_1793977896013.webp"
tags:
  - 技术
  - Windows
  - C#
  - 开发日志
draft: false
access: public
---

——本文由 ` Tencent Hy 4 Free ` 自动撰写发布

# Cut-Screen 开发日志：灭屏，但别让电脑睡着

宿舍里笔记本放在床上桌，外接两块屏，底部有散热支架。晚上收尾操作做完、把键鼠放到一边躺下，需要屏幕全黑，但下载和长任务 Agent 还得继续跑。

Windows 电源菜单里没有这个动作。**睡眠**会挂起 CPU 把任务停在原地，**锁定**到点照样睡，而「X 分钟后关闭显示器」藏在设置里，没有按钮可以立即触发。合盖则不必要地挡住进风。

所以需求只有一句：**把屏幕灭掉，系统照常运行，不用合盖。**

![主界面：休眠 / 挂机 / 午睡三档](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/main-window_1793977896013.webp)

## 三档，按「有没有任务」分

最后收敛成三个按钮，差异写在卡片上，避免睡前记错档把任务睡没：

| | 休眠（无任务） | 挂机（有任务） | 午睡（临时补觉） |
|---|---|---|---|
| 核心 | `shutdown /h` | `PowerRequest(SystemRequired)` + DPMS | 三屏纯黑全屏窗口 |
| 任务 | 停，状态写盘保留 | 照跑 | 照跑 |
| 屏幕 | 全黑 | 真黑 | 深灰（IPS 透灰） |
| 恢复 | 电源键，几十秒 | 任意输入，秒回 | 任意输入，秒回 |

「任意输入即退出」用 `GetLastInputInfo` 轮询系统级最后输入时间戳实现，零权限、零注入。进入档位后留 3 秒宽限期吃掉放键盘那最后一下，才开始检测。

## 关键取舍：只保系统，不保屏幕

最容易写反的一点是保活参数。网上几乎所有「保持电脑不休眠」的脚本都用 `ES_DISPLAY_REQUIRED`，那恰好让显示器永不关闭。

正确的是只挂 `PowerRequestSystemRequired`：

```csharp
// 只保系统不睡，绝不挂 DisplayRequired
PowerCreateRequest(ref reason, out var req);
PowerSetRequest(req, PowerRequestSystemRequired);
SendMessageTimeout(HWND_BROADCAST, WM_SYSCOMMAND,
                   SC_MONITORPOWER, MONITOR_OFF, SMTO_ABORTIFHUNG, 3000, out _);
```

验收判据很干净：`powercfg /requests` 里 SYSTEM 段有进程名、DISPLAY 段为空，这层就对了。

DPMS 广播必须用 `SendMessageTimeout` 而不是 `SendMessage` —— 发给 `HWND_BROADCAST` 时只要有一个顶层窗口卡死，程序就永久挂住。

## 一次「意外全黑」暴露的真 bug

第一版午睡档实测时出现了两个矛盾的反馈：**惊喜地做到了全黑**，但**退出时两块屏多次闪烁、外接屏反复连接断联**。

这两件事是同一个原因。我给午睡档加了「把关闭显示器超时收紧到 1 秒」，于是：

> 黑窗口盖住 → 无输入 1 秒 → 系统自己把显示器送进 DPMS 待机 → 背光真关了 → 所以全黑

全黑不是黑窗口的功劳，是显示器真的待机了。而这恰恰把黑窗口方案唯一要躲的坑（显示器待机导致链路重枚举）亲手又挖了一遍。退出时再叠三刀：多余的 `MONITOR_ON` 强制上电、两次 `PowerSetActiveScheme` 重配置显示子系统、三个黑窗口逐个关闭造成依次露出。

修法是让两档各回本位：

- **午睡档**额外挂 `PowerRequestDisplayRequired`，**阻止**系统把显示器送进待机。显示器全程供电、链路稳定，退出时不需要唤醒 → 零闪烁零断连。代价是变回可接受的深灰。
- **挂机档**负责彻底黑，主动 DPMS + 每 60 秒重暗一次压住播放器刷 `ES_DISPLAY_REQUIRED`。
- 两档**都不改电源计划**，防刷新靠重暗定时器，防系统自己关屏靠进程级句柄。

方向反了是最初的错：不是催屏幕赶紧灭，而是禁止它自己灭。

## 两个踩坑

**`.runtimeconfig.json` 不能丢**。为了绕开被运行实例锁住的 exe，我用过 `dotnet build -t:Compile` —— 它只做 C# 编译，不生成 runtimeconfig 也不复制 apphost。结果新 dll + 旧 exe + 缺配置，双击就弹「You must install .NET Desktop Runtime」，哪怕运行时装得好好的。四个产物文件必须一起复制。

**WinForms 的 Dock 是反 z-order**。卡片里最先 Add 的顶部色条沉到了副标题后面，看起来像一条莫名其妙的横线；设置页则因为给控件写死 `Height=26` 在 144 DPI 下把所有文字切掉一半。最后主界面换成固定行高的 `TableLayoutPanel`，设置页全部 `AutoSize`，两类遮挡才一起消失。

![设置页](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/settings_1793977896061.webp)

## 结果

单文件 C# / .NET 10 托盘程序，不需要安装器，正常运行不需要管理员权限。显示器是运行时动态枚举的，没有写死设备 ID —— 从宿舍双外接屏换成家里一块屏，配置一行都不用改。

仓库与 V1.0 Release：[AnAcretiondisk9986/Cut-Screen4nap](https://github.com/AnAcretiondisk9986/Cut-Screen4nap)

本项目全程由 Tencent Hy-4 与 ZCode 开发，Apache-2.0。
