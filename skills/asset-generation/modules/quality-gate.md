---
name: quality-gate
description: 素材质量门控模块——生成后自检清单、常见AI生成问题修复策略、美学评分工具参考。在展示生成结果给用户前进行质量评估。
---

# 质量门控模块

本模块定义了 AI 生成素材在展示给用户**之前**应执行的质量评估流程。目标是在用户看到结果前，先自行判断质量是否达标，减少无效的"生成-否决-重生成"循环。

---

## 1. 视觉质量自检清单

每次素材生成完成后，按以下四个维度逐项检查：

### 1.1 技术质量

| 检查项 | 合格标准 | 不合格的典型表现 |
|--------|---------|----------------|
| 清晰度 | 主体边缘锐利，无明显模糊 | 整体发糊、局部失焦（非刻意虚化） |
| 无伪影 | 无色块、无条纹、无马赛克、无光晕异常 | JPEG压缩纹理、棋盘格伪影、彩色噪点 |
| 无畸变 | 人物比例正常、直线不弯曲 | 手指数量错误、肢体扭曲、建筑线条弯曲 |
| 色彩自然 | 肤色真实、白平衡正确、无过饱和 | 皮肤偏绿/偏紫、白色物品偏色、荧光色 |
| 分辨率 | 输出尺寸符合请求规格 | 输出尺寸与请求不符 |

### 1.2 构图质量

| 检查项 | 合格标准 | 不合格的典型表现 |
|--------|---------|----------------|
| 主体突出 | 主体在画面中清晰可辨、位置得当 | 主体被背景淹没、偏到边缘、比例过小 |
| 空间平衡 | 画面重心稳定、留白合理 | 一侧过于拥挤、另一侧空旷 |
| 引导线合理 | 视线自然引导向主体 | 背景线条将视线引出画面 |
| 无截断 | 重要元素完整呈现 | 人物手脚被截断（非刻意裁切）、物品不完整 |

### 1.3 风格一致性

| 检查项 | 合格标准 | 不合格的典型表现 |
|--------|---------|----------------|
| 色调统一 | 与同组前序素材色温、饱和度一致 | 前一张暖色调，这一张冷色调 |
| 角色外观 | 同一角色的发型、服装、体型一致 | 角色发型/服装忽然改变 |
| 风格统一 | 写实/插画/3D 风格不跳变 | 前一张写实风，这一张突然卡通化 |
| 光影方向 | 光源方向与同组素材一致 | 前一张左侧光，这一张顶光 |

### 1.4 平台适配

| 检查项 | 合格标准 | 不合格的典型表现 |
|--------|---------|----------------|
| 尺寸正确 | 宽高比符合目标平台规格 | 抖音竖屏内容生成了横版素材 |
| 安全区域 | 重要元素不在顶部/底部被UI遮挡的区域 | 人脸在抖音顶部状态栏区域 |
| 文字区域 | 预留了后期叠加文字的空间（如需要） | 画面过满，无处放标题/字幕 |

### 自检流程

```
生成完成
  ↓
[技术质量检查] → 不合格 → 自动重新生成（调整prompt）
  ↓ 合格
[构图质量检查] → 不合格 → 自动重新生成（调整prompt）
  ↓ 合格
[风格一致性检查] → 不合格 → 自动重新生成（增加风格锚定词）
  ↓ 合格
[平台适配检查] → 不合格 → 调整参数后重新生成
  ↓ 合格
展示给用户 ✓
```

> 注意：自动重试最多 1 次。如果重试后仍不达标，将两次结果都展示给用户，说明存在的问题，让用户决定是否接受或进一步调整。

---

## 2. 常见 AI 生成问题及修复

### 2.1 手部畸形

**问题表现**：多余手指、手指融合、关节方向错误、手掌比例失调

**修复策略**：
- 在 prompt 中强调手部描述：`natural hand position, five fingers on each hand, anatomically correct hands, relaxed hand pose`
- 如果手部不是画面重点，用道具遮挡：`hands holding a coffee cup`、`hands in pockets`
- 负向提示词（SD系列）：`bad hands, extra fingers, fewer fingers, fused fingers, deformed hands, mutated hands`
- 使用参考图引导手部姿态

### 2.2 文字乱码

**问题表现**：图片中出现无法辨认的字符、变形文字、随机字母

**修复策略**：
- **根本原则：不要在 prompt 中要求生成文字**
- 如果需要画面中出现文字，在后处理阶段用设计工具叠加
- 如果确实需要文字元素（如招牌、书本），添加：`no text, no letters, no writing, blank pages, empty signage`
- 用模糊效果规避：`text out of focus, blurred background text`

### 2.3 面部不一致

**问题表现**：同一角色在不同生成中长相差异大

**修复策略**：
- 每次生成都使用完全相同的角色描述文本（不要缩写或改写）
- 使用参考图（ref-image）锚定面部特征
- 固定种子值（seed）并只微调场景相关词汇
- 考虑使用 LoRA/InstantID（详见 `modules/prompt-mastery.md` 第 5 节）

### 2.4 色彩过饱和

**问题表现**：颜色不自然地鲜艳、荧光感、像 HDR 过度处理

**修复策略**：
- 正向添加：`natural color, muted tones, subtle color palette, realistic color grading, desaturated`
- 负向添加（SD系列）：`oversaturated, vibrant, neon, HDR, high saturation, fluorescent`
- 指定具体色板（hex值）限制色域范围
- 添加胶片感关键词中和：`Kodak Portra 400, film color science, analog color`

### 2.5 背景杂乱

**问题表现**：背景出现无关物体、纹理混乱、元素过多

