---
name: video-prompt-narrative
description: Use BEFORE writing any prompt for Seedance 2.0 / Dreamina video generation. Translates emotional intent into the timeline-prompting protocol Seedance was trained to follow — bracketed [Xs] timestamps, 4-component beat blocks, closing style line, subject identity discipline, lip-sync syntax. Rigid; mandatory before every video generation. Skip and you ship 匀速无情绪 AI 默认产物.
type: capability
priority: rigid
sources:
  - https://www.mindstudio.ai/blog/timeline-prompting-seedance-2-cinematic-ai-video
  - https://docs.byteplus.com/en/docs/ModelArk/2222480
  - https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts
---

# Video Prompt — Narrative Layer (Seedance 2.0 / Dreamina 协议)

`dreamina-mastery.md` 是**工具书**——命令矩阵 / 模型选型 / 运镜词汇。这份是**创作书**——把情感意图翻成 Seedance 2.0 训练时**就期待的语法**。

> 本文档协议直接对齐 ByteDance / Dreamina 官方推荐 + 业界 2000+ 高赞 prompt 集（见 sources）的实证范式。**不是普适视频 prompt 工程**——Sora 2 / Veo 3 / Kling 期待的语法跟 Seedance 不同（详见 `model-paradigms.md`）。

---

## 0. 第一原则

每个 prompt 必须能回答 3 个问题：

1. **观众这 N 秒之内想感受到什么？**（一个词：好奇 / 紧迫 / 敬畏 / 温暖 / 心痛 / 荒诞…）
2. **如果删掉镜头运动，这个画面还成立吗？** 成立 = 运动是装饰；不成立 = 运动承载情感。
3. **第 1 帧和最后 1 帧能各自被 freeze 当独立画面欣赏吗？**

任意一题答不上，回 `taste/` 重想，**不要写 prompt**。

---

## 1. Timeline Prompting — Seedance 2.0 的训练范式

### 1.1 核心格式

**用 `[Xs]` 方括号显式标 timestamp**——不是"0-1s"或"开场"或"接着"。Seedance 2.0 训练时见的就是这种格式。

```
[0s] — Establish the scene
[Xs] — First camera move or subject action
[Ys] — Second beat or emotional shift
[Zs] — Hold or exit movement
[Closing line — 全片风格定调]
```

### 1.2 Beat count 公式（必须遵守）

| Clip 时长 | Beat 数量 | 间隔示例 |
|---|---|---|
| 5s | 2-3 beats | `[0s] [2s] [4s]` |
| 8s | 3-4 beats | `[0s] [3s] [5s] [7s]` |
| 10s | 3-4 beats | `[0s] [3s] [6s] [8s]` |
| 15s | 4-5 beats | `[0s] [3s] [7s] [10s] [13s]` |

**违反公式的代价**：beat 太多 = 模型在多事件间漂移、糊；beat 太少 = 输出感觉静态、无叙事。

### 1.3 每个 Beat 必须含 4 component

```
[Xs] [Shot Type]: [Subject + action]. Camera [Movement]. [Mood/Lighting].
```

| Component | 必填值 | 反例 |
|---|---|---|
| **Timestamp** | `[3s]` | "接着" |
| **Shot Type** | `Wide shot / Medium shot / Close-up / Over-the-shoulder / Extreme close-up` | "镜头" |
| **Camera Movement** | `Slow dolly in / Pan left / Tracking shot / Rack focus / Static` | "镜头动一下" |
| **Mood / Lighting** | "Cold blue tones, low-key lighting" / "Warm golden hour" | "好看的光" |

**铁律**：一个 beat **只许有 1 个主导动作 + 1 个相机指令**。两个动作叠加 = 模型分不清优先级，输出糊。

### 1.4 Closing Style Line（必须最后一行）

不写 closing line，Seedance 默认值会接管，输出感觉"AI 模板感"。**永远**用一行总体定调收尾：

```
Cinematic 4K, [film grain spec], [color grade], [overall mood], 
shot on [camera model], [lens character].
```

具体值参考 `keyword-library.md` 的"惊艳关键词"小节。

---

## 2. Subject Identity Discipline（主体身份纪律）

**所有 beat 用同一个名词指代同一个人物。**

❌ 反例（模型会生成不同人脸）：
```
[0s] A man enters the alley.
[3s] The detective looks back.
[5s] He pulls out a cigarette.
```

✅ 正例：
```
[0s] A man in a navy coat enters the alley.
[3s] The man in the navy coat looks back.
[5s] The man in the navy coat pulls out a cigarette.
```

**为什么**：Seedance 2.0 在 prompt 解析上把每次出现的名词当**独立 entity**重新生成；用 "the detective / he / 他" 切换 = 模型可能给你三个不同长相的人。

