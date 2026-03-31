---
name: music-generation
description: AI 音乐生成方法论。使用 Google Lyria 3 Pro 生成 BGM 和配乐，支持文生音乐和图生音乐。
---

# AI 音乐生成指南

本模块说明如何在 assets 阶段使用 Google Lyria 3 Pro 生成 BGM 和配乐。生成的音乐在 assembly 阶段由 ffmpeg 混入最终视频。

---

## 何时生成 BGM

| 内容形式 | BGM 必要性 | 说明 |
|---------|-----------|------|
| 短视频 | **必须生成** | 策划方案中标注了 BGM 需求的镜头均需配乐 |
| 图文轮播视频 | 可选 | 轮播图导出为展示视频时可加背景氛围音乐 |
| 纯图文 | 通常不需要 | 静态图文帖无需 BGM |

---

## 脚本用法

脚本路径：`~/.claude/skills/asset-generation/scripts/music_generate.py`

需要环境变量 `OPENROUTER_API_KEY`。模型固定为 `google/lyria-3-pro-preview`（$0.08/首，生成约 2 分钟完整曲目）。

### 参数说明

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--prompt` | str（必填） | 音乐描述 | — |
| `--output` | str（必填） | 输出文件路径（`.mp3`） | — |
| `--ref-image` | str（可多次） | 参考图路径或 URL（图生音乐） | 无 |
| `--vocal` | flag | 启用人声（默认纯器乐） | False |
| `--seed` | int | 随机种子，用于复现相同音乐 | 无 |
| `--temperature` | float | 创意度，范围 0.0–2.0 | 无 |

### 示例一：纯器乐 BGM（默认）

```bash
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "soft acoustic guitar, warm and cozy, lo-fi vibes, 85 BPM" \
  --output {workDir}/assets/music/bgm.mp3
```

### 示例二：图生音乐（用封面图引导风格）

```bash
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "background music matching this image mood" \
  --ref-image {workDir}/assets/images/cover.png \
  --output {workDir}/assets/music/bgm.mp3
```

### 示例三：带人声

```bash
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "catchy pop song about spring fashion, female vocal, 110 BPM" \
  --vocal \
  --output {workDir}/assets/music/bgm-vocal.mp3
```

### 示例四：固定种子（保持一致性）

```bash
python3 ~/.claude/skills/asset-generation/scripts/music_generate.py \
  --prompt "upbeat energetic pop, claps and synth, motivational, 120 BPM" \
  --seed 42 \
  --output {workDir}/assets/music/bgm.mp3
