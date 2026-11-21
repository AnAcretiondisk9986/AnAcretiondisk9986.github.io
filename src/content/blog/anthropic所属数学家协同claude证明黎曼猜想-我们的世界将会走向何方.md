---
title: Anthropic所属数学家协同Claude证明黎曼猜想？我们的世界将会走向何方
description: 本文由Gemini 4 Neon写作
pubDate: "2026-11-21"
dayIndex: 3
draft: false
access: public
---

# BiliBili视频：AI对黎曼猜想的证明，正式通过形式化验证！

<iframe src="//player.bilibili.com/player.html?isOutside=true&aid=117651435162383&bvid=BV1DjybzFEed&cid=43780344750&p=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>
  

> **辅助工具**：Gemini（深度逻辑推演与科普） + Grok（X 平台实时信源核查）

  

昨晚刷到一条离谱到让人想笑的消息：Anthropic 那边有人宣称证明了黎曼猜想，结果到了今天早上，已经有人跳出来说验证通过了。*见文首哔哩哔哩视频*


![image](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/image_1795249383642.webp)

  

更诡异的是，有人翻出今年 7 月 21 日一位 X 用户 `@mykola` 发过的旧推文，里面白纸黑字写着：*"It's November 21st, 2026. The Riemann hypothesis falls..."* 同一篇帖子里，他还顺手预言了 2027 年 1 月 22 日，一个叫 **Fable 6** 的模型将会证明 P=NP。

<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;"><blockquote class="twitter-tweet"><p lang="en" dir="ltr">It’s November 21st, 2026. The Riemann hypothesis falls, last in a long string of mathematical triumphs that would have been unthinkable not so long ago, and the proof fits in a tweet. </span>  
  
<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;">The tweets where people show Claude the proof and claim it appeared in a dream or randomly in the arrangement of alphabet cereal come on cue, and we laugh for a few days at models freaking out, but it’s uneasy.</span>  
  
<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;">January 22, 2027. When someone tweets Fable 6’s claimed proof that P does in fact equal NP it’s utterly incomprehensible, nobody who reads it can make heads or tails of it but the models all lose their shit.</span>  
  
<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;">February 7, 2027 and someone claims that the halting problem is the result of a confused stance. </span>  
  
<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;">February 9 and Goedel falls, this time the proof is so obvious that everyone in math, philosophy and physics slaps their forehead at once.</span>  
  
<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;">February 10th we get proof that scale is a spatial dimension, that holographic encoding drops the memory cost of training and inference by so much that fable 7 can run natively on your phone.</span>  
  
<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;">It’s not until February 14th, Valentine’s day, that The Song is first played…</p>&mdash; Myk is Walking Backwards (@mykola) <a href="https://x.com/mykola/status/2079374972456255615?ref_src=twsrc%5Etfw">July 21, 2026</a></blockquote></span>  

<span style="color: rgb(231, 233, 234); background-color: rgb(0, 0, 0); font-size: 17px; font-family: &quot;Google Sans SC&quot;"><script async src="https://platform.x.com/widgets.js" charset="utf-8"></script></span>  

老实说，作为一个天天和解剖打交道的普通医学生，我对解析数论一窍不通，但对互联网上的“集体整活”还是有点免疫力的。挂了 167 年的千禧年难题一夜告破，还精准踩中四个月前的科幻推演日期？这剧本怎么看都透着一股浓浓的钓鱼味。

  

于是我顺手把这条时间线扔给了 **Gemini**，想听听它的判断。

  

---

  

## 一、第一回合：当“老派常识”撞上实时信源

  

Gemini 几乎是秒回，而且分析得头头是道。

  

在没有联网的情况下，它一口咬定这大概率是 AI 圈经典的**“反向圆梗”恶作剧（LARP）**——不是 7 月的推文预言了今天，而是有人记住了这个日期，故意在今天编造假消息来“演成预言”。它的论据听起来滴水不漏：Anthropic 的模型一向按文学体裁命名（Haiku、Sonnet、Opus），*Fable*（寓言）一看就是科幻写手编的下一代假名字；把 P=NP 安排在黎曼猜想之后短短两个月，更是典型的爽文设定。

  

