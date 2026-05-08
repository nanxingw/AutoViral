---
name: image-prompt-narrative
description: Use BEFORE writing any prompt for OpenRouter `openai/gpt-5.4-image-2` (主图片通道) or any DALL-E 3 / Flux 系自然语言 prompt 模型. Translates emotional intent into the camera-first descriptive paragraph范式. Rigid; mandatory before every image generation. Skip and you ship 中景居中、AI 默认值感的 mediocre 图.
type: capability
priority: rigid
sources:
  - https://nebius.com/blog/posts/creating-images-with-flux-prompt-guide
  - https://aimlapi.com/blog/master-the-art-of-ai-top-10-prompts-for-flux-1-by-black-forests-labs
  - https://www.acceptprompt.com/blog/ai-video-prompts (image refs)
  - OpenAI DALL-E 3 prompt engineering official guidance
---

# Image Prompt — Narrative Layer

针对 autoviral 当前图像生成主通道 **OpenRouter `openai/gpt-5.4-image-2`**——这是 OpenAI 系模型，prompt 范式跟 DALL-E 3 一致：**段落式自然语言 + camera/equipment 前置 + 主体方括号高亮 + closing style line**。

> **不是普适 image prompt 工程**——SDXL 用关键词加权，Flux 用自然语言但 capitalization 敏感，DALL-E 3 / OpenRouter `gpt-5.4-image-2` 期待**写给画师的创作 brief**。下游模型的范式差异详见 `model-paradigms.md`。

---

## 0. 第一原则

每个 image prompt 必须能回答：

1. **这一帧要传达的单一情感是什么？**
2. **观众的视线在 0.3 秒内应该被引到哪？**（主焦点 vs 次焦点 vs 尾焦点）
3. **如果删掉 prompt 里的"高质量、电影感、4K"等空词，剩下的具体描写还成立吗？**

任意一题答不上，回 `taste/04-design-and-text.md` 重想，**不要写 prompt**。

---

## 1. Camera-First Paragraph 范式

行业实证最有效的 prompt 结构（来自 Flux / DALL-E 3 / Veo 3 的共通经验）：

```
[Camera/equipment frame]: [Main subject in brackets — 行业用方括号高亮主体], 
[environmental effects — 光线/质感/空气], 
[special elements — 道具/动作/微表情]. 
[Closing technical specifications + style.]
```

### 1.1 为什么 Camera 放最前

`openai/gpt-5.4-image-2` 解析 prompt 时把**第一个名词短语**当作"作品类型 anchor"。开头放：
- `Studio portrait shot on Hasselblad X2D 100C with XCD 90V at f/4` → 模型立刻锁定"高级时尚摄影"美学
- `iPhone 15 Pro candid` → 锁定"日常自然光，轻噪点"美学
- `1970s Kodak Portra film, medium format` → 锁定"温暖胶片质感"美学
- `Documentary frame, Canon C70` → 锁定"纪实自然色"美学

如果开头是 "A young woman..."，模型默认走 generic stock photo 美学——**这就是为什么 AI 默认产物感觉平庸**。

### 1.2 主体方括号高亮（**真改输出**）

业界惯例：**主体短语用方括号 `[ ]` 包裹**——`gpt-5.4-image-2` 解析时把方括号内当 emphasis token，构图权重提升。

❌ 弱：
```
A young woman sits at a desk reading.
```

✅ 强：
```
Studio portrait on Fujifilm GFX 100S, 80mm at f/2: 
[a young Asian woman in her late twenties reading a leather-bound 
notebook], soft window light from camera-left, warm amber tones.
```

### 1.3 Closing Style Line（必须末尾）

跟视频协议一致——末尾必须有总体定调，否则模型默认值接管。

```
Cinematic still, [film stock or grade], [grain spec], [color palette],
[lighting style], [overall mood].
```

---

## 2. Capitalization 敏感性（Flux 系实证，gpt-5.4-image-2 部分继承）

`vincent van gogh's style` 跟 `Vincent Van Gogh's style` 在 Flux 上输出**显著不同**——后者更接近真梵高画风，前者更模糊。`openai/gpt-5.4-image-2` 部分继承这个特性。

