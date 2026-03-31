---
name: visual-aesthetics
description: 视觉美学进阶模块——封面设计系统、色彩理论、构图模式与2026审美趋势。当内容策划需要精细的视觉方向指导时加载此模块。
type: module
---

# 视觉美学进阶模块

本模块为内容策划提供进阶视觉指导，覆盖封面设计、色彩理论、构图模式和当下审美趋势。SKILL.md 中的基础色彩心理表和构图规则仍然有效，本模块在其基础上提供更深入、更可操作的视觉策略。

---

## 一、封面设计系统

封面是用户决定是否点击的第一要素。不同平台对封面有不同要求，但核心逻辑一致：**在0.5秒内传递"这条内容值得看"的信号。**

### 1.1 小红书封面6大爆款规律

| 规律 | 说明 | Prompt 关键词参考 |
|------|------|------------------|
| **质感为王** | 高清、有质感的画面自带高级感。避免模糊、过曝、杂乱背景 | `high quality, detailed texture, sharp focus, professional photography` |
| **标题党排版** | 大字标题直接写在封面上，一眼看到核心信息。字号要大、颜色要跳 | 排版层面处理，非 prompt 层面 |
| **强反差对比** | Before/After、新旧对比、价格对比——视觉冲击力制造停留 | `split screen comparison, before and after, dramatic contrast` |
| **图文结合** | 实拍图+文字标注，信息密度高，适合教程和测评类 | `annotated photo, text overlay, infographic style` |
| **多图统一风格** | 轮播图保持一致的色调、排版、边距，创造品牌感 | 在风格定义中统一，所有图共用同一组 style keywords |
| **创意脑洞** | 出其不意的视角、夸张的表现手法、反常规构图 | `creative composition, unexpected angle, surreal, whimsical` |

### 1.2 封面文字布局规则

```
┌─────────────────────────┐
│     主标题区域（上1/3）     │  ← 主标题占图片宽度 40-50%
│   "5分钟学会的XX技巧"     │     字号：画面高度的 8-12%
├─────────────────────────┤
│                         │
│      主体内容区域         │  ← 主体占 50-60%
│    （人物/产品/场景）      │     视觉重心在此
│                         │
├─────────────────────────┤
│   副标题/标签（底部）      │  ← 留白 10-15%
│                         │     辅助信息、品牌水印
└─────────────────────────┘
```

**空间分配原则：**
- 文字区域：30-40%（含主标题和辅助文字）
- 主体区域：50-60%（核心视觉内容）
- 留白/呼吸空间：10-15%（避免压迫感）

**文字避坑：**
- 不要把文字放在人脸、产品关键部位上
- 文字颜色与背景要有足够对比度（亮背景用深色字，暗背景用亮色字或加描边/阴影）
- 小红书封面比例 3:4（1080x1440），文字安全区避开底部 150px（会被标题栏遮挡）

### 1.3 抖音封面要求

- **尺寸：** 1080x1920（9:16 竖屏）
- **核心规则：** 前3秒画面 = 封面。抖音不支持自定义封面上传（部分功能灰度中），所以视频的第一帧必须具备封面级别的视觉吸引力
- **强视觉钩子设计：**
  - 在第1帧就展示最有冲击力的画面（成品、对比结果、表情、场景）
  - 画面中的文字要在手机尺寸下清晰可读（最小 48px 等效字号）
  - 避免纯黑/纯白开头——算法可能判定为低质量内容

**封面策划 Prompt 公式：**
```
[抓眼球的主体], [清晰的环境], [强光线对比], [竖屏构图], [风格关键词],
text overlay reading "[封面文字]" in bold Chinese characters
```

---

## 二、色彩理论进阶

### 2.1 色彩和谐模型

在策划内容的色彩方案时，使用以下经典配色模型确保视觉和谐：

