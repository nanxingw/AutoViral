---
name: prompt-mastery
description: 高级提示词工程模块——模型差异化策略、负向提示词库、高级质量关键词、Prompt自动增强流程、风格一致性进阶技术
---

# Prompt 进阶模块

本模块覆盖 SKILL.md 基础提示词工程之上的高级技巧，包括模型差异化策略、负向提示词库、高级质量关键词、自动增强流程和风格一致性进阶。当你需要针对特定模型优化 prompt、提升生成质量、或保证多图风格统一时，加载本模块。

---

## 1. 模型差异化策略

不同生成模型的 prompt 语法和偏好差异巨大，同一段描述在不同模型上效果可能天差地别。以下是主流模型的 prompt 最佳实践：

### 1.1 Flux（Black Forest Labs）

- **语法风格**：自然语言散文，30-80 词为最佳长度
- **结构层次**：按 Foundation（主体）→ Visual（视觉细节）→ Technical（镜头/光线）→ Atmospheric（氛围/情绪）逐层展开
- **核心要点**：
  - 光照描述对最终结果影响最大，务必详细指定
  - **不支持负向提示词**（negative prompt），所有引导必须通过正向描述实现
  - 不要使用 `(keyword:1.2)` 加权语法，模型不识别
  - 避免堆砌关键词，用连贯的句子描述

**Flux prompt 示例**：
```
A young Chinese woman in her mid-twenties sits at a minimalist wooden desk,
reading a leather-bound journal. She has shoulder-length black hair with soft
waves, wearing a cream linen blouse. Warm golden hour sunlight streams through
sheer curtains, casting gentle shadows. Shot on medium format camera with
shallow depth of field, the background softly blurred into warm amber tones.
The overall mood is contemplative and serene, with a muted earth-tone palette.
```

### 1.2 SDXL（Stable Diffusion XL）

- **语法风格**：结构化加权关键词，用逗号分隔
- **加权语法**：`(keyword:1.2)` 提升权重，`(keyword:0.8)` 降低权重，范围 0.5-1.5
- **核心要点**：
  - 必须配合负向提示词（见第 2 节）
  - 关键词排列顺序影响权重——越靠前越重要
  - 支持 `BREAK` 关键词分割注意力区域
  - LoRA 和 embedding 可通过触发词激活

**SDXL prompt 示例**：
```
正向: (masterpiece:1.2), best quality, (young Chinese woman:1.1), shoulder-length black hair,
cream linen blouse, sitting at wooden desk, reading journal, (golden hour lighting:1.3),
warm tones, shallow depth of field, bokeh, professional photography, 8K

负向: (worst quality:1.4), low quality, blurry, deformed hands, extra fingers,
bad anatomy, watermark, text, signature
```

### 1.3 即梦 Jimeng（字节跳动）

- **语法风格**：中文描述友好，中英文混合均可
- **核心要点**：
  - 对中文语义理解能力强，可直接用自然中文描述
  - 风格关键词偏好：`摄影风格`、`插画风格`、`3D渲染`、`水墨画`
  - 支持参考图引导（ref-image），适合保持风格一致性
  - 分辨率通过 `--width` 和 `--height` 参数指定

**即梦 prompt 示例**：
```
一位25岁左右的中国女性坐在简约木桌前，翻阅一本皮面日记本。
齐肩黑发带有自然微卷，穿着米白色亚麻衬衫。暖色黄昏阳光透过薄纱窗帘洒入，
营造温馨宁静的氛围。浅景深效果，背景柔和虚化。摄影风格，高画质，细节丰富。
```

### 1.4 DALL-E 3 / GPT-4o（OpenAI）

- **语法风格**：段落式详细描述，像写给画师的创作简报
- **核心要点**：
  - 支持多轮对话式修改（"把背景换成咖啡馆"）
  - 描述越详细越好，模型擅长理解复杂场景
  - 可以指定 `I NEED exactly what I describe` 防止模型擅自修改 prompt
  - 自动安全过滤较严格，避免涉及真实公众人物

**DALL-E 3 prompt 示例**：
```
Create a photograph-style image of a young East Asian woman in her mid-twenties,
sitting at a clean minimalist wooden desk. She is reading a leather-bound journal
with a contemplative expression. Her shoulder-length black hair has soft natural waves.
She wears a cream-colored linen blouse. The scene is lit by warm golden hour sunlight
streaming through sheer white curtains to her left, creating soft diffused shadows.
The camera captures her from a medium shot with shallow depth of field, the background
melting into warm amber bokeh. The color palette is earth tones: cream, warm brown,
soft gold. The mood is serene and reflective.
```

