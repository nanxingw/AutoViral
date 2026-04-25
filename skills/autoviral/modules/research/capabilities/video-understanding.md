# 视频理解模块

当需要理解视频内容（分析竞品、理解用户上传素材、分析下载的热门视频等）时，加载此模块。

---

## 核心方法：抽帧 + Vision 分析 + 音频分析

```
视频 → ffprobe 元数据 → ffmpeg 抽帧 → Claude Read 逐帧理解 → 音频分析 → 综合报告
```

**关键原则：图片分析完后只保留文字描述，不要在后续对话中反复引用图片。**

---

## 使用脚本

### 快速分析（仅视觉）

```bash
python3 skills/autoviral/modules/research/scripts/video-understanding/analyze_video.py \
  <video_path> --max-frames 15
```

### 完整分析（视觉 + 音频）

```bash
python3 skills/autoviral/modules/research/scripts/video-understanding/analyze_video.py \
  <video_path> --max-frames 20 --audio-analysis
```

### 输出格式

```json
{
  "metadata": { "duration": 25.5, "width": 1080, "height": 1920, "fps": 30, "codec": "h264" },
  "scenes": [ { "start": 0.0, "end": 5.2, "duration": 5.2 }, ... ],
  "frames": [ { "path": "/tmp/av-frames/frame_000.jpg", "timestamp": 0.5, "scene_index": 0 }, ... ],
  "audio": { "has_speech": true, "bpm": 120.5, "beat_times": [0.5, 1.0, ...], "energy_profile": [...] }
}
```

---

## Agent 分析流程

### 第一步：运行脚本获取帧和元数据

```bash
ANALYSIS=$(python3 skills/autoviral/modules/research/scripts/video-understanding/analyze_video.py \
  video.mp4 --max-frames 15 --audio-analysis --json)
```

### 第二步：用 Read 工具查看抽出的帧

脚本会输出帧文件路径。用 Read 工具逐帧查看（Claude 的 Read 工具支持图片）：

```
Read: /tmp/av-frames-xxx/frame_000.jpg
Read: /tmp/av-frames-xxx/frame_001.jpg
...
```

**重要：每批不超过 5-8 帧。** 查看后立即写下文字描述，不要累积大量图片在上下文中。

### 第三步：写出结构化理解

查看完所有帧后，输出结构化分析：

```markdown
## 视频内容分析

**基本信息**: 1080x1920, 25s, 30fps
**BPM**: 120, 有人声

### 场景分解
| 时间 | 画面描述 | 情绪 | 镜头语言 |
|------|---------|------|---------|
| 0-5s | [描述] | [情绪] | [镜头] |
| 5-12s | [描述] | [情绪] | [镜头] |
| ... | ... | ... | ... |

### 内容要素
- **主题**: [主题]
- **风格**: [风格关键词]
- **目标受众**: [推测]
- **爆款要素**: [分析]

### 音频特征
- **BGM 风格**: [描述]
- **节奏**: [快/中/慢]，BPM [数值]
- **语音**: [有/无]，内容概要

### 参考价值
- **可借鉴**: [列出]
- **可改进**: [列出]
```

---

## 应用场景

| 场景 | 做法 |
|------|------|
| **竞品分析** | 下载竞品视频 → 分析结构/节奏/Hook → 写入调研报告 |
| **用户素材理解** | 分析用户上传的原始素材 → 识别可用片段 → 指导剪辑方案 |
| **下载视频筛选** | 分析 material-search 下载的候选视频 → 验证是否符合五维约束 |
| **效果复盘** | 分析已发布视频的结构 → 对比数据表现 → 总结优化方向 |

---

## 依赖

```bash
pip3 install librosa scenedetect[opencv]
# ffmpeg 和 ffprobe 需要系统安装
```
