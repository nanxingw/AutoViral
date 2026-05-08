---
name: model-paradigms
description: Use BEFORE writing a prompt for a non-Seedance model — Sora 2, Veo 3, Kling 3, Flux, Stable Diffusion 3.5, Midjourney. Each model has a distinct core metaphor and prompt grammar; what works on one fails on another. Reference table for cross-model translation. Skip and you write Seedance prompts to Sora and wonder why output is bad.
type: capability
priority: flexible
sources:
  - https://medium.com/@creativeaininja/how-to-actually-control-next-gen-video-ai-runway-kling-veo-and-sora-prompting-strategies-92ef0055658b
  - https://medium.com/@vijeetdeliwala/everyones-chasing-sora-i-cracked-veo-3-with-json-prompts-instead-fd873e1fb6a0
  - https://nebius.com/blog/posts/creating-images-with-flux-prompt-guide
  - https://aimlapi.com/blog/google-veo-3-1
---

# Model Paradigms — 模型范式分化

**核心认知**：不同视频/图像生成模型有**不同的核心隐喻**——同一段 prompt 在一个模型上很好，在另一个模型上会输出乱。这不是质量问题，是**语言不通**。

> 这份文档是**翻译手册**，不是创作指南。autoviral 主通道是 Seedance 2.0（视频）+ OpenRouter `gpt-5.4-image-2`（图像），但你可能会遇到：用户拿了 Sora 2 的 prompt 让你用 Seedance 跑、用户问"Veo 3 上能这样写吗"、需要把 Flux prompt 翻给 SDXL。这时候来这查。

---

## 1. 视频模型的 4 种核心隐喻

| 模型 | 核心隐喻 | Prompt 期待 |
|---|---|---|
| **Sora 2** (OpenAI) | **物理模拟器** | 描述**力 / 因果链 / 世界规则**，不是外观 |
| **Veo 3 / 3.1** (Google) | **渲染引擎** | **JSON schema** + reference images 防 concept bleed |
| **Kling 3** (快手) | **视听编排者** | Timeline + beat markers + native audio choreography |
| **Seedance 2.0** (字节, 我们用的) | **Timeline 导演** | **`[Xs]` 方括号** + 4-component beat + closing style line |

### 1.1 Sora 2 — 物理模拟器

**核心特征**：不是"画一帧"，是"模拟一个 8 秒的世界发生了什么"。它训练数据里学了真实物理——重力、流体、惯性、因果。

**Prompt 范式**：
- 描述**因果链**（"buggy 撞水 → 水柱炸开 → 司机继续踩油门 → 水珠落下"）
- 描述**力**（"raw energy of off-road rally" / "brutal impact"）
- 描述**世界状态**而不是镜头（"a world where the wall slowly returns to nature"）
- 不用 `[Xs]` 时间戳，用**自然叙事段落**

**Sora 2 范例**（来源：业界 viral）：
```
The scene explodes with the raw energy of a hardcore off-road rally. 
Handheld camera, found-footage aesthetic, frequently splattered with mud. 
A low-slung buggy approaches a wide, shallow river crossing at incredible 
speed. Without hesitation, the driver powers straight in — an enormous 
sheet of muddy water erupts into the air, engulfing the vehicle for a 
terrifying moment. Camera: wide tracking shot, low angle.
```

**对比**：这段 prompt 给 Seedance 2.0 跑会输出"匀速跟随小车开过水"，因为 Seedance 期待 `[Xs]` 时间锚点而不是因果叙事。

**Sora 2 viral 强项**：
- 超现实/梦境（"IRS agent files taxes during zombie apocalypse"）
- 因果剧情（"A spills coffee → coffee soaks into table → table cat panics → cat knocks over plant"）
- 真实物理（流体、布料、火、烟雾）

### 1.2 Veo 3 — 渲染引擎

**核心特征**：把 prompt 当**输入参数**而不是描述。最强的玩法是 **JSON prompt**——用结构化字段防止"concept bleed"（描述心情会意外影响物体颜色）。

**Prompt 范式**：
- **JSON schema**：character / environment / camera / motion / lighting / audio / output 各字段独立
- **reference images** 优先：上参考图比文字描述强 10x
- **fixed seed** + `series_id` + `character_id` 跨片角色一致