> **唯一例外**：第一次出现时定义 anchor noun（"a man in a navy coat, 30s, thin face"），之后都缩写到 anchor noun（"the man in the navy coat"），不要换 hyponym（"the detective"）也不要换代词（"he"）。

---

## 3. Camera Model Naming（**真改输出**）

Seedance 2.0 训练数据里学过具体相机的视觉特征——**点名相机会真的把输出推向那个美学**。

| 用途 | 推荐相机/镜头 prompt 表达 |
|---|---|
| 高级电影感 | `shot on ARRI Alexa Mini, anamorphic lens, 35mm` |
| 数码电影 | `shot on Sony Venice, prime lens, shallow DOF` |
| 胶片质感 | `shot on 16mm film, fine grain, halation` |
| 时尚/美食 | `shot on Hasselblad medium format, 80mm lens` |
| 纪录片 | `shot on Canon C70, handheld, natural light` |
| Vlog / UGC | `iPhone 15 Pro 4K, slight noise, natural color` |
| 复古 | `Bolex 16mm, faded, dust artifacts, lo-fi` |

**配套 lens character**（**真改输出**）：

- `Black Pro-Mist 1/4` — 高光柔晕（Veo 3 例同款）
- `anamorphic flare` — 电影宽银幕光斑
- `tilt-shift` — 微缩景观感
- `petzval lens` — 古典漩涡 bokeh
- `f/1.4 shallow DOF` — 极浅景深

---

## 4. 运动-情感映射（写运镜前必查）

每种镜头运动**默认携带情感色彩**。选错了，运动跟意图打架。

| 情感意图 | 推荐运动 | Camera 字段 prompt | 反向警告 |
|---|---|---|---|
| **好奇 / 揭示** | 缓推 + 定帧 | `slow dolly in, ending on static frame` | ❌ 环绕 = 猎奇感 |
| **紧迫 / 危险** | 快推 + 手持 | `quick handheld push-in with subtle shake` | ❌ 丝滑跟随 = 泄气 |
| **敬畏 / 宏大** | 升镜 + 拉远 | `low-angle tilt up, then crane back` | ❌ 近景特写 = 破坏比例 |
| **温暖 / 平静** | 横移 + 静止 | `slow lateral pan, ending static` | ❌ 剧烈推拉 = 破坏 anchor |
| **心痛 / 失去** | 缓拉 + 定帧 | `slow dolly out from close-up` | ❌ 环绕 = 变讽刺 |
| **荒诞 / 反差** | 突变切 | `hard cut from angle A to angle B` | ❌ 丝滑过渡 = 平掉笑点 |
| **沉浸 / 主观** | 第一视角手持 | `first-person handheld, occasional limbs in foreground` | ❌ 第三跟随 = 失带入 |
| **悬念 / 停滞** | 静止 + 局部动作 | `locked camera, only subject's hand moves` | ❌ 任何 camera 关键词 = 一加就泄 |

**铁律**：一段 prompt 里**只许有一个主导运动**。要双段运动 → 拆成两个 clip，剪辑接。

---

## 5. Lip-Sync 协议（Seedance 2.0 原生支持）

Seedance 2.0 支持原生 lip-sync——**对话用引号 + 前置情绪标注**。

### 5.1 基础语法

```
[5s] Medium close-up: The woman in the red dress softly whispers, 
"Just looking at you." Her lips move precisely. 
Warm key light from window-left.
```

### 5.2 必备元素

| 元素 | 示例 | 为什么 |
|---|---|---|
| 情绪/语调 | `softly whispers / sternly says / nervously stammers` | 不写 = 模型用平淡语调，画面情绪对不上 |
| 引号包裹台词 | `"Just looking at you."` | 引号是 Seedance 识别 lip-sync 区域的语法标记 |
| 短句 | ≤ 8 词 | 长台词 lip-sync 漂移；分多个 beat |
| 一句话一个说话人 | 每 beat 只 1 人开口 | 多人同时说 = 全糊 |

### 5.3 多人对话拆 beat

❌ 反例：
```
[3s] A says "Where were you?" B replies "At the bar."
```

✅ 正例：
```
[3s] Close-up on A. A sternly asks, "Where were you?"
[5s] Cut to B. B nervously replies, "At the bar."
```

### 5.4 音频干净要求

- 上传 audio ref 时：**clean, dry, non-overlapping**——避免重混响（reverb 会让 lip-sync 漂移）
- audio clip ≤ 15s
- 想要原生生成的对话音频 = 直接放台词；想要导入音频 = 后期混音（lip-sync 不一定准）

---

## 6. Negative Guidance（反向引导，**有效**）

Seedance 2.0 接受反向 phrase——告诉它**不要什么**。

### 6.1 常用 negative