| 模型 | 原理 | 视觉效果 | 适用场景 | Prompt 关键词 |
|------|------|----------|----------|--------------|
| **互补色** (Complementary) | 色轮上相对的两色（如蓝+橙） | 强烈对比，视觉冲击 | 封面、对比内容、产品突出 | `complementary colors, blue and orange palette` |
| **类似色** (Analogous) | 色轮上相邻的 2-3 色（如黄+橙+红） | 和谐统一，舒适柔和 | 生活方式、美食、自然主题 | `analogous warm tones, harmonious color scheme` |
| **三角色** (Triadic) | 色轮上等距三色（如红+黄+蓝） | 丰富活泼，平衡感 | 年轻潮流、童趣内容 | `triadic color scheme, vibrant balanced palette` |
| **分裂互补色** (Split-Complementary) | 一个主色+互补色两侧的邻近色 | 对比感但不刺眼 | 需要重点突出但整体柔和的场景 | `split-complementary palette, subtle contrast` |

### 2.2 2026 平台配色趋势

| 趋势 | 色彩特征 | 情绪调性 | 适用内容 | Prompt 关键词 |
|------|----------|----------|----------|--------------|
| **奶油色暖调** | 米白、奶油黄、浅杏色、暖灰 | 温暖、治愈、慢生活 | 家居、烘焙、日常vlog | `cream tones, warm beige palette, soft ivory, cozy warm grading` |
| **莫兰迪低饱和** | 灰粉、雾蓝、灰绿、灰紫 | 高级、克制、文艺 | 时尚穿搭、艺术展、极简生活 | `Morandi palette, muted desaturated tones, grey-pink, dusty blue` |
| **深蓝+橙色对比** | 藏蓝/午夜蓝 + 烧橙/琥珀 | 专业但有活力、可信赖 | 科技测评、商业内容、知识分享 | `deep navy and burnt orange, dark blue amber contrast` |
| **米黄复古** | 米黄、棕褐、焦糖色、旧纸色 | 怀旧、温情、有故事感 | 文化内容、故事叙述、旧物改造 | `vintage sepia tones, warm nostalgic palette, old film color grading` |
| **自然绿调** | 鼠尾草绿、橄榄绿、苔藓绿+大地色 | 自然、健康、可持续 | 户外、健康饮食、环保话题 | `sage green earth tones, natural organic palette, moss and soil colors` |

### 2.3 内容类型 × 色彩矩阵

| 内容类型 | 首选色系 | 备选色系 | 避免 | 色彩策略说明 |
|----------|----------|----------|------|-------------|
| 美食教程 | 暖橙/暖黄 | 奶油色暖调 | 冷蓝、灰绿（抑制食欲） | 暖色刺激食欲感，食物在暖光下更诱人 |
| 美妆护肤 | 粉色/桃色 | 莫兰迪低饱和 | 过度饱和的荧光色 | 柔和色调与肤质高级感匹配 |
| 科技测评 | 深蓝+橙色对比 | 冷蓝/高对比黑白 | 粉色、马卡龙色 | 冷调传递专业感，橙色点缀增加活力 |
| 穿搭时尚 | 莫兰迪低饱和 | 高对比黑白 | 大面积荧光色 | 低饱和让服装本身成为视觉焦点 |
| 旅行户外 | 大地色系/自然绿 | 暖橙（日落场景） | 过度滤镜导致失真 | 保留自然色彩真实感，轻微暖调增加氛围 |
| 知识分享 | 冷蓝/白底 | 深蓝+橙色对比 | 杂乱多色 | 简洁配色降低认知负荷，突出信息 |
| 情感故事 | 胶片/复古 | 米黄复古 | 高饱和度商业感配色 | 复古色调增加故事的"年代感"和情绪厚度 |
| 母婴育儿 | 马卡龙色/奶油暖调 | 自然绿调 | 冷硬的工业风配色 | 柔和色调传递安全感和温馨感 |
| 健身运动 | 高对比（黑+亮色点缀） | 深蓝+橙 | 全粉色调 | 高对比传递力量感和动态能量 |
| 宠物日常 | 暖橙/奶油暖调 | 马卡龙色 | 阴沉冷色调 | 暖色调增加可爱亲和感 |

### 2.4 配色工具

- **Coolors** (coolors.co)：快速生成和谐配色方案，支持锁定主色后随机搭配
  - 使用方法：选定内容主色 → 锁定 → 按空格生成搭配色 → 导出 HEX 值写入风格定义
- **实操建议：** 在策划方案的"风格指南"中，明确写出 3-5 个 HEX 色值，确保素材生成和后期处理的色彩统一

---

## 三、构图进阶

### 3.1 13种构图模式

基于 SAMP-Net 分类体系，以下是短视频和图文内容中常用的 13 种构图模式：