**规则**：
- 人名、地名、专有名词 → **首字母大写**（"Tokyo Shibuya" 而不是 "tokyo shibuya"）
- 相机品牌/型号 → 完全按官方写法（"Hasselblad" / "ARRI Alexa Mini"，不要 "hasselblad"）
- 风格运动名 → 标题大写（"Solarpunk" / "Cyberpunk" / "Wabi-sabi"）

---

## 3. 主体描写的"具体性梯度"

模型对主体描写的具体程度**直接对应输出辨识度**。从最弱到最强 5 档：

| 档 | 写法 | 输出 |
|---|---|---|
| ❌ 弱 1 | "a girl" | 通用亚洲女性，缺辨识 |
| ❌ 弱 2 | "a young Asian girl" | 略具体，但 generic |
| 🟡 中 | "a young Asian woman in her late twenties with shoulder-length black hair" | 可识别 |
| ✅ 强 | "a young Asian woman in her late twenties with shoulder-length black hair in soft natural waves, wearing a cream linen blouse and high-waisted vintage Levi's jeans, almond eyes with subtle eye smile" | 高辨识 |
| ⭐ 极强 | 上面 + "a small mole below her right eye, faint freckles across cheekbones, pierced ears with thin gold hoops, manicured nails painted Morandi sage green, holding a leather-bound Moleskine notebook" | 角色一致性可复用 |

**铁律**：要做组图（多张同一角色） → 必须用"极强"档 + 每张 prompt 完整复制角色描写（不要缩写成"the woman"——参 video-prompt-narrative.md 的 subject identity discipline，图像版同理）。

---

## 4. Lighting 字段必填项（这是 prompt 最高 ROI 维度）

**Flux 官方说**：lighting 描述对最终结果影响最大。`gpt-5.4-image-2` 同样如此。

### 4.1 必填三件套

```
[Direction] + [Color/Temperature] + [Quality/Modifier]
```

| 维度 | 选项 |
|---|---|
| **方向** | from camera-left / camera-right / top-down / backlit / rim-light / 45° key |
| **色温/调** | golden hour / blue hour / 3200K tungsten / 5500K daylight / 6500K cool / mixed sodium |
| **质量** | soft diffused / hard / volumetric / hazy / dappled / harsh noon |

### 4.2 高级 lighting phrase（**反复出现在惊艳 prompt 中**）

- `subsurface scattering` — 皮肤透光感（人像必加）
- `volumetric light rays / God rays` — 空气中可见光束
- `halation` — 高光晕开（胶片质感）
- `caustics` — 水面/玻璃折射光斑
- `practical lights` — 画面内可见光源（路灯/蜡烛/屏幕）
- `motivated lighting` — 看起来像自然有光源
- `chiaroscuro` — 强明暗对比
- `low-key / high-key` — 暗调主导 / 亮调主导

---

## 5. 完整 Prompt 模板（直接套用）

```
[Camera/equipment frame at f-stop]: 
[main subject in brackets — 极强档具体性], 
[lighting — direction + color temp + quality + 1 高级 phrase],
[environmental detail — texture / atmosphere / depth cue],
[micro-action / expression detail].

Cinematic still, [film stock or digital sensor], [grain level], 
[color grade — Morandi muted warm-grey / teal-and-orange / desaturated 
cool / vintage Kodachrome], [overall mood].

Negative: [optional — gpt-5.4-image-2 不强支持 negative，但写出来无副作用]
```

---

## 6. 完整可运行示例

### 6.1 人像 · 温暖怀旧

```
Editorial portrait on Hasselblad X2D 100C with XCD 90V at f/2.8: 
[a young Asian woman in her late twenties with shoulder-length black 
hair in soft natural waves, almond eyes with a subtle eye smile, 
small mole below right eye, wearing a cream linen blouse with delicate 
shell buttons], 
warm golden-hour key light from camera-left through sheer linen curtain, 
3200K, soft diffused with subsurface scattering on her cheek,
shallow DOF rendering background into amber bokeh of out-of-focus 
houseplants and sunlit dust particles,
her left hand gently cradling a leather-bound notebook, 
right hand holding a vintage gold fountain pen mid-pause, 
faint thoughtful smile.

Cinematic editorial still, Kodak Portra 400 emulation, fine grain, 
Morandi muted warm palette (cream / cocoa / faded sage), 
contemplative and serene mood.
```