| 用途 | Phrase |
|---|---|
| 防变形 | `no distortion, no stretching, no warping` |
| 防低分辨率 | `no grain, no blur, no compression artifacts`（除非你要 grain） |
| 防风格漂移 | `no cartoon, no anime, no 3D render`（要写实时） |
| 防文本溢出 | `no subtitles, no text overlays, no watermarks` |
| 防年代错位 | `no historical drama feel, no period costume` |
| 防解剖错误 | `no extra fingers, no malformed hands, no fused limbs` |

### 6.2 写法

末尾另起一行：
```
Negative: no distortion, no extra fingers, no subtitles, no text overlays.
```

---

## 7. 完整 Prompt 模板（直接套用）

```
[0s] [Shot type]: [Subject + initial pose]. Camera is [position]. 
[Lighting/mood detail].

[Xs] [Movement instruction]. Camera [specific technique]. 
[Subject action — same noun as [0s]].

[Ys] [New focal point]. [Atmospheric / emotional shift].

[Zs] [Final hold or exit movement]. [Mood resolution].

Cinematic 4K, [film grain spec], [color grade — e.g. desaturated cold blue / 
warm amber / Morandi muted], [overall mood], 
shot on [ARRI Alexa / Sony Venice / Hasselblad / iPhone Pro], 
[lens character — Black Pro-Mist 1/4 / anamorphic flare / shallow DOF].

Negative: no distortion, no extra fingers, no subtitles, no text overlays.
```

---

## 8. 完整可运行示例（套上面模板）

### 8.1 温暖怀旧 · 咖啡馆女生（情感叙事钩子）

```
[0s] Medium shot: A young Asian woman in her late twenties sits alone 
at a coffee shop window seat, head down reading a leather-bound notebook, 
left hand cupping her cheek. Camera is static. Warm tungsten interior 
key light, color temp 3200K.

[2s] The young Asian woman in her late twenties stays still — only 
blurred silhouettes of pedestrians drift across the rain-wet window 
behind her.

[5s] The young Asian woman in her late twenties looks up toward the 
window, eyes drifting to a far point. Her lip corners lift faintly.

[7s] The young Asian woman in her late twenties closes the notebook, 
hugs it to her chest, leans back into the chair.

[8s] Camera slowly pulls back, ending on her at right-third golden 
ratio position.

Cinematic 8s clip, fine 35mm grain, Morandi muted warm-grey palette, 
nostalgic and contemplative mood, shot on Hasselblad medium format, 
Black Pro-Mist 1/4 softening highlights. Shallow DOF f/2.0.

Negative: no distortion, no extra fingers, no subtitles, no text overlays, 
no cartoon, no anime.
```

### 8.2 紧迫 · 地下停车场奔跑（高能量动作）

```
[0s] Wide shot: A man in a black trench coat sprints into frame from 
the lower-left corner, backlit silhouette against fluorescent ceiling 
tubes. Camera is handheld, third-person tracking from behind, slight 
shake.

[2s] The man in the black trench coat runs deeper into the underground 
parking garage, camera maintains distance, framing him 1/3 of the frame.

[4s] Camera accelerates, closing in. Cuts from rear to 3/4 side profile 
showing the man in the black trench coat's panting breath.

[6s] The man in the black trench coat suddenly turns his head back 
without slowing, eyes wide and alert.

[7s] Camera abruptly stops as if dropped, the man in the black trench 
coat sprints out of frame to the right.

Cinematic 7s clip, fine grain visible, color graded teal-and-orange 
(cyan ceiling cast, amber skin), tense and breathless mood, 
shot on Sony Venice handheld, anamorphic lens flare from ceiling tubes.

Negative: no distortion, no smooth tripod feel, no extra fingers, 
no subtitles, no slow motion.
```

### 8.3 荒诞反差 · 跳舞猫（喜剧荒诞）

```
[0s] Low-angle close-up: A British shorthair silver tabby cat stands 
on hardwood floor, facing the camera, perfectly still. Camera is locked, 
ground level. Soft top-down studio light, clean white seamless background.

[2s] The British shorthair silver tabby cat suddenly begins alternating 
its hind legs in a small, rhythmic tap-dance pattern.

[4s] The British shorthair silver tabby cat speeds up the rhythm. Its 
front paws sway left and right in sync.

[6s] The British shorthair silver tabby cat performs a quick spin.

[7s] The British shorthair silver tabby cat freezes, snaps its head 
toward the lens, pupils dilate. Frame holds.

8s clip, sharp focus, clean cool-tone palette, absurd and deadpan mood, 
shot on ARRI Alexa Mini, 50mm prime, f/2.8.

Negative: no distortion, no costume, no music visualizer overlays, 
no text, no historical drama feel.
```

### 8.4 满足感 · 时间流逝枯墙绽放（满足感转化）

