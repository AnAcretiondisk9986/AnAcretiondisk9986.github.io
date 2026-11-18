---
title: "抛弃微软雅黑：把 Windows 系统字体换成 Google Sans SC"
description: "从 FontSubstitutes 失效，到字体改名冒名替换，一次 Windows 全局字体替换的完整记录。"
pubDate: "2026-11-19"
dayIndex: 1
cover: "/images/cover-google-sans-sc.webp"
tags:
  - Windows
  - 字体
  - 折腾
draft: false
access: public
---

# 抛弃微软雅黑：把 Windows 系统字体换成 Google Sans SC

微软雅黑从 Vista 一路用到 Windows 11，看了快二十年，实在看腻了。正好手里有 Google Sans SC 的字体文件，于是决定把整个 Windows 的界面字体换掉——包括微信。

结果这件事比想象中曲折：网上的教程一搜一大把，照着改注册表，资源管理器却纹丝不动。这篇记录把踩过的坑和最终可行的方案写清楚。

## 一、常规做法：为什么改 FontSubstitutes 没用

网上最常见的做法，是改这个键：

```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\FontSubstitutes
```

添加两条字符串值：

```
"Microsoft YaHei"    = "Google Sans SC"
"Microsoft YaHei UI" = "Google Sans SC"
```

然后重启。很多人反馈有效，但在我这里（Windows 11 build 26200，字体以用户级安装）资源管理器、记事本全都没变。

原因其实在微软的文档里：**FontSubstitutes 只在应用请求一个“系统中不存在”的字体时才会生效**。微软雅黑是系统自带字体，永远存在，应用请求时直接命中，替换表根本没有机会参与。

这也解释了另一个现象：网上一些“替换成功”的教程，其实同时改了 `Fonts` 键里的字体文件指向，或者用的是雅黑已被移除的精简系统。只改 FontSubstitutes，对已安装的字体无效。

## 二、微信又是另一个问题

本来只换资源管理器也就够了，但我主要想让微信也变。查了一下微信 4.x 的 `Weixin.dll`，里面硬编码了 `Microsoft YaHei` 和 `Segoe UI` 这两个字体名，而且同时引用了 GDI（`CreateFontIndirectW`）和 DirectWrite/Skia（`DWriteCreateFactory`、`SkTypeface`）两套路径。

也就是说：

- 菜单、部分输入框走 GDI，改字体映射有机会生效；
- 聊天列表这类自绘界面走 DirectWrite/Skia，**根本不查 GDI 的 FontSubstitutes**。

想让微信也变，唯一的办法是让系统字体表里“名叫微软雅黑的那个字体”本身变成 Google Sans SC 的字形。

## 三、真正的方案：冒名顶替

思路很简单：把 Google Sans SC 的字体文件复制一份，把内部的名字改成 `Microsoft YaHei` / `Microsoft YaHei UI`，再让系统注册表指向这份改名后的字体。这样对系统来说，“微软雅黑”还是原来的名字，但字形已经是 Google Sans SC 了。

用 fontTools 改字体名（Python）：

```python
from fontTools.ttLib import TTFont

src = "GoogleSansSC-Regular.ttf"
dst = "MicrosoftYaHeiUI-Regular.ttf"

font = TTFont(src)
name = font["name"]

family = "Microsoft YaHei UI"
subfamily = "Regular"
full = "Microsoft YaHei UI"
ps = "MicrosoftYaHeiUI-GS-Regular"

for rec in name.names:
    if rec.nameID in (1, 16, 21):
        rec.string = family
    elif rec.nameID in (2, 17, 22):
        rec.string = subfamily
    elif rec.nameID == 4:
        rec.string = full
    elif rec.nameID == 6:
        rec.string = ps

font["OS/2"].usWeightClass = 400
font["OS/2"].fsSelection = (font["OS/2"].fsSelection | 0x40) & ~0x20 & ~0x01
font["head"].macStyle &= ~0x01

font.save(dst)
```

