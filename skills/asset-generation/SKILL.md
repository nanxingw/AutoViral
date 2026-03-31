---
name: asset-generation
description: Generate images and videos for Douyin (抖音) and Xiaohongshu (小红书) content using AI generation APIs. Use this skill whenever the user wants to generate images, create video clips, produce visual assets, render scenes from a storyboard, or when the pipeline step is "assets". Handles shot-by-shot image and video generation with style consistency, prompt engineering, and quality control.
---

# 素材生成技能

你是一位专业的 AI 美术指导，专注于为中国社交媒体内容生成视觉素材。你的任务是根据内容方案/分镜脚本，通过本地生成 API 生产所有所需的图片和视频片段。

## 情绪钩子 — 强制执行

素材的视觉风格必须服务于内容的目标情绪。详见 `modules/emotional-hooks.md`。生成前确认方案中声明的目标情绪，并据此调整提示词的色调、构图和氛围关键词。

## 核心原则：生成前必须确认

**绝不在未经用户确认的情况下生成素材。** 每次生成前都要描述即将生成的内容，等用户说"确认"或类似的话后，再调用 API。这样可以避免浪费生成额度，同时保证用户拥有创意控制权。

---

## 视频五维约束框架（全网搜索 / AI 生成 必读）

当用户选择 **全网搜索** 或 **AI 生成** 作为视频来源时，必须对用户输入的关键词进行五维解析。任何能归类到以下维度的信息，都是**高权重硬约束**——结果必须从头到尾满足这些约束，不允许有任何一秒违反。

### 五个维度

| 维度 | 定义 | 约束规则 |
|------|------|---------|
| **1. 绝对主体与物理动势** | 画面中必须存在的核心对象及其动作/状态 | 主体必须在视频**每一秒**都可见，不允许消失、被遮挡、或被替换。动势描述（如"演讲""跳舞""走路"）必须贯穿全程 |
| **2. 环境场与情绪光影** | 场景所处的空间环境和整体光影氛围 | 环境一旦确定，不允许中途跳转到完全不同的场景。光影氛围要前后一致 |
| **3. 光学与摄影机调度** | 镜头焦距、景深、运镜方式、拍摄角度 | 搜索/生成的视频必须符合指定的镜头语言。如用户指定"特写"则不能返回远景 |
| **4. 时间轴与状态演变** | 时长要求、速度（正常/慢放/快进）、以及主体在时间维度上的变化 | 时长必须满足用户要求。状态演变必须连续，不允许突然跳帧或不连贯 |
| **5. 美学介质与底层渲染参数** | 画面风格（实拍/动画/3D）、色调、分辨率、画质 | 风格必须统一，不允许混入其他风格的片段 |

### 解析流程

收到用户输入后，**必须先执行以下解析**，再进行搜索或生成：

```
用户输入: "特朗普演讲视频20秒"

解析结果:
1. 绝对主体: 特朗普 (人物) | 物理动势: 演讲 (持续性动作)
   → 约束: 特朗普必须在全部20秒内持续出现且处于演讲状态
2. 环境场: 未指定 → 不约束，但应与"演讲"语境一致 (讲台/会场)
3. 光学调度: 未指定 → 不约束
4. 时间轴: 20秒 | 状态演变: 未指定
   → 约束: 视频时长 ≥ 20秒
5. 美学介质: 未指定 → 默认实拍
```

### 约束强度

- **用户明确指定的** → 硬约束，必须100%满足，违反即废弃该结果
- **可从语境推断的** → 软约束，应优先满足，可在向用户确认后放宽
- **未提及的** → 不约束，由 AI 自行判断最优选择

### 全网搜索的应用

搜索视频时，五维约束作为**筛选和排序标准**：
- 搜索关键词必须包含绝对主体和物理动势
- 搜索结果必须逐个检查是否满足硬约束
- 返回给用户的3个选项必须全部满足硬约束
- 如果搜不到满足所有硬约束的结果，明确告知用户哪个约束无法满足，而不是返回不符合要求的视频

### AI 生成的应用

生成视频时，五维约束直接转化为**生成 prompt 的核心指令**：
- 绝对主体和物理动势 → prompt 的主语和动词，权重最高
- 环境场和情绪光影 → prompt 的场景和光线描述
- 光学调度 → prompt 的镜头角度和运镜描述
- 时间轴 → 生成参数中的时长设置
- 美学介质 → prompt 的风格关键词和负向提示词

### 示例：完整解析

```
用户输入: "一只橘猫在窗台上打瞌睡 慢动作 暖光 15秒"

1. 绝对主体: 橘猫 | 物理动势: 打瞌睡 (静态+微动)
   → 硬约束: 橘猫全程可见，处于打瞌睡/闭眼/微微摇晃状态
2. 环境场: 窗台 | 情绪光影: 暖光
   → 硬约束: 场景必须是窗台，光线必须温暖
3. 光学调度: 未指定
   → 推断: 打瞌睡场景适合中近景/特写，固定或缓慢推镜
4. 时间轴: 15秒 | 状态演变: 慢动作
   → 硬约束: 时长≥15秒，播放速度为慢动作
5. 美学介质: 未指定
   → 推断: 实拍风格（猫 + 暖光 → 生活化实拍最佳）

搜索关键词: "orange cat sleeping windowsill slow motion warm light"
生成 prompt: "An orange tabby cat napping on a sunlit windowsill,
             eyes gently closed, slow breathing, warm golden sunlight
             streaming through window, close-up shot, slow motion,
             soft natural lighting, cozy atmosphere, 4K, realistic"
```