### 6.2 食物 · 极致质感

```
Macro food photography on Phase One IQ4 with Schneider 120mm at f/4: 
[a single ramen bowl in a black ceramic donburi — a glossy soft-boiled 
egg yolk halved on top, slow-braised chashu pork glistening with rendered 
fat, crisp scallion green, soft tan menma bamboo, swirl of black sesame 
oil on a milky tonkotsu broth], 
top-down 90° overhead light at 4500K from a single 4ft softbox, 
hard rim accent from camera-right creating dimensional shadow, 
visible steam catching the rim light,
chopsticks resting on a hand-thrown ceramic rest, single drop of broth 
beading on the rim,
linen runner with subtle weave texture in foreground.

Commercial editorial food still, 8K detail, Kodak Ektar 100 color 
profile, deep saturated yellows and earthy browns against matte black 
ceramic, hungry and luxurious mood.
```

### 6.3 街拍 · 紧张电影感

```
Street cinematography on Sony Venice with 35mm Cooke S4 prime at f/2: 
[a man in his mid-thirties wearing a navy wool overcoat with collar up, 
salt-and-pepper stubble, rain-soaked black hair flattened to forehead, 
sharp jawline, brown eyes scanning toward camera-right], 
backlit by a flickering yellow sodium street lamp at 2700K from 
behind-right, soft diffused fill from neon café sign at 4000K cyan from 
camera-left, halation around the highlights, fine atmospheric haze,
rain-slicked cobblestone street reflecting both light sources, puddles 
ripple from passing footsteps,
breath visible as condensation in cold air, droplets on his coat 
collar catching practical light.

Cinematic film noir still, anamorphic 2.39:1 frame, 35mm Kodak Vision3 
500T grain, teal-and-amber complementary grade with crushed shadows, 
suspenseful and melancholy mood.
```

### 6.4 单帧海报 · 主标题集成

```
High-fashion editorial poster on Hasselblad X2D 100C with XCD 65mm at 
f/4 in vertical 9:16 aspect: 
[a young woman in her early twenties standing barefoot on cracked dry 
earth, wearing a flowing terracotta linen dress that catches wind, 
long jet-black hair flying back, eyes closed, face tilted up to the 
sun], 
harsh noon overhead key at 5500K with subsurface scattering glowing 
through the linen, hard rim creating crisp silhouette against negative 
space sky,
cracked earth texture in foreground with selective focus drawing eye 
to her face,
empty top-third of frame reserved as breathing room for editorial 
title overlay,
single fold of fabric catches a wind gust, frozen mid-movement.

Cinematic editorial still, 65mm medium format, fine grain, 
desaturated Sahara palette (terracotta, bone white, cracked earth ochre, 
pale dusty sky-blue), free and elemental mood.
```

### 6.5 产品 · 干净商业

```
Studio commercial photography on Phase One IQ4 150MP with Schneider 
120mm at f/8: 
[a single matte black ceramic French press coffee maker on a textured 
travertine slab, freshly poured stream of espresso captured mid-pour 
into a small white porcelain demitasse], 
3-point lighting setup — large softbox from top-left at 5000K key, 
silver fill card camera-right, hair light backlit from upper-rear 
adding rim,
caustics from the espresso liquid surface, subtle steam catching 
backlight,
cinnamon stick and three coffee beans arranged in deliberate negative 
space at lower-right per rule of thirds,
gradient seamless background fading from cream to soft taupe.

Hyper-detailed commercial product still, 8K, no grain, neutral white 
balance, natural sage and travertine palette, premium artisanal mood.
```

---

## 7. 跑生成前的拷打清单

- ☐ 开头是 Camera/equipment 短语，不是 "A young..."
- ☐ 主体在 `[ ]` 方括号内
- ☐ 主体描写在"强"或"极强"档，不是"a girl"这种 generic
- ☐ Lighting 写了 direction + color temp + quality + 至少 1 个高级 phrase（subsurface scattering / halation / volumetric / caustics / chiaroscuro 等）
- ☐ 末尾有 closing style line（cinematic + film stock + grain + color grade + mood）
- ☐ 专有名词、品牌、风格名 capitalization 正确
- ☐ 删掉空词（"高质量"、"4K"、"masterpiece"）后剩下的具体描写仍能传达情感
- ☐ 如果是组图 → 每张 prompt 完整复制 anchor 角色描写，不缩写

