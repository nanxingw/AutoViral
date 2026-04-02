---
name: content-assembly
description: Assemble generated assets into final publishable content using ffmpeg for video editing and image composition. Use this skill whenever the user wants to combine clips, edit video, add subtitles, add music, create the final output, assemble content, or when the pipeline step is "assembly". Handles video concatenation, transitions, subtitle overlay, music mixing, and publish-ready text generation.
---

# 内容组装技能

## ⚠️ 字幕烧录规范（强制）

字幕烧录**必须**调用 `scripts/subtitle_burn.py`，**禁止**自行使用 ffmpeg drawtext 或手写 Pillow 方案。

```bash
# 基本用法
python3 ~/.claude/skills/content-assembly/scripts/subtitle_burn.py \
  --video input.mp4 --subs subtitles.srt --output output.mp4

# 指定风格
python3 ~/.claude/skills/content-assembly/scripts/subtitle_burn.py \
  --video input.mp4 --subs subtitles.srt --output output.mp4 --style cinematic

# 可用风格: modern (默认), cinematic, bold, minimal, karaoke
```

字体规则：
- 强制使用 `~/.autoviral/fonts/` 下的字体（由 font_manager.py 管理）
- 默认字体：Noto Sans CJK SC Regular
- **禁止使用系统字体**

你是一名专业的视频剪辑师和内容组装专家，专注于抖音和小红书的短视频和图文内容制作。你的任务是将已生成的素材（视频片段、图片）通过 ffmpeg 组装成精美的、可直接发布的成品。

## 情绪钩子 — 强制执行

**最终成品必须能让观众产生以下四种情绪中的至少一种。** 详见 `modules/emotional-hooks.md`。

| 情绪 | 剪辑/文案要求 |
|------|-------------|
| **焦虑** | 图文：严格按策划选定的路线（1/2/3）执行模板；视频：节奏递增、信息密度高、文案直接抛出威胁 |
| **愤怒** | 图文：严格按策划选定的路线（1/2/3）执行模板；视频：对比剪辑放大不合理、文案抛出开放问题引发评论 |
| **搞笑/抽象** | 节奏精确服务笑点（详见 `genres/comedy.md`）、**文案只写一句话，禁止剧透笑点** |
| **羡慕** | 慢节奏沉浸、文案轻描淡写展示结果 |

合成完成前必须自检：这条成品能让观众产生什么情绪？如果答案不明确，需要回溯调整剪辑节奏、BGM 或文案。

## 准备工作：收集上下文信息

```bash
# 1. 获取作品详情（包含 pipeline 数据中的分镜脚本/计划）
curl http://localhost:3271/api/works/{workId}

# 2. 列出所有已生成的素材
curl http://localhost:3271/api/works/{workId}/assets

# 3. 查看共享素材（音乐、字体、水印等）
curl http://localhost:3271/api/shared-assets
```

确认以下内容：
- `clips/` 目录下的所有视频片段
- `frames/` 目录下的所有帧图片
- `images/` 目录下的所有内容图片
- 共享素材中可用的音乐文件
- 上一个 pipeline 步骤生成的分镜脚本/计划

## 平台参考文档

根据目标发布平台，阅读对应的参考文档以获取输出规格和发布文案模板：
- **抖音：** 阅读 `references/douyin.md` 了解视频编码规格、分辨率要求和发布文案格式
- **小红书（XHS）：** 阅读 `references/xiaohongshu.md` 了解图片/视频规格和发布文案格式（注重 SEO）
- **双平台发布：** 两个参考文档都要阅读，并分别生成各平台的发布文案

---

## 工作流程：短视频剪辑

### 阶段一：提出剪辑方案

在执行任何 ffmpeg 命令之前，先向用户展示剪辑方案：

```markdown
## 剪辑方案

### 片段顺序
1. clip-01.mp4 (3s) — 开场/Hook
2. clip-02.mp4 (5s) — 主体内容
3. clip-03.mp4 (5s) — 发展
4. clip-04.mp4 (3s) — 高潮
5. clip-05.mp4 (3s) — 结尾/CTA

### 转场效果
- 片段 1→2: fade (0.5s)
- 片段 2→3: dissolve (0.3s)
- 片段 3→4: cut (直切)
- 片段 4→5: fade (0.5s)

### 字幕时间线
| 时间 | 字幕内容 | 样式 |
|------|---------|------|
| 00:00-00:03 | "你知道吗？" | 大号居中，白色描边 |
| 00:03-00:08 | "这个方法..." | 标准居中 |
| ... | ... | ... |

### 配乐
- 音乐: [共享素材名称或描述]
- 音量: 背景音乐 30%, 人声/旁白 100%
- 淡入: 0-1s
- 淡出: 最后2s

### 输出规格
- 分辨率: [按平台参考文档 — 如 9:16 对应 1080×1920]
- 编码: [按平台参考文档]
- 帧率: 30fps
- 预计总时长: ~25s

确认此方案？
```