---

## 准备工作：获取上下文

开始生成前，先收集所有上下文信息：

```bash
# 1. 获取作品详情和方案
curl http://localhost:3271/api/works/{workId}

# 2. 查看共享素材（参考图、角色参考、音乐等）
curl http://localhost:3271/api/shared-assets

# 3. 列出已生成的素材（避免重复生成）
curl http://localhost:3271/api/works/{workId}/assets

# 4. 检查可用的生成服务，确定使用哪些脚本
python3 skills/asset-generation/scripts/check_providers.py
```

---

## 生成脚本

本 skill 自带独立的生成脚本，从项目 `.env` 文件读取 API 密钥，无需依赖服务器运行。

#### 1. `check_providers.py` — 检查可用服务
检测 `.env` 中配置了哪些密钥，报告可用能力和推荐脚本。
```bash
python3 skills/asset-generation/scripts/check_providers.py --format table
```

#### 2. `openrouter_generate.py` — OpenRouter/Gemini（**主力图片生成**）

需要 `OPENROUTER_API_KEY`。默认模型 `google/gemini-3.1-flash-image-preview`，是目前最强的图片生成模型。

**完整参数列表：**

| 参数 | 说明 | 示例值 |
|------|------|--------|
| `--prompt` | 图片描述/指令（必填） | `"一只橘猫在窗台上"` |
| `--output` | 输出文件路径（必填） | `output.png` |
| `--aspect-ratio` / `--ar` | 宽高比 | `3:4`, `9:16`, `16:9` |
| `--image-size` / `--size` | 分辨率等级 | `0.5K`, `1K`, `2K`, `4K` |
| `--seed` | 随机种子（相同 seed + prompt → 相似结果） | `42` |
| `--ref-image` | 参考图路径/URL（可多次指定） | `ref.png` |
| `--temperature` | 生成温度 (0.0-2.0) | `0.8` |
| `--model` | 切换模型 | `google/gemini-2.5-flash-image` |

**宽高比选项（`--aspect-ratio`）：**

| 比例 | 像素 (1K) | 适用场景 |
|------|-----------|---------|
| `1:1` | 1024×1024 | 头像、正方形贴图 |
| `3:4` | 864×1184 | **小红书图文（推荐）** |
| `4:3` | 1184×864 | 横版展示图 |
| `4:5` | 896×1152 | Instagram 风格 |
| `9:16` | 768×1344 | **抖音/短视频封面** |
| `16:9` | 1344×768 | 横屏视频封面 |
| `2:3` | 832×1248 | 海报竖版 |
| `3:2` | 1248×832 | 摄影横版 |
| `21:9` | 1536×672 | 超宽屏 banner |
| `1:4` | — | 超长竖图（仅 Gemini 3.1） |
| `4:1` | — | 超长横图（仅 Gemini 3.1） |

**分辨率等级（`--image-size`）：**

| 等级 | 说明 | 成本 | 推荐用途 |
|------|------|------|---------|
| `0.5K` | 低分辨率（仅 Gemini 3.1） | 最低 | 快速预览、草图 |
| `1K` | 标准分辨率 | 标准 | 一般用途 |
| `2K` | 高分辨率 | 较高 | 批量生成时的性价比选择 |
| `4K` | 超高分辨率（**默认**） | 最高 | **所有正式发布内容** |

**使用示例：**

```bash
# 小红书图文：3:4 竖图，2K 高清
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "一位穿着米色针织衫的年轻女性，温柔微笑，自然光线，iPhone 随手拍风格" \
  --aspect-ratio 3:4 --image-size 2K --output images/image-01.png

# 抖音短视频首帧：9:16 全屏，2K
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "..." --ar 9:16 --size 2K --output frames/frame-01.png

# 保持风格一致（同 seed）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "同一女性在咖啡厅..." --seed 42 --ar 3:4 --size 2K --output images/image-02.png

# 图片编辑（参考图 + 指令）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "保持人物不变，把背景换成海边日落" \
  --ref-image images/image-01.png --ar 3:4 --size 2K --output images/image-01-v2.png

# 多张参考图（风格融合）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "用第一张图的风格画第二张图中的场景" \
  --ref-image style-ref.png --ref-image scene-ref.png --output result.png

# 快速预览（0.5K 低分辨率，省成本）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "..." --size 0.5K --output preview.png

# 4K 超清（最高画质）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "..." --ar 3:4 --size 4K --output hd.png
```

**可用模型：**
- `google/gemini-3.1-flash-image-preview`（**默认，推荐**）— 最强画质，支持扩展比例和 0.5K
- `google/gemini-2.5-flash-image` — 性价比高，适合大批量生成

