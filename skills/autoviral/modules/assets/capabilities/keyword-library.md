---
name: keyword-library
description: Use as a lookup when writing any video/image prompt and you need a high-impact phrase that's been validated by 2026 viral / cinematic prompt corpora. Reference table only — DO NOT just shotgun keywords from this list. Pick 1-2 per category that match the emotional intent. Skip and you fall back to "高质量、4K、电影感" 这种空词.
type: capability
priority: flexible
sources:
  - https://www.acceptprompt.com/blog/ai-video-prompts (高频关键词分析)
  - https://aimlapi.com/blog/master-the-art-of-ai-top-10-prompts-for-flux-1-by-black-forests-labs
  - https://prompthero.com/flux-realistic-prompts (社区高赞)
  - https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts (2000+ curated)
---

# Keyword Library — 惊艳关键词分类索引

业界 2026 年 viral / cinematic prompt 反复出现的关键词集合。每个关键词都**真实可用** + **真实改输出**——不是 SEO 凑词。

> **使用方法**：写 prompt 时，按情感意图先选 archetype（参 `viral-archetypes.md`），再来这里**精挑 1-2 个**关键词加进 prompt。**不要堆砌**——业界铁律 "kitchen sink approach"（关键词大杂烩）会**降低**输出质量。

---

## 1. 光线（最高 ROI 维度）

### 1.1 高级 lighting phrase

| 关键词 | 效果 | 何时用 |
|---|---|---|
| `subsurface scattering` | 皮肤透光、肉感 | 人像（**人像必加**） |
| `volumetric lighting` / `God rays` | 空气中可见光束 | 室内逆光、晨雾、教堂、神秘氛围 |
| `halation` | 高光晕开（胶片效应）| 复古、温暖怀旧、电影感 |
| `caustics` | 水/玻璃折射光斑 | 水下、泳池、玻璃器皿、奢华质感 |
| `practical lights` | 画面内可见光源 | 夜景、室内、电影叙事感 |
| `motivated lighting` | 看起来像自然光源 | 写实场景，避免棚拍感 |
| `chiaroscuro` | 强明暗对比 | 戏剧性、film noir、肖像 |
| `low-key lighting` | 暗调主导 | 神秘、紧张、film noir |
| `high-key lighting` | 亮调主导 | 时尚、清新、商业广告 |
| `Rembrandt lighting` | 三角形高光、伦勃朗式 | 古典肖像、油画质感 |
| `golden hour rim light` | 金色逆光镶边 | 温暖、浪漫、纪念性 |
| `blue hour ambient` | 蓝色环境光 | 忧郁、安静、电影夜景 |
| `dappled light` | 树荫斑驳光 | 自然、童年、文艺 |
| `harsh noon shadows` | 正午硬阴影 | 干燥、紧张、超现实 |

### 1.2 色温 / 色调

| 关键词 | K 值 | 视觉感受 |
|---|---|---|
| `tungsten warm` | 2700-3200K | 室内白炽、温暖怀旧 |
| `golden hour` | 3200-3500K | 黄昏、浪漫 |
| `daylight balanced` | 5500K | 标准日光、商业 |
| `overcast diffuse` | 6500K | 阴天柔光、无方向 |
| `blue hour` | 8000-10000K | 黎明黄昏冷蓝 |
| `mixed sodium and neon` | — | 都市夜景 |
| `mixed tungsten and daylight` | — | 室内窗光，电影感 |

---

## 2. 色调 / 调色（grade）

业界反复出现的**色彩 grade phrase**：