### 模型选择速查表

| 需求场景 | 推荐模型 | 原因 |
|---------|---------|------|
| 写实人像/产品摄影 | Flux / 即梦 | 自然光影表现优秀 |
| 需要精确控制细节 | SDXL | 加权语法灵活 |
| 中文场景描述 | 即梦 | 中文语义理解最佳 |
| 快速迭代/对话修改 | DALL-E 3 / GPT-4o | 多轮对话编辑 |
| 图生视频 | 即梦 | 支持首帧驱动视频生成 |

---

## 2. 负向提示词库

> 注意：负向提示词仅适用于 SD 系列模型（SD 1.5 / SDXL）。Flux 和 DALL-E 3 不支持负向提示词。
> 即梦的负向提示词支持有限，一般通过正向描述引导即可。

### 2.1 SD 1.5 通用负向模板

```
(worst quality:1.4), (low quality:1.4), (normal quality:1.2), lowres, bad anatomy,
bad hands, extra fingers, fewer fingers, missing fingers, extra digit, extra limbs,
extra arms, extra legs, malformed limbs, fused fingers, too many fingers,
long neck, cross-eyed, mutated hands, polar lowres, bad body, bad proportions,
gross proportions, missing arms, missing legs, extra foot, bad feet, bird feet,
missing foot, text, error, cropped, jpeg artifacts, signature, watermark,
username, blurry, artist name, bad face, poorly drawn face, deformed iris,
deformed pupils, semi-realistic, 3d, render, cgi, painting, drawing, cartoon,
anime, sketch, disfigured, out of frame, duplicate, morbid, mutilated
```

### 2.2 SDXL 精简版

SDXL 模型本身质量较高，负向提示词可以更精简：

```
(worst quality:1.4), low quality, blurry, deformed, bad anatomy, bad hands,
extra fingers, watermark, text, signature, ugly, duplicate, morbid
```

### 2.3 按问题类型分类的负向关键词

**解剖问题（人物畸形）**：
```
bad anatomy, bad hands, extra fingers, fewer fingers, missing fingers,
fused fingers, extra limbs, extra arms, extra legs, malformed limbs,
long neck, bad proportions, gross proportions, deformed, disfigured,
mutated, cross-eyed, bad face, poorly drawn face
```

**质量问题（模糊/伪影）**：
```
(worst quality:1.4), (low quality:1.4), lowres, blurry, jpeg artifacts,
compression artifacts, noise, grain, pixelated, out of focus, soft focus
```

**风格问题（风格偏移）**：
```
# 要写实时排除：
painting, drawing, cartoon, anime, sketch, illustration, 3d render, cgi,
digital art, concept art, art style

# 要插画时排除：
photograph, photo, realistic, photorealistic, real life, raw photo
```

**内容问题（不需要的元素）**：
```
text, watermark, signature, logo, username, artist name, copyright,
border, frame, banner, caption, subtitle, stamp, label,
out of frame, cropped, cut off, duplicate, clone
```

---

## 3. 高级质量关键词

### 3.1 按风格分类的质量提升词

**写实摄影**：
```
award-winning photography, professional color grading, shot on Hasselblad,
Kodak Portra 400, Fujifilm Superia, medium format photography,
editorial photography, National Geographic quality, professional retouching,
skin detail, pore-level detail, catchlight in eyes, natural skin texture
```

**插画/概念艺术**：
```
trending on artstation, concept art, detailed illustration, digital painting,
matte painting, illustration by Greg Rutkowski, fantasy art, highly detailed,
intricate details, sharp lines, clean linework, vibrant illustration
```

**电影感（Cinematic）**：
```
cinematic still, anamorphic lens, film grain, color grading, cinematic lighting,
35mm film, movie scene, directed by Roger Deakins, Arri Alexa, widescreen,
letterbox, dramatic composition, volumetric lighting, lens flare, atmospheric haze
```

**美食摄影**：
```
professional food photography, food styling, appetizing, Michelin star plating,
studio food shot, editorial food photography, high-end restaurant,
macro food detail, steam visible, fresh ingredients, glossy sauce
```

**产品摄影**：
```
commercial product photography, studio lighting setup, clean background,
product hero shot, catalog photography, e-commerce quality,
reflection on surface, gradient background, floating product
```

### 3.2 细节增强词

当需要极致细节表现时，选择性添加以下关键词：