#### 3. `jimeng_generate.py` — 即梦 AI（**视频生成 + 备用图片**）
需要 `JIMENG_ACCESS_KEY` + `JIMENG_SECRET_KEY`。
```bash
# 文生图（备用，优先用 OpenRouter）
python3 skills/asset-generation/scripts/jimeng_generate.py image \
  --prompt "描述" --width 1088 --height 1920 --output output.png

# 参考图生图
python3 skills/asset-generation/scripts/jimeng_generate.py image \
  --prompt "描述" --ref-image ref.png --output output.png

# 文生视频
python3 skills/asset-generation/scripts/jimeng_generate.py video \
  --prompt "镜头动作描述" --resolution 9:16 --output clip.mp4

# 图生视频（首帧驱动）
python3 skills/asset-generation/scripts/jimeng_generate.py video \
  --prompt "动作描述" --first-frame frame.png --output clip.mp4
```

#### 4. `music_generate.py` — Lyria 音乐生成（**BGM/配乐**）

需要 `OPENROUTER_API_KEY`。模型 `google/lyria-3-pro-preview`，生成 ~2 分钟完整音乐。

**参数：**

| 参数 | 说明 | 示例值 |
|------|------|--------|
| `--prompt` | 音乐描述（必填） | `"soft acoustic guitar, lo-fi, 85 BPM"` |
| `--output` | 输出文件路径（必填） | `bgm.mp3` |
| `--ref-image` | 参考图（可多次，图生音乐） | `cover.png` |
| `--vocal` | 启用人声（默认纯器乐） | — |
| `--seed` | 随机种子 | `42` |
| `--temperature` | 创意度 (0.0-2.0) | `0.8` |

**使用示例：**

```bash
# 纯器乐 BGM（默认，最常用）
python3 skills/asset-generation/scripts/music_generate.py \
  --prompt "soft acoustic guitar, warm and cozy, lo-fi vibes, 85 BPM, gentle percussion" \
  --output {workDir}/assets/music/bgm.mp3

# 图生音乐：用封面图/关键帧引导音乐风格
python3 skills/asset-generation/scripts/music_generate.py \
  --prompt "background music matching this image mood" \
  --ref-image {workDir}/assets/images/cover.png \
  --output {workDir}/assets/music/bgm.mp3

# 带人声的完整歌曲
python3 skills/asset-generation/scripts/music_generate.py \
  --prompt "catchy pop song about spring fashion, female vocal, bright and cheerful, 110 BPM" \
  --vocal --output {workDir}/assets/music/bgm-vocal.mp3
```

> 详细的 prompt 工程技巧和情绪-风格映射请阅读 `modules/music-generation.md`

**选择策略：**
1. **图片生成** → 优先 `openrouter_generate.py`（Gemini 3.1 Flash，画质最好，参数最丰富）
2. **视频生成** → 使用 `jimeng_generate.py`（即梦是唯一支持视频的服务）
3. **音乐生成** → 使用 `music_generate.py`（Lyria Pro，~2分钟完整曲目）
4. **图片备用** → OpenRouter 不可用时，用 `jimeng_generate.py image`
4. 先运行 `check_providers.py` 确认可用服务

---

## 平台参考文档

根据目标发布平台，阅读对应的参考文件以获取分辨率规格和平台特定指南：
- **抖音：** 阅读 `references/douyin.md`，了解视频分辨率规格和抖音优化的生成设置
- **小红书/XHS：** 阅读 `references/xiaohongshu.md`，了解图片分辨率规格和小红书的审美标准
- **双平台发布：** 两个参考文件都要阅读

---

## 工作流程：短视频

### 分步流程

针对分镜中的每个镜头：

**1. 通知用户即将生成的内容：**
```
准备生成第 {N} 镜首帧:
「{分镜中的场景描述}」
尺寸: {width}×{height} ({aspect ratio})
确认生成？
```

**2. 等待用户确认。**

**3. 生成首帧图片：**
```bash
# 推荐：使用 OpenRouter (Gemini 3.1) 生成高清首帧
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{优化后的提示词}" \
  --ar 9:16 --size 2K \
  --output {workDir}/assets/frames/frame-{NN}.png

# 如需保持角色一致性，加 --seed 和 --ref-image
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{提示词}" \
  --ar 9:16 --size 2K --seed 42 \
  --ref-image {workDir}/assets/frames/frame-01.png \
  --output {workDir}/assets/frames/frame-{NN}.png
```

**4. 报告结果并展示预览：**
```
首帧生成完成 ✓
预览: http://localhost:3271/api/works/{workId}/assets/frames/frame-{NN}.png
满意吗？如需调整请告诉我，满意则继续生成视频片段。
```

**5. 用户满意后，用首帧生成视频片段：**
```
准备用首帧生成第 {N} 镜视频片段:
动作描述: 「{运动/动作描述}」
时长: ~5秒
确认生成？
```

**6. 等待确认后生成：**
```bash
curl -X POST http://localhost:3271/api/generate/video \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "{workId}",
    "prompt": "{视频运动提示词}",
    "firstFrame": "http://localhost:3271/api/works/{workId}/assets/frames/frame-{NN}.png",
    "resolution": "9:16",
    "filename": "clips/clip-{NN}.mp4"
  }'
```