| # | 构图模式 | 英文名 | 核心原理 | 适用内容类型 | Prompt 关键词 |
|---|---------|--------|----------|-------------|--------------|
| 1 | **中心构图** | Center Composition | 主体置于画面正中央，四周对称 | 产品展示、人像特写、美食俯拍 | `centered composition, subject in the middle, symmetrical framing` |
| 2 | **三分法** | Rule of Thirds | 主体位于3×3网格交叉点 | 通用——最安全的构图选择 | `rule of thirds, subject at intersection point` |
| 3 | **黄金比例** | Golden Ratio | 基于1:1.618螺旋线放置主体 | 自然风光、艺术感肖像、高端产品 | `golden ratio composition, fibonacci spiral placement` |
| 4 | **三角形构图** | Triangle | 三个视觉元素形成三角形稳定结构 | 多人合影、产品组合、建筑 | `triangular composition, three-point visual balance` |
| 5 | **水平线构图** | Horizontal Lines | 强调水平线条，营造平静宽广感 | 风景、海边、城市天际线 | `horizontal lines, wide landscape, calm horizon` |
| 6 | **垂直线构图** | Vertical Lines | 强调纵向线条，营造高耸挺拔感 | 建筑、森林、竖屏人像 | `vertical lines, tall structures, upward perspective` |
| 7 | **对角线构图** | Diagonal | 主要线条沿对角线延伸，制造动态感 | 运动、街拍、动态场景 | `diagonal composition, dynamic angle, tilted lines` |
| 8 | **对称构图** | Symmetry | 画面左右或上下完全对称 | 建筑、倒影、仪式感场景 | `perfect symmetry, mirror reflection, balanced composition` |
| 9 | **曲线构图** | Curves / S-Curve | S形或C形曲线引导视线流动 | 道路、河流、人体曲线、美食摆盘 | `S-curve composition, flowing curves, winding path` |
| 10 | **放射状构图** | Radial | 线条从中心向外辐射或向中心汇聚 | 光线、隧道、花朵特写、建筑仰视 | `radial composition, lines converging to center, sunburst` |
| 11 | **消失点构图** | Vanishing Point | 利用透视线汇聚于一点创造纵深 | 街道、走廊、铁路、桥梁 | `vanishing point perspective, converging lines, deep perspective` |
| 12 | **重复模式** | Repetition / Pattern | 重复元素创造节奏感和视觉韵律 | 建筑细节、市集、产品阵列 | `repeating pattern, visual rhythm, uniform arrangement` |
| 13 | **填充画面** | Fill the Frame | 主体占满整个画面，无多余背景 | 美食特写、质感细节、产品微距 | `fill the frame, extreme close-up, no negative space, tight crop` |

### 3.2 竖屏(9:16) vs 方形(3:4) 构图差异

| 维度 | 竖屏 9:16 | 方形 3:4 |
|------|-----------|----------|
| **主要平台** | 抖音短视频 | 小红书图文 |
| **视觉重心** | 垂直居中偏上（人眼自然落点） | 画面中央略偏上 |
| **适合的构图** | 垂直线、中心、三分法（纵向）、填充画面 | 三分法、对称、黄金比例、重复模式 |
| **不适合的构图** | 水平线构图（画面太窄，横向展不开） | 垂直线构图（画面不够高，效果弱） |
| **文字安全区** | 上方 15% + 下方 20% 避免被 UI 遮挡 | 底部 10% 避免被标题遮挡 |
| **主体比例建议** | 主体占画面 60-80%（竖屏空间有限，要"顶满"） | 主体占画面 40-60%（方形有更多呼吸空间） |
| **Prompt 提示** | `vertical 9:16 format, portrait orientation` | `3:4 aspect ratio, square-ish format` |

### 3.3 构图选择决策流

策划时根据以下优先级选择构图：

1. **内容类型决定基础构图** → 参考上表"适用内容类型"列
2. **平台决定画幅** → 抖音用竖屏构图，小红书用方形构图
3. **情绪决定微调** → 需要稳定感用对称/水平线，需要动态感用对角线/曲线
4. **封面图优先"中心构图"或"填充画面"** → 封面在信息流中缩略显示，复杂构图在小图下不清晰

---

## 四、2026视觉审美趋势