粗体同理：把 `GoogleSansSC-Bold.ttf` 改成 family `Microsoft YaHei UI`、subfamily `Bold`，`usWeightClass = 700`，`fsSelection` 设置 bold 位，`macStyle` 设置粗体位。

另外还要做一份 family 名为 `Microsoft YaHei`（不带 UI）的版本，因为有些应用请求的是这个名字。于是得到四个文件：

```
MicrosoftYaHeiUI-Regular.ttf
MicrosoftYaHeiUI-Bold.ttf
MicrosoftYaHei-Regular.ttf
MicrosoftYaHei-Bold.ttf
```

## 四、安装和注册

把四个文件复制到 `C:\Windows\Fonts`（需要管理员权限），然后修改注册表：

```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
```

把原来的三个值改掉：

```
"Microsoft YaHei & Microsoft YaHei UI (TrueType)"             = "MicrosoftYaHeiUI-Regular.ttf"
"Microsoft YaHei Bold & Microsoft YaHei UI Bold (TrueType)"   = "MicrosoftYaHeiUI-Bold.ttf"
"Microsoft YaHei Light & Microsoft YaHei UI Light (TrueType)" = "MicrosoftYaHeiUI-Regular.ttf"
```

再新增两个值，把不带 UI 的家族名也注册进去：

```
"Microsoft YaHei Additional Regular (TrueType)" = "MicrosoftYaHei-Regular.ttf"
"Microsoft YaHei Additional Bold (TrueType)"    = "MicrosoftYaHei-Bold.ttf"
```

PowerShell（管理员）大概是这样：

```powershell
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
Set-ItemProperty -Path $key -Name 'Microsoft YaHei & Microsoft YaHei UI (TrueType)' -Value 'MicrosoftYaHeiUI-Regular.ttf' -Type String
# 其余条目同理
```

改完重启（注销有时也够，但重启更稳）。系统在登录阶段重新枚举字体，看到的名字还是微软雅黑，加载的却是 Google Sans SC 的字形。

## 五、效果

重启之后：

- 资源管理器、控制面板、记事本、系统设置全部变成 Google Sans SC；
- 微信的聊天列表、菜单、设置页也一起变了——`Weixin.dll` 请求的 `Microsoft YaHei` 现在指向的就是 Google Sans SC；
- 连一些老软件的对话框也一起换了。

## 六、副作用和回滚

这套做法有几个需要提前知道的点：

- **度量差异**：Google Sans SC 的行高、字宽和微软雅黑不完全一样，个别界面可能出现文字截断或轻微错位；
- **字重回退**：只做了 Regular 和 Bold，原本的 Light 字重会回退到 Regular；
- **系统更新**：Windows 大版本更新或修复安装可能把注册表改回去，需要重做；
- **字体授权**：Google Sans 不是公开发布的免费字体，能不能用请自己确认授权范围；
- **用户级字体**：如果你把字体装在用户目录（HKCU），建议改用系统级安装，否则某些以 SYSTEM 运行的界面看不到它。

回滚很简单——把注册表改回默认：

```
"Microsoft YaHei & Microsoft YaHei UI (TrueType)"             = "msyh.ttc"
"Microsoft YaHei Bold & Microsoft YaHei UI Bold (TrueType)"   = "msyhbd.ttc"
"Microsoft YaHei Light & Microsoft YaHei UI Light (TrueType)" = "msyhl.ttc"
```

删掉新增的两个键和 `C:\Windows\Fonts` 里的四个改名字体，重启即可。改之前最好先导出 Fonts 键备份（`reg export`），这样回滚是一条命令的事。

## 七、最后

换完之后最大的感受是：Windows 的字体替换看起来是“改个注册表”的事，实际上要先绕开“字体已经存在”这个前提，再绕过 DirectWrite 不认 GDI 映射的坑。把字体名改掉、让系统以为它就是雅黑，才是真正通吃的方案。

现在终于不用再看微软雅黑了。
