---
title: "Ubuntu 26.04 | Windows 11 双系统安装记录"
description: ""
pubDate: "2026-08-26"
dayIndex: 1
cover: "https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/image_1787750275068.webp"
draft: false
access: public
---

# Ubuntu 双系统安装记录：从失败、排错到正常运行

2026 年 8 月 26 日，Ubuntu 双系统终于安装完成。

回顾整个过程，这并不是一次简单的“安装 Linux”。从最初准备安装介质，到处理安装失败、排查 U 盘故障，再到解决 NVIDIA 独立显卡驱动导致的花屏问题，这次经历几乎完整走了一遍现代 Linux 桌面系统安装与调试流程。

现在回头看，最大的收获并不是多了一个 Ubuntu，而是真正理解了一个操作系统从启动、内核、驱动到桌面的完整链路。

---

## 一、开始：准备 Ubuntu 双系统

最初的目标很明确：

在现有 Windows 系统基础上，划分约 322GB 空间，安装 Ubuntu LTS，组成 Windows + Linux 双系统。

准备工作包括：

* 下载 Ubuntu LTS 镜像；
* 使用 Rufus 制作启动 U 盘；
* 使用 UEFI 模式启动；
* 保留 Windows 分区，仅使用空闲空间安装 Ubuntu。

第一次启动 U 盘时，出现了一些奇怪现象。

启动界面中曾出现：

* 左侧约三分之一屏幕花屏；
* 右侧黑屏；
* 图像闪烁。

当时一度怀疑显卡兼容性问题。

但进入 Ubuntu 安装界面后，显示恢复正常，因此暂时认为这可能只是启动阶段的显示初始化问题。

---

## 二、第一次安装失败：分区留下的疑惑

进入 Ubuntu 安装程序后，开始进行双系统安装。

原本准备使用之前释放出的约 322GB 空闲空间。

然而第一次安装并没有成功完成。

重新启动进入安装环境后，发现原本的空闲空间已经出现了一个 Ubuntu 相关分区，显示为 LTS。

这带来了新的疑问：

是不是 Ubuntu 已经写入了一部分系统？
是不是需要重新格式化硬盘？

经过确认，这并不是 Windows 分区损坏，而只是安装过程中已经创建出的 Linux 分区。

因此没有贸然删除硬盘内容，而是继续寻找安装失败原因。

---
![image.png](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/image_1787750226134.webp)
## 三、重新检查镜像：发现 ISO 校验问题

为了排查安装失败原因，对 Ubuntu 镜像进行了哈希校验。

结果发现：

部分文件哈希值不一致。

这意味着当前 ISO 文件可能存在损坏。

于是重新下载镜像，并重新制作安装 U 盘。

本以为问题即将解决，但接下来发生了一个意外。

---

## 四、意外事故：唯一的 128GB U 盘损坏

在重新制作启动盘的过程中，使用 Rufus 时开启了：

> 检查磁盘坏区

这个功能会对 U 盘进行大量读写测试。

随后，U 盘出现异常：

* 插入后系统要求格式化；
* 格式化无法完成；
* 原本 128GB 容量异常降低；
* 系统只能识别约 300MB。

最终判断，这个 U 盘已经无法正常使用。

现在看来，更可能的原因是：

这个 U 盘本身可能已经存在潜在的闪存或主控问题，而 Rufus 的全盘读写检测触发了故障。

Rufus 并不是正常情况下会损坏 U 盘的软件，但对于已经存在隐患的存储设备，大量连续写入可能成为最后一次压力测试。

一个 Ubuntu 安装过程，先牺牲了一只 U 盘。

---

## 五、更换安装介质，再次安装 Ubuntu

更换可靠的安装介质后，再次进入 Ubuntu 安装环境。

这一次安装顺利完成。

重启后，出现了 GRUB 引导菜单：

```
Ubuntu
Advanced options for Ubuntu
Memory test
Windows Boot Manager
UEFI Firmware Settings
```

看到：

```
Windows Boot Manager (on /dev/nvme0n1p1)
```