| 关键词 | 描述 | 适合 |
|---|---|---|
| `teal-and-orange grade` | 影院最常用补色对比 | 商业大片、动作、高级感 |
| `cyan-amber complementary` | 同上变体（teal/orange 的高级名） | 同上 |
| `Morandi muted palette` | 高级灰调 | 极简、editorial、奢侈品 |
| `Kodak Portra 400 emulation` | 温暖人像胶片 | 人像、生活方式、暖怀旧 |
| `Kodak Vision3 250D` | 数字电影胶片日光 | 户外纪实、电影感 |
| `Kodak Vision3 500T` | 数字电影胶片钨丝 | 室内电影、夜景 |
| `Fujifilm Eterna` | 低对比胶片 | 柔和、克制、艺术片 |
| `Fujifilm Velvia` | 高饱和胶片 | 风光、自然、鲜艳 |
| `Cinestill 800T` | 灯光胶片 | 都市夜景、霓虹、halation |
| `desaturated cool` | 去饱和冷调 | 忧郁、Sci-fi、距离感 |
| `crushed shadows` | 黑位深陷 | 戏剧性、film noir |
| `lifted blacks` | 黑位提升 | 复古、雾感、温柔 |
| `bleach bypass` | 跳漂白工艺 | 战争、纪实、粗砺 |
| `solarpunk vibrant` | 太阳朋克饱和 | 自然/科技融合、希望 |
| `Sahara warm palette` | 撒哈拉色（赤陶/骨白/赭石） | 大地、自由、流浪 |
| `Wes Anderson symmetrical pastel` | 韦斯安德森粉彩对称 | 童趣、对称、童话 |
| `Blade Runner cyberpunk neon` | 银翼杀手霓虹 | 未来、霓虹、雨夜 |

---

## 3. 质感 / 物理纹理

| 关键词 | 触发的物理属性 |
|---|---|
| `fine 35mm grain` | 细颗粒胶片质感 |
| `coarse 16mm grain` | 粗颗粒胶片 |
| `digital sensor noise` | 数码高 ISO 噪点 |
| `motion blur trailing` | 运动模糊拖影 |
| `lens distortion` | 广角变形（要时才加，否则 negative 里去除）|
| `chromatic aberration` | 色散（复古镜头）|
| `vignetting` | 暗角 |
| `bloom on highlights` | 高光过曝晕染 |
| `shallow DOF f/1.4` | 极浅景深 |
| `bokeh balls` | 圆形虚化光斑 |
| `anamorphic flare horizontal` | 宽银幕水平光斑 |
| `film scratches and dust` | 胶片划痕（怀旧极强）|
| `Polaroid edge wear` | 拍立得边缘磨损 |
| `VHS tracking lines` | VHS 信号干扰 |
| `4K sharp focus` | 高分辨率清晰 |
| `8K hyperdetailed` | 超分辨率细节 |

---

## 4. 镜头 / 设备名（**真改输出**）

Seedance 2.0 / Flux / DALL-E 3 训练时见过具体型号——点名会推动输出向那个美学。

### 4.1 数字电影机

| 设备 | 美学倾向 |
|---|---|
| `ARRI Alexa Mini` | 电影标准、自然肤色、宽容度高 |
| `ARRI Alexa 35` | 同上更新款 |
| `Sony Venice` | 数字电影、清晰、商业广告标杆 |
| `RED Komodo` | 紧凑高分辨率、动作 |
| `RED V-Raptor` | 高速、慢动作 |
| `Phantom Flex 4K` | 极致慢动作专用 |
| `Canon C70` | 纪实、Vlog、自然 |
| `Sony FX3 / FX6` | 现代纪实、Vlog 高级版 |
| `Blackmagic Pocket 6K` | 独立电影感、廉价电影 |

### 4.2 静态相机

| 设备 | 美学 |
|---|---|
| `Hasselblad X2D 100C` | 中画幅、时尚、editorial |
| `Phase One IQ4 150MP` | 商业巅峰、产品广告 |
| `Leica M11` | 街头、纪实、自然 |
| `Fujifilm GFX 100S` | 中画幅数码、人像 |
| `Canon EOS R5` | 全能、自然 |
| `Nikon Z9` | 新闻、动作 |
| `iPhone 15 Pro / 16 Pro` | 现代 vlog、UGC、亲切 |

### 4.3 胶片相机

| 设备 | 美学 |
|---|---|
| `Bolex 16mm` | 复古电影、文艺 |
| `Super 8 home video` | 童年、家庭录像 |
| `Hasselblad 500CM medium format` | 经典中画幅 |
| `Pentax 67` | 时尚胶片中画幅 |
| `Leica M6 with Tri-X` | 街头黑白经典 |
| `Polaroid SX-70` | 拍立得即时 |

### 4.4 镜头 / 滤镜（很关键）

