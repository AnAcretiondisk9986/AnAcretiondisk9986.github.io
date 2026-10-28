---
title: "把「改提示词」做成可执行闭环：MOSS-Image × ComfyUI × DSH 的工程实践"
description: PNG 元数据当执行快照还原现场、开关值算出实际分支、切断一个链接就跳过 GLM——用 prompt_loop / push_prompt 两个脚本把「看一眼图、改一句话、跑出新图」做成 Agent 能自己转的闭环，单张 50 秒。
pubDate: "2026-10-28"
dayIndex: 1
tags:
  - 技术
  - ComfyUI
  - 提示词工程
  - 图像生成
  - DSH
draft: false
access: public
---

> 一句话：让 Agent 看完图、改完词，自己把任务推进 ComfyUI 跑出来，50 秒后拿新图回来对照——中间不需要人粘贴、不需要点「运行」、不会把参数改飘。

---

## TL;DR

| 项      | 结论                                                                                   |
| ------ | ------------------------------------------------------------------------------------ |
| 痛点     | 提示词迭代的最大成本不是「想词」，是**搬运**：改一句 → 找到输入框 → 粘贴 → 点运行 → 等 → 再对照                            |
| 关键发现 1 | ComfyUI 的 `SaveImage` 把**完整 API 图和画布图**写进 PNG 的 `tEXt`，是天然的执行快照，不受 `/history` 重启丢失影响 |
| 关键发现 2 | `ComfySwitchNode` 的布尔值可以从 API 图里算出来，因此能还原「这次到底走了反推还是手写」                              |
| 关键发现 3 | 把 `CLIPTextEncode.text` 从「链接」换成字面量，上游整条 LLM 链就失去下游 → **不触发 GLM/DeepSeek、不烧 token**   |
| 结果     | 一轮「意见 → 新图」≈ 50–56 秒，seed 与全部参数不变，画布工作流零改动                                           |
| 底座     | `dsh-purge` 提供的是**连续执行能力**（少一些确认往返），不是提示词能力                                          |

---

## 1. 问题：提示词迭代卡在哪

MOSS-Image 的提示词不是一个字符串，而是一份**布局 JSON**：

```json
{"summary":{"meta":["illustration"],"canvas":"single","caption":"..."},
 "items":[{"label":"character","caption":"...","bbox":[-994,-675,1104,748]}],
 "bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}
```

这意味着每次改词都要同时满足：`bbox` 数值合法、字段顺序不变、`caption` 词数在区间内、格式约束不被破坏。人工改一轮要两三分钟，改错一个括号就要重跑。

更麻烦的是**反馈回路**：改完要手动粘、手动点运行、等一分钟、看图、再判断。一个晚上能迭代的轮次被搬运成本吃掉大半。

所以真正的工程目标不是「让模型写更好的提示词」，而是：

> **让人只说一句人话，剩下的动作由机器串起来，并且保证除了提示词以外什么都没变。**

---

## 2. 架构：四层，各管一件事

![四层架构](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/01-architecture_1793199295172.webp)

| 层   | 角色      | 只负责                                         |
| --- | ------- | ------------------------------------------- |
| L4  | 人       | 审美判断。给一句「表情太惊讶」「发色不对」「头要被遮住一半」              |
| L3  | Agent   | 读图、诊断、改词。保持 bbox 与格式约束                      |
| L2  | 两个脚本    | `prompt_loop.py` 还原现场；`push_prompt.py` 提交执行 |
| L1  | ComfyUI | 采样、出图、把 prompt 写进 PNG                       |

层与层之间只有两种通道：**文件**（PNG / JSON）和 **HTTP**（`/prompt`、`/history`）。没有隐藏状态，每一步都能被外部检查。

---

## 3. 工具栈与分工

### 3.1 DSH + dsh-purge：把「执行摩擦」降下来

DeepSeek Harness（DSH）是会话宿主。它的默认行为是「每一步都确认」——写文件确认、跑命令确认、改配置确认。对聊天没问题，对「一晚上迭代十几版」是灾难。