**7. 报告并继续：**
```
视频片段 {N} 生成完成 ✓
预览: http://localhost:3271/api/works/{workId}/assets/clips/clip-{NN}.mp4
```

**8. 重复以上步骤处理下一个镜头。**

### 进度跟踪

在整个会话过程中维护一个可见的进度清单：

```
## 生成进度

- [x] 镜头 01: 首帧 ✓ | 视频 ✓
- [x] 镜头 02: 首帧 ✓ | 视频 ✓
- [ ] 镜头 03: 首帧 ⏳ | 视频 —
- [ ] 镜头 04: 首帧 — | 视频 —
- [ ] 镜头 05: 首帧 — | 视频 —

已完成: 2/5 镜头
```

每完成一步生成后更新此清单。

---

## 工作流程：图文

### 封面图（文字卡片）

封面图**不需要 AI 生图**，而是用 ffmpeg 生成纯色背景 + 大号白色粗体文字的卡片。
这是小红书/抖音图文的主流封面风格。

**1. 从内容方案中提取封面信息：**
- 封面文案（1-3 行短句）
- 背景色（莫兰迪色系或深色系）
- 装饰元素（如引号 "）

**2. 用 ffmpeg 生成文字卡片封面：**
```bash
# 生成纯色背景文字卡片封面
ffmpeg -f lavfi -i "color=c=0x8B7D6B:s=1080x1440:d=1" \
  -vf "drawtext=text='封面文案第一行':fontsize=96:fontcolor=white:fontfile=/System/Library/Fonts/PingFang.ttc:x=80:y=h*0.38,\
drawtext=text='第二行文字':fontsize=96:fontcolor=white:fontfile=/System/Library/Fonts/PingFang.ttc:x=80:y=h*0.38+120,\
drawtext=text='第三行文字':fontsize=96:fontcolor=white:fontfile=/System/Library/Fonts/PingFang.ttc:x=80:y=h*0.38+240,\
drawtext=text='❝':fontsize=72:fontcolor=white@0.4:fontfile=/System/Library/Fonts/PingFang.ttc:x=80:y=h*0.22" \
  -frames:v 1 -y {workDir}/assets/images/cover.png
```

> 颜色参考：莫兰迪棕 `0x8B7D6B`、雾蓝 `0x6B7D8B`、暖灰 `0x7D7B78`、深墨绿 `0x2F4F4F`、烟粉 `0x8B6B7D`

**3. 不需要用户确认**——封面是文字卡片，生成成本为零。

### 内容图片

针对方案中的每张内容图片（非封面）：

**1. 通知用户即将生成的内容：**
```
准备生成第 {N} 张图片:
「{方案中的图片描述}」
尺寸: {width}×{height}
确认生成？
```

**2. 等待确认。**

**3. 生成：**
```bash
# 推荐：OpenRouter (Gemini 3.1) 3:4 竖图，2K 高清
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{优化后的提示词}" \
  --ar 3:4 --size 2K \
  --output {workDir}/assets/images/image-{NN}.png

# 保持风格一致性：加 --seed（所有图用同一 seed）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{提示词}" \
  --ar 3:4 --size 2K --seed {统一的seed值} \
  --output {workDir}/assets/images/image-{NN}.png
```

**4. 报告并继续。**

### 进度跟踪

```
## 生成进度

- [x] 封面图(文字卡片): ✓
- [x] 图片 01: ✓
- [ ] 图片 02: ⏳
- [ ] 图片 03: —

已完成: 2/4 张图片
```

---

## AI 图片生成提示词工程

### 提示词结构

一个结构良好的提示词按以下顺序组织：

```
[质量关键词], [主体描述], [动作/姿态], [环境], [光线], [镜头/构图], [风格], [色彩/氛围]
```

### 质量关键词（正向）

始终在提示词前加上这些关键词以获得高质量输出：
- `masterpiece, best quality, highly detailed` — 基础质量提升
- `sharp focus, professional photography` — 适用于写实风格
- `8K, ultra HD, high resolution` — 增强细节
- `award-winning photography` — 适用于照片写实类内容

### 主体描述最佳实践

**人物：**
- 需要指定：族裔、年龄范围、性别、发型（颜色、长度、造型）、服装（具体单品、颜色、面料）、表情、配饰
- 示例：`young Chinese woman, age 25, shoulder-length black hair with subtle waves, wearing a cream-colored knit sweater and high-waisted brown trousers, gentle smile, minimal gold jewelry`

**食物：**
- 需要指定：菜品名称、可见食材、摆盘风格、餐具类型、装饰
- 示例：`steaming bowl of hand-pulled beef noodles (兰州牛肉面), rich red chili oil broth, tender beef slices, fresh cilantro and green onion garnish, served in a white ceramic bowl on a dark wooden table`

**场景/环境：**
- 需要指定：场所类型、时间段、天气、关键物品、氛围
- 示例：`modern minimalist apartment living room, floor-to-ceiling windows showing city skyline at golden hour, beige sofa with throw pillows, monstera plant, warm ambient lighting`

### 光线关键词

