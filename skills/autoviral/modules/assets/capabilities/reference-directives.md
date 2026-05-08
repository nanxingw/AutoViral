---
name: reference-directives
description: Use when generating video with multiple reference images / videos / audio — e.g. "use the character from the first reference image to replace the actor in the reference video", "borrow the camera movement from this clip", "ground the scene in this environment image". Defines the OpenRouter `input_references` array protocol + role vocabulary + slot budget. Skip and you waste reference slots that the model silently ignores.
type: capability
priority: rigid
sources:
  - https://openrouter.ai/docs/guides/overview/multimodal/video-generation
  - dreamina-mastery.md (legacy CLI @ syntax for fallback context)
last_updated: 2026-05-08
---

# Reference-driven 视频生成 — directive 协议

OpenRouter video API 的 `input_references` 不是"多张参考图当 identity anchor"——它是**编排式导演系统**：每个 ref 是可被 prompt 文本指代的可寻址资产，被分配一个**结构化角色**（角色身份、首帧、目的地、运镜、风格、音频床）。

> **Historical note**：Dreamina CLI 时代用 `@image1` / `@video1` / `@audio1` 语法寻址。OpenRouter 改为 **`input_references` 数组 + prompt 文本自然语言指代**（"the first reference image"）。本文件协议已升级到 OpenRouter 范式，CLI 语法见末尾 fallback 章节。

最常见的失败 = 把 reference 模式当成"多塞几张图，期望模型自己挑出谁是主角"。**不行**。真正的能力来自给每张 ref 一个明确 role，并在 prompt 里**显式描述用它做什么**。

---

## 1. OpenRouter input_references 语法

### 1.1 基础格式

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "Replace the character in the first reference video with the person from the first reference image. The character should wear sci-fi glasses. Match the camera movement of the reference video.",
    "input_references": [
      { "type": "image_url", "image_url": { "url": "https://cdn.com/hero.png" } },
      { "type": "image_url", "image_url": { "url": "https://cdn.com/destination.png" } },
      { "type": "video_url", "video_url": { "url": "https://cdn.com/dolly-shot.mp4" } }
    ],
    "duration": 8
  }'