```
[0s] Medium shot: A barren grey concrete wall in an urban alley, 
crumbling at the edges. Camera is static, eye-level, framed dead-center. 
Cool overcast diffuse light.

[2s] Warm sunlight breaks through clouds and hits the wall's center. 
The grey concrete wall begins sprouting green moss outward in 
time-lapse acceleration.

[4s] Vines and ivy unfurl across the grey concrete wall surface, 
reaching the edges.

[6s] Wildflowers bloom across the entire surface — vibrant yellow, 
pink, white, purple — in rapid time-lapse.

[8s] Camera slowly pulls back, revealing the entire vertical garden. 
A single bee enters frame.

Time-lapse 8s clip, sharp focus, dramatic color shift from desaturated 
grey to fully saturated bloom, solarpunk aesthetic, awe-inspiring 
satisfying mood, shot on RED Komodo with macro lens, no grain.

Negative: no jump cuts, no flickering, no distortion, no text, 
no people in frame.
```

### 8.5 对话 · 警察审橡皮鸭（喜剧荒诞 + lip-sync）

```
[0s] Medium close-up: A grizzled detective in a brown trench coat sits 
across a metal interrogation table from a small yellow rubber duck. 
Camera is static, eye-level on the detective. Hard top-down film noir 
key light, deep shadows.

[3s] The grizzled detective in the brown trench coat sternly asks, 
"Where were you on the night of the bubble bath?" His face leans 
forward into the light.

[5s] Cut to extreme close-up of the small yellow rubber duck. It 
emits a single nervous squeak.

[7s] Cut back. The grizzled detective in the brown trench coat 
slams his notepad shut. Frame holds on his deadpan stare.

8s clip, fine grain, high-contrast film noir black and white with 
warm amber accent on key light, deadpan absurd mood, shot on ARRI 
Alexa Mini, 50mm prime.

Negative: no distortion, no extra fingers, no subtitles, no music 
overlay, no soft lighting.
```

---

## 9. 跑生成前的 5 问拷打

写完 prompt 跑 dreamina 之前，逐条核对：

1. ☐ 每个 beat 都用 `[Xs]` 方括号开头吗？
2. ☐ 每个 beat 都含 timestamp + shot type + camera + mood **4 个 component**吗？
3. ☐ 全程 subject **同一个名词**（不要换 detective/he/他）吗？
4. ☐ 末尾有 closing style line（cinematic / film grain / color grade / camera / lens）吗？
5. ☐ 末尾有 `Negative: ...` 反向引导吗？
6. ☐ Beat 数量符合 `5s=2-3 / 8s=3-4 / 10s=3-4 / 15s=4-5` 公式吗？
7. ☐ 一个 beat 内**只有一个**主导动作 + 一个相机指令吗？
8. ☐ 运动-情感映射对得上意图吗？（参 §4 表）
9. ☐ 如果有对话，引号 + 情绪前置标注齐了吗？

任何一项答 No → **回去改 prompt**。生成 1 次 1-3 分钟，prompt 改 1 次几秒。**永远先打磨 prompt，不要赌运气。**

---

## 10. Failure Mode → Fix 速查

| 失败模式 | 输出表现 | 修法 |
|---|---|---|
| Timestamp 用自然语言 | 模型当成段落理解，时间序列丢失 | 全部换 `[Xs]` |
| Beat 太挤（5s 塞 5 个 event） | 输出糊 / 跳过 event | 减到 2-3 beat |
| Beat 之间换主体名词 | 多个不同人脸 | 统一 anchor noun，全程不换 |
| 没有 closing style line | 输出 AI 默认值感 | 加 cinematic + camera + grade |
| 一个 beat 两个 camera 指令 | 模型摇摆 | 拆成两个 beat |
| 运动跟情感打架（"温暖" + "环绕"） | 输出违和 | 查 §4 映射表 |
| 对话不加情绪标注 | 平淡语调 | 前置 softly whispers / sternly says |
| 长台词（超 8 词） | lip-sync 漂移 | 拆多 beat 短句 |
| 通篇 negative 都不写 | 画面元素失控 | 至少加 `no distortion, no extra fingers, no subtitles` |

---

## See also

- `taste/02-visual-grammar.md` — 镜头语法的情感映射（道）
- `taste/03-rhythm-and-editing.md` — 节奏决策
- `dreamina-mastery.md` — Dreamina CLI 命令矩阵 + 模型选型（工具书）
- `reference-directives.md` — 多 ref 编排式 prompt（@image1 / role 词汇）
- `viral-archetypes.md` — 4 大 viral 原型 + 真实 prompt 范本库
- `keyword-library.md` — 惊艳关键词分类索引（subsurface scattering / halation 等）
- `model-paradigms.md` — Sora 2 / Veo 3 / Kling 3 / Seedance 2 的范式分化
- `frame-gacha.md` — 重要 clip 多生候选机制