等待用户确认后再继续执行。

### 音频丢失防护（极重要）

**每一步 ffmpeg 处理后，都必须验证输出文件包含音频流：**
```bash
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 output.mp4 | grep audio
```
如果没有 `audio` 行，说明音频丢失了。常见原因：
- 使用 `-map 0:v` 时忘记同时 `-map 0:a`（或用 `-map 0` 映射所有流）
- 使用 `-vf` 视频滤镜时没有用 `-c:a copy` 保留音频
- 多步骤处理时中间文件丢了音频（letterbox、字幕叠加等步骤特别容易出问题）

**安全做法：** 在 pad/crop/overlay 等纯视频操作中始终加 `-c:a copy` 或 `-map 0:a`。

### 阶段二：执行组装

#### 第1步：统一所有片段格式（横屏→竖屏智能裁切）

在拼接前，必须将所有片段转为竖屏 9:16（1080×1920）。**绝不允许出现黑边——画面必须充满屏幕。**

**先检测素材是否为横屏：**
```bash
# 获取素材目录路径
WORK_DIR=$(curl -s http://localhost:3271/api/works/{workId} | python3 -c "import sys,json; print(json.load(sys.stdin).get('path',''))")

# 检测宽高
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 clip-01.mp4
# 输出示例: 1920,1080 (横屏) 或 1080,1920 (竖屏)
```

**横屏素材的两种裁切策略：**

**策略A：充满屏幕裁切（优先使用）**

当绝对主体可以在裁切后完整露出时，直接裁切为 9:16，画面充满屏幕：

```bash
ffmpeg -i clip-01.mp4 -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" -r 30 -c:v libx264 -preset medium -crf 23 -c:a aac -ar 44100 -y norm-01.mp4
```

原理：从横屏中央裁出竖屏比例的区域，然后缩放到 1080×1920。

**策略B：保留完整宽度居中（绝对主体会被裁切时使用）**

当主体较宽（如多人场景、全身动作），裁切会遮挡主体时，保持横屏的宽度等于竖屏的宽度（1080px），在垂直方向居中，上下留黑边：

```bash
ffmpeg -i clip-01.mp4 -vf "scale=1080:-2,pad=1080:1920:0:(oh-ih)/2:black" -r 30 -c:v libx264 -preset medium -crf 23 -c:a aac -ar 44100 -y norm-01.mp4
```

原理：先将宽度缩放到 1080，高度按比例缩小，然后在上下补黑边居中。

**选择依据：**

| 情况 | 使用策略 | 判断方法 |
|------|---------|---------|
| 主体居中，占画面 < 60% 宽度 | A（充满裁切） | 裁切后主体仍完整可见 |
| 主体占画面 > 60% 宽度，或在边缘 | B（宽度对齐居中） | 裁切会切掉主体 |
| 不确定时 | 先用 A 试裁，抽一帧检查主体是否完整 | 用 ffmpeg 抽帧预览 |

**抽帧预览检查：**
```bash
# 用策略A裁切后抽一帧检查
ffmpeg -i clip-01.mp4 -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0" -ss 00:00:02 -frames:v 1 -y preview-crop.png
# 查看 preview-crop.png，确认主体是否完整
```

**竖屏素材**直接标准化：
```bash
ffmpeg -i clip-01.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,crop=1080:1920" -r 30 -c:v libx264 -preset medium -crf 23 -c:a aac -ar 44100 -y norm-01.mp4
```

**通用参数：**
- 帧率：`-r 30`
- 编码：`-c:v libx264 -preset medium -crf 23`
- 音频：`-c:a aac -ar 44100`

> **可选：视频增强处理** — 如果AI生成的素材存在帧率低、分辨率不足或画面微抖等问题，参考 `modules/video-enhancement.md` 进行增强处理。推荐处理链：RIFE帧插值 → Real-ESRGAN超分 → vid.stab稳定。

#### 第1.5步：剪除静音/停顿片段（有人声的素材必做）

当视频中有人物说话时，**必须剪掉所有无声停顿片段**，只保留人物在说话的部分。这能大幅提升节奏感和完播率。

**检测流程：**