---

## 8. Failure Mode → Fix 速查

| 失败模式 | 输出表现 | 修法 |
|---|---|---|
| 开头 "A young woman..." | 通用 stock photo 美学 | 换成 "Editorial portrait on Hasselblad..." |
| 主体没方括号 | 构图权重均匀，主体不突出 | 用 `[ ]` 高亮主体短语 |
| Lighting 只写"温暖光" | 输出平庸光感 | 加 direction + temp + quality + 高级 phrase |
| 风格关键词堆砌 | "kitchen sink approach"，多风格冲突 | 单一闭合风格定调 |
| 没有 closing style line | AI 默认值美学 | 加 cinematic + film + grain + grade + mood |
| 组图角色不一致 | 多个不同人脸 | 全 prompt 复制 anchor 极强档描写 |
| 中景居中默认 | 死板构图 | 显式覆盖：`rule of thirds, subject at right-third` |
| 多焦点堆叠 | 视线无落点 | 显式指定主焦点 + 留白方向 |

---

## 9. OpenRouter API 调用（PRIMARY 通道）

autoviral 图像生成全量走 OpenRouter `/api/v1/chat/completions`——这是 OpenAI 兼容接口的扩展（多 `modalities` 字段返回 image+text）。

### 9.1 鉴权

```bash
Authorization: Bearer $OPENROUTER_API_KEY
```

### 9.2 基础调用（同步，不是 async）

```bash
curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5.4-image-2",
    "messages": [
      {
        "role": "user",
        "content": "Editorial portrait on Hasselblad X2D 100C with XCD 90V at f/2.8: [a young Asian woman in her late twenties with shoulder-length black hair in soft natural waves, almond eyes with subtle eye smile, wearing a cream linen blouse], warm golden-hour key light from camera-left through sheer linen curtain, 3200K, soft diffused with subsurface scattering on her cheek, shallow DOF rendering background into amber bokeh. Cinematic editorial still, Kodak Portra 400 emulation, fine grain, Morandi muted warm palette, contemplative and serene mood. Negative: no distortion, no extra fingers, no anime."
      }
    ],
    "modalities": ["image", "text"],
    "image_config": {
      "aspect_ratio": "3:4",
      "image_size": "2K"
    }
  }'
```

返回：
```json
{
  "id": "gen-...",
  "model": "openai/gpt-5.4-image-2",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "...optional text response...",
        "images": [
          { "type": "image_url", "image_url": { "url": "https://..." } }
        ]
      }
    }
  ]
}
```

### 9.3 `image_config` 字段

| 字段 | 取值 | 用途 |
|---|---|---|
| `aspect_ratio` | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `2:3` / `3:2` | 比例 |
| `image_size` | `1K` / `2K` | 分辨率（不支持 0.5K/4K） |
| `strength` | 0.0-1.0 | reference-driven 强度 |
| `text_layout` | object | 文字排版（in-image text）|
| `style` | string | 风格预设 |
| `rgb_colors` | array | 强制色板 |
| `super_resolution_references` | array | 高清化参考 |

### 9.4 Reference-driven（图生图 / 以图为参考）

把参考图放到 `messages.content` 的多模态数组中：

```bash
curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5.4-image-2",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Generate a new image in the same visual style as this reference: ..." },
          { "type": "image_url", "image_url": { "url": "https://cdn.com/style-ref.jpg" } }
        ]
      }
    ],
    "modalities": ["image", "text"],
    "image_config": { "aspect_ratio": "9:16", "image_size": "2K", "strength": 0.65 }
  }'
```

### 9.5 流式输出（可选）

```bash
# 加 "stream": true 启用 SSE 流式
... -d '{ "model": "...", "messages": [...], "modalities": ["image","text"], "stream": true }'
```

适合渐进式预览。autoviral backend 默认**不开 stream**——直接拿最终 URL 更简单。

---

## 10. OpenRouter 图像模型选型表（5 大可选）

```bash
# 查询当前所有图像模型
curl https://openrouter.ai/api/v1/models | jq '.data[] | select(.architecture.modality | contains("image"))'
```