```

### 输出格式（stdout JSON）

```json
{
  "success": true,
  "output": "/absolute/path/to/bgm.mp3",
  "duration_sec": 120,
  "model": "google/lyria-3-pro-preview",
  "has_vocals": false,
  "size_kb": 2400.5,
  "lyrics": null
}
```

---

## Prompt 工程

### 风格关键词库（按情绪分类）

与 `emotional-hooks.md` 的情绪体系对齐，根据内容情绪选择对应音乐风格：

| 情绪 | 推荐音乐风格关键词 |
|------|------------------|
| **焦虑/紧迫** | tense strings, minor key, 120+ BPM, suspenseful, dark ambient, staccato piano |
| **愤怒/冲突** | heavy drums, distorted guitar, aggressive, powerful, intense, driving rhythm |
| **搞笑/抽象** | quirky, playful, ukulele, comedic timing, bouncy, whimsical, tuba, kazoo |
| **羡慕/向往** | dreamy, soft piano, warm strings, ethereal, inspiring, nostalgic, cinematic |
| **治愈/温暖** | acoustic guitar, gentle, cozy, lo-fi, warm pads, soft percussion, nature sounds |
| **活力/积极** | upbeat pop, bright, energetic, claps, synth, motivational, major key, 120 BPM |

### 参数控制关键词

**BPM（节奏速度）**
- 慢速舒缓：`slow tempo around 70 BPM`
- 中速标准：`tempo 90 BPM`
- 快速活力：`upbeat 120 BPM`
- 超快卡点：`fast tempo 130+ BPM`

**调性（情绪倾向）**
- 明亮开朗：`in C major`
- 温暖积极：`in G major`
- 忧伤深沉：`in A minor`
- 神秘压抑：`in D minor`

**乐器组合**
- 轻柔氛围：`acoustic guitar, soft piano, light percussion, warm strings`
- 治愈 lo-fi：`lo-fi beats, vinyl crackle, muted piano, lazy drums`
- 史诗大气：`full orchestra, soaring strings, powerful brass, cinematic`
- 流行节奏：`pop production, electronic drums, synth bass, bright lead`

**段落结构标签**（引导动态变化）

```
[Intro] soft piano, sparse, quiet →
[Verse] add acoustic guitar, gentle rhythm →
[Chorus] full band, energetic, uplifting →
[Bridge] stripped back, emotional →
[Outro] fade out, return to piano only
```

### Prompt 构建模板

```
{风格形容词}, {主乐器}, {情绪关键词}, {BPM}, {调性}, {结构标签（可选）}
```

示例：
```
Warm and nostalgic, acoustic guitar and soft piano, gentle and cozy,
tempo 85 BPM, in G major.
[Intro] solo guitar → [Main] add piano and light drums → [Outro] fade to silence
```

---

## 图生音乐

`--ref-image` 参数允许传入图片，让 Lyria 分析视觉氛围并生成匹配的音乐。

**适用场景：**
- 不确定该用什么音乐风格时，让封面图或关键帧来决定
- 视觉色调和音乐情绪需要高度匹配时
- 快速生成与内容视觉自然融合的 BGM

**用法说明：**
- 传入封面图（`cover.png`）：Lyria 读取整体色调和氛围
- 传入关键帧（高潮画面）：更精准地匹配内容情绪
- 可同时添加文字 prompt 作为补充约束，图片优先

**示例：**
```bash
# 只用图片决定风格
--ref-image cover.png --prompt "background music for this scene"

# 图片 + 文字约束（限定 BPM 和乐器）
--ref-image keyframe.jpg --prompt "acoustic guitar style, tempo 90 BPM"
```

---

## 平台适配

| 平台 | 风格偏好 | BPM 范围 | 特殊要求 |
|------|---------|---------|---------|
| **抖音** | 节奏感强，有明确 hook | 100–130 BPM | 前 3 秒有抓耳元素，支持卡点剪辑 |
| **小红书** | 氛围感优先，轻柔舒缓 | 70–100 BPM | acoustic / lo-fi 风格，不抢镜 |

**抖音 Prompt 示例：**
```
Energetic pop with a catchy hook in the first 3 seconds, synth and claps,
upbeat 120 BPM, bright and punchy, in C major
```

**小红书 Prompt 示例：**
```
Soft lo-fi acoustic guitar, cozy and relaxed, gentle percussion,
slow tempo 80 BPM, warm pads, in G major, unobtrusive background feel
```

---

## 图生音乐

（已在上方"图生音乐"章节详细说明）

---

## 与 Assembly 阶段的衔接

**文件存放规范：**
```
assets/music/
  bgm.mp3        （主 BGM）
  bgm-alt.mp3    （备选方案）
```

**ffmpeg 混音命令：**
```bash
# 将 BGM 以 20% 音量混入主音轨
ffmpeg -i {workDir}/output/video-no-bgm.mp4 \
       -i {workDir}/assets/music/bgm.mp3 \
       -filter_complex "[1:a]volume=0.2[bg];[0:a][bg]amix=inputs=2" \
       -c:v copy {workDir}/output/final.mp4
```

**音量建议：**
- 有人声/解说旁白时：BGM 音量 15–25%
- 纯视觉画面（无语音）：BGM 音量 40–60%
- 片尾淡出：用 `afade=t=out` 滤镜在最后 3 秒渐弱

**节拍同步剪辑：**
如需卡点剪辑（抖音常见），配合 `modules/beat-sync.md` 使用——先用 beat-sync 提取 BGM 节拍时间戳，再据此裁切视频片段。

---

## 安全过滤提示

- 不要在 prompt 中要求模仿特定歌手或艺人的声音风格
- 不要包含受版权保护的歌词原文
- 所有 Lyria 生成的音乐自动嵌入 **SynthID** 水印（不可见，不影响音质）
- 生成内容版权归生成方所有，可用于商业发布