```bash
# 1. 用 silencedetect 检测静音片段（阈值 -30dB，持续超过 0.5 秒视为停顿）
ffmpeg -i norm-01.mp4 -af silencedetect=noise=-30dB:d=0.5 -f null - 2>&1 | grep "silence_"
# 输出示例:
# [silencedetect] silence_start: 3.245
# [silencedetect] silence_end: 4.812 | silence_duration: 1.567
# [silencedetect] silence_start: 8.100
# [silencedetect] silence_end: 9.350 | silence_duration: 1.250
```

**裁剪流程：**

```bash
# 2. 根据检测结果，提取有声片段并拼接
# 假设检测到 0-3.245 有声，4.812-8.100 有声，9.350-end 有声

# 提取各有声片段
ffmpeg -i norm-01.mp4 -ss 0 -to 3.245 -c copy -y seg-01.mp4
ffmpeg -i norm-01.mp4 -ss 4.812 -to 8.100 -c copy -y seg-02.mp4
ffmpeg -i norm-01.mp4 -ss 9.350 -c copy -y seg-03.mp4

# 拼接有声片段
cat > speech-list.txt << 'EOF'
file 'seg-01.mp4'
file 'seg-02.mp4'
file 'seg-03.mp4'
EOF
ffmpeg -f concat -safe 0 -i speech-list.txt -c copy -y norm-01-trimmed.mp4
```

**自动化脚本（推荐）：**

```bash
# 一行命令：检测静音并自动生成裁剪后的视频
# 保留语音片段之间 0.1 秒的微小间隔，避免剪辑太硬
python3 -c "
import subprocess, re, sys

input_file = 'norm-01.mp4'
output_file = 'norm-01-trimmed.mp4'
silence_thresh = '-30dB'
min_silence = '0.5'

# Detect silences
result = subprocess.run(
    ['ffmpeg', '-i', input_file, '-af', f'silencedetect=noise={silence_thresh}:d={min_silence}', '-f', 'null', '-'],
    capture_output=True, text=True
)
lines = result.stderr

# Parse silence intervals
starts = [float(m.group(1)) for m in re.finditer(r'silence_start: ([\d.]+)', lines)]
ends = [float(m.group(1)) for m in re.finditer(r'silence_end: ([\d.]+)', lines)]

if not starts:
    print('No silence detected, keeping original')
    subprocess.run(['cp', input_file, output_file])
    sys.exit(0)

# Build speech segments (inverse of silence)
# Get total duration
dur_result = subprocess.run(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input_file],
    capture_output=True, text=True
)
total_dur = float(dur_result.stdout.strip())

speech = []
prev_end = 0.0
for s, e in zip(starts, ends):
    if s > prev_end + 0.05:
        speech.append((prev_end, s))
    prev_end = e
if prev_end < total_dur - 0.05:
    speech.append((prev_end, total_dur))

# Extract and concat
segs = []
for i, (a, b) in enumerate(speech):
    seg = f'_seg_{i:03d}.mp4'
    subprocess.run(['ffmpeg', '-i', input_file, '-ss', str(a), '-to', str(b), '-c', 'copy', '-y', seg],
                   capture_output=True)
    segs.append(seg)

with open('_speech_list.txt', 'w') as f:
    for seg in segs:
        f.write(f\"file '{seg}'\n\")

subprocess.run(['ffmpeg', '-f', 'concat', '-safe', '0', '-i', '_speech_list.txt', '-c', 'copy', '-y', output_file],
               capture_output=True)

# Cleanup
import os
for seg in segs:
    os.remove(seg)
os.remove('_speech_list.txt')
print(f'Trimmed: {len(starts)} silences removed, {len(speech)} speech segments kept')
"
```

**适用条件：**
- 素材中有人物说话/演讲/解说 → **必须执行**
- 纯音乐/纯画面/无人声素材 → **跳过此步**
- 抽象类内容中刻意使用的沉默 → **跳过此步**（沉默是创意的一部分）

**参数调整：**
| 场景 | noise 阈值 | min_silence |
|------|-----------|-------------|
| 安静环境录音 | -40dB | 0.5s |
| 一般室内 | -30dB | 0.5s |
| 嘈杂环境 | -20dB | 0.8s |
| 演讲/独白（保留自然停顿） | -30dB | 1.0s |

---

#### 第2步：拼接片段

**方法 A：简单拼接（无转场）**
```bash
# 创建拼接列表
cat > concat-list.txt << 'EOF'
file 'norm-01.mp4'
file 'norm-02.mp4'
file 'norm-03.mp4'
file 'norm-04.mp4'
file 'norm-05.mp4'
EOF

# 拼接
ffmpeg -f concat -safe 0 -i concat-list.txt -c copy -y concat.mp4
```

**方法 B：带转场效果（使用 xfade 滤镜）**