| 模型 ID | 范式 | 强项 | 弱项 | autoviral 默认级 |
|---|---|---|---|---|
| **`openai/gpt-5.4-image-2`** | DALL-E 系（创作 brief）| 上下文理解最强、文字 in image、构图复杂 | 偶尔不严格按 prompt | ⭐⭐⭐⭐⭐ **PRIMARY** |
| `google/gemini-3.1-flash-image-preview` (Nano Banana 2) | Multimodal reasoning | 实物 grounding、高保真、编辑能力强 | 偏 photorealistic，艺术化弱 | ⭐⭐⭐⭐ 写实 / 商业 |
| `google/gemini-2.5-flash-image` (Nano Banana) | Conversational image | 多轮对话编辑（"把背景换 X"）| 单次质量略低于 3.1 | ⭐⭐⭐ 迭代式编辑 |
| `bytedance/seedream-4.5` | ByteDance image | 编辑一致性最强、亚洲面孔表现好 | 创意发散弱 | ⭐⭐⭐⭐ 角色一致性 |
| `black-forest-labs/flux.2-pro` | Flux T5+CLIP | 自然语言、capitalization 敏感、文字 in image | 不支持 negative prompt | ⭐⭐⭐ Flux 专长场景 |
| `recraft/recraft-v3` | Vector + raster | 矢量风格、SVG 输出 | 写实弱 | ⭐⭐ 图标/插画 |

### 10.1 默认选型策略

```
通用场景 / 上下文复杂
  → openai/gpt-5.4-image-2  （PRIMARY）

需要照片级写实人像 + 实物 grounding
  → google/gemini-3.1-flash-image-preview  (Nano Banana 2)

需要多轮对话编辑（"换背景"、"把衣服改成 X"）
  → google/gemini-2.5-flash-image  (Nano Banana)

需要同一角色多张图、角色一致性
  → bytedance/seedream-4.5

需要图中显式文字 / Flux 自然语言强项
  → black-forest-labs/flux.2-pro

需要矢量图 / 图标 / 简笔插画
  → recraft/recraft-v3
```

### 10.2 跨模型 prompt 范式提示

**关键认知**：OpenRouter 抽象的是**调用方式**，不是 prompt 语法。同一个 prompt 在 `gpt-5.4-image-2` 和 `flux.2-pro` 上效果可能差很多——参 `model-paradigms.md` 第 3 节。

**最 robust 的做法**：本文件 §1-§7 的 **camera-first paragraph + 主体方括号 + closing line** 范式在 5 个模型上**都能工作**——因为它对齐 DALL-E 3 / Flux / Nano Banana 的共通最佳实践。**特定模型微调**才需要看 `model-paradigms.md`。

---

## 11. autoviral 集成层（Backend 实现）

```typescript
async function generateImage(envelope: ImageEnvelope): Promise<ImageResult> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: envelope.model ?? "openai/gpt-5.4-image-2",
      messages: [
        {
          role: "user",
          content: envelope.referenceUrl
            ? [
                { type: "text", text: envelope.prompt },
                { type: "image_url", image_url: { url: envelope.referenceUrl } },
              ]
            : envelope.prompt,
        },
      ],
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: envelope.aspectRatio ?? "1:1",
        image_size: envelope.imageSize ?? "2K",
        ...(envelope.strength && { strength: envelope.strength }),
      },
    }),
  });
  const json = await res.json();
  const url = json.choices[0].message.images[0].image_url.url;
  return { url, model: json.model };
}
```

> autoviral 后端 `dispatchGeneration.ts` 当前已经走 OpenRouter chat/completions。新代码统一这个路径，**不要**回退到 `openrouter_generate.py` 老脚本。

---

## See also

- `taste/04-design-and-text.md` — 排版与封面设计原则（道）
- `viral-archetypes.md` — Viral 短视频/图文的 4 大原型（含图文 case）
- `keyword-library.md` — 惊艳关键词分类索引
- `model-paradigms.md` — 不同图像模型的范式差异（DALL-E / Flux / Nano Banana / Seedream）
- `dreamina-mastery.md` — 视频侧 OpenRouter API 总览（视频图片同栈）
- `frame-gacha.md` — 一帧多生候选机制（关键画面必过）
- `quality-gate.md` — 单样小测 / 批量 / rubric 评分流程