| 关键词 | 效果 |
|---|---|
| `Cooke S4 prime` | 经典电影柔和肤色 |
| `Zeiss Master Prime` | 现代清晰电影感 |
| `Black Pro-Mist 1/4` | 高光柔晕（人像必加） |
| `Black Pro-Mist 1/2` | 更强柔晕 |
| `Tiffen Glimmerglass 1/4` | 柔光磨砂 |
| `anamorphic 1.8x` | 横向压缩、椭圆 bokeh |
| `tilt-shift` | 微缩景观感 |
| `petzval lens` | 古典漩涡 bokeh |
| `Lensbaby Velvet` | 柔焦艺术 |
| `f/1.4 shallow DOF` | 极浅景深 |
| `f/8 deep focus` | 全景深 |

---

## 5. 运镜 / 镜头运动（动词级）

| 关键词 | 动作 |
|---|---|
| `slow dolly in` | 缓慢推近 |
| `quick dolly in` | 快推 |
| `dolly out / pull back` | 拉远 |
| `tracking shot` | 跟拍（侧向）|
| `following shot` | 跟拍（背向）|
| `whip pan` | 快速平移 |
| `slow lateral pan` | 缓慢横移 |
| `tilt up / tilt down` | 摇上 / 摇下 |
| `crane up / crane down` | 升降镜头 |
| `arc shot` | 弧形围绕 |
| `orbit shot` | 360 围绕 |
| `rack focus` | 焦点变化 |
| `pull focus to background` | 焦点拉到后景 |
| `push-in close-up` | 推到特写 |
| `Steadicam follow` | 稳定器跟随 |
| `handheld with subtle shake` | 手持轻晃 |
| `handheld found-footage` | 手持伪纪录 |
| `static locked-off` | 固定锁机位 |
| `POV first-person` | 第一视角 |
| `over-the-shoulder` | 越肩拍 |
| `Dutch angle` | 倾斜画面 |
| `bird's eye view` | 鸟瞰 |
| `worm's eye view` | 极低视角 |

---

## 6. 美学 / 风格 phrase

### 6.1 时代美学

| 关键词 | 视觉语言 |
|---|---|
| `1970s romantic drama` | 暖色暖光、胶片颗粒、高光晕开 |
| `1980s VHS aesthetic` | VHS 噪点、扫描线、饱和色 |
| `1990s film grain documentary` | 粗颗粒、新闻纪实色 |
| `2000s digital MiniDV` | 早期数码低饱和 |
| `Y2K aesthetic` | 千禧年金属感、霓虹 |

### 6.2 流派

| 关键词 | 视觉感 |
|---|---|
| `solarpunk` | 自然 + 科技 + 饱和、希望 |
| `cyberpunk noir` | 霓虹 + 雨夜 + 反乌托邦 |
| `wabi-sabi` | 不完美美学、克制、自然 |
| `cottagecore` | 田园浪漫、暖色、自然 |
| `dark academia` | 学院派、深色、复古 |
| `liminal space` | 阈限空间、空旷、不安 |
| `vaporwave` | 蒸汽波、粉紫、复古未来 |
| `brutalist` | 野兽派、混凝土、几何 |
| `minimalist Scandinavian` | 极简北欧 |
| `Japanese minimalism` | 日式极简、留白 |
| `Wes Anderson symmetrical` | 韦斯安德森式对称粉彩 |
| `Studio Ghibli pastoral` | 吉卜力田园 |
| `David Lynch surreal` | 林奇式超现实 |
| `Roger Deakins cinematography` | 罗杰·迪金斯式（自然光大师）|
| `Wong Kar-wai dreamy` | 王家卫式手持迷离 |

### 6.3 情绪 phrase

| 关键词 | 触发 |
|---|---|
| `nostalgic and contemplative` | 怀旧沉思 |
| `bittersweet` | 苦甜参半 |
| `melancholic and tender` | 忧郁温柔 |
| `triumphant and visceral` | 胜利感、本能反应 |
| `awe-inspiring` | 敬畏感 |
| `serene and reflective` | 安静沉思 |
| `tense and breathless` | 紧张、屏息 |
| `deadpan absurd` | 一本正经的荒诞 |
| `dreamlike and ethereal` | 梦幻、缥缈 |
| `raw and elemental` | 粗砺、原始 |
| `intimate and tender` | 亲密、温柔 |
| `playful and whimsical` | 玩味、奇思 |