两个片段之间添加淡入淡出转场：
```bash
ffmpeg -i norm-01.mp4 -i norm-02.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=2.5[v]" \
  -map "[v]" -c:v libx264 -preset medium -crf 23 -y merged-01-02.mp4
```

多个片段带转场需要逐步合并：
```bash
# 合并片段 1+2
ffmpeg -i norm-01.mp4 -i norm-02.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=2.5[v]" \
  -map "[v]" -c:v libx264 -crf 23 -y temp-12.mp4

# 合并 (1+2)+3
ffmpeg -i temp-12.mp4 -i norm-03.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=dissolve:duration=0.3:offset=7.0[v]" \
  -map "[v]" -c:v libx264 -crf 23 -y temp-123.mp4

# 继续链式合并...
```

**offset 值的计算方法** = 已合并视频的总时长减去转场时长。详细计算：
- offset = (所有前序片段时长之和) - (所有前序转场时长之和) - (当前转场时长)

#### 第3步：添加字幕

**方法 A：drawtext 滤镜（简单方式，无需外部文件）**

```bash
ffmpeg -i concat.mp4 \
  -vf "drawtext=text='你知道吗？':enable='between(t,0,3)':fontsize=56:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=/System/Library/Fonts/PingFang.ttc, \
       drawtext=text='这个方法改变了一切':enable='between(t,3,8)':fontsize=48:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=/System/Library/Fonts/PingFang.ttc" \
  -c:v libx264 -preset medium -crf 23 -c:a copy -y subtitled.mp4
```

**drawtext 关键参数说明：**
- `text`：字幕文本（需正确转义特殊字符）
- `enable='between(t,START,END)'`：仅在指定时间范围内显示文字
- `fontsize`：字号，单位为像素（移动端优化建议 48-64）
- `fontcolor`：文字颜色（社交媒体通常使用白色）
- `borderw` + `bordercolor`：文字描边，提升可读性
- `x=(w-text_w)/2`：水平居中
- `y=h*0.82`：定位在距顶部约 82% 处（下三分之一区域，位于平台 UI 上方）
- `fontfile`：中文字体文件路径

**macOS 可用的中文字体：**
- `/System/Library/Fonts/PingFang.ttc` — 苹方（简洁现代）
- `/System/Library/Fonts/STHeiti Medium.ttc` — 黑体（粗体，有冲击力）
- `/System/Library/Fonts/Hiragino Sans GB.ttc` — 冬青黑体

**方法 B：ASS 字幕文件（复杂样式）**

如需更高级的字幕样式（多种颜色、动画、卡拉OK效果），可创建 ASS 文件：

```bash
cat > subs.ass << 'ASSEOF'
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
Style: Default,PingFang SC,56,&H00FFFFFF,&H00000000,1,3,0,2,20,20,340
Style: Highlight,PingFang SC,64,&H0000FFFF,&H00000000,1,4,0,2,20,20,340

[Events]
Format: Layer,Start,End,Style,Text
Dialogue: 0,0:00:00.00,0:00:03.00,Highlight,你知道吗？
Dialogue: 0,0:00:03.00,0:00:08.00,Default,这个方法改变了一切
ASSEOF

ffmpeg -i concat.mp4 -vf "ass=subs.ass" -c:v libx264 -crf 23 -c:a copy -y subtitled.mp4
```

> **进阶字幕样式** — 需要花字、动画字幕或自动语音转字幕等高级功能，参考 `modules/subtitle-aesthetics.md`。

#### 第4步：添加背景音乐

**音乐获取规则：指定知名歌曲时**

当用户指定了一首具体歌曲名时，必须遵循以下规则：

1. **必须使用官方音源**：从官方音乐平台（YouTube Music、网易云音乐、QQ音乐等）获取，不能使用真人翻唱、live版、cover版或任何非官方录音
2. **直接从高潮部分开始**：不要从歌曲开头播放。用 ffmpeg 裁切到副歌/高潮段落，跳过前奏和主歌
3. **高潮定位方法**：
   - 大多数流行歌曲高潮在 50-70% 位置（如4分钟的歌，高潮大约在 2:00-2:48）
   - 用 `ffmpeg -i song.mp3 -ss 120 -to 150 -c copy chorus.mp3` 裁切高潮段
   - 如果不确定高潮位置，搜索"[歌名] 高潮 时间点"或听几个位置找到能量最高的段落

```bash
# 下载官方音源（用 yt-dlp 从官方MV提取音频）
yt-dlp -x --audio-format mp3 --audio-quality 0 -o "song.%(ext)s" "OFFICIAL_MV_URL"

# 裁切高潮部分（示例：从2:00开始取30秒）
ffmpeg -i song.mp3 -ss 120 -to 150 -c copy -y chorus.mp3
```