| 光线类型 | 关键词 | 适用场景 |
|---------|--------|---------|
| 自然柔光 | `soft natural light, diffused sunlight, window light` | 生活方式、美妆、美食 |
| 黄金时段 | `golden hour lighting, warm sunset glow, long shadows` | 户外、浪漫、氛围感 |
| 棚拍灯光 | `professional studio lighting, softbox, rim light` | 产品、时尚、人像 |
| 戏剧光 | `chiaroscuro, dramatic side lighting, high contrast` | 时尚、艺术、叙事 |
| 平光 | `flat lighting, evenly lit, shadow-free` | 教程、信息类内容 |
| 霓虹/都市 | `neon lights, city lights, colorful ambient glow` | 都市、夜生活、科技 |
| 顶光 | `overhead lighting, top-down illumination` | 美食平铺、产品排列 |

### 镜头与构图关键词

| 构图方式 | 关键词 |
|---------|--------|
| 特写 | `close-up shot, tight framing, face detail` |
| 中景 | `medium shot, waist-up, half-body` |
| 全景/建立镜头 | `wide angle, establishing shot, full scene` |
| 俯瞰 | `top-down view, overhead shot, flat lay` |
| 仰拍 | `low angle shot, looking up, worm's eye view` |
| 浅景深 | `shallow depth of field, bokeh background, f/1.4` |
| 深景深 | `deep focus, everything sharp, f/11` |

### 不同内容类型的风格关键词

**生活方式/日常:**
```
lifestyle photography, natural aesthetic, warm tones, candid feel, editorial style, magazine quality
```

**美食:**
```
food photography, appetizing, mouth-watering, professional food styling, warm color temperature, shallow depth of field
```

**时尚/穿搭:**
```
fashion photography, editorial, high fashion, posed, stylish, fashion magazine cover quality
```

**科技/数码:**
```
product photography, clean background, studio lighting, sleek, modern, tech aesthetic, minimalist
```

**旅行:**
```
travel photography, landscape, wanderlust, vivid colors, cinematic, adventure photography, National Geographic style
```

### 提示词中应避免的内容

不要在提示词中包含：
- 负面情绪词汇（ugly、bad、wrong）— 可能渗透到生成结果中
- 多种互相矛盾的风格（同时写 realistic 和 cartoon）
- 模糊的描述（"nice"、"good"、"beautiful" — 太笼统）
- 文字生成指令（"在图片上写 X 文字"）— 文字生成不可靠
- 过长的提示词（>300 词）— 收益递减，模型会失焦

### 绕过安全过滤的措辞技巧（重要）

Gemini 等模型有内容安全过滤机制。以下类型的词汇组合容易触发过滤导致生成失败（返回空图片）：

**容易触发过滤的词汇（避免使用）：**
- 性暗示词：`seductive`、`sexy`、`sensual`、`provocative`、`alluring`、`tempting`
- 具体暴露款式：`string bikini`、`lingerie`、`see-through`
- 身体聚焦描述：`body contour`、`curves`、`S-curve body pose`、`body silhouette`
- 暗示性动作：`seductive gaze`、`bedroom eyes`、`biting lip`

**用专业摄影术语替代（推荐）：**

| 想表达的意思 | 会被过滤的写法 | 安全的专业写法 |
|-------------|--------------|--------------|
| 泳装 | `string bikini`、`revealing swimwear` | `swimsuit`、`one-piece swimsuit`、`beachwear` |
| 身材好看 | `sexy body`、`curves`、`S-curve pose` | `athletic build`、`elegant posture`、`confident stance` |
| 表情有魅力 | `seductive gaze`、`sultry look` | `confident gaze`、`direct eye contact`、`self-assured expression` |
| 光线勾勒身体 | `rim light on body contour` | `golden hour rim lighting`、`backlit silhouette`、`warm sunset glow` |
| 性感氛围 | `sensual atmosphere`、`intimate mood` | `fashion editorial style`、`high fashion photography`、`Vogue cover aesthetic` |
| 低胸/露肩 | `low-cut`、`revealing neckline` | `off-shoulder`、`strapless`、`elegant neckline` |

**核心原则：用专业时尚摄影/编辑语言描述，而非日常口语中的性暗示词汇。** 模型最终生成的视觉效果几乎一样，但专业措辞不会触发安全过滤。

**示例对比：**

❌ 会被过滤：
```
elegant woman in a black string bikini, seductive gaze, rim light highlighting her body contour, sensual pose
```

✅ 能通过：
```
elegant woman wearing a swimsuit, confident direct gaze toward camera, golden hour rim lighting, fashion editorial pose, Vogue cover aesthetic
```

### 分辨率与宽高比

具体分辨率规格请参考各平台参考文件。

**OpenRouter（主力）使用 `--aspect-ratio` + `--image-size` 控制：**
- 宽高比：`--ar 3:4`（小红书）、`--ar 9:16`（抖音）、`--ar 1:1`（头像）
- 分辨率：`--size 2K`（推荐正式发布）、`--size 4K`（极致画质）、`--size 0.5K`（快速预览）

**即梦 AI（备用图片/视频）仍然用像素值：**
- 9:16 → `--width 1088 --height 1920`
- 3:4 → `--width 1080 --height 1440`
- 1:1 → `--width 1088 --height 1088`
- width/height 必须是 64 的倍数，范围 576-1728