```

### 1.2 索引规则

- `input_references` 是数组，**1-indexed when described in prompt** — 即 prompt 里说 "the first reference image" 对应数组第 0 个 image-type 元素
- **Image / video / audio 各自独立计数** — `input_references[0]` 是 video 不影响 "the first reference image" 的指代
- prompt 文本里用**自然语言**指代（"the first/second/third reference image|video|audio"），**不要**用 `@image1`/`@video1`（CLI 残留）

### 1.3 何时不需要 input_references

- 纯文字生成 → text-to-video（不传 input_references）
- 单图驱动整段 → image-to-video with `frame_images`（不要塞到 input_references）
- 首+末帧插值 → image-to-video with `frame_images.frame_type` 双图（同上）

`frame_images` 跟 `input_references` 是两件事：

| 用途 | 字段 | 行为 |
|---|---|---|
| 钉死视频的具体帧 | `frame_images` | 模型必须从这一帧开始 / 结束，受严格约束 |
| 给视觉/语义素材 | `input_references` | 模型编排式参考，受 prompt 文本指代 |

`frame_images` 跟 `input_references` 同传时，**`frame_images` 优先**——OpenRouter 会优先满足帧约束。

---

## 2. Role 词汇表（**模型能稳定识别**的 directive pattern）

下表是 Seedance 2.0 / Veo 3.1 / Wan 2.7 训练时学过的 role pattern。在同一 prompt 里可以**叠加多个 role** ——角色越精确，模型猜得越少。

| Role | 中文模式 | English pattern | 作用 |
|---|---|---|---|
| **角色身份** | "用第一张参考图的人物替换第一段参考视频的角色" | `replace the character in the first reference video with the person from the first reference image` | 锁定主体外观 |
| **首帧锚定** | "以第一张参考图作为开场画面" | `with the first reference image as the first frame` / `open on the first reference image` | 视频开场即匹配该 ref（强约束建议直接用 `frame_images` 而非 input_references） |
| **目的环境** | "进入第二张参考图所示的环境"、"结束在第二张参考图的场景" | `travel to the environment of the second reference image` / `ending in the environment shown in the second reference image` | 视频结束位置 |
| **中景设置** | "事件发生在第二张参考图所示的位置" | `set inside the location shown in the second reference image` | 全程发生在该环境 |
| **运镜传递** | "参考第一段参考视频的运镜节奏" | `match the camera movement and pacing of the first reference video` | 借用 dolly/tracking/handheld |
| **风格迁移** | "用第三张参考图的视觉风格"、"调色像第一段参考视频" | `in the visual style of the third reference image` / `color-grade like the first reference video` | 借色彩/质感，不抄内容 |
| **道具/服装** | "角色应戴 sci-fi 眼镜" | `the character should wear sci-fi glasses` | 增加细节，不需要 ref |
| **视角切换** | "从第三人称切到第一视角" | `from third-person to subjective POV` | 镜头语言 |
| **音频床** | "以第一段参考音频作为背景音乐" | `background music from the first reference audio` | 当 BGM 用；output-audio 审核常拒，详见"常见错误" |

### 2.1 多 role 叠加示例

每张 ref 做一件**互不重叠**的事：

```json
{
  "model": "bytedance/seedance-2.0",
  "prompt": "Replace the character in the first reference video with the person from the first reference image, with the first reference image also serving as the first frame. The character should wear virtual sci-fi glasses. Refer to the camera movement and close-up surround shots of the first reference video, transitioning from a third-person perspective to the character's subjective perspective. Travel through the glasses and arrive at the deep blue universe of the second reference image, where several spaceships are seen traveling into the distance.",
  "input_references": [
    { "type": "image_url", "image_url": { "url": "https://cdn.com/hero.png" } },
    { "type": "image_url", "image_url": { "url": "https://cdn.com/space-vista.png" } },
    { "type": "video_url", "video_url": { "url": "https://cdn.com/dolly-shot.mp4" } }
  ],
  "duration": 8
}
```

| Ref | Role | 替代了什么 prose |
|---|---|---|
| `image[0]` (hero) | 角色身份 + 首帧 | "一个戴眼镜的科技少年" 这类含糊描写 |
| `image[1]` (space-vista) | 目的地环境 | "深蓝色宇宙、远处有飞船" 这类长描写 |
| `video[0]` (dolly-shot) | 运镜模板 | "推镜、环绕、第三切第一人称" 这类 camera prose |

正因为 role 不撞车，模型能**干净 follow**。

---

## 3. 槽位预算（OpenRouter）

| 类型 | 上限 | 备注 |
|---|---|---|
| `image` | **9** | image-type input_references 元素数 |
| `video` | **3** | video-type input_references 元素数 |
| `audio` | **3** | audio-type；需要至少一个 image 或 video ref 才能用 |
| 总计 | **≤ 12** | 跨所有模态求和 |

### 3.1 槽位策划建议

- **角色 ref（image）**：只要有特定人物出场就放一张。需要多角度（前/侧/背）才用多张同人物，否则一张就够。
- **视频 ref**：当**运镜/blocking/节奏**比"看"更重要时使用。一段 5 秒运镜参考胜过三段 camera prose。
- **音频 ref**：稀有用。output-audio 分类器经常 reject 生成视频的音轨（content-policy reject），默认安全调用是**不传 audio ref + 视频静音 + 后期 ffmpeg 混音**。
- **不要塞装饰 ref**——任何 prompt 里**不被指代**的 ref 都几乎是浪费槽位（模型最多当微弱 mood 信号）。

---

## 4. 决策表 — 何时用哪种模式

| 情境 | 模式 |
|---|---|
| 仅 prompt，从零生成 | `text-to-video`（不传 frame/refs） |
| 单张静图驱动整段 | `image-to-video` with `frame_images.first_frame` |
| 首帧 + 末帧插值 | `image-to-video` with `frame_images` 双 frame_type |
| 必须出现某个特定角色 | `reference-to-video` + 角色 image input_ref |
| 在两个不同环境间转场 | `reference-to-video` + 目的地 image input_ref |
| 借用其他片段的运镜语言 | `reference-to-video` + 运镜 video input_ref |
| 角色 + 环境 + 运镜三件齐 | `reference-to-video` + 多 role 叠加（参 §2.1）|

凡是有**多于一个**视觉意图需要钉死的，立刻切到 `reference-to-video` 并分配 role。**不要**指望"一张图 + 一长段 prose"能精确控制复杂调度——prose 的约束力远不如结构化 ref。

---

## 5. 常见错误

| ❌ 错误 | 后果 | ✅ 改法 |
|---|---|---|
| 把 reference 当 from-image 多塞图 | 传 4 张 ref 但 prompt 里没指代任何一张 → 模型只把它们当微弱风格信号，浪费槽位 | 在 prompt 里**显式指代**每张 ref（"the first reference image" / "the second reference image"） |
| 两张 ref 抢同一个 role | 让 image[0] 和 image[1] 都当"角色" → 模型在两套面孔间漂移，输出脸糊 | 一个 role 只许一张 ref。多角度同人物 = 角色身份 role 用第一张，其他张作为"侧面参考" |
| 一张图同时承担"角色"和"目的地" | 让 image[0] 既是"主角"又是"目的地的房间" → 身份和环境耦合，模型撕扯 | 拆成两张专职 ref（image[0] = 角色, image[1] = 环境）|
| 未寻址 ref + 期待 mood | 未被 prompt 文本指代的 ref 几乎被忽略 | 要它做事就在 prompt 里明确点名 |
| 用 `@image1` 语法 | OpenRouter 不解析（CLI 残留） | 用 "the first reference image" 自然语言指代 |
| 指望 audio ref 总能成功 | output-audio 分类器经常 reject 生成的音轨 | 默认走"不传 audio ref + 视频静音 + 后期 ffmpeg 混音"路径 |
| `frame_images` + `input_references` 同传期望都生效 | OpenRouter 优先 `frame_images`，input_references 部分被忽略 | 单选：精确帧约束用 `frame_images`，编排式 ref 用 `input_references` |

---

## 6. 完整可运行示例

### 6.1 角色穿越科幻序列

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "Replace the character in the first reference video with the person from the first reference image, with the first reference image as the first frame. The character should wear virtual sci-fi glasses. Refer to the camera movement and close-up surround shots of the first reference video, changing from a third-person perspective to the characters subjective perspective. Travel through the glasses and arrive at the deep blue universe of the second reference image, where several spaceships are seen traveling into the distance.",
    "input_references": [
      { "type": "image_url", "image_url": { "url": "https://cdn.autoviral.app/hero.png" } },
      { "type": "image_url", "image_url": { "url": "https://cdn.autoviral.app/space-vista.png" } },
      { "type": "video_url", "video_url": { "url": "https://cdn.autoviral.app/dolly-shot.mp4" } }
    ],
    "aspect_ratio": "16:9",
    "duration": 8
  }'
```