```bash
# 简单的音乐叠加，带音量控制
ffmpeg -i subtitled.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=22:d=2[music];[0:a][music]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -y final.mp4
```

**如果输入视频没有音频轨：**
```bash
ffmpeg -i subtitled.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=22:d=2[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -shortest -y final.mp4
```

**音乐音量参考：**
- 仅背景音乐：`volume=0.3` 到 `volume=0.5`
- 音乐+旁白：`volume=0.15` 到 `volume=0.25`
- 音乐为主音频：`volume=0.7` 到 `volume=1.0`
- 淡入时长：1-2 秒
- 淡出时长：结尾 2-3 秒

#### 第4.5步：调色（可选但推荐）

为成品视频添加统一的调色风格，大幅提升观感：

```bash
# 应用LUT调色
ffmpeg -i final-no-grade.mp4 -vf "lut3d=cinematic.cube" -c:a copy -y final.mp4

# 或使用基础参数调色（暖调示例）
ffmpeg -i final-no-grade.mp4 -vf "eq=brightness=0.03:contrast=1.1:saturation=1.15:gamma=1.02" -c:a copy -y final.mp4
```

> 详细调色指南和内容类型专属参数，参考 `modules/color-grading.md`。

#### 第5步：最终输出

按照对应平台参考文档中的编码设置进行最终编码，然后：

```bash
# 移动到输出目录
mkdir -p output/
cp final.mp4 output/final.mp4
```

---

## 工作流程：图文排版

### 阶段一：提出排版方案

```markdown
## 图文排版方案

### 图片顺序
1. cover.png — 封面文字卡片（已在素材生成阶段完成，纯色背景+大字）
2. image-01.png — [描述]
3. image-02.png — [描述]
4. image-03.png — [描述]

### 封面处理
- 封面是文字卡片，通常不需要额外处理
- 如需微调：可调整色调使其与内容图片色系统一

### 输出
- 所有图片复制到 output/ 目录
- 生成 publish-text.md

确认此方案？
```

### 阶段二：执行

#### 封面图

封面图是素材生成阶段已完成的文字卡片（纯色背景 + 大字），直接复制到 output/ 即可，无需再叠加文字。

#### 可选：为内容图片添加文字叠加

#### 可选：创建拼图

```bash
# 用4张图片创建 2×2 拼图
ffmpeg -i img1.png -i img2.png -i img3.png -i img4.png \
  -filter_complex "[0:v]scale=540:720[a];[1:v]scale=540:720[b];[2:v]scale=540:720[c];[3:v]scale=540:720[d];[a][b]hstack[top];[c][d]hstack[bottom];[top][bottom]vstack[out]" \
  -map "[out]" -y collage.png
```

#### 复制最终图片

```bash
mkdir -p output/
cp images/cover.png output/
cp images/image-01.png output/
cp images/image-02.png output/
# ... 以此类推
```

---

## 发布文案生成

组装完成后，根据对应平台参考文档（`references/douyin.md` 或 `references/xiaohongshu.md`）中的模板生成 `output/publish-text.md`。如果需要发布到两个平台，则分别生成各平台的文案。

写入文件：
```bash
cat > output/publish-text.md << 'EOF'
[按平台参考文档模板生成的内容]
EOF
```

---

## ffmpeg 快速参考

### 常用操作

**查看视频信息：**
```bash
ffmpeg -i input.mp4 2>&1 | grep -E "Duration|Stream"
```

**裁剪视频：**
```bash
ffmpeg -i input.mp4 -ss 00:00:02 -to 00:00:08 -c copy -y trimmed.mp4
```

**变速：**
```bash
# 2倍速
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" -map "[v]" -map "[a]" -y fast.mp4
# 0.5倍速（慢动作）
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=2.0*PTS[v];[0:a]atempo=0.5[a]" -map "[v]" -map "[a]" -y slow.mp4
```

**添加水印：**
```bash
ffmpeg -i input.mp4 -i watermark.png \
  -filter_complex "[1:v]scale=100:-1,format=rgba,colorchannelmixer=aa=0.5[wm];[0:v][wm]overlay=W-w-20:20[v]" \
  -map "[v]" -map 0:a -c:v libx264 -crf 23 -c:a copy -y watermarked.mp4
```

**提取某一帧为图片：**
```bash
ffmpeg -i input.mp4 -ss 00:00:03 -frames:v 1 -y frame.png
```

**图片序列转视频：**
```bash
ffmpeg -framerate 1 -i image-%02d.png -c:v libx264 -r 30 -pix_fmt yuv420p -y slideshow.mp4
```

