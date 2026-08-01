---
title: 关于绕过GFW和用于自搭建节点的VPS技术简介和建议
description: 如何更具安全性地使用VPN
pubDate: "2026-08-01"
dayIndex: 5
tags:
  - VPN
  - VPS
  - 机场
  - 梯子
draft: false
---

<iframe src="https://www.youtube.com/embed/5LM3jtVVs40?si=tvQOyisxrjf7xhhG" title="嵌入式视频播放器" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>

# 原理
网络请求首先到达翻墙软件，再进行请求的加密，随后到达GFW，GFW发现请求的目标在节点服务器（不在黑名单中），就会放行请求到达节点服务器；节点服务器通过解密得到真正的请求后跟目标网站交互，再加密转发回翻墙软件，之后就能拿到所需要的数据

# 关于VPN的选择
这里面我觉得除了免费VPN不能用其他都是没有问题的
危险的点在于：
- 监控
- DNS挟持
- 挖矿
- 钓鱼
- 篡改
---
## 经过前面的原理解释其实不难明白


** VPN在这个网络交互事件中扮演的是一个中继器和中间商的角色，所以很难保证这些经由中间人传输的数据不会被截留泄露**
---
# 关于自建节点（VPS）

<iframe width="560" height="315" src="https://www.youtube.com/embed/NhhyCl1w-4c?si=x8oH3OVgF-MkYOBp" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

## 本质和原理
本质是一台海外的电脑

线路越好速度和延迟越稳。

### ASN自治域
例如跨越上海到洛杉矶的两台服务器分别为

1. Shanghai *59.43*.80.142
- 这就是国际出口服务器
2. LA *59.43*.184.158
- 这就是落地服务器

他们都是59.43，所以同属于一个ASN自治域，即 `AS4809` ,其他也是同理，即一个ASN自治域旗下包含了许多的线路
![image.png](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/image_1785595948781.webp)
线路虽然由不同运营商承建，但三网用户可互相使用线路，不过本家的线路必然更好
---
## VPS选购
### 视频下附
>◉ 搬瓦工VPS官网（有货）：
>50美元/3个月 | 三网顶级优化线路
> <https://bandwagonhost.com/>
>
>◉ DMIT美国VPS（有货）：
>中国电信顶级优化线路CN2 GIA
> <https://www.dmit.io/>
>
> ◉ Akile香港VPS（有货）：
>最低40元/月 | 香港无稳定机建议【月付】
><https://akile.ai/register?aff_code=e3...>
>
>Vmiss VPS官网：
>
>三网顶级优化线路
><https://app.vmiss.com/aff.php?aff=5248>
>
>VPS测试脚本：
><https://wise-vegetarian-da6.notion.si...>
>
>全球优化线路VPS推荐：
><https://wise-vegetarian-da6.notion.si...>

## VPS测试
数据传输的流程叫做** 路由**，需要测试路由是否经过宣传的线路来验证提供商是否以次充好

测试网络稳定性（丢包率）
- ITDOG Ping值测试：<https://www.itdog.cn/ping/>

测试IP地址（能否解锁带有验证的流媒体）
- 去程测试脚本IPIP网站<https://tools.ipip.net/traceroute.php>

- IP测试
```powershell
bash <(curl -Ls https://Check.Place) -I
```

# 建议与总结
1. 选择适合自己的线路
2. 流量、带宽参数
3. 硬件配置（只搭接点可忽略）
4. 厂商口碑，对知名度较低小厂进行背调
#### 对安全性极致追求的（涉敏感内容灰黑产的）可以选择此项技术来进行节点搭建，一般用户直接采用现成的服务即可