出现在菜单中，说明：

* Windows 系统仍然完整；
* EFI 分区正常；
* Ubuntu GRUB 已成功接管启动。

双系统的基本结构已经建立。

---

## 六、真正的挑战：Ubuntu 启动后的花屏问题

然而，安装完成后的第一次启动并不顺利。

进入 Ubuntu 后，再次出现之前类似的花屏：

* 屏幕部分区域异常；
* 图像撕裂；
* 显示不稳定。

最开始仍然需要判断：

这是硬件问题，还是 Linux 驱动问题？

关键证据来自：

> Ubuntu Safe Graphics 模式可以正常显示。

如果硬件本身损坏，那么安全模式也不应该正常。

因此判断：

问题来自正常启动时 GPU 图形模式初始化。

---

## 七、定位问题：nomodeset 绕过 GPU 初始化

进入 GRUB 编辑启动参数。

临时加入：

```
nomodeset
```

启动后，Ubuntu 正常进入桌面。

这说明：

* Ubuntu 系统没有问题；
* 分区没有问题；
* GRUB 没有问题；
* 问题集中在 GPU KMS（Kernel Mode Setting）阶段。

换句话说：

Linux 在尝试启用完整显卡驱动时发生异常。

---

## 八、解决 RTX 5070 驱动问题

进入系统后检查硬件：

发现设备为：

* Intel Raptor Lake-S UHD Graphics
* NVIDIA GeForce RTX 5070 Max-Q

这是典型的 Intel + NVIDIA 混合显卡架构。

随后安装 Ubuntu 推荐的 NVIDIA 驱动：

```
nvidia-driver-595-open
```

安装完成后：

重新启动。

去除临时添加的：

```
nomodeset
```

再次进入 Ubuntu。

这一次：

系统正常启动。

执行：

```
nvidia-smi
```

成功识别：

```
GeForce RTX 5070 Laptop GPU
```

至此，花屏问题彻底解决。

---

## 九、最终状态

现在的系统状态：

### Windows

* 保留完整；
* 可以通过 GRUB 启动；
* Windows Boot Manager 正常识别。

### Ubuntu

* 安装完成；
* GRUB 正常；
* NVIDIA RTX 5070 驱动正常；
* Intel 核显正常；
* 双系统启动稳定。

后续还完成了：

* Intel/NVIDIA 混合显卡模式配置；
* NVIDIA PRIME 调整；
* 电源管理优化。
![image.png](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/image_1787750275068.webp)
---

## 十、总结

这次安装最大的意义，不只是安装了 Ubuntu。

整个过程实际上经历了一次完整的 Linux 系统排错：

从：

```
ISO 镜像
↓
启动 U 盘
↓
UEFI
↓
分区
↓
GRUB
↓
Kernel
↓
GPU 驱动
↓
桌面环境
```

每一层都出现过问题。

其中最重要的经验：

1. **安装失败不一定代表硬盘有问题。**

   分区变化需要确认后再处理，不要盲目格式化。

2. **Safe Graphics 是非常有价值的诊断工具。**

   它可以帮助区分硬件问题和驱动问题。

3. **Linux 排错依赖证据，而不是猜测。**

   花屏最初看起来像硬件故障，但最终通过测试证明是显卡初始化问题。

4. **不要随便开启 U 盘全盘测试。**

   对于健康 U 盘没有必要，对于存在隐患的 U 盘可能成为最后一次压力测试。

---

最终，一个普通的 Ubuntu 安装，变成了一次关于计算机启动流程、Linux 内核、显卡驱动和系统架构的实践。

从一个无法启动的安装盘，到最终让 RTX 5070 在 Linux 下正常工作。

这次折腾，值得记录。

放一些系统的现状
![image.png](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/image_1787750340395.webp)
![截图 2026-08-26 21-21-40.png](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/-------2026-08-26-21-21-40_1787750588503.webp)
![截图 2026-08-26 20-30-18.png](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/-------2026-08-26-20-30-18_1787750613400.webp)