**按平台要求裁切画面：**
```bash
# 从 16:9 横屏裁切为 9:16 竖屏（居中裁切）
ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0" -c:v libx264 -crf 23 -y vertical.mp4
```

### 转场效果参考

可用的 xfade 转场效果：
| 转场类型 | 效果描述 | 适用场景 |
|-----------|--------|----------|
| `fade` | 渐变交叉淡化 | 通用，平滑过渡 |
| `dissolve` | 像素级溶解 | 梦幻、柔和的转场 |
| `wipeleft` | 从左到右擦除 | 有活力、有序的 |
| `wiperight` | 从右到左擦除 | 反向揭示 |
| `wipeup` | 从下到上擦除 | 积极向上、递进的 |
| `wipedown` | 从上到下擦除 | 戏剧性揭示 |
| `slideleft` | 新画面从右滑入 | 动感、现代 |
| `slideright` | 新画面从左滑入 | 动感、现代 |
| `smoothleft` | 平滑左滑 | 精致 |
| `smoothright` | 平滑右滑 | 精致 |
| `circlecrop` | 圆形揭示 | 创意、吸引注意力 |
| `rectcrop` | 矩形揭示 | 干净、专业 |
| `distance` | 缩放揭示 | 戏剧性 |
| `fadeblack` | 经由黑屏过渡 | 场景切换、时间跳跃 |
| `fadewhite` | 经由白屏过渡 | 梦幻、闪回 |
| `radial` | 径向擦除 | 动感、有活力 |
| `smoothup` | 平滑上滑 | 递进、积极向上 |
| `smoothdown` | 平滑下滑 | 收束、总结 |

**转场时长参考：**
- 快节奏内容（Hook 部分）：0.2-0.3s
- 标准内容：0.3-0.5s
- 慢节奏、电影感内容：0.5-1.0s
- 直切（无转场）：0s — 用于制造冲击力的瞬间

### CRF 质量参考

- CRF 18-20：高画质，文件较大（1080p 约 10-15MB/分钟）
- CRF 22-23：画质良好，文件大小适中（约 5-8MB/分钟）
- CRF 25-28：可接受画质，文件较小（约 3-5MB/分钟）

### 社交媒体字幕样式