### 6.2 角色身份 + 风格迁移

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "[0s] Medium close-up: The young woman from the first reference image walks slowly through a misty forest. Camera tracks beside her at eye-level. [3s] She turns her head left, eyes catching dappled light. [6s] Camera pulls back, revealing dense fog and tall trees. Color-grade and atmosphere like the first reference video. Cinematic 8s clip, fine 35mm grain, dreamy ethereal mood, shot on Sony Venice with 50mm at f/2. Negative: no distortion, no extra fingers, no subtitles.",
    "input_references": [
      { "type": "image_url", "image_url": { "url": "https://cdn.autoviral.app/character.png" } },
      { "type": "video_url", "video_url": { "url": "https://cdn.autoviral.app/foggy-grade.mp4" } }
    ],
    "aspect_ratio": "9:16",
    "duration": 8
  }'
```

### 6.3 多角色 + 环境 + 运镜（接近上限）

```bash
curl -X POST "https://openrouter.ai/api/v1/videos" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "prompt": "Two characters meet for the first time. The young woman from the first reference image enters from the left. The older man from the second reference image waits at center. They meet inside the cafe environment of the third reference image. Camera follows the womans entrance with the panning rhythm of the first reference video. They make eye contact. The young woman speaks softly: \"Ive been looking for you.\" Cinematic 12s clip, warm Kodak Portra 400 emulation, fine grain, contemplative tender mood, shot on ARRI Alexa Mini with 35mm at f/2. Negative: no distortion, no extra fingers, no subtitles.",
    "input_references": [
      { "type": "image_url", "image_url": { "url": "https://cdn.autoviral.app/woman.png" } },
      { "type": "image_url", "image_url": { "url": "https://cdn.autoviral.app/man.png" } },
      { "type": "image_url", "image_url": { "url": "https://cdn.autoviral.app/cafe-env.png" } },
      { "type": "video_url", "video_url": { "url": "https://cdn.autoviral.app/pan-rhythm.mp4" } }
    ],
    "aspect_ratio": "16:9",
    "duration": 12
  }'
```

---

## 7. Dreamina CLI Legacy 语法（FALLBACK 时用）

> 仅当 OpenRouter 不可用时才用 CLI。新代码**不要**走这条路径。

CLI 用 `@imageN` / `@videoN` / `@audioN` 寻址：

```bash
dreamina multimodal2video \
  --prompt "Replace the character in @video1 with @image1, ending in the environment of @image2." \
  --image hero.png         `# @image1` \
  --image destination.png  `# @image2` \
  --video dolly-shot.mp4   `# @video1` \
  --duration=8 --ratio=16:9 --model_version=seedance2.0 \
  --output shot.mp4
```

CLI ↔ OpenRouter 翻译规则：
- `@imageN` → "the N-th reference image"
- `@videoN` → "the N-th reference video"
- `@audioN` → "the N-th reference audio"
- 数组顺序对齐 ↔ 多个 `--image` flag 出现顺序

详细 CLI 用法见 `dreamina-mastery.md` 第 7 节（legacy fallback）。

---

## See also

- `dreamina-mastery.md` — Video toolkit 总览（OpenRouter PRIMARY + CLI fallback）
- `video-prompt-narrative.md` — Seedance 2.0 timeline prompt 协议
- `model-paradigms.md` — 不同模型的 prompt 范式
- `filter-retries.md` — content-policy 拒绝（含 audio-output reject）的恢复路径
- `structured-generation.md` — variant 模式自动注入 references 的 envelope 协议