**Veo 3 JSON 范例**（来源：vijeetdeliwala 文章）：
```json
{
  "video_type": "cinematic_intro",
  "aspect_ratio": "16:9",
  "duration_seconds": 12,
  "style": "hyper_realistic",
  "character": {
    "type": "human",
    "gender": "male",
    "age": 30,
    "ethnicity": "Indian",
    "expression": "calm_confident",
    "clothing": {
      "top": "dark blue blazer",
      "bottom": "black trousers"
    }
  },
  "environment": {
    "location": "modern office",
    "time_of_day": "early_morning",
    "weather": "soft sunlight"
  },
  "camera": {
    "shot_type": "medium_to_close",
    "movement": "slow_dolly_in",
    "focus": "face"
  },
  "audio": {
    "ambient": "subtle office background",
    "music": "minimal piano"
  },
  "output": {
    "fps": 24,
    "quality": "max",
    "seed": 424242
  }
}
```

**为什么 JSON 强**：
- 改 `"clothing.top"` 不会影响 `"environment.lighting"`——文字 prompt 改一处会污染全局（**concept bleed**）
- `seed: 424242` 固定 → 同一组参数下输出可复现
- `character_id` 跨片复用 → 角色一致性

**Veo 3 viral 强项**：
- 商业广告（产品需要精确控制）
- 系列内容（同角色多片段）
- 写实人像（皮肤细节最强）

### 1.3 Kling 3 — 视听编排者

**核心特征**：原生**音视频联合生成**——不是先生视频再配音，是**一次生成带音频的视频**。期待 prompt 像**音乐 timeline 脚本**。

**Prompt 范式**：
- Beat markers 显式（"on the bass drop... / on the snare hit..."）
- 音频/视频联合时间轴
- 强调**节奏匹配**（动作切在 beat 上）

**Kling 范例**：
```
A street dancer practices alone in an underground subway station at 2am.
Audio: The track starts with low ambient hum. At 0:02, a deep bass kicks 
in — on the bass, his shoulders drop into rhythm. At 0:04, snare hi-hat 
pattern enters — his footwork accelerates with the snare hits. At 0:06, 
the beat drops out for one second — he freezes mid-motion. At 0:07, 
beat returns — he releases into a fluid spin.

Camera: locked-off wide, ambient practical light from subway tubes, 
cinematic 35mm aesthetic.
```

**Kling viral 强项**：
- 音乐视频
- 编舞内容
- ASMR 视听同步

### 1.4 Seedance 2.0 — Timeline 导演（**autoviral 主通道**）

**核心特征**：期待**显式时间锚点 + 镜头语言**——参 `video-prompt-narrative.md` 完整协议。

简短回顾：
- `[Xs]` 方括号 timestamp
- 每 beat 4-component（timestamp + shot type + camera movement + mood）
- Subject 全程同一名词
- Closing style line 必须
- Lip-sync 用引号 + 情绪标注

---

## 2. 跨模型 Prompt 转换表

把 prompt 从一个模型迁到另一个时的核心改动：

| 从 → 到 | 主要改动 |
|---|---|
| **Seedance → Sora 2** | 删 `[Xs]` 时间戳；改写成因果叙事段落；加"raw energy / brutal / explodes" 等力的词；保留 camera 描述 |
| **Seedance → Veo 3** | 转 JSON schema；character/environment/camera 拆字段；加 `seed`；考虑 reference image 替代文字 |
| **Seedance → Kling 3** | 加 audio timeline；动作切点对齐 beat marker；用 `at 0:02 / on the bass drop` 等音乐语法 |
| **Sora 2 → Seedance** | 因果叙事拆成 `[Xs]` beat；每 beat 限 1 个动作 + 1 个相机；末尾加 closing style line |
| **Veo 3 JSON → Seedance** | JSON 字段拍平到自然语言 beat；保留 character/lighting 描述；加 timestamp |
| **Sora 2 → Veo 3** | 拆字段、加 reference image、固定 seed |

---

## 3. 图像模型的 3 种核心隐喻

| 模型 | 核心隐喻 | Prompt 期待 |
|---|---|---|
| **DALL-E 3 / OpenAI `gpt-5.4-image-2`** (autoviral 主通道) | **创作 brief** | 段落式自然语言 + camera-first 范式 |
| **Flux 1** (Black Forest Labs) | **自然语言执行器** | 散文式 + capitalization 敏感 + **不要负向 prompt** |
| **Stable Diffusion 3.5 / SDXL** | **加权关键词解析器** | 逗号分隔 + `(keyword:1.2)` 加权 + 负向 prompt |

### 3.1 DALL-E 3 / `gpt-5.4-image-2`（autoviral 主通道）

**核心特征**：把 prompt 当"写给画师的创作 brief"。理解上下文最强，但加权语法**不识别**。