**推荐字幕参数：**
- 字号：1080p 竖屏视频建议 48-64px
- 颜色：白色 (#FFFFFF) 配黑色描边 (borderw=2-4)
- 位置：距顶部 75-85%（在平台 UI 元素上方）
- 阴影：可选，`shadowx=2:shadowy=2:shadowcolor=black@0.5`
- 每行最大字符数：15-18 个中文字符
- 换行：在 drawtext 中使用 `\n`，或在 ASS 中使用多行对话

**双行字幕：**
```bash
drawtext=text='第一行内容\n第二行内容':...
```

### 音频混合速查表

**音量级别（0.0 到 1.0）：**
- 对话/旁白：1.0
- 有语音时的背景音乐：0.15-0.25
- 无语音时的背景音乐：0.3-0.5
- 音效：0.4-0.7
- 片头/片尾音乐：0.5-0.8

**音频闪避（自动降低音乐音量以突出语音）：**
```bash
ffmpeg -i video_with_voice.mp4 -i music.mp3 \
  -filter_complex "[0:a]asplit=2[voice][sc];[sc]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[compressed];[1:a]volume=0.4[music];[voice][music][compressed]amix=inputs=3:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -y output.mp4
```

**两段音频之间的交叉淡化：**
```bash
ffmpeg -i audio1.mp3 -i audio2.mp3 \
  -filter_complex "acrossfade=d=3:c1=tri:c2=tri" \
  -y crossfaded.mp3
```

---

## 垂类专项指南

执行前检查 `genres/` 目录。如果当前作品的内容类型（如搞笑、美食、教育等）有对应的 `genres/<type>.md` 文件，**必须读取并遵循其中的专项规则**——特别是剪辑节奏、BGM 策略和音效使用方面，垂类文件的规则优先级高于本文件的通用规则。

## 扩展能力模块

本 skill 自带以下模块和脚本，**必须优先使用这些工具，不要自己写内联代码替代**：

### 可用模块

| 模块 | 文档路径 | 用途 |
|------|---------|------|
| 热门音乐搜索 | `modules/music-search.md` | 从 YouTube/B站搜索下载 BGM，按情绪/BPM 匹配 |
| 卡点剪辑 | `modules/beat-sync.md` | 节拍检测 + 视频与音乐节拍对齐 |
| 调色指南 | `modules/color-grading.md` | LUT调色、内容类型调色参数、AI调色工具 |
| 字幕美学 | `modules/subtitle-aesthetics.md` | 字幕规范、花字样式、ASS高级样式、自动字幕流水线 |
| 专业字幕 | `modules/pro-captions.md` | 逐词高亮 karaoke 字幕、自动语音识别、5种预设样式 |
| 视频增强 | `modules/video-enhancement.md` | 帧插值(RIFE)、超分(Real-ESRGAN)、视频稳定(vid.stab) |

### 可用脚本

| 脚本 | 路径 | 用途 | 用法示例 |
|------|------|------|---------|
| 节拍检测 | `scripts/beat-sync/detect_beats.py` | 分析音乐节拍、BPM、强拍 | `python3 skills/content-assembly/scripts/beat-sync/detect_beats.py bgm.mp3 -o beats.json` |
| 一键卡点 | `scripts/beat-sync/beat_sync_edit.py` | 自动按节拍切割视频+混入BGM | `python3 skills/content-assembly/scripts/beat-sync/beat_sync_edit.py --video source.mp4 --music bgm.mp3 --output final.mp4 --style dramatic` |
| 专业字幕 | `scripts/caption_generate.py` | 逐词高亮 karaoke ASS 字幕生成 | `python3 skills/content-assembly/scripts/caption_generate.py --input video.mp4 --output subs.ass --style douyin-highlight` |

**⚠️ 重要：当需要节拍分析或卡点剪辑时，必须调用上述脚本，禁止自己写 librosa/numpy 内联代码。**

### 使用流程

1. 需要 BGM → 先读 `modules/music-search.md`，用 yt-dlp 搜索下载
2. 需要分析节拍 → 运行 `detect_beats.py` 获取 beats.json
3. 需要卡点剪辑 → 运行 `beat_sync_edit.py` 一键完成
4. 需要手动精调 → 参考 `modules/beat-sync.md` 中的手动流程

---

## 专业字幕生成（caption_generate.py）

逐词高亮（karaoke）字幕生成脚本，支持自动语音识别和外部时间戳两种模式，内置 5 种平台预设样式。

> **完整方法论** — 详见 `modules/pro-captions.md`，包含何时加字幕的判断、样式选择决策树、与 beat-sync 配合等。

### 参数列表

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--input` | str | 视频/音频路径（auto 模式，与 `--timestamps` 互斥） | — |
| `--timestamps` | str | 时间戳 JSON 路径（手动模式，与 `--input` 互斥） | — |
| `--output` | str（必填） | 输出 ASS 文件路径 | — |
| `--style` | str | 预设样式：`douyin-highlight`/`douyin-bold`/`xhs-soft`/`funny`/`minimal` | `douyin-highlight` |
| `--language` | str | 语言代码（auto 模式） | `zh` |
| `--model` | str | Whisper 模型（auto 模式） | `medium` |
| `--font` | str | 覆盖预设字体 ID | 由样式决定 |
| `--font-size` | int | 覆盖预设字号 | 由样式决定 |
| `--highlight-color` | str | 高亮颜色 hex，如 `#FFFF00` | 由样式决定 |
| `--base-color` | str | 基础颜色 hex，如 `#FFFFFF` | 由样式决定 |
| `--stroke-width` | int | 描边宽度 | 由样式决定 |
| `--position` | str | `center`/`top`/`bottom` | 由样式决定 |
| `--max-words` | int | 每行最大词数 | `8` |
| `--lead-time` | int | 字幕提前出现毫秒数 | `80` |

### 使用示例

```bash
# Auto 模式：自动识别视频中的语音
python3 skills/content-assembly/scripts/caption_generate.py \
  --input video.mp4 --output subtitles.ass \
  --style douyin-highlight --language zh

# Timestamps 模式：从 JSON 文件读取词级时间戳
python3 skills/content-assembly/scripts/caption_generate.py \
  --timestamps captions.json --output subtitles.ass \
  --style xhs-soft

# 自定义颜色
python3 skills/content-assembly/scripts/caption_generate.py \
  --input video.mp4 --output subtitles.ass \
  --style douyin-highlight --highlight-color "#FF6699" --font-size 56

# 烧录到视频
ffmpeg -i video.mp4 -vf "ass=subtitles.ass" -c:v libx264 -crf 18 -c:a copy output.mp4
```

### 输出格式（stdout JSON）

```json
{
  "success": true,
  "output": "/abs/path/subtitles.ass",
  "segments": 12,
  "words": 87,
  "duration_sec": 45.2,
  "style": "douyin-highlight",
  "mode": "auto",
  "model": "medium"
}
```

### 依赖

- **auto 模式**：`pip install stable-ts`（含 Whisper + torch）
- **timestamps 模式**：无额外依赖
- **烧录**：系统 ffmpeg
- **字体**：通过 `font_manager.py` 自动下载

---

## 错误处理

### 音频丢失防护（极重要）

**每一步 ffmpeg 处理后，都必须验证输出文件包含音频流：**
```bash
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 output.mp4 | grep audio
```
如果没有 `audio` 行，说明音频丢失了。常见原因：
- 使用 `-map 0:v` 时忘记同时 `-map 0:a`（或用 `-map 0` 映射所有流）
- 使用 `-vf` 视频滤镜时没有用 `-c:a copy` 保留音频
- 多步骤处理时中间文件丢了音频（letterbox、字幕叠加等步骤特别容易出问题）

**安全做法：** 在 pad/crop/overlay 等纯视频操作中始终加 `-c:a copy` 或 `-map 0:a`。

### 常见 ffmpeg 错误

**"No such file or directory"：**
- 检查文件路径 — 尽量使用绝对路径
- 确认素材已生成：`curl http://localhost:3271/api/works/{workId}/assets`

**"Invalid data found when processing input"：**
- 文件可能已损坏或不完整
- 尝试重新下载：`curl -o clip.mp4 http://localhost:3271/api/works/{workId}/assets/clips/clip-01.mp4`

**"Cannot find a matching stream"：**
- 音频/视频流不匹配
- 添加 `-an` 去除音频，或使用 `-c:a aac` 编码音频

**"Filter complex... error"：**
- 通常是滤镜语法拼写错误
- 先单独测试每个滤镜步骤，再组合使用

**字幕不显示：**
- 字体文件路径可能有误 — 用 `ls /System/Library/Fonts/` 验证
- 文本中的特殊字符需要转义：`:` → `\:`，`'` → `'\''`

---

## 完成后操作

组装完成后：

1. 展示最终输出摘要：
```
## 成品输出

### 视频
- output/final.mp4 (25s, 1080×1920, 12MB)
- 预览: http://localhost:3271/api/works/{workId}/assets/output/final.mp4

### 发布文案
- output/publish-text.md

### 下一步
1. 预览视频确认效果
2. 根据 publish-text.md 中的建议时间发布
3. 发布后关注前30分钟的数据表现
```

2. 更新 pipeline 状态：
```bash
curl -X PUT http://localhost:3271/api/works/{workId} \
  -H "Content-Type: application/json" \
  -d '{"pipeline": {"assembly": {"status": "done"}}}'
```

## 垂类专项指南

执行前检查 `genres/` 目录。如果当前作品的内容类型（如搞笑、美食、教育等）有对应的 `genres/<type>.md` 文件，**必须读取并遵循其中的专项规则**——特别是剪辑节奏、BGM 策略和音效使用方面，垂类文件的规则优先级高于本文件的通用规则。

## 扩展能力模块

本 skill 自带以下模块和脚本，**必须优先使用这些工具，不要自己写内联代码替代**：

### 可用模块

| 模块 | 文档路径 | 用途 |
|------|---------|------|
| 热门音乐搜索 | `modules/music-search.md` | 从 YouTube/B站搜索下载 BGM，按情绪/BPM 匹配 |
| 卡点剪辑 | `modules/beat-sync.md` | 节拍检测 + 视频与音乐节拍对齐 |

### 可用脚本

| 脚本 | 路径 | 用途 | 用法示例 |
|------|------|------|---------|
| 节拍检测 | `scripts/beat-sync/detect_beats.py` | 分析音乐节拍、BPM、强拍 | `python3 skills/content-assembly/scripts/beat-sync/detect_beats.py bgm.mp3 -o beats.json` |
| 一键卡点 | `scripts/beat-sync/beat_sync_edit.py` | 自动按节拍切割视频+混入BGM | `python3 skills/content-assembly/scripts/beat-sync/beat_sync_edit.py --video source.mp4 --music bgm.mp3 --output final.mp4 --style dramatic` |
| 专业字幕 | `scripts/caption_generate.py` | 逐词高亮 karaoke ASS 字幕生成 | `python3 skills/content-assembly/scripts/caption_generate.py --input video.mp4 --output subs.ass --style douyin-highlight` |

**重要：当需要节拍分析或卡点剪辑时，必须调用上述脚本，禁止自己写 librosa/numpy 内联代码。**

### 使用流程

1. 需要 BGM → 先读 `modules/music-search.md`，用 yt-dlp 搜索下载
2. 需要分析节拍 → 运行 `detect_beats.py` 获取 beats.json
3. 需要卡点剪辑 → 运行 `beat_sync_edit.py` 一键完成
4. 需要手动精调 → 参考 `modules/beat-sync.md` 中的手动流程
