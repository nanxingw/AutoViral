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

#### 2. `jimeng_generate.py` — 即梦 AI（主力，图片+视频）
需要 `JIMENG_ACCESS_KEY` + `JIMENG_SECRET_KEY`。
```bash
# 文生图
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

#### 3. `openrouter_generate.py` — OpenRouter/Gemini（备用，仅图片）
需要 `OPENROUTER_API_KEY`。
```bash
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "描述" --output output.png
```

**选择策略**: 先运行 `check_providers.py` 确认可用服务，优先使用即梦（支持图片+视频），OpenRouter 作为图片生成的备用方案。

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
curl -X POST http://localhost:3271/api/generate/image \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "{workId}",
    "prompt": "{优化后的提示词}",
    "width": 1088,
    "height": 1920,
    "filename": "frames/frame-{NN}.png"
  }'
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

### 分步流程

针对内容方案中的每张图片：

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
curl -X POST http://localhost:3271/api/generate/image \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "{workId}",
    "prompt": "{优化后的提示词}",
    "width": 1080,
    "height": 1440,
    "filename": "images/image-{NN}.png"
  }'
```

**4. 报告并继续。**

### 进度跟踪

```
## 生成进度

- [x] 封面图: ✓
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

### 分辨率与宽高比

具体分辨率规格请参考各平台参考文件。通用规则：

**API 的 width/height 必须是 64 的倍数。** 常用安全值：
- 9:16 → 1088×1920
- 3:4 → 1088×1440 或 1080×1440
- 1:1 → 1088×1088
- 16:9 → 1920×1088

---

## 风格一致性技巧

### 技巧一：风格后缀

从方案的风格模块中提取风格后缀，并附加到每一条提示词后面：

```
[具体场景提示词], [风格后缀: soft natural lighting, warm color grading, lifestyle photography, Morandi color palette, shot on iPhone 15 Pro]
```

### 技巧二：角色描述复用

将方案中角色参考模块的角色描述原样复制到每个该角色出现的镜头中。不要改写或缩写——生成模型在不同调用之间没有记忆。

错误做法：`the woman from shot 1, same outfit`
正确做法：`young Chinese woman, age 25, shoulder-length black hair with subtle waves, wearing cream-colored knit sweater and high-waisted brown trousers, gentle smile`

### 技巧三：色板锚定

在每条提示词中都包含明确的色彩参考：
```
color palette: warm cream (#F5E6CC), soft terracotta (#C4785B), sage green (#9CAF88), natural wood brown (#8B6914)
```

### 技巧四：参考图

如果共享素材中有定义风格的参考图，可以用它来引导生成：
```bash
curl -X POST http://localhost:3271/api/generate/image \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "{workId}",
    "prompt": "{prompt}",
    "width": 1088,
    "height": 1920,
    "filename": "frames/frame-02.png",
    "referenceImage": "http://localhost:3271/api/shared-assets/references/style-ref.png"
  }'
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
      cover.png
      image-01.png
      image-02.png
      ...
```

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
