# AI 视频生成与剪辑美学研究报告

> 调研日期：2026-03-26
> 目标：系统梳理能提升 AI 视频生成与自动化剪辑质量的方法、工具和技术，为 AutoViral 内容流水线提供可落地的技术选型参考。

---

## 目录

1. [AI 视频生成最佳实践](#1-ai-视频生成最佳实践)
2. [FFmpeg 专业级剪辑技术](#2-ffmpeg-专业级剪辑技术)
3. [卡点/音画同步剪辑](#3-卡点音画同步剪辑)
4. [开源视频增强工具](#4-开源视频增强工具)
5. [短视频（抖音/小红书）爆款美学](#5-短视频抖音小红书爆款美学)
6. [AI 视频的电影化技法](#6-ai-视频的电影化技法)
7. [字幕/文字叠加美学](#7-字幕文字叠加美学)
8. [高级音画同步技术](#8-高级音画同步技术)
9. [自动化流水线集成建议](#9-自动化流水线集成建议)

---

## 1. AI 视频生成最佳实践

### 1.1 主流模型特性与提示词策略（2026年）

| 模型 | 核心优势 | 提示词策略 | 开源/闭源 |
|------|---------|-----------|----------|
| **Kling 2.6** | 音视频同步生成（画面+配音+音效+氛围一体化）| 用"时间轴脚本"式写法，标注节拍点 | 闭源 API |
| **Sora 2** | 物理模拟引擎，因果链推理 | 描述"力"而非"外观"，写因果链条 | 闭源 API |
| **Runway Gen-4.5** | 角色一致性、运动控制 | 聚焦动态/情绪/镜头语言，非视觉外观 | 闭源 API |
| **Veo 3.1** (Google) | 渲染引擎思维，支持结构化输入 | JSON schema式提示词、参考图输入 | 闭源 API |
| **Seedance 1.0** (字节) | 中英双语原生支持，1080p 5秒41.4秒生成 | 详细描述场景+动作+光照 | 闭源（2.0 非开源）|
| **Wan 2.1/2.2** | 当前最强开源电影级视频生成 | ComfyUI 节点化工作流 | **开源** |

### 1.2 通用提示词框架

**结构化提示词模板（6要素法）：**

```
1. 镜头类型 → "以一个广角镜头开始..."
2. 镜头运动 → "缓慢推进（dolly in）的同时..."
3. 主体动作/情绪 → 具体动词+形容词
4. 光照/氛围 → "金色黄昏光线，温暖而充满希望"
5. 转场指令 → "切换到..." / "过渡到..."
6. 收尾视觉重点 → 情感或叙事收束
```

**关键原则：**
- **正向描述**：告诉模型你想要什么，而非不想要什么（避免 negative prompt）
- **描述"力"而非"样子"**：如"前引擎盖在高阻力下向内凹陷，玻璃碎片随惯性前飞"而非"一辆撞毁的车"
- **单句单动作**：每句只描述一个动作/事件
- **先设比例再生成**：后期裁剪会降低画质，务必在生成前设定正确的宽高比（16:9/9:16/1:1）

### 1.3 Kling 专项提示词技巧

- **70+ 镜头运动指令**支持：crane shot、circular movement、slow dolly、rapid pan、gentle tilt
- **指定速度和起止点**：如 "slow dolly from medium shot to close-up"
- **光照关键词**：soft lighting、neon glow、sunset backlighting、volumetric light
- 参考：[Kling 2.5 Prompt Guide (hixx.ai)](https://www.hixx.ai/blog/ai-industry-insights/kling-25-prompt)

### 1.4 开源模型推荐

- **Wan 2.1-I2V-14B-720P-Turbo**：图生视频最优，适合高速720P生成
- **Wan 2.2**：被广泛认为是目前最具电影感的开源视频生成模型
- **Wan 2.1 VACE**：支持视频修复、续写、编辑等多任务
- ComfyUI 原生支持，可构建节点化自动工作流

参考：
- [Best Open Source AI Video Generation Models (siliconflow.com)](https://www.siliconflow.com/articles/en/best-open-source-text-to-video-models)
- [Wan VACE (seedance.ai)](https://www.seedance.ai/wan-vace)

---

## 2. FFmpeg 专业级剪辑技术

### 2.1 转场效果

#### xfade 内置转场（~44种）
FFmpeg 的 `xfade` 滤镜内置约44种转场效果，包括 fade、wipeleft、slidedown、circleopen 等。

#### xfade-easing 扩展
- **GitHub**: https://github.com/scriptituk/xfade-easing
- 提供 **10种标准缓动**（quadratic, cubic, sinusoidal, exponential, elastic, bounce 等）
- 支持 **CSS 缓动函数**（cubic-bezier, steps, linear）
- 将 gl-transitions 库的 GLSL 转场**移植为 FFmpeg 原生 C 转场和自定义表达式**
- 提供 CLI 脚本 `xfade-easing.sh` 一键生成表达式

```bash
# 使用示例
ffmpeg -i first.mp4 -i second.mp4 -filter_complex \
  "xfade=duration=3:offset=1:easing=cubic-in-out:transition=wipedown" output.mp4
```

#### ffmpeg-gl-transition（GLSL 转场）
- **GitHub**: https://github.com/transitive-bullshit/ffmpeg-gl-transition
- 支持 gl-transitions.com 的所有 GLSL 转场（数百种）
- 需要自编译 FFmpeg + OpenGL/EGL 支持

#### ffmpeg-concat（Node.js 封装）
- **GitHub**: https://github.com/transitive-bullshit/ffmpeg-concat
- Node.js CLI，一行命令将多个视频用 OpenGL 转场拼接

**流水线集成方案：** 用 xfade-easing 做 CPU 端纯表达式转场（无需 GPU），适合服务器部署。

### 2.2 调色（Color Grading）

#### LUT 应用
```bash
# 应用 3D LUT 文件
ffmpeg -i input.mp4 -vf "lut3d=cinematic.cube" output.mp4

# 应用 Hald CLUT 图像
ffmpeg -i input.mp4 -i hald_clut.png -filter_complex "[0][1]haldclut" output.mp4
```

#### 基础调色参数
```bash
# 色温、饱和度、对比度调整
ffmpeg -i input.mp4 -vf "eq=brightness=0.06:contrast=1.2:saturation=1.3:gamma=1.1" output.mp4

# 色彩曲线
ffmpeg -i input.mp4 -vf "curves=preset=cross_process" output.mp4
```

#### AI 智能调色工具

| 工具 | 链接 | 说明 |
|------|------|------|
| **agentic-color-grader** | https://github.com/perbhat/agentic-color-grader | LLM Agent 驱动 FFmpeg，分析→校正→再分析→精调循环 |
| **AI_color_grade_lut** | https://github.com/andjoer/AI_color_grade_lut | pix2pix 网络生成 LUT，Colab 可用 |
| **fylm.ai** | https://fylm.ai/ | 深度学习从参考图提取调色并导出 3D LUT |
| **Color.io Match AI** | https://www.color.io/match | 自动色彩匹配+导出 .cube LUT |

**agentic-color-grader 重点说明：**
- 用自然语言对话控制调色流程
- 支持分析工具：波形图、矢量示波器、直方图、亮度/色度/饱和度指标
- 支持校正工具：曝光、对比度、Gamma、色温、饱和度、曲线、色彩平衡、LUT
- 多片段工作流：导入 FCPXML → 场景分组 → 主镜头调色 → 匹配扩展到全组 → 一致性验证 → 导出
- 适合集成到自动化流水线中作为调色环节

### 2.3 自动化流水线

```bash
# 链式处理示例：调色 → 字幕 → 转场拼接 → 输出
ffmpeg -i clip1.mp4 -vf "lut3d=warm.cube,eq=contrast=1.1" -y clip1_graded.mp4
ffmpeg -i clip1_graded.mp4 -vf "ass=subtitles.ass" -y clip1_sub.mp4
# 使用 xfade 拼接
ffmpeg -i clip1_sub.mp4 -i clip2_sub.mp4 \
  -filter_complex "xfade=duration=1:offset=4:transition=fadeblack" final.mp4
```

参考：
- [Building an Automated Video Processing Pipeline with FFmpeg (cincopa.com)](https://www.cincopa.com/learn/building-an-automated-video-processing-pipeline-with-ffmpeg)
- [FFmpeg Xfade Transition Methods (Medium)](https://donglumail.medium.com/3-methods-you-need-to-know-for-ffmpeg-transition-animation-7d2ea8f7ced7)

---

## 3. 卡点/音画同步剪辑

### 3.1 Librosa（Python 音频分析库）

**核心功能：**
- `librosa.beat.beat_track()`：节拍检测（三阶段：onset strength → 估速 → 取峰值）
- `librosa.onset.onset_detect()`：音频起始点检测（基于频谱通量）
- `librosa.beat.plp()`：Predominant Local Pulse，频域分析找每帧局部稳定节奏
- 所有时间戳可直接转为帧号，用于驱动剪辑点

**卡点剪辑流水线伪代码：**
```python
import librosa

# 加载音频
y, sr = librosa.load("bgm.mp3")

# 检测节拍
tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
beat_times = librosa.frames_to_time(beat_frames, sr=sr)

# 检测 onset（更精细的打击点）
onset_frames = librosa.onset.onset_detect(y=y, sr=sr)
onset_times = librosa.frames_to_time(onset_frames, sr=sr)

# 将节拍时间点作为剪辑切点，驱动 ffmpeg/moviepy 切割视频
for i, t in enumerate(beat_times):
    # 在每个节拍处切换片段或添加转场
    pass
```

参考：
- [librosa beat_track 文档](https://librosa.org/doc/main/generated/librosa.beat.beat_track.html)
- [Open Source Beat Detection Models Rundown (biff.ai)](https://biff.ai/a-rundown-of-open-source-beat-detection-models/)

### 3.2 Auto-Editor（自动静音剪切）

- **GitHub**: https://github.com/WyattBlue/auto-editor
- **PyPI**: `pip install auto-editor`
- 自动分析音频响度，剪切"死区"（静音段），适合口播/解说类视频的第一遍粗剪
- 命令行即用：`auto-editor input.mp4`

### 3.3 MoviePy（Python 视频编辑库）

- **GitHub**: https://github.com/Zulko/moviepy
- Python 3.9+，支持剪切、拼接、缩放、旋转、添加文字/音频/特效
- 可与 librosa 联动：检测节拍 → 在节拍处切换片段 → 添加转场 → 输出
- 支持 GIF 输出，适合做封面动图

### 3.4 商业工具参考

- **BeatEdit**（Premiere Pro 插件）：自动添加节拍标记
- **Filmora Auto Beat Sync**：自动匹配素材与音乐，识别并删除画质差的片段
- **VSDC Edit the Beat**：视频效果自动同步到节拍

---

## 4. 开源视频增强工具

### 4.1 超分辨率（Upscaling）

| 工具 | GitHub | 核心技术 | 特点 |
|------|--------|---------|------|
| **Video2X** | https://github.com/k4yt3x/video2x | Real-ESRGAN, Real-CUGAN, Anime4K, RIFE | CLI+GUI，支持 Vulkan 加速，完善的文档 |
| **REAL Video Enhancer** | https://github.com/TNTwise/REAL-Video-Enhancer | RIFE + ESRGAN | 现代重写版，Flowframes 替代品 |
| **Waifu2x-Extension-GUI** | https://github.com/AaronFeng753/Waifu2x-Extension-GUI | 集成十余种模型 | 功能最全，支持 RTX VSR |
| **enhancr** | https://github.com/mafiosnik777/enhancr | TensorRT + NCNN | Electron GUI，NVIDIA 优化 |

**Video2X CLI 使用示例：**
```bash
# 2x 超分
video2x -i input.mp4 -o output.mp4 -f realesrgan-plus -r 2

# 帧插值（RIFE）
video2x -i input.mp4 -o output.mp4 -f rife -r 2
```

### 4.2 帧插值（Frame Interpolation）

- **RIFE**（Real-Time Intermediate Flow Estimation）：https://github.com/hzwer/ECCV2022-RIFE
  - 实时级帧插值，将视频从 24fps 提升至 48/60fps
  - 命令行：`python inference_video.py --exp=1 --video=video.mp4`
  - 4K 视频可调 `--scale` 参数降低显存占用

### 4.3 视频稳定（Stabilization）

- **vid.stab** + FFmpeg：https://github.com/georgmartius/vid.stab
  - 两遍处理：第一遍检测运动（vidstabdetect）→ 第二遍补偿抖动（vidstabtransform）
  - 效果显著优于 FFmpeg 内置 deshake 滤镜

```bash
# 第一遍：分析抖动
ffmpeg -i shaky.mp4 -vf vidstabdetect=shakiness=5:accuracy=15 -f null -

# 第二遍：应用稳定
ffmpeg -i shaky.mp4 -vf vidstabtransform=smoothing=10:input=transforms.trf output.mp4
```

### 4.4 流水线集成建议

推荐处理链路：`AI生成原始视频 → RIFE帧插值(提升流畅度) → Real-ESRGAN超分(提升清晰度) → vid.stab稳定(消除AI生成的微抖动) → LUT调色`

---

## 5. 短视频（抖音/小红书）爆款美学

### 5.1 2025-2026 抖音创作趋势

基于36氪对1000支爆款视频的拆解分析：

1. **节奏感为王**：卡点切换动作/服装/风景，极强律动+流畅转场是爆款标配
2. **创意运镜**：手持转场、Fitcheck 式花式运镜+脑洞剪辑+氛围音乐
3. **"活人感"**：生活类内容强调真实、鲜活，反完美主义
4. **传统文化现代化**：年轻创作者用流行元素讲传统故事
5. **AI 特效赋能**：AI 滤镜/特效叠加成为新流量密码

### 5.2 爆款转场手法

| 转场类型 | 说明 | 适用场景 |
|---------|------|---------|
| **遮挡转场** | 利用手掌/物体遮挡镜头完成场景切换 | 换装、换场景 |
| **划像转场** | 横划/竖划/对角线划 | 产品展示、对比 |
| **闪格转场** | 快速闪白/闪黑 | 卡点高潮、氛围切换 |
| **变速转场** | 慢→快→慢，配合节拍变化 | 运动、舞蹈 |
| **旋转/3D翻转** | 画面旋转过渡 | 创意内容、科技感 |

### 5.3 视觉节奏设计

- **快节奏（0.5-1秒/镜头）**：舞蹈、卡点、产品速览
- **中节奏（2-3秒/镜头）**：Vlog、美食制作、穿搭展示
- **慢节奏（5秒+/镜头）**：风景、情感叙事、ASMR

### 5.4 小红书视觉风格

- 偏好：高饱和度、暖调、轻滤镜、"氛围感"
- 字幕风格：大标题+关键词高亮+底部小字说明
- 封面设计：统一模板感，信息密度高

参考：
- [深度拆解1000支爆款视频 (36kr.com)](https://36kr.com/p/2934211622640265)
- [2025年短视频趋势 (fanruan.com)](https://www.fanruan.com/blog/article/1797780/)

---

## 6. AI 视频的电影化技法

### 6.1 镜头运动关键词速查表

| 中文术语 | 英文提示词 | 效果 |
|---------|-----------|------|
| 推镜头 | Dolly in | 聚焦、逼近、增强压迫感 |
| 拉镜头 | Dolly out / Pull back | 揭示环境、退出 |
| 横摇 | Pan left/right | 水平扫过场景 |
| 俯仰 | Tilt up/down | 垂直视角变化 |
| 跟踪 | Tracking shot | 跟随主体运动 |
| 环绕 | Orbit / Arc shot | 围绕主体旋转 |
| 升降 | Crane shot | 从高处俯冲或升起 |
| 手持 | Handheld | 真实感、紧张感 |
| 稳定器 | Steadicam | 流畅跟随 |
| 甩镜 | Whip pan | 快速水平切换 |
| 变焦 | Zoom in/out | 焦距变化 |

### 6.2 景别关键词

- **特写 Close-Up (CU)**：面部情绪、物品细节
- **中景 Medium Shot (MS)**：腰部以上，平衡细节与环境
- **全景 Wide Shot (WS)**：建立场景、展示规模
- **过肩镜头 Over-the-Shoulder (OTS)**：对话场景
- **俯视 Bird's Eye View**：全知视角
- **仰视 Low Angle**：主体显得高大
- **荷兰角 Dutch Angle**：倾斜制造不安感

### 6.3 光照关键词

- `soft golden-hour lighting` — 温暖、希望
- `monochromatic blue palette` — 忧郁
- `high contrast, low-key lighting` — 悬疑、紧张
- `neon glow` — 赛博朋克、科技感
- `volumetric light` — 体积光，电影感
- `natural light filtering through windows` — 自然、亲切
- `dramatic shadows and silhouettes` — 戏剧张力

### 6.4 构图原则

- **对称构图**：经典、庄重
- **深焦摄影**：前后景同时清晰
- **负空间**：极简、留白
- **纵深分层**：前景/中景/背景层次

参考：
- [Civitai Video Gen Prompting Guide](https://education.civitai.com/civitais-guide-to-video-gen-prompting/)
- [Crafting Cinematic Sora Prompts (GitHub Gist)](https://gist.github.com/ruvnet/e20537eb50866b2d837d4d13b066bd88)
- [Runway Camera Terms & Examples](https://help.runwayml.com/hc/en-us/articles/47313504791059-Camera-Terms-Prompts-Examples)
- [Kling Prompt Guide (ambienceai.com)](https://www.ambienceai.com/tutorials/kling-prompting-guide)

---

## 7. 字幕/文字叠加美学

### 7.1 抖音/短视频字幕规范

**基本规范：**
- 位置：居中靠底部（不遮挡画面主体）
- 单行：15-20字以内，避免换行
- 字色：白色 + 描边/阴影确保可读
- 字号：根据平台和分辨率适配（1080p 下约 40-60px）

**花字（装饰文字）要素：**
- 文字颜色 + 纹理
- 字体选择（推荐免费商用字体）
- 多层描边 + 多层阴影
- 背景色块 + 发光效果
- 入场/出场/循环动画

### 7.2 推荐字体

| 字体 | 说明 | 授权 |
|------|------|------|
| **猴尊宋体** | 黄金比例宋体，精致大标题 | 免费商用 |
| **方正柳公权楷书** | 剪映官方合作字体 | 剪映内免费 |
| **方正王铎行草** | 剪映官方合作字体 | 剪映内免费 |
| **思源黑体/宋体** | Google+Adobe 开源 | 免费商用 |

### 7.3 技术实现

#### ASS 字幕格式（最灵活）
```
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,思源黑体,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1
```

- FFmpeg 渲染：`ffmpeg -i input.mp4 -vf "ass=subtitles.ass" output.mp4`
- 支持动画：通过 `\fad`（淡入淡出）、`\move`（移动）、`\t`（渐变变换）等 ASS 标签
- 中文字体务必确保 UTF-8 编码

#### FFmpeg drawtext 动画
- 支持表达式驱动的透明度渐变、字号缩放动画
- 适合简单动效，复杂花字推荐 ASS

#### Whisper + 自动字幕流水线
```
视频 → FFmpeg 提取音频 → Whisper 语音识别 → SRT/ASS → FFmpeg 烧录字幕
```
- OpenAI Whisper 支持多语言，中文识别精度高
- `whisper audio.wav --language zh --output_format srt`

### 7.4 pyJianYingDraft（剪映草稿生成器）

- **GitHub**: https://github.com/GuanYixuan/pyJianYingDraft
- **PyPI**: `pip install pyJianYingDraft`
- Python 生成剪映草稿文件，支持：
  - 文字气泡效果和花字预设
  - SRT 批量导入+样式批量设置
  - 入场/出场/循环动画
  - 描边、背景、阴影样式
  - 关键帧动画
  - 视频/音频/文字轨道完整操控
- Windows 支持全功能（含自动导出），Linux/macOS 支持草稿生成
- **集成价值极高**：可用 Python 生成完整剪映工程 → 导入剪映 → 一键导出

参考：
- [阿里云花字效果代码案例 (cnblogs.com)](https://www.cnblogs.com/VideoCloudTech/p/17729576.html)
- [FFmpeg Subtitles Tutorial (bannerbear.com)](https://www.bannerbear.com/blog/how-to-add-subtitles-to-a-video-with-ffmpeg-5-different-styles/)

---

## 8. 高级音画同步技术

### 8.1 超越基础节拍检测

| 技术 | 说明 | 应用 |
|------|------|------|
| **Onset Detection（起始检测）** | 频谱通量分析，检测音频事件起始点 | 精确到每个打击/音符的切点 |
| **Spectral Flux（频谱通量）** | 连续帧间频谱变化量测量 | 音效/鼓点的精确定位 |
| **PLP（Predominant Local Pulse）** | 频域分析找局部稳定节奏 | 变速音乐的自适应卡点 |
| **音源分离** | HybridDemucs / OpenUnmix | 分离鼓、人声、贝斯，分别驱动不同效果 |
| **Visual Rhythm（视觉节奏）** | 视频运动分析提取视觉节拍 | 将视觉节拍与音乐节拍对齐 = 舞蹈效果 |

### 8.2 ComfyUI 音频反应节点

#### ComfyUI_Yvann-Nodes
- **GitHub**: https://github.com/yvann-ba/ComfyUI_Yvann-Nodes
- 14个节点，支持 3 种工作流：图生视频、视频转视频、文字生视频
- **音频分析方式**：全频分析、仅鼓点、仅人声、音源分离
- **音源分离模型**：HybridDemucs、OpenUnmix
- 核心节点：Audio Analysis、Audio Peaks Detection、Audio IP Adapter Transitions、Audio Prompt Schedule
- 可将音频权重直接连接到 IPAdapter 控制和提示词调度器

#### ComfyUI_RyanOnTheInside
- **GitHub**: https://github.com/ryanontheinside/ComfyUI_RyanOnTheInside
- "Everything-Reactivity"：音频、MIDI、运动、距离、颜色、深度、亮度等全维度反应

### 8.3 前沿研究

- **MTV（Audio-Sync Video Generation）**：将音频分离为语音/音效/音乐三轨，分别控制唇动、事件时序、视觉氛围
- **Music ControlNet**：扩散模型上的多时变控制，精确控制节拍位置和动态变化
- **LTX 2.3**：ComfyUI 原生支持，4K 50fps + 内置音频同步

参考：
- [Music ControlNet for Video (HuggingFace)](https://huggingface.co/blog/B4S1C/music-control-net-for-video)
- [Audio-Sync Video Generation (arxiv.org)](https://arxiv.org/abs/2506.08003)
- [ComfyUI LTX 2.3 Audio-Synced Tutorial (apatero.com)](https://apatero.com/blog/comfyui-ltx-2-3-audio-video-workflow-tutorial-2026)

---

## 9. 自动化流水线集成建议

### 9.1 推荐技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                   AutoViral Video Pipeline                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [素材生成层]                                                 │
│    Wan 2.2 (ComfyUI) ──→ AI 视频生成                         │
│    Kling API / Runway API ──→ 商业级生成                     │
│                                                              │
│  [音频分析层]                                                 │
│    librosa ──→ 节拍检测 + onset检测 + PLP                    │
│    HybridDemucs ──→ 音源分离（鼓/人声/贝斯）                  │
│                                                              │
│  [视频增强层]                                                 │
│    RIFE ──→ 帧插值（24fps→60fps）                            │
│    Real-ESRGAN (Video2X) ──→ 超分辨率                        │
│    vid.stab ──→ 稳定化                                       │
│                                                              │
│  [剪辑合成层]                                                 │
│    FFmpeg + xfade-easing ──→ 转场拼接                        │
│    agentic-color-grader ──→ AI 调色                          │
│    Whisper ──→ 自动字幕                                      │
│    ASS/pyJianYingDraft ──→ 花字/动效字幕                     │
│    MoviePy ──→ 叠加/合成                                     │
│                                                              │
│  [输出适配层]                                                 │
│    FFmpeg ──→ 多平台格式/比例输出                             │
│    9:16 (抖音/TikTok) / 3:4 (小红书) / 16:9 (B站)           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 核心开源工具汇总

| 工具 | GitHub / 链接 | 用途 | 许可证 |
|------|--------------|------|--------|
| Video2X | https://github.com/k4yt3x/video2x | 超分+帧插值 | AGPL-3.0 |
| RIFE | https://github.com/hzwer/ECCV2022-RIFE | 帧插值 | MIT |
| vid.stab | https://github.com/georgmartius/vid.stab | 视频稳定 | GPL-2.0 |
| xfade-easing | https://github.com/scriptituk/xfade-easing | FFmpeg 转场扩展 | MIT |
| ffmpeg-gl-transition | https://github.com/transitive-bullshit/ffmpeg-gl-transition | GLSL 转场 | MIT |
| ffmpeg-concat | https://github.com/transitive-bullshit/ffmpeg-concat | 视频拼接 | MIT |
| agentic-color-grader | https://github.com/perbhat/agentic-color-grader | AI 调色 | - |
| AI_color_grade_lut | https://github.com/andjoer/AI_color_grade_lut | AI LUT 生成 | - |
| color-matcher | https://github.com/hahnec/color-matcher | 自动色彩匹配 | GPL-3.0 |
| MoviePy | https://github.com/Zulko/moviepy | Python 视频编辑 | MIT |
| auto-editor | https://github.com/WyattBlue/auto-editor | 自动静音剪切 | MIT |
| librosa | https://github.com/bmcfee/librosa | 音频分析 | ISC |
| Whisper | https://github.com/openai/whisper | 语音转文字 | MIT |
| pyJianYingDraft | https://github.com/GuanYixuan/pyJianYingDraft | 剪映草稿生成 | MIT |
| ComfyUI_Yvann-Nodes | https://github.com/yvann-ba/ComfyUI_Yvann-Nodes | 音频反应节点 | - |
| ComfyUI_RyanOnTheInside | https://github.com/ryanontheinside/ComfyUI_RyanOnTheInside | 全维度反应 | - |
| Remotion | https://github.com/remotion-dev/remotion | React 编程化视频 | BSL |
| Wan 2.1 VACE | 开源 (HuggingFace) | 视频生成/编辑 | Apache-2.0 |

### 9.3 优先级建议

**P0（立即集成，ROI 最高）：**
1. **librosa 卡点引擎**：节拍/onset 检测 → 驱动剪辑切点
2. **FFmpeg xfade-easing**：无 GPU 依赖的专业转场
3. **Whisper 自动字幕**：语音→SRT→ASS→烧录
4. **LUT 调色**：预设 3D LUT 一键应用电影感

**P1（显著提升质量）：**
5. **RIFE 帧插值**：AI 生成视频普遍帧率低，插帧后明显更流畅
6. **agentic-color-grader**：LLM 驱动的智能调色
7. **pyJianYingDraft**：生成剪映工程，利用剪映的花字/特效生态
8. **ASS 动效字幕**：比硬编码 drawtext 灵活得多

**P2（进阶优化）：**
9. **ComfyUI 音频反应节点**：音频驱动 AI 视频生成
10. **vid.stab 视频稳定**：消除 AI 生成的微抖动
11. **Real-ESRGAN 超分**：720p→1080p 提升清晰度
12. **Remotion**：React 技术栈的模板化视频生成

---

*本报告基于 2026年3月的公开资料整理，技术发展迅速，建议定期更新。*