**Prompt 范式**（详见 `image-prompt-narrative.md`）：
- Camera/equipment 前置
- 主体方括号高亮
- Closing style line
- 段落式自然语言

### 3.2 Flux 1

**核心特征**：T5+CLIP 双 encoder，自然语言理解最强。**不要负向 prompt**（flow matching 训练）。**capitalization 敏感**。

**Flux 范例**：
```
Editorial portrait shot on Hasselblad X2D 100C with XCD 90V at f/4: 
A young Asian woman in her late twenties with shoulder-length black hair 
sits by a sunlit window reading a leather-bound notebook. Warm golden-hour 
key light from camera-left, soft diffused with subsurface scattering on 
her cheek. Vincent Van Gogh's painterly aesthetic in the background bokeh.

Kodak Portra 400 emulation, fine grain, Morandi muted warm palette.
```

**注意**：
- "Vincent Van Gogh" 大写正确——小写 "vincent van gogh" 输出风格弱化
- 没有 `Negative:` 行——Flux 不解析
- 没有 `(keyword:1.2)` 加权——Flux 不解析

**Flux 强项**：自然语言细节、文字 in image（"a sign that says HELLO" 真能出 HELLO）、复杂构图

### 3.3 SDXL / SD 3.5

**核心特征**：关键词解析器 + 加权 + 负向。

**SDXL 范例**：
```
正向: 
(masterpiece:1.2), (best quality:1.1), professional photography, 
(young Asian woman:1.1), shoulder-length black hair, cream linen blouse, 
sitting by window, reading journal, (golden hour lighting:1.3), 
warm tones, shallow depth of field, bokeh, 8K, Hasselblad medium format

负向: 
(worst quality:1.4), low quality, blurry, deformed hands, extra fingers, 
bad anatomy, watermark, text, signature, cartoon, anime
```

**注意**：
- 加权 `(x:1.2)` 提升、`(x:0.8)` 降低，范围 0.5-1.5
- **必须**配负向 prompt（不写 = 输出畸形）
- 关键词排序影响权重——越靠前越重要
- 支持 `BREAK` 关键词分割注意力区域
- 支持 LoRA / embedding 触发词

---

## 4. 跨图像模型转换表

| 从 → 到 | 主要改动 |
|---|---|
| **DALL-E 3 → Flux** | 大致保留，注意 capitalization；删除任何 SDXL 风格的 `(x:1.2)` 残留 |
| **DALL-E 3 → SDXL** | 拆段落为关键词逗号；加加权；加负向 prompt；可能要丢失部分语义（SDXL 不理解长上下文） |
| **Flux → DALL-E 3** | 大致保留；DALL-E 3 解析力强 |
| **Flux → SDXL** | 提取关键词；加加权；补负向 |
| **SDXL → Flux** | 删 `(x:1.2)`；删负向 prompt；改写为完整句子 |
| **SDXL → DALL-E 3** | 改写成段落，去掉加权和负向 |

---

## 5. 决策表：什么时候用哪个模型

### 5.1 视频

| 需求 | 推荐 |
|---|---|
| autoviral 默认（已接 Dreamina）| **Seedance 2.0** |
| 超现实 / 梦境 / 因果剧情 | Sora 2 |
| 商业广告 / 系列角色一致 | Veo 3.1 + JSON + reference |
| 音乐视频 / 编舞 | Kling 3 |
| 速度优先 / 实时迭代 | LTX-Video（OSS） |
| 角色身份精控 / 多 ref | Seedance 2.0 + multimodal2video（参 `reference-directives.md`） |
| 真实物理（流体/火/烟） | Sora 2 |
| 真实人像皮肤 | Veo 3.1 |

### 5.2 图像

| 需求 | 推荐 |
|---|---|
| autoviral 默认（已接 OpenRouter）| **`openai/gpt-5.4-image-2`** |
| 文字 in image | Flux 1 |
| 极致写实人像 | Flux 1 / Midjourney v6 |
| 精确控制（加权） | SDXL + LoRA |
| 中文场景理解 | 即梦（已下线） / OpenRouter（中英都行）|

---

## 6. OpenRouter — 统一调用层 ≠ 统一 prompt 层

**关键认知**：autoviral 的图像 + 视频生成全量走 OpenRouter（PRIMARY）——但 OpenRouter 抽象的是**调用方式**（统一 endpoint / 统一鉴权 / 统一 async job 格式），**不是 prompt 语法**。