`dsh-purge` 解决的就是这一层：宿主补丁 + 提示词注入 + 状态自检 + 本机备份回滚，让 Agent 能连续执行任务而不反复停下来问。详见 [第 10 节](#10-dsh-purge-在这套体系里到底做了什么)。

**关键认知**：它不提升提示词质量，也不生成图片。它是「让闭环能连续转起来」的润滑层。

### 3.2 ComfyUI + MOSS 工作流：生成端

实测环境：

| 项     | 值                                                                    |
| ----- | -------------------------------------------------------------------- |
| 宿主    | ComfyUI-aki-v3.2（Python 3.13.11）                                     |
| 主模型   | `moss_image_base_int8_convrot`                                       |
| LoRA  | 5 个串联（SFT 4-steps / hires / umina style / chenbin blush / extracted） |
| 采样    | 6 步 · CFG 2 · euler + simple                                         |
| 文本编码器 | `qwen3.5_9b_int8_convrot`（type=`moss_image`）                         |
| 画布    | 3:4 · 3.5MP → 1664×2208，2× 放大到 3328×4416                             |

### 3.3 两个脚本：闭环的两条腿

```text
tools/prompt_loop.py   ← 现场还原（只读）
tools/push_prompt.py   ← 提交执行（只写这一次的提交，不动工作流文件）
```

### 3.4 Danbooru 中文词典：装了，但故意没接

`ComfyUI-Danbooru-Tags-ZH`（10 万条标签、中文译名、别名、图数）确实装上了，跑得也很好：加载 0.83 秒、查询 0.0005 毫秒、纯离线。**但它没有接进 MOSS-1 / MOSS-2 / Krea2-1 的主链路**，原因很实在：

- MOSS 消费的是**自然语言布局 JSON**，系统提示词里明确禁止 tag 堆砌。塞词表会诱导线上模型把标签抄进 `caption`。
- Krea2-1 的规则第 1 条就是 `Never output tags`，词表是负资产。

所以它的定位是**人查词的工具**（「银发」到底该写 `grey_hair` 还是 `white_hair`），不是工作流组件。这是一个「数据驱动地否掉一个功能」的案例——装了不等于该接。

---

## 4. 关键发现一：PNG 就是执行快照

ComfyUI 的 `SaveImage` / `SaveImageAdvanced` 会把两份 JSON 写进 PNG 的文本块：

```
keys: ['prompt', 'workflow']
prompt   -> 13399 bytes   # API 格式：节点 id → class_type + inputs
workflow -> 47456 bytes   # 画布格式：节点、连线、坐标
```

验证方式（标准库即可，不需要任何依赖）：

```python
def read_png_text(path):
    data = open(path, "rb").read()
    out, i = {}, 8
    while i + 8 <= len(data):
        ln = struct.unpack(">I", data[i:i+4])[0]
        typ = data[i+4:i+8]
        body = data[i+8:i+8+ln]
        if typ == b"tEXt":
            k, v = body.split(b"\x00", 1)
            out[k.decode("latin-1")] = v.decode("utf-8", "replace")
        elif typ == b"zTXt":
            k, rest = body.split(b"\x00", 1)
            out[k.decode("latin-1")] = zlib.decompress(rest[1:]).decode("utf-8")
        i += 12 + ln
        if typ == b"IEND":
            break
    return out
```

**这条发现的价值**：`/history` 只存在内存里，ComfyUI 一重启就清空（我就踩到了：图是 21:37 生成，进程 21:41 重启，历史直接归零）。而 PNG 里的元数据**永久有效**——三个月前的图也能把当时的提示词、模型栈、采样参数完整读回来。

---

## 5. 关键发现二：开关值可以算出来

MOSS 的工作流用 `ComfySwitchNode` 做分支：反推 / 手写、DeepSeek / GLM、线上 / 端侧、是否启用规范化。所以一张图对应的提示词**有 2⁴ = 16 种可能**，光看候选列表没有意义。

但开关的值本身就在 API 图里——`PrimitiveBoolean.inputs.value`。于是可以沿链路走，遇到 `ComfySwitchNode` 就读它的 `switch` 输入，决定只走 `on_true` 还是 `on_false`：

```python
if ct in SWITCH_TYPES:
    flag = bool_value(api, inputs.get("switch"))   # 可能是 bool，也可能链接到 PrimitiveBoolean
    branch = "on_true" if flag else "on_false"
    walk(api, inputs.get(branch), depth+1, ...)
```

还原结果长这样（真实的 `t2i-2xprcs_00093.png`）：

```text
[36] 正向提示词 · text ← 运行时生成
  [28] 提示词来源选择 · 开关 = True → 走 on_true
    [46] 线上模型：DeepSeek / GLM · 开关 = True → 走 on_true
      [45] 反推 · 线上 GLM 5.3 Flash · 运行时调用 glm-5.3-flashx
        [14] 反推系统提示词 · JSON 布局
        [15] 画幅指令（随出图尺寸）
```

一眼就能看出：**这次是 GLM 反推**，不是 DeepSeek，也不是手写。而如果只看工作流文件，你会以为默认是 DeepSeek。

![提示词链路](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/03-chain_1793199312874.webp)

> 注：文字模型在运行时才产出最终提示词，所以 PNG 里只有**输入**（系统提示词 + 手写内容）。最终成品的来源有两个：界面上的「当前提示词预览」，或者没重启时的 `/history` 里 `PreviewAny` 节点的输出。我把这条限制写进了工具的输出里，不假装能拿到。

---

## 6. 关键发现三：切断一处就能跳过 LLM

这是整套方案里最省事的一步。

`CLIPTextEncode.text` 在 API 图里是一个**链接**：`["28", 0]`。把它改成字符串：

```python
cnode["inputs"]["text"] = new_prompt_text
```

原链接失效，上游的 `ComfySwitchNode → MOSS_Online_Chat → GLM` 整条链**没有任何下游节点**。ComfyUI 只执行输出节点依赖的节点，于是：

- 不触发 GLM / DeepSeek API
- 不消耗 token、不等待网络
- 不改动画布上的工作流文件
- 所有模型、LoRA 权重、seed、分辨率、放大链保持原样

也就是说：**这一次提交里，唯一的变量就是提示词本身。** 这才让「第 3 版和第 7 版的差异」有解释力。

---

## 7. 闭环实现

![执行链路](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/02-loop_1793199305279.webp)

### 7.1 `prompt_loop.py`：现场还原

```text
python tools\prompt_loop.py                       # output 下最新一张
python tools\prompt_loop.py <png>                 # 指定图
python tools\prompt_loop.py <png> --json          # 给程序用
```

输出：采样参数、模型栈（含每个 LoRA 的权重）、开关状态、**本次实际生效的提示词链路**、负向是否被 `ConditioningZeroOut` 清零、`/history` 命中情况。

两个细节值得说：

1. **API key 脱敏**。第一版实现里 `MOSS_Online_Chat.api_key` 被当成普通字符串打印了出来，立刻改成遇到 `[0-9a-f]{16,}\.[A-Za-z0-9]{8,}` 就替换成 `<已隐藏的密钥>`。
2. **只走文本字段**。早期版本把 `model_name`、`aspect_ratio`、`lanczos` 全当文本收集，输出 30 多条噪声；改成按节点类型白名单 + 显式字段名后，输出稳定在 6–10 条。

### 7.2 `push_prompt.py`：提交执行

```text
python tools\push_prompt.py --prompt-file p.json            # 跑
python tools\push_prompt.py --prompt-file p.json --dry-run  # 只看会改什么
python tools\push_prompt.py --prompt-file p.json --seed 123 # 换种子
```

核心流程：

```python
graph = latest_history_graph() or read_png_prompt(latest_png())   # 拿基准
cid, cnode = bfs_cliptext(graph, sampler["inputs"]["positive"])   # 找到正向编码
cnode["inputs"]["text"] = new_text                                # 只改这一处
pid = api_post("/prompt", {"prompt": graph, "client_id": ...})    # 提交
while True:                                                       # 轮询
    h = api_get("/history/" + pid)
    if pid in h:
        break
```

单张耗时实测：**48.7 / 49.3 / 54.7 / 56.1 秒**（6 步采样 + 2× 放大，3.5MP）。

---

## 8. 实战：七版迭代

![四版对比](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/04-iterations_1793199319613.webp)

同一 seed、同一套参数，只改提示词。记录如下：

| 版本  | 改动               | 结果                             | 判断                             |
| --- | ---------------- | ------------------------------ | ------------------------------ |
| v0  | 原提示词             | 表情夸张（大张嘴 + 双汗滴 + 问号）、棕发没嗅、发色灰白 | 触发需求                           |
| v1  | 去问号、表情降级、加嗅、改发色  | 发色**过冲**成金橙                    | `golden undertone` 的锅          |
| v2  | 去掉 golden、加强埋头   | 表情**过平**（发呆）、头顶被裁              | `calm` 与 `mildly puzzled` 叠加导致 |
| v3  | 表情回一档            | 三处都接近参考图                       | 可用                             |
| v4  | 眼睛改正常、手绕前面、头压低   | 眼睛正常了，但只遮到嘴；背景渗出米色块            | 遮挡不足 + 白底约束丢失                  |
| v5  | 强化白底 + 头再低       | 白底干净、手在肩带                      | 遮挡仍差口气                         |
| v6  | 发丝盖住下半脸          | **遮挡最好**，但手漂到肩上                | 改 caption 会连带漂移手部              |
| v7  | 融合 v5 的手 + v6 的头 | **四条全中**                       | 定稿候选                           |

这七版本身就是结论：**提示词里的形容词是「连续量」，一次只能推一档。** 推到第 3 档就过冲，退回第 2 档才对。

---

## 9. 词 → 效果映射（踩坑表）

这些不是推测，是逐版对照图得出的：

| 写法                                                                         | 实际画面             | 正确做法                                                          |
| -------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `eyes closed` / `half closed` 表达「埋头嗅」                                      | 眼睛被画成**细长眯眼**    | 埋头靠「头部下沉 + 发丝盖住下半脸」，闭眼是错误信号                                   |
| `head sunk down behind X's head` + `strands falling across her lower face` | 下半脸被头发遮住、只露眼和额   | 要让一个头被遮，写「头发盖脸」比调 bbox 有效                                     |
| `golden undertone`                                                         | 浅棕直接变**金橙**      | 暖度一次只加一档，`warm muted beige-brown` 是安全区                        |
| `puzzled` / `confused`                                                     | 模型会**自己补一个问号涂鸦** | 要干净就写 `calm`                                                  |
| 把手塞进「从背后抱住」                                                                | 手落到肩膀或腰上         | 手要单独写：`hand flat on her chest, fingers hooked over the strap` |
| 漏掉 `clean plain white background`                                          | 背景渗出米色/木色块       | 白底必须显式写，并加 `generous empty white space`                       |
| `short hair`                                                               | 画成短波波头           | 及肩用 `shoulder-length`                                         |

---

## 10. dsh-purge 在这套体系里到底做了什么

前九节讲的全是「提示词怎么改」。但如果没有 dsh-purge，这套东西根本跑不起来——不是因为能力不够，而是因为**每一步都会被确认打断**。

### 10.1 它是什么

| 项   | 值                                                                             |
| --- | ----------------------------------------------------------------------------- |
| 包名  | `dsh-purge-community`                                                         |
| 版本  | 1.6.60（本地 `installed-rev: apply:1.6.60`）                                      |
| 定位  | 跑在你自己机器上的 DSH 附加组件；社区俗称「破甲」/「无限制模式」                                           |
| 作者  | 原作者 **小杨 / YuJunZhiXue**；社区版由 **kingcharleslzy-ai** 独立维护                      |
| 仓库  | [kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) |
| 许可  | MIT（保留原作者署名与版权）                                                               |
| 规模  | 80 条宿主补丁 · 25 层状态自检 · 左侧栏整页设置                                                 |
| 适配  | DSH Desktop 0.2.1-rc.1 / rc.2 / rc.3                                          |

### 10.2 它解决什么，不解决什么

它的四条设计原则写得很直白：

| 原则     | 含义                       |
| ------ | ------------------------ |
| 本机优先   | 全部逻辑在本机，不改云端账号、不上传提示词或配置 |
| 可见     | 每个动作都有状态与证据，不靠「应该生效了」判断  |
| 可回滚    | 应用/安装/回滚前自动快照，保留原文件与校验清单 |
| 不替你做决定 | 只减少摩擦，不改变你的目标            |

拆开看就是：

- **做**：把反复出现的确认与打断收敛成一次设置；提供状态自检（`selfcheck`）、锚点漂移诊断（`diagnose`）、动作审计（`audit`）、本机备份与回滚（`backup` / `rollback`）。
- **不做**：不改模型本身、不提升提示词质量、不生成图片、不联网、不修改代理或 npm 源。

在这一套体系里，它的位置非常具体：**它让「改完直接跑」这件事在工程上成立。** 没有它，一次迭代要经过「写入确认 → 执行确认 → 网络确认」，光确认就比 50 秒出图还长。

### 10.3 为什么值得单独写一段

因为它和「提示词工程」是两件正交的事，容易混为一谈：

```text
dsh-purge      → 降低交互摩擦（让循环能连续转）
prompt_loop    → 提供事实（这一版到底是什么参数、走了哪条链）
push_prompt    → 提供动作（把新词变成一张新图）
Agent          → 提供判断（哪一条达成了、哪一条过冲了）
```

四者缺一：少了 dsh-purge，循环会卡在确认；少了 prompt_loop，判断没有依据；少了 push_prompt，动作要人做；少了 Agent，没人能看懂「眼睛太细长」到底该改哪个词。

![四者分工](https://cdn.jsdelivr.net/gh/AnAcretiondisk9986/blog-images@main/image/05-division_1793199326929.webp)

---

## 11. 局限与下一步

**当前的局限**

1. **最终提示词不在 PNG 里**。模型运行时生成的内容存不下来，要么看界面预览，要么趁没重启读 `/history`。
2. **遮挡靠描述，不靠几何**。MOSS 的 bbox 控制占位，但「谁盖住谁」最终由模型决定，caption 只是强引导。
3. **改一处会漂另一处**。v6 修好遮挡，手就漂到肩上——这是同一份 caption 里的注意力竞争。
4. **没有自动评分**。判定「像不像参考图」目前靠人眼/Agent 目视，没有 CLIP score 之类的量化。

**可以往下做的**

- 用 `CLIP` 相似度做粗筛，把「明显跑偏」的版本自动丢掉，人只看前三
- 把每轮的提示词 diff 存成版本树，支持「回到第 3 版再改一处」
- 把「词 → 效果」映射沉淀成校验规则：出现 `golden` 就警告发色风险，出现 `eyes closed` 就警告眯眼
- 对 MOSS-2 的「人物快捷替换」接入词典，把中文角色名解析成 canon tag + 作品先验

---

## 12. 复现清单

```text
tools/prompt_loop.py                   现场还原（只读）
tools/push_prompt.py                   提交执行
ComfyUI/custom_nodes/ComfyUI-Danbooru-Tags-ZH/   10 万条标签词典（查询用，不接主链路）
.cache/prompt_loop/next_prompt_*.json  每版提示词留档
docs/blog/src/*.html                   本文插图源文件（Chrome headless 截图）
docs/blog/img/*.png                    渲染结果
```

```powershell
# 1. 看这一版到底是什么
python tools\prompt_loop.py ComfyUI\output\MOSS\t2i-2xprcs_00100.png

# 2. 改词、提交、等图
python tools\push_prompt.py --prompt-file .cache\prompt_loop\next_prompt_100.json

# 3. 看一眼出图，回到第 2 步
```

---

## 附：一句话总结

> 提示词迭代的效率瓶颈，从来不是「想不到好词」，而是**词与画面之间缺少一条可重复、可观测、只改一个变量的通道**。
> 
> 这条通道由四块拼起来：`dsh-purge` 让循环不断，`prompt_loop` 让事实清楚，`push_prompt` 让动作归机器，Agent 让人只需要保留审美判断。