```
# 皮肤/人物细节
skin pores, skin texture, individual hair strands, peach fuzz,
catchlight, iris detail, fabric weave visible

# 物体/场景细节
micro-scratches, dust particles, fabric texture, wood grain,
surface imperfections, material texture, fine detail,
visible brush strokes (适用于画作), paper texture

# 环境细节
atmospheric particles, volumetric light rays, light scattering,
caustics, subsurface scattering, ambient occlusion
```

### 3.3 2026 趋势词

当前视觉审美趋势偏向以下方向，在小红书/抖音内容中尤为受欢迎：

```
# 真实感与不完美美学
authentic imperfection, film grain, lo-fi aesthetic, organic shapes,
analog photography, raw and unedited look, candid moment,
imperfect beauty, wabi-sabi aesthetic

# 柔和自然色调
muted earth tones, desaturated palette, Morandi colors,
soft pastel tones, warm undertones, natural color grading

# 氛围感/情绪优先
atmospheric, moody, ethereal, dreamy haze, soft glow,
golden hour warmth, blue hour melancholy, misty morning

# 复古回潮
Y2K aesthetic, 90s film photography, Polaroid style,
vintage color cast, retro grain, disposable camera look
```

---

## 4. Prompt 自动增强流程

当用户给出简单的中文描述时，使用以下流程将其转化为高质量结构化 prompt。

### 4.1 增强公式

```
[quality] + [subject] + [action/pose] + [environment] + [lighting] + [camera] + [style] + [color/mood]
```

### 4.2 增强步骤

**Step 1**：解析用户输入，提取关键信息
```
用户输入: "一个女生在咖啡馆看书"

解析:
- subject: 女生（需补充：年龄、发型、服装）
- action: 看书（需补充：姿态、表情）
- environment: 咖啡馆（需补充：风格、细节）
- lighting: 未指定（需推断）
- camera: 未指定（需推断）
- style: 未指定（需从作品方案推断）
- color/mood: 未指定（需推断）
```

**Step 2**：补充各维度细节，生成结构化 prompt
```
增强结果:
masterpiece, best quality, professional photography,
a young Chinese woman in her early twenties with long straight black hair,
wearing an oversized beige cardigan over a white t-shirt,
sitting by the window reading a paperback book with a gentle focused expression,
in a cozy minimalist coffee shop with wooden furniture and indoor plants,
warm natural window light with soft shadows,
medium shot with shallow depth of field f/2.0,
lifestyle photography editorial style,
warm cream and brown color palette, calm and contemplative mood
```

### 4.3 各维度关键词速查表

**Quality（质量）**：
| 级别 | 关键词 |
|------|--------|
| 基础 | `best quality, highly detailed` |
| 摄影 | `professional photography, award-winning, 8K` |
| 插画 | `masterpiece, detailed illustration, trending on artstation` |
| 电影 | `cinematic still, film quality, color graded` |

**Subject（主体）**：
| 维度 | 需要指定 |
|------|---------|
| 人物 | 族裔、年龄段、性别、发型(颜色+长度+造型)、服装(单品+颜色+面料)、表情、配饰 |
| 食物 | 菜品名、可见食材、摆盘风格、餐具、装饰 |
| 物品 | 品类、材质、颜色、尺寸参照、状态 |
| 动物 | 品种、毛色、体型、姿态 |

**Lighting（光线）**：
| 场景 | 推荐光线 |
|------|---------|
| 室内日常 | `soft natural light, window light, diffused daylight` |
| 户外白天 | `bright natural sunlight, open shade, golden hour` |
| 餐厅/咖啡馆 | `warm ambient lighting, candle light, cozy warm light` |
| 夜景/都市 | `neon lights, city lights, street lamp, moody blue hour` |
| 产品/棚拍 | `studio lighting, softbox, three-point lighting` |

**Camera（镜头）**：
| 意图 | 推荐参数 |
|------|---------|
| 突出人物情绪 | `close-up, shallow depth of field, f/1.8, 85mm lens` |
| 展示环境关系 | `medium shot, f/2.8, 35mm lens` |
| 大场景/风光 | `wide angle, deep focus, f/8, 24mm lens` |
| 产品/美食 | `macro shot, overhead view, 90mm macro lens` |
| 时尚/人像 | `full body shot, fashion photography, 50mm lens` |

**Color/Mood（色彩/情绪）**：
| 情绪 | 色彩关键词 |
|------|-----------|
| 温馨/舒适 | `warm tones, earth palette, cream and brown, cozy` |
| 清新/自然 | `fresh green, light blue, pastel, airy` |
| 高级/克制 | `Morandi palette, muted tones, desaturated, minimal` |
| 活力/年轻 | `vibrant colors, bold palette, pop of color, energetic` |
| 复古/怀旧 | `vintage color cast, warm yellow tint, faded, retro` |
| 冷酷/科技 | `cool blue tones, metallic, monochrome, futuristic` |