### 4.1 从"塑料感"到"瑕疵美"

**趋势洞察：** 过度修图、过度滤镜的"完美"内容正在失去吸引力。2026年的审美转向真实、有情感的"不完美"。

**实操要点：**
- 保留自然肤质纹理，不要磨皮到失真
- 允许画面中有轻微的不对称、自然的光影变化
- "高级感"不再等于"完美无瑕"，而是"真实且有质感"

**Prompt 关键词：**
```
natural imperfections, authentic skin texture, unretouched beauty,
real and raw, organic feel, candid moment
```

**反面 Prompt（避免）：**
```
overly smooth skin, plastic look, heavy airbrushing, uncanny valley,
too perfect, artificial beauty
```

### 4.2 Lo-Fi 美学与胶片颗粒感回归

**趋势洞察：** 受 Z 世代怀旧情绪驱动，低保真（Lo-Fi）视觉风格成为新潮流。胶片颗粒、轻微过曝、偏色都成为"风格"而非"缺陷"。

**实操要点：**
- 在风格定义中加入胶片颗粒感关键词
- 色彩处理偏暖黄或偏青绿（模拟不同胶片型号）
- 适合情感叙事、生活方式、文化内容——不适合精确的产品展示

**Prompt 关键词：**
```
film grain texture, lo-fi aesthetic, shot on 35mm film, Kodak Portra 400,
Fujifilm color science, analog photography, slight overexposure,
light leaks, vintage film look
```

### 4.3 流动的自然启发视觉系统

**趋势洞察：** 几何硬边设计让位于有机流动形态。灵感来自水流、云层、植物生长等自然形态。

**实操要点：**
- 背景和排版元素使用流动曲线而非直角矩形
- 色彩过渡使用渐变而非硬切
- 适合健康、自然、生活方式类内容

**Prompt 关键词：**
```
organic flowing shapes, nature-inspired design, fluid gradients,
soft natural curves, botanical elements, watercolor texture,
cloud-like soft edges
```

### 4.4 "活人感"取代过度修饰

**趋势洞察：** "活人感"（真实的人的状态感）是2026年中文社媒的核心审美关键词。用户厌倦了千篇一律的"网红脸"和"ins风"精致，转而追捧有个人特色、有生活气息的内容。

**实操要点：**
- 人物状态要自然——自然笑容、随意的姿势、真实的生活场景
- 光线偏向自然光而非棚拍闪光灯
- 场景要有"生活痕迹"——不必每个角落都完美布置
- 穿搭和妆容要"不费力的好看"而非精心雕琢

**Prompt 关键词：**
```
candid natural moment, effortless beauty, lived-in space,
natural daylight, relaxed pose, genuine smile, real life setting,
unstaged authentic scene, casual chic
```

**反面 Prompt（避免）：**
```
overly posed, studio lighting perfection, Instagram-perfect,
staged flat lay, heavy makeup, stiff posture
```

---

## 五、模块使用指南

### 在策划方案中的应用位置

| 策划环节 | 参考本模块章节 | 具体应用 |
|----------|--------------|----------|
| 风格指南 → 色调 | 二、色彩理论 | 根据内容类型从矩阵中选择色系，写入色调字段 |
| 风格指南 → 整体氛围 | 四、审美趋势 | 选择适合的审美趋势方向，融入氛围描述 |
| 封面图 → Generation Prompt | 一、封面设计 + 三、构图 | 按封面布局规则设计文字区域，选择构图模式 |
| 分镜脚本 → 首帧描述 | 三、构图进阶 | 为每个镜头选择合适的构图模式，写入 prompt |
| 所有图片 → 风格关键词 | 各章节 Prompt 关键词 | 从各表格中选取关键词，统一附加到所有 prompt |

### 快速决策清单

策划视觉方向时，按以下顺序决策：

1. **确定审美基调** → 第四章：选择一个主要趋势方向（真实感/胶片感/自然感/活人感）
2. **选择配色方案** → 第二章：从内容类型×色彩矩阵中选择，用 Coolors 生成具体色板
3. **确定封面策略** → 第一章：根据平台选择封面规律和布局
4. **选择构图模式** → 第三章：根据内容类型和平台画幅选择 1-2 种主要构图
5. **生成关键词集** → 汇总以上选择的 Prompt 关键词，写入风格定义块