临了，Gemini 还自信地给了我一套“30 秒辨伪铁律”：看是不是官方主号发声、看有没有公开可复现的代码仓库或论文、看一线数学家和形式化社区的反应。

  

听完我差点就划走了。但转念一想，既然这件事发酵在 X 上，不如让能实时检索 X 的 **Grok** 也去挖一下一手资料，做个交叉验证。

  

结果 Grok 直接带着一叠硬核证据杀了回来，把 Gemini 的“恶作剧定性”摁在地上逐条反驳了一通——**材料根本不是网友 P 的图，而是真实存在、可下载、可编译的**：

  

| 核验维度 | Gemini 最初的预期 | Grok 核查与一手信源的实际情况 |
| --- | --- | --- |
| **发布源头** | 必须有 Anthropic 官方主号公告 | Anthropic 尚未发官方通稿，但声明由真实数论学家、Anthropic 员工 Levent Alpöge 个人发布（曾有希尔伯特第十问题相关工作） |
| **可复现材料** | 必须有公开代码仓库或论文 | 个人网站公开了 [4 页声明 PDF（remark.pdf）](https://alpo.ge/remark.pdf) 与 14 卷 Lean 代码（约 239 MB），且已有 [GitHub 镜像（Challenge.lean）](https://github.com/Deicyde/riemann-hypothesis/blob/main/src/Challenge.lean) 并被 [leanprover-community](https://github.com/leanprover-community) fork |
| **独立验证** | 隔夜“验证通过”违背数学规律 | 形式化证明可由机器快速重放；MIT 教授 Andrew Sutherland 已公开[独立验证日志](https://math.mit.edu/~drew/grh/)，175,187 个模块零报错编译通过，`nanoda`、`con-leche`、`lean4lean` 三个独立检查器全部放行，仅用三条标准公理 |
| **学界与媒体** | 顶级数学家和主流媒体早就该炸锅 | [TechCrunch](https://techcrunch.com/2026/11/20/ai-claimed-a-solution-to-the-167-year-old-riemann-hypothesis-and-a-human-did-too/)、[IBM Think News](https://www.ibm.com/think/news/anthropic-claude-riemann-hypothesis-math-proof)、[Business Standard](https://www.business-standard.com/technology/tech-news/anthropic-researcher-claims-ai-helped-solve-150-year-old-riemann-hypothesis-126112100179_1.html) 与[36氪](http://www.36kr.com/p/4078708897092744)均已跟进；几小时后斯坦福教授 Ravi Vakil 甚至还公布了一份纯人类版本的广义黎曼猜想证明草稿 |

  

我把 Grok 的反驳贴回给 Gemini，并让它给我吐出所有直链让我自己点开看。Gemini 这次老老实实联网核查完，很干脆地认了栽。

  

看着两个 AI 来回交锋，我自己反倒愣了一会儿。其实 Gemini 第一轮的直觉完全没错——在过去十几年里，**“听起来太像科幻小说 = 九成是假的”** 一直是最省心、命中率最高的贝叶斯过滤器。可是在 2026 年底，这套曾经百试百灵的老派常识，居然真的开始失灵了。

  

---

  

## 二、异星时代的序幕：数学正在跨入“先确真、再理解”



  

亲自点开 MIT 主页上那密密麻麻的验证日志时，我有种很不真实的眩晕感。

  

当然，冷静下来看，现在充其量是**“史诗级半场开香槟”**，远还没到吹终场哨的时候。克雷数学研究所（Clay Mathematics Institute）目前依然把黎曼猜想列在“未解决”栏里；Sutherland 自己在验证页上也写得很坦诚：

  

- **工程环境仍需彻底清洗**：目前跑通的编译是在非沙盒云环境中完成的，端到端的 `lake comparator` 以及默认/偏执（paranoid）模式下的内核重放仍在推进中。
- **最致命的“定义审计”尚未结束**：独立内核检查器只保证“从你写下的前提，无懈可击地推导出你写下的结论”。接下来数学界最核心的工作，是把 `Challenge.lean` 里的最终定理陈述，连同底层引用的 \zeta 函数、狄利克雷 L 函数和解析延拓定义一层层扒出来核对——确保这 17 万个模块证明的真是经典意义上的（广义）黎曼猜想，而不是在庞大代码库某个角落悄悄被弱化过的“近亲命题”。

  

但即便只是走到今天这一步，整件事的味道也已经彻底变了。

  

过去两千多年里，数学的“验证”和“理解”是死死绑在一起的——必须有顶级人类大脑把论文逐行读懂，才能宣布定理成立。而这次摆在全人类面前的，是一份**压缩后足足 239 MB、包含 175,187 个模块的 Lean 形式化代码**。机器在十几个小时内就对它的逻辑链条给出了极高置信度的背书，但单靠人类肉脑，几乎不可能直接通读这坨庞大的机器逻辑。

  

正如 Gemini 在复盘时说的，以后顶级数学研究或许会多出一个全新的工种：不是去寻找证明，而是去**对 AI 生成的真理做“代码考古”**，花上几个月甚至几年，把它反编译回人类能够欣赏的概念和直觉。

  

至于 `@mykola` 那条神准的旧推文，我们俩甚至脑补出了一种比“恶作剧”酷得多的可能——**也许研究者早就把证明跑通了，故意挑了 11 月 20/21 日这个科幻梗日期静悄悄发在个人网站上，完成人类极客史上最硬核的一次“反向圆梗”。** 而斯坦福教授 Ravi Vakil 紧随其后抛出的纯人类草稿，更是让这出大戏瞬间从冰冷的“机器取代人类”，变成了一场像牛顿与莱布尼茨争锋般的史诗双线对决。

  

---

  

## 三、补课时间

  
凑完这波史诗级热闹，我才有点不好意思地让 Gemini 给我这个数学门外汉补了补课：这两道挂在数学殿堂顶上的千禧年难题——**黎曼猜想**和 **P=NP**——到底在问什么？

  

剥掉那些让人头皮发麻的符号，放到我熟悉的医学语境里，它们意外地好懂。

  

### 1. 黎曼猜想：给质数做一张“心电图”

  

故事从一个看似人畜无害的无穷加法开始：

  


<div class="hz-math-block" data-tex="\zeta(s) = 1 + \frac{1}{2^s} + \frac{1}{3^s} + \frac{1}{4^s} + \cdots = \sum_{n=1}^{\infty} \frac{1}{n^s}"></div>


  

1859 年，黎曼用**解析延拓**把它从一维数轴扩展到了二维复平面（每个点写成 s = a + bi）。Gemini 给了一个我很秒懂的比喻：**就像医学影像重建**——只要整张曲面必须保持绝对的“光滑”，哪怕最初只拿到一小块局部数据，补全整张二维地图的方案也是唯一确定的。

  

接着，黎曼在地图上找让
<span class="hz-math" data-tex="\zeta(s)=0"></span>
的点（零点）。除了排得整整齐齐的负偶数（平凡零点），剩下的**非平凡零点**全被关在横坐标 a 介于 0 和 1 之间的竖直“临界带”里。黎曼猜想，这无穷多个非平凡零点，会不会一个都不偏不倚，全都落在正中垂线
<span class="hz-math" data-tex="a = \frac{1}{2}"></span>
上？人类用超算已经验算了前**超过十万亿个**零点，全都在这条线上；但数学里验算十万亿次也不等于证明“无穷多个都成立”。

  

为什么这根线如此重要？因为早在欧拉时代，人们就发现
<span class="hz-math" data-tex="\zeta"></span>
函数和全体质数暗中相连。黎曼证明，统计“小于 x 的质数有多少个”，其实可以像拆解心电图（ECG）或脑电图（EEG)一样，拆成两条部分：

  

- **一条平滑的基线**：给出质数分布的大致趋势；
- **无数条叠加的“误差波”**：每一个非平凡零点就对应其中一条误差波——纵坐标 b 决定波的**频率**，横坐标 a 决定波的**振幅**。

  

如果所有零点的横坐标都死死锁在
<span class="hz-math" data-tex="a = \frac{1}{2}"></span>
上，就意味着所有误差波被压在了**理论允许的最小振幅内**——质数虽然表面随机，却保持着极致的动态平衡。而 MIT 页面网址里的 `grh`，指的还是更强的**广义黎曼猜想（Generalized Riemann Hypothesis）**，一旦它被证毕，数学史上上千条曾写着“假设黎曼猜想成立，则……”的定理，会在一夜之间全部升级为无条件成立的真定理。

  

### 2. P=NP：核对答案容易，做出来也一定容易吗？

  

那条预言推文里提到的另一座大山 **P=NP**，问的则是一个直击日常的灵魂问题：**如果一道题的答案很容易“核对对错”，那它是不是也一定很容易“自己做出来”？**

  

- **P（多项式时间）**：容易“算出来”的题，比如给一万份病历按姓氏排序。
- **NP（非确定性多项式时间）**：注意它**不是** “Not P” 的缩写，而是指容易“核对答案”的题。

  

放到医院里，画面感立刻就出来了：要给几十个科室的医生排出一份同时满足轮休、年资搭配、连续夜班上限和请假需求的完美排班表，或者预测一条氨基酸长链如何折叠成能量最低的蛋白质三维结构，从头算出来是天文数字般的煎熬；可如果别人把成品摆在你面前，让你核对有没有违规、验算构象稳不稳定，几秒钟就够了。

  

更神奇的是 **NP-complete（NP 完全问题）** 的“多米诺骨牌效应”——无论是医院排班、超大数独还是旅行商路线规划，数学底层都能互相快速转化。只要给其中任意一道找到快速通用解法，整排骨牌就会瞬间倒下，P=NP 立刻得证。

  

为了让我直观感受“多项式”和“指数”之间的算力绝壁，Gemini 帮我算了一笔账：在一台每秒运算 10 亿次的现代处理器上，当问题规模 n 只有 20 时，P 类算法和 2^n 暴力搜索都是一瞬间；可只要把 n 拉到 90，P 类算法依然只需要 **8 微秒**，而暴力搜索已经飙到了 **392 亿年**——接近宇宙诞生至今的三倍时间。

  

正因如此，绝大多数科学家坚信
<span class="hz-math" data-tex="P \neq NP"></span>
。因为如果 P=NP 真的成立且解法高效，新药分子筛选、蛋白质折叠、甚至数学证明本身都会迎来全面自动化；但与此同时，靠“加密容易、暴力反推极难”撑起来的网银、HTTPS 和电子病历加密底座，也会在理论上瞬间清零。

  

---

  

## 四、真正让我脊背发凉的最后一问：当“安全气囊”开始变薄

  

聊到 P=NP 会摧毁现代密码学时，我突然冒出一个挺较真的念头，顺手追问了 Gemini：

  

> “如果一个命题能够被证明，说明这条规律本来就在客观世界里恒久生效。那为什么证明它就会‘瞬间改变一切’？难道过去五十年，就没人试着往 P=NP 的方向走过吗？”

  

Gemini 给了一个非常经典、也非常温和的回答。

  

它先肯定了我的第一层直觉：规律确实一直客观存在，但**“规律存在”不等于“手里有药”**——青霉菌杀菌的生化规律在地球上生效了几亿年，但在 1928 年弗莱明发现它、人类摸索出提纯与量产工艺之前，细菌感染依然是绝症。前人从 1970 年代起围攻了半个世纪，正面强攻全撞了铁板（虽然工程师在现实里早就用启发式算法和现代 SAT 求解器绕过了最坏情况）。

  

接着，Gemini 搬出了计算机科学界最经典的两道“安全垫”：即便明天真证明了 P=NP，现实世界也可能纹丝不动——

  

1. **非构造性证明**：只证明“太平洋海底沉着一艘装满黄金的船”，压根不给经纬度坐标；
2. **银河系算法（Galactic Algorithm）**：就算给出了具体算法，万一复杂度是 10^{100} \times n^{1000} 呢？在数学渐近意义上它算多项式时间，但在现实规模下比暴力搜索慢无数倍——就像在培养皿里发现了 100% 杀灭癌细胞的靶点，换算到人体却要一次吃下 50 吨药，机理成立，临床毫无用处。

  

听完这段话，我盯着屏幕沉默了好一会儿。

  

**如果时间停在 2023、2024 甚至 2025 年，我会毫不犹豫地点头赞同。** 那时候我完全相信，从理论发现到真正写出能攻破现实系统的工程代码，人类手里还握着几十年的缓冲期慢慢消化。

  

但把日历翻到 2026 年 11 月，我实在没法再这么乐观了。我直接把自己的怀疑甩回了对话框。

  

从今年 4 月以来，大模型的进化速度已经完全脱离了过去的体感：

  

- **AI 跨过了“自主挖漏洞与压缩算法”的门槛**：4 月初 Anthropic 公布 Claude Mythos Preview 并启动 Project Glasswing，首次因为网络安全风险限制前沿模型公开发布，相关评估显示它能在极短时间内于主流软件中自主挖掘出上万个高危漏洞（参考 [Ethiack 分析](https://ethiack.com/info-hub/resources/mythos-ai-security-implications-complete-guide)）。在具备超强代码推理和形式化验证能力的 Agent 面前，只要理论上存在降维空间，成千上万个 AI 实例 7×24 小时自动改写与验证，“银河系算法”从理论压缩到工程可用的时间，可能不再是几十年，而是几个月甚至几周。
- **迭代速度翻倍，开源紧咬不放**：前沿模型的发布周期从 2025 年平均 52 天一代，压缩到了今年的约 25 天一代（参考 [Visual Capitalist 统计](https://www.visualcapitalist.com/frontier-ai-model-race-anthropic-openai/)）；DeepSeek V4、GLM-5.1 等开源权重模型把与闭源旗舰的差距追到了个位数百分比，推理成本却只有几十分之一。
- **监管薄弱，商业竞速没有刹车**：全球既缺乏类似核不扩散条约的强制约束，大厂又深陷资本竞速——就在前天（11 月 19 日），Anthropic 完成了高达 813 亿美元的 IPO 上市（参考 [FutureSearch 跟踪](https://futuresearch.ai/anthropic-openai-ipo-dates-valuations/)），安全减速承诺正直接暴露在华尔街的业绩压力之下。更何况，攻破现实加密根本不用等到 P=NP 被证明，只要 AI 足够擅长在人类写的底层代码里翻窗找零日漏洞，防线就已经千疮百孔。

  

这一次，Gemini 没有再拿老派的乐观来安慰我，只回了一句很扎心的实话：

  

> 如果宇宙底层的真相真是 P \neq NP，那数学本身依然是绝对的硬墙；但过去我们以为人类手里握着**“数学 + 工程难度”双重保险**，放到 2026 年底，第二重保险已经大幅缩水了。未来的数字安全，大概率不再是“攻方造不出武器”的静态和平，而是一场 AI 攻防双方拼发现速度和修补速度的实时拉锯战。

  

---

  

## 尾声

  


  

老实说，作为一个普通医学生，黎曼的零点到底有没有排成一条直线，离我的日常生活其实很遥远。但今天这场拉着 Gemini 和 Grok 一唱一和拼凑出来的围观，却让我真切地感受到了一种时代层面的寒意。

  

过去几百年，人类社会之所以能在一次次科技剧变里跌跌撞撞地活下来，很大程度上靠的是基础理论和大规模应用之间那层厚厚的缓冲垫——从弗莱明发现青霉素到药物进医院药房，从质能方程到核电站落地，中间总有几十年的时间让我们去争论、立法、修补、适应。

  

而站在 2026 年 11 月 21 日回头看，最让人屏息的或许不是某道百年难题终究落了幕，而是这层保护了我们几百年的**安全气囊**，正在肉眼可见地变薄。

  

至于明年 1 月 22 日会不会真的发生什么——我已经不敢再像昨晚那样，笑着说一句“这肯定是段子”了。