---

## 7. 构图 / 视觉语法

| 关键词 | 效果 |
|---|---|
| `rule of thirds` | 三分法 |
| `golden ratio composition` | 黄金分割 |
| `centered composition` | 中心构图（用于强对称美学）|
| `negative space on the right` | 右侧留白 |
| `low-angle hero shot` | 低角度英雄镜头 |
| `Dutch tilt for tension` | 倾斜画面制造紧张 |
| `framed within architecture` | 建筑构图 |
| `leading lines` | 引导线 |
| `symmetrical balance` | 对称平衡 |
| `asymmetric balance` | 不对称平衡 |
| `high horizon line` | 高地平线（人物压低画面）|
| `low horizon line` | 低地平线（强调天空）|
| `over-the-shoulder framing` | 越肩构图 |
| `extreme close-up macro` | 极特写 |
| `wide establishing shot` | 大全景定场 |

---

## 8. 防御性 negative（反向引导清单）

加在 prompt 末尾 `Negative: ...` 行。**至少必加**：

```
no distortion, no extra fingers, no malformed hands, no subtitles, 
no text overlays, no watermarks, no signatures.
```

按场景**追加**：

| 场景 | 追加 negative |
|---|---|
| 写实人像 | `no cartoon, no anime, no 3D render, no digital art` |
| 动作 | `no smooth tripod feel`（要手持感时）|
| 卡通/插画 | `no photograph, no realistic, no raw photo` |
| 干净商业 | `no grain, no noise, no compression artifacts` |
| 复古 | `no modern saturation, no clean digital look` |
| 严肃喜剧 | `no comedic music, no laugh track, no cartoon` |
| 食物 | `no plastic-looking food, no overcooked browns` |
| 海报留白 | `no busy background, no cluttered elements` |

---

## 9. 高频"惊艳 prompt"出现的句式模板

业界 viral 案例反复出现的 closing line 模式（直接套）：

```
Cinematic [Ns] clip, [film stock] emulation, [grain spec], 
[color grade], [overall mood], shot on [camera] with [lens] 
at [aperture], [optional lens character].

Negative: no distortion, no extra fingers, no subtitles, 
no text overlays, [scene-specific].
```

填空例：

```
Cinematic 8s clip, Kodak Portra 400 emulation, fine grain, 
warm Morandi nostalgic palette, contemplative and tender mood, 
shot on Hasselblad medium format with 80mm at f/2, 
Black Pro-Mist 1/4 softening highlights.

Negative: no distortion, no extra fingers, no subtitles, 
no text overlays, no anime, no 3D render.
```

---

## 10. 反例：堆砌关键词 = 输出降质

❌ 反例（kitchen sink approach）:
```
A girl, photorealistic, 8K, masterpiece, best quality, ultra detailed, 
cinematic, dramatic lighting, beautiful, stunning, award winning, 
trending on artstation, hyperdetailed, sharp focus, realistic, 4K, 
HDR, professional photography, golden hour, bokeh, depth of field, 
volumetric, ray tracing
```

**为什么糟**：模型在 30 个等权关键词间漂移，每个权重被稀释。输出会变 generic AI default。

✅ 改写（精挑）:
```
Editorial portrait on Hasselblad X2D with XCD 80mm at f/2: 
[a young Asian woman in her late twenties with shoulder-length 
black hair, almond eyes, faint smile], 
warm golden-hour key light from camera-left through linen curtain, 
subsurface scattering on her cheek, halation on highlights, 
shallow DOF rendering background into amber bokeh.

Cinematic editorial still, Kodak Portra 400 emulation, fine grain, 
Morandi warm palette, nostalgic mood.

Negative: no distortion, no extra fingers, no subtitles, no anime.
```

**对比**：第二个 prompt 关键词数量更少，但每个都**承担明确职责**（camera 锚定美学 / lighting 4 维度齐 / closing 完整定调 / negative 防御）。

---

## See also

- `video-prompt-narrative.md` — Seedance 2.0 timeline 协议
- `image-prompt-narrative.md` — OpenRouter 主通道范式
- `viral-archetypes.md` — 4 大 viral 原型
- `model-paradigms.md` — 不同模型的 prompt 范式分化
- `taste/04-design-and-text.md` — 设计与排版的道