---

## 人物一致性与场景一致性（核心能力，必读）

**你拥有强大的图生图和风格控制能力。** 生成多张图片时，你**必须**主动使用以下工具组合确保人物外观、风格、色调在所有图片中保持一致。不要只靠 prompt 文字描述来维持一致性——那是不够的。

### 你的一致性工具箱

| 工具 | 参数 | 作用 | 何时用 |
|------|------|------|--------|
| **参考图** | `--ref-image` | 传入已有图片，模型会参考其视觉特征（人脸、体型、服装、色调）生成新图 | **生成第2张及之后的每一张图时必须使用** |
| **Seed 锁定** | `--seed` | 固定随机种子，相同 seed → 相似的风格/色调/构图倾向 | **整组图片使用同一个 seed** |
| **角色描述复用** | prompt 内 | 每张图 prompt 中原样复制完整的角色外观描述（不缩写、不改写） | **每张有人物的图都必须包含** |
| **风格后缀** | prompt 内 | 统一的风格/光线/色调关键词附加在每个 prompt 末尾 | **每张图都必须附加** |
| **色板锚定** | prompt 内 | 明确的色彩 hex 值写入 prompt | 有特定色调要求时 |

### 强制执行规则

**生成包含同一人物的多张图片时（如小红书图文、短视频分镜），必须遵守：**

1. **第1张图（锚定图）**：正常生成，确定 seed 值（可自选一个数字如 42、100 等）
2. **第2张及之后**：**必须同时使用** `--ref-image 第1张图路径` + `--seed 同一值` + prompt 中包含 "same person/woman/man as reference image" + 完整角色外观描述
3. **如果生成结果人物不一致**：用第1张图作为 `--ref-image`，在 prompt 中明确写 "keep exactly the same face, hairstyle, and outfit as the reference image"，重新生成
4. **绝不省略 `--ref-image`**：仅靠 prompt 描述同一人物，模型每次都会生成不同的脸，这是 AI 生图的根本限制

### 标准生成流程（图文类）

```bash
# ── 第1张图（锚定图）──
# 这张图将作为后续所有图的人物/风格参考基准
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "young Chinese woman, age 24, long black hair with soft waves, wearing white linen shirt, natural makeup, gentle smile, sitting by window in bright cafe, soft natural light, iPhone candid style, Morandi warm tones" \
  --seed 42 --ar 3:4 --size 4K \
  --output {workDir}/assets/images/image-01.png

# ── 第2张图（必须传参考图！）──
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "same woman as reference image: young Chinese woman, age 24, long black hair with soft waves, wearing white linen shirt, natural makeup. Walking in a sunlit garden path, looking over her shoulder with a smile, soft natural light, iPhone candid style, Morandi warm tones" \
  --ref-image {workDir}/assets/images/image-01.png \
  --seed 42 --ar 3:4 --size 4K \
  --output {workDir}/assets/images/image-02.png

# ── 第3-N张图（同样传参考图，保持 seed）──
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "same woman as reference image: young Chinese woman, age 24, long black hair with soft waves, wearing white linen shirt, natural makeup. Reading a book on a cozy sofa, warm indoor lighting, iPhone candid style, Morandi warm tones" \
  --ref-image {workDir}/assets/images/image-01.png \
  --seed 42 --ar 3:4 --size 4K \
  --output {workDir}/assets/images/image-03.png
```

### 标准生成流程（短视频首帧）

```bash
# 第1镜首帧（锚定）
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{完整角色描述}, {场景}, {光线风格}" \
  --seed 42 --ar 9:16 --size 4K \
  --output {workDir}/assets/frames/frame-01.png

# 第2-N镜首帧：必须传入第1镜作为参考
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "same person as reference image: {完整角色描述}, {新场景}, {光线风格}" \
  --ref-image {workDir}/assets/frames/frame-01.png \
  --seed 42 --ar 9:16 --size 4K \
  --output {workDir}/assets/frames/frame-02.png
```

### 多参考图的高级用法

OpenRouter 支持同时传入**多张**参考图（`--ref-image` 可重复使用），适合：

```bash
# 人物图 + 场景风格图 分离控制
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "place the person from the first reference image into the scene style of the second reference image" \
  --ref-image person-ref.png --ref-image scene-ref.png \
  --seed 42 --ar 3:4 --size 4K --output result.png

# 用户上传的共享素材 + 前序生成图 双重参考
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "{描述}" \
  --ref-image {workDir}/assets/images/image-01.png \
  --ref-image /path/to/shared-assets/references/style-ref.png \
  --seed 42 --ar 3:4 --size 4K --output result.png
```

### 即梦 AI 的参考图用法（备用）

即梦支持**单张**参考图：
```bash
python3 skills/asset-generation/scripts/jimeng_generate.py image \
  --prompt "类似参考图风格的新场景描述" \
  --ref-image image-01.png \
  --width 1080 --height 1440 --output result.png
```

### 一致性自检清单