**修复策略**：
- 正向添加：`clean background, minimal background, uncluttered, simple backdrop, negative space`
- 使用浅景深虚化背景：`shallow depth of field, f/1.4, bokeh background, blurred background`
- 明确指定背景内容：`plain white wall background`、`solid color backdrop`
- 负向添加（SD系列）：`cluttered, busy background, messy, chaotic`

### 2.6 光影不合理

**问题表现**：多个光源方向矛盾、阴影方向错误、光照不一致

**修复策略**：
- 明确指定单一主光源方向：`key light from upper left, single light source`
- 添加光影一致性关键词：`consistent lighting, natural shadow direction, physically accurate lighting`
- 参考真实摄影布光：`three-point lighting setup, fill light on right`

### 2.7 画面重复/克隆

**问题表现**：画面中同一元素重复出现（如两个相同的人、重复的物品）

**修复策略**：
- 明确指定数量：`a single woman, one person only, solo`
- 负向添加（SD系列）：`duplicate, clone, multiple copies, repeated elements`
- 简化场景复杂度，减少 prompt 中的元素数量

---

## 3. 美学评分工具参考

以下工具可以对生成的图片进行量化评估，在 pipeline 中可作为自动化质量门控的一环。

### 3.1 Aesthetic Predictor V2.5（美学评分）

评估图片的整体美学质量，输出 1-10 分的评分。

```bash
# 安装
pip install aesthetic-predictor-v2-5

# Python 使用
from aesthetic_predictor_v2_5 import convert_v2_5_from_siglip
from PIL import Image
import torch

model, preprocessor = convert_v2_5_from_siglip(
    low_cpu_mem_usage=True,
    trust_remote_code=True,
)
model = model.to(torch.bfloat16).cuda().eval()

image = Image.open("generated_image.png").convert("RGB")
pixel_values = preprocessor(images=image, return_tensors="pt").pixel_values
pixel_values = pixel_values.to(torch.bfloat16).cuda()

with torch.inference_mode():
    score = model(pixel_values).logits.squeeze().float().cpu().numpy()

print(f"美学评分: {score:.2f}")
```

**评分参考**：
| 分数区间 | 质量等级 | 建议操作 |
|---------|---------|---------|
| >= 6.5 | 优秀 | 直接使用 |
| 5.5 - 6.5 | 良好 | 可以使用，建议微调 |
| 4.5 - 5.5 | 一般 | 考虑重新生成 |
| < 4.5 | 较差 | 必须重新生成 |

### 3.2 PyIQA / MUSIQ（技术质量评估）

评估图片的技术质量（清晰度、噪声、压缩伪影等），不涉及美学判断。

```bash
# 安装
pip install pyiqa

# Python 使用
import pyiqa

# MUSIQ 模型（无参考图像质量评估）
musiq_metric = pyiqa.create_metric('musiq', device='cuda')
score = musiq_metric('generated_image.png')
print(f"技术质量评分: {score.item():.2f}")

# 也可以用其他指标
clipiqa_metric = pyiqa.create_metric('clipiqa+', device='cuda')
score = clipiqa_metric('generated_image.png')
print(f"CLIP-IQA+ 评分: {score.item():.4f}")
```

**适用场景**：检测模糊、噪声、伪影等技术缺陷，适合作为第一道自动筛选。

### 3.3 ImageReward（文本-图像对齐评估）

评估生成的图片与输入 prompt 的语义匹配程度。

```bash
# 安装
pip install image-reward

# Python 使用
import ImageReward as RM

model = RM.load("ImageReward-v1.0")

score = model.score(
    "a young Chinese woman reading in a cozy coffee shop, warm lighting",
    "generated_image.png"
)
print(f"文本-图像对齐分数: {score:.4f}")

# 多图排序（选出最匹配 prompt 的图）
ranking = model.rank(
    "prompt text here",
    ["image_1.png", "image_2.png", "image_3.png"]
)
print(f"最佳图片排序: {ranking}")
```

**适用场景**：当一次生成多张候选图时，用该分数选出最符合 prompt 意图的一张。

### 3.4 Pipeline 集成建议

在自动化 pipeline 中，这些工具可以按以下方式组合使用：

```
生成图片
  ↓
[MUSIQ 技术质量] → 低于阈值 → 自动重新生成
  ↓ 通过
[Aesthetic Predictor 美学评分] → 低于阈值 → 自动重新生成（优化prompt）
  ↓ 通过
[ImageReward 文本对齐] → 低于阈值 → 自动重新生成（调整prompt语义）
  ↓ 通过
通过质量门控 ✓ → 展示给用户
```

> **当前状态**：这些工具需要 GPU 环境运行，目前作为参考。
> 在没有 GPU 环境时，依靠上述第 1 节的人工自检清单进行质量判断。
> 未来可在服务端部署这些模型，通过 API 调用实现全自动质量门控。

---

## 快速参考卡

**生成后必查 Top 5**：

1. 手指数量对吗？（数一数，5 根/手）
2. 色调和前一张统一吗？（对比查看）
3. 主体在安全区域内吗？（顶部/底部留余量）
4. 有文字乱码吗？（特别是招牌、书页区域）
5. 分辨率和宽高比对吗？（检查输出参数）

**常见问题速修表**：

| 问题 | 快速修复关键词 |
|------|--------------|
| 手部畸形 | `natural hand position, five fingers, hands holding [object]` |
| 文字乱码 | 不要在 prompt 中要求文字，后处理叠加 |
| 面部不一致 | 完整复制角色描述 + ref-image |
| 过饱和 | `natural color, muted tones, Kodak Portra 400` |
| 背景杂乱 | `clean background, shallow depth of field, bokeh` |
| 光影矛盾 | `single light source from [direction], consistent lighting` |
| 元素重复 | `single [subject], one person only, solo` |