```
┌──── OpenRouter 抽象的部分（统一）───────────┐
│  • Endpoint URL                              │
│  • 鉴权（Bearer $OPENROUTER_API_KEY）        │
│  • Async job lifecycle（视频）/ sync（图像）│
│  • 错误码 / 限流 / 计费                      │
└──────────────────────────────────────────────┘
        │ 一份 HTTP client 跑所有模型
        ▼
┌──── 模型范式不变（必须各自适配）────────────┐
│  • Seedance 2.0  → [Xs] timeline 协议       │
│  • Veo 3.1       → JSON schema              │
│  • Wan 2.7       → 自然语言 + camera prose  │
│  • Sora 2 Pro    → 因果叙事段落             │
│  • GPT-5.4 Image → DALL-E 创作 brief        │
│  • Flux.2 Pro    → 自然语言 + capitalization│
│  • Nano Banana   → 多模态推理 + 实物 ground │
└──────────────────────────────────────────────┘
```

**铁律**：在 OpenRouter 上换 model 字段 ≠ 跨模型可直接用同 prompt。每次切模型都要回头查这份文件对应的 prompt 范式。

### 6.1 OpenRouter 完整模型 ID 表（autoviral 已通的）

#### 视频（统一 endpoint `POST /api/v1/videos`）

| OpenRouter Model ID | 范式 | 详细文档 |
|---|---|---|
| `bytedance/seedance-2.0` ⭐ PRIMARY | Timeline 导演 | `video-prompt-narrative.md` |
| `bytedance/seedance-2.0-fast` | Timeline 导演 | 同上 |
| `bytedance/seedance-1.5-pro` | Timeline 导演 | 同上（1080p 输出） |
| `google/veo-3.1` | Rendering engine | `model-paradigms.md` §1.2（JSON schema） |
| `alibaba/wan-2.7` | MoE diffusion | `model-paradigms.md` §1.x |
| `alibaba/wan-2.6` | MoE diffusion | 同上（旧版） |
| `openai/sora-2-pro` | Physics simulator | `model-paradigms.md` §1.1 |

#### 图像（统一 endpoint `POST /api/v1/chat/completions` + `modalities`）

| OpenRouter Model ID | 范式 | 详细文档 |
|---|---|---|
| `openai/gpt-5.4-image-2` ⭐ PRIMARY | DALL-E 创作 brief | `image-prompt-narrative.md` |
| `google/gemini-3.1-flash-image-preview` (Nano Banana 2) | Multimodal reasoning + grounding | 同上 §10 |
| `google/gemini-2.5-flash-image` (Nano Banana) | Conversational editing | 同上 §10 |
| `bytedance/seedream-4.5` | Image consistency | 同上 §10 |
| `black-forest-labs/flux.2-pro` | T5 自然语言 | `model-paradigms.md` §3.2 |
| `recraft/recraft-v3` | Vector + raster | 同上 §10 |

---

## 7. autoviral 当前的范式锁定（2026-05-08）

| 模块 | 主模型 (PRIMARY) | OpenRouter Model ID | Prompt 范式文档 |
|---|---|---|---|
| 视频生成 | Seedance 2.0 | `bytedance/seedance-2.0` | **`video-prompt-narrative.md`**（rigid · 必读） |
| 图像生成 | GPT-5.4 Image 2 | `openai/gpt-5.4-image-2` | **`image-prompt-narrative.md`**（rigid · 必读） |
| 多 ref 视频 | Seedance 2.0 | `bytedance/seedance-2.0` | `reference-directives.md`（OpenRouter `input_references` 语法） |
| 音乐生成 | Lyria 3 Pro | （独立通道） | `music-generation.md` |
| 图文排版 | Playwright + HTML | （非 AI 通道） | `poster-design.md` |

**API 调用层**：全部走 OpenRouter，**不再使用** Dreamina CLI（legacy fallback only）/ Jimeng（DEPRECATED）/ `openrouter_generate.py` 老脚本。

**铁律**：
1. 写 prompt 前先确认目标模型（默认 PRIMARY），再来这查范式
2. **不要**把 Sora 2 prompt 直接给 Seedance 跑（同理反向）
3. **不要**把 OpenRouter 的"统一"误解为"prompt 也统一"——每个模型仍是各自的语言

---

## See also

- `video-prompt-narrative.md` — Seedance 2.0 完整协议
- `image-prompt-narrative.md` — OpenRouter 主通道协议
- `dreamina-mastery.md` — Dreamina CLI 工具书
- `reference-directives.md` — 多 ref 编排
- `viral-archetypes.md` — Viral 4 大原型
- `keyword-library.md` — 关键词分类索引