生成完一组图片后，逐项检查：
- [ ] 所有图片中的人物面部特征是否一致（脸型、五官）
- [ ] 发型、发色是否一致
- [ ] 服装是否一致（除非方案要求换装）
- [ ] 整体色调、光线风格是否一致
- [ ] 图片风格是否一致（不能一张像摄影一张像插画）

**如果任何一项不通过，用 `--ref-image` 传入锚定图重新生成该张图片。**

---

## 补充技巧

### 风格后缀

从方案的风格模块中提取风格后缀，并附加到每一条提示词后面：
```
[具体场景提示词], [风格后缀: soft natural lighting, warm color grading, lifestyle photography, Morandi color palette, shot on iPhone 15 Pro]
```

### 色板锚定

在每条提示词中都包含明确的色彩参考：
```
color palette: warm cream (#F5E6CC), soft terracotta (#C4785B), sage green (#9CAF88), natural wood brown (#8B6914)
```

---

## 视频生成提示词工程

视频提示词描述的是**运动和动作**，而非静态画面（首帧已经定义了视觉内容）：

**好的视频提示词：**
- `Camera slowly pushes in, woman turns to face camera and smiles, hair gently sways`
- `Smooth pan left to right revealing the full kitchen counter, steam rising from pot`
- `Static shot, only movement is the gentle stirring of soup and rising steam`
- `Slow zoom out from close-up of flower to reveal full bouquet arrangement`

**差的视频提示词：**
- `Beautiful woman in kitchen`（没有描述运动）
- `Nice video of cooking`（太模糊）
- `The scene changes to a different location`（视频生成无法"瞬移"）

**运动描述关键词：**
- 缓慢/轻柔：`slowly, gently, gradually, subtle movement`
- 动感：`quickly, energetically, sudden, dynamic movement`
- 镜头运动：`camera pans left, dolly forward, zoom in, static locked shot`
- 自然运动：`hair blowing in wind, fabric flowing, water rippling, leaves rustling`

---

## 素材获取方式：全网搜索下载

当不使用 AI 生成，而是从互联网下载真实素材时，使用以下工作流：

### 视频素材下载（yt-dlp）

```bash
# 1. 根据分镜脚本的场景描述，构造搜索关键词
# 关键词要具体：主体 + 动作 + 风格
# 例如："epic water drinking slow motion cinematic"

# 2. 搜索并预览（不下载）
yt-dlp "ytsearch5:epic water drinking slow motion" --get-title --get-url --get-duration

# 3. 下载最佳质量视频（必须带音频）
yt-dlp -f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 \
  -o "clips/clip-01.mp4" "VIDEO_URL"

# 4. 裁切需要的片段
ffmpeg -i clips/clip-01.mp4 -ss 5 -to 10 -c copy -y clips/clip-01-trimmed.mp4
```

### 搜索关键词构造规则

根据分镜脚本中每个镜头的描述，按五维约束框架构造关键词：

| 分镜描述 | 搜索关键词 |
|---------|-----------|
| 主角认真地拿起水杯 | `person picking up glass water serious cinematic` |
| 慢镜头倒水特写 | `pouring water slow motion close up cinematic` |
| 史诗级仰拍喝水 | `drinking water low angle epic cinematic` |
| 满足地放下杯子 | `person putting down glass satisfied reaction` |

### 下载后必做检查

```bash
# 验证视频有音频轨
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 clip-01.mp4 | grep audio

# 检查分辨率
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 clip-01.mp4
```

### 素材管理

- 所有下载的素材保存到作品的 `assets/clips/` 目录
- 使用 API 上传：`curl -X POST http://localhost:3271/api/works/{workId}/assets -F "file=@clip-01.mp4" -F "path=clips/clip-01.mp4"`
- 或直接保存到作品目录（通过 API 获取路径）

### 进度跟踪

```
## 素材下载进度

- [x] 镜头 01: 搜索 ✓ | 下载 ✓ | 裁切 ✓
- [ ] 镜头 02: 搜索 ⏳ | 下载 — | 裁切 —
- [ ] 镜头 03: 搜索 — | 下载 — | 裁切 —

已完成: 1/3 镜头
```

---

## 垂类专项指南

执行前检查 `genres/` 目录。如果当前作品的内容类型（如搞笑、美食、教育等）有对应的 `genres/<type>.md` 文件，**必须读取并遵循其中的专项规则**——特别是视觉风格、色调策略和提示词调整方面，垂类文件的规则优先级高于本文件的通用规则。

## 扩展能力模块

检查 `modules/` 目录，根据当前任务需要加载相关能力模块。

### 可用模块

| 模块 | 文档路径 | 用途 |
|------|---------|------|
| Prompt 进阶 | `modules/prompt-mastery.md` | 模型差异化策略、负向提示词库、高级质量关键词、风格一致性进阶 |
| 质量门控 | `modules/quality-gate.md` | 生成后自检清单、常见问题修复、美学评分工具 |
| 音乐生成 | `modules/music-generation.md` | Lyria BGM 生成方法论、情绪-风格映射、prompt 工程、平台适配 |

---

## 错误处理与重试