---

## 5. 风格一致性进阶

### 5.1 面部一致性技术

当同一角色需要在多张图中保持面部一致时：

**InstantID**：
- 原理：从单张参考照片提取面部特征，注入生成过程
- 适用：需要特定人物外貌的场景
- 使用方式：提供一张清晰正面照作为参考图

**IP-Adapter（Face）**：
- 原理：将参考图的面部特征作为额外条件输入
- 适用：角色在不同场景中需保持一致
- 权重建议：0.6-0.8（太高会失去多样性，太低会失去相似度）

> 目前 pipeline 中通过即梦的 `--ref-image` 参数可部分实现面部参考。
> 完整的 InstantID/IP-Adapter 需要本地部署 ComfyUI 等工具。

### 5.2 角色一致性技术

**LoRA（Low-Rank Adaptation）**：
- 原理：用少量图片（5-20 张）微调模型，学习特定角色/风格
- 适用：系列内容中的固定角色、固定画风
- 训练数据要求：同一角色的不同角度、不同表情、不同光线照片
- 注意：需要本地 SD 环境，即梦/DALL-E 不支持自定义 LoRA

**无 LoRA 时的替代方案**：
- 每张图都完整复制角色描述（不要缩写，参见 SKILL.md 技巧二）
- 使用参考图（ref-image）引导
- 固定种子值（seed）+ 微调 prompt 变化部分

### 5.3 色板锚定：按内容类型的 hex 色值示例

为 prompt 中的色彩参考提供具体 hex 值，比模糊的"暖色调"更精确：

**生活方式/日常**：
```
color palette: warm cream (#F5E6CC), soft terracotta (#C4785B),
sage green (#9CAF88), natural wood (#8B6914), linen white (#FAF0E6)
```

**美食/咖啡馆**：
```
color palette: espresso brown (#3C2415), cream (#FFFDD0),
warm caramel (#FFD59A), olive green (#808000), ceramic white (#F5F5F0)
```

**科技/数码**：
```
color palette: deep navy (#0A1628), electric blue (#0066FF),
silver grey (#C0C0C0), pure white (#FFFFFF), accent cyan (#00D4FF)
```

**清新/自然**：
```
color palette: mint green (#98FF98), sky blue (#87CEEB),
lavender (#E6E6FA), soft pink (#FFB6C1), cloud white (#F0F0F0)
```

**复古/怀旧**：
```
color palette: faded mustard (#C9A855), dusty rose (#DCAE96),
olive drab (#6B8E23), warm sepia (#704214), aged paper (#F5E6C8)
```

**高级/极简**：
```
color palette: charcoal (#36454F), off-white (#FAF9F6),
warm grey (#A9A9A9), matte black (#28282B), sand (#C2B280)
```

### 5.4 小红书 7 大质量标准

在为小红书生成内容时，每张图片都需满足以下标准：

| 标准 | 检查点 | prompt 中如何引导 |
|------|--------|-----------------|
| **调色统一** | 整组图片色调一致，无忽冷忽暖 | 每张 prompt 附加相同的 color palette hex 值 |
| **构图精美** | 主体突出，遵循三分法/对称/引导线 | 明确指定构图方式：`rule of thirds`, `centered composition` |
| **光线自然** | 无过曝/欠曝，光影方向合理 | 指定光线类型和方向：`soft natural light from left` |
| **细节丰富** | 纹理清晰，材质可辨 | 添加细节关键词：`highly detailed, texture visible, sharp focus` |
| **白平衡准确** | 白色物品不偏色，肤色自然 | 添加：`accurate white balance, natural skin tone` |
| **背景干净** | 无杂乱元素分散注意力 | 添加：`clean background, minimal, uncluttered` |
| **宽高比统一** | 同组图片比例一致 | 所有图片使用相同的 width/height 参数 |

---

## 快速参考：模型 prompt 转换

当你已有一个模型的 prompt，需要转换到另一个模型时：

| 从 → 到 | 转换要点 |
|---------|---------|
| SDXL → Flux | 去掉加权 `(x:1.2)`，去掉负向提示词，改为自然语言散文 |
| SDXL → 即梦 | 可保留关键词结构，添加中文描述，去掉加权语法 |
| Flux → SDXL | 提取关键词，添加加权，补充负向提示词 |
| 任意 → DALL-E 3 | 改写为详细段落描述，像写给画师的 brief |
| 中文描述 → 英文 prompt | 用 LLM 翻译并按增强公式结构化 |