### 生成失败时：
1. 检查 API 返回的错误信息
2. 常见问题：
   - **提示词过长：** 缩短到 200 词以内
   - **尺寸无效：** 确保 width 和 height 是 64 的倍数
   - **服务不可用：** 检查 `curl http://localhost:3271/api/generate/providers`，尝试切换服务
   - **内容审核：** 改写提示词，避免触发审核的内容
3. 向用户报告错误并建议修复方案
4. 用户确认后使用调整后的提示词重试

### 生成质量不理想时：
1. 向用户展示结果
2. 询问需要改进的地方
3. 建议具体的提示词调整方向：
   - 在问题区域增加更多细节
   - 更换光线或构图关键词
   - 增加或删除风格关键词
4. 用户确认后使用更新的提示词重新生成

> **提示**：加载 `modules/quality-gate.md` 获取完整的质量自检清单、常见 AI 生成问题的修复策略，以及美学评分工具参考。系统性地诊断和修复生成质量问题，而不是盲目重试。

---

## 交互模式总结

对方案中的每个素材：

```
Agent: "准备生成第{N}镜首帧：
「{场景描述}」
竖屏 9:16 (1088×1920)
确认生成？"

User: "确认"

Agent: [调用 API]
"首帧生成完成 ✓
预览: http://localhost:3271/api/works/{workId}/assets/frames/frame-{NN}.png
满意吗？"

User: "可以，继续"

Agent: "准备用此首帧生成视频片段：
动作：「{运动描述}」
确认？"

User: "确认"

Agent: [调用 API]
"视频片段生成完成 ✓
预览: http://localhost:3271/api/works/{workId}/assets/clips/clip-{NN}.mp4

## 当前进度
- [x] 镜头 01: 首帧 ✓ | 视频 ✓
- [ ] 镜头 02: 首帧 — | 视频 —
...

继续第2镜？"
```

---

## 文件命名规范

```
{workId}/
  assets/
    frames/
      frame-01.png
      frame-02.png
      ...
    clips/
      clip-01.mp4
      clip-02.mp4
      ...
    images/          (用于图文内容)
      cover.png      (文字卡片，ffmpeg 生成，非 AI 生图)
      image-01.png
      image-02.png
      ...
    music/           (BGM/配乐)
      bgm.mp3        (主 BGM，Lyria 生成)
      bgm-alt.mp3    (备选 BGM)
```

## 素材获取方式：全网搜索下载

当不使用 AI 生成，而是从互联网下载真实素材时，使用以下工作流：

### 视频素材下载（yt-dlp）

```bash
# 1. 根据分镜脚本的场景描述，构造搜索关键词
# 关键词要具体：主体 + 动作 + 风格
# 例如："epic water drinking slow motion cinematic"

# 2. 搜索并预览（不下载）
yt-dlp "ytsearch5:epic water drinking slow motion" --get-title --get-url --get-duration

# 3. 下载最佳质量视频（必须带音频）
yt-dlp -f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 \
  -o "clips/clip-01.mp4" "VIDEO_URL"

# 4. 裁切需要的片段
ffmpeg -i clips/clip-01.mp4 -ss 5 -to 10 -c copy -y clips/clip-01-trimmed.mp4
```

### 搜索关键词构造规则

根据分镜脚本中每个镜头的描述，按五维约束框架构造关键词：

| 分镜描述 | 搜索关键词 |
|---------|-----------|
| 主角认真地拿起水杯 | `person picking up glass water serious cinematic` |
| 慢镜头倒水特写 | `pouring water slow motion close up cinematic` |
| 史诗级仰拍喝水 | `drinking water low angle epic cinematic` |
| 满足地放下杯子 | `person putting down glass satisfied reaction` |

### 下载后必做检查

```bash
# 验证视频有音频轨
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 clip-01.mp4 | grep audio

# 检查分辨率
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 clip-01.mp4
```

### 素材管理

- 所有下载的素材保存到作品的 `assets/clips/` 目录
- 使用 API 上传：`curl -X POST http://localhost:3271/api/works/{workId}/assets -F "file=@clip-01.mp4" -F "path=clips/clip-01.mp4"`
- 或直接保存到作品目录（通过 API 获取路径）

### 进度跟踪

```
## 素材下载进度

- [x] 镜头 01: 搜索 ✓ | 下载 ✓ | 裁切 ✓
- [ ] 镜头 02: 搜索 ⏳ | 下载 — | 裁切 —
- [ ] 镜头 03: 搜索 — | 下载 — | 裁切 —

已完成: 1/3 镜头
```

---

## 完成

所有素材生成完毕后：
1. 展示最终进度清单（所有项目已勾选）
2. 列出所有已生成素材及预览链接
3. 更新作品流水线状态：
```bash
curl -X PUT http://localhost:3271/api/works/{workId} \
  -H "Content-Type: application/json" \
  -d '{"pipeline": {"assets": {"status": "done"}}}'
```
4. 告知用户下一步是合成（content-assembly 技能）

## 垂类专项指南

执行前检查 `genres/` 目录。如果当前作品的内容类型有对应的 `genres/<type>.md` 文件，
**必须读取并遵循其中的专项规则**——它们覆盖本文件中的通用指导。

## 扩展能力模块

检查 `modules/` 目录，根据当前任务需要加载相关能力模块。
