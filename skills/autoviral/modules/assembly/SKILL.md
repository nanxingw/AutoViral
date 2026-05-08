---
name: autoviral-assembly
description: Use when the user wants final-cut work — cutting, captions, music mixing, beat sync, color grading, packaging. Pick this directly when the user has materials and just wants a deliverable. Do NOT use to *create* footage; that lives in assets.
---

# Assembly Module

## 定位

本模块是**成片引擎**：把素材、音乐、字幕合成最终可发布的视频或图文。

**节奏、切点、音画对齐的判断**全部依赖 `taste/03-rhythm-and-editing.md`。本模块做的是：

1. 执行 `planning/` 的剪辑意图
2. 烧录字幕、混音、节拍对齐
3. 输出符合平台技术规格的成片

## 工具矩阵

| 能力 | 工具 | 用途 |
|---|---|---|
| **视频剪辑** | `ffmpeg` 命令行 | 拼接、裁剪、调速、转码 |
| **字幕烧录** | `subtitle_burn.py` （**必须**） | 带样式的硬字幕；禁止手写 drawtext |
| **字幕生成** | `caption_generate.py` | ASR 生成 SRT |
| **节拍检测** | `beat-sync/detect_beats.py` | 检测音乐 beat，输出时间戳 JSON |
| **节拍对齐剪辑** | `beat-sync/beat_sync_edit.py` | 按 beat 自动切换镜头 |
| **音频分析** | `/api/audio/analyze` | 音频 loudness / 谱分析 |
| **多轨混音** | `/api/audio/mix` | BGM + 人声 + 音效分轨混音 |

## 字幕（硬性规则）

**字幕烧录必须使用 `subtitle_burn.py`，禁止自行写 `ffmpeg drawtext` 或手拼方案。**

原因：`subtitle_burn.py` 封装了字体管理、描边样式、安全区避让、中英混排处理。手写极易产生低级事故（字体缺失、底部被平台 UI 遮挡、颜色对比不足）。

```bash
# 基础烧录
python3 scripts/subtitle_burn.py \
  --video input.mp4 \
  --srt captions.srt \
  --style bold_yellow \
  --output burned.mp4

# 自动生成字幕（ASR + 烧录）
python3 scripts/caption_generate.py --video input.mp4 --output captions.srt
python3 scripts/subtitle_burn.py --video input.mp4 --srt captions.srt --output burned.mp4
```

字幕样式选择参考 `capabilities/subtitle-aesthetics.md`，具体的字体/颜色/位置决定对齐 `taste/04-design-and-text.md`。

字幕美学详见 `capabilities/pro-captions.md`。

## 节拍对齐（Beat-sync）

当作品配了有明确节拍的音乐，用节拍驱动剪辑切点——这是 `taste/03` 里"音乐驱动的剪辑"的实现路径。

```bash
# 1. 检测节拍
python3 scripts/beat-sync/detect_beats.py bgm.mp3 -o beats.json

# 2. 按节拍剪辑（自动切换镜头到 beat 位置）
python3 scripts/beat-sync/beat_sync_edit.py \
  --video source.mp4 \
  --music bgm.mp3 \
  --beats beats.json \
  --style dramatic \
  --output final.mp4

# 或一步到位（auto 检测 + 剪辑）
python3 scripts/beat-sync/beat_sync_edit.py \
  --video source.mp4 --music bgm.mp3 \
  --style punchy --output final.mp4
```

可选 style：`steady` / `punchy` / `dramatic` / `chill`。详见 `capabilities/beat-sync.md`。

**重要**：beat-sync 是工具，不是创作决策。**哪一刀该切在 beat 上、哪一刀该切在反拍、payoff 该落在哪个 drop**——这些由 `taste/03` 指导，不能让工具代替思考。

## ffmpeg 常用片段

### 基础拼接（concat demuxer，推荐）

```bash
# 生成 filelist.txt
cat > filelist.txt <<EOF
file 'clip1.mp4'
file 'clip2.mp4'
file 'clip3.mp4'
EOF

ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
```

### 转 9:16 竖屏（带模糊背景，而非硬裁）

```bash
ffmpeg -i landscape.mp4 -vf \
  "split[a][b];[a]scale=1080:-2,boxblur=20:1[bg];[b]scale=-2:1920[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,crop=1080:1920" \
  -c:a copy output.mp4
```

### 时间裁剪（精确到帧）

```bash
ffmpeg -ss 00:00:03.500 -to 00:00:11.200 -i input.mp4 -c copy clip.mp4
```

### 调速 / 变速

```bash
# 2 倍速（视频 + 音频同步）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" -map "[v]" -map "[a]" out.mp4
```

### 画面定格（制造停顿，常用于 payoff）

```bash
ffmpeg -i in.mp4 -vf "tpad=stop_mode=clone:stop_duration=1" out.mp4
```

## 音频处理

### 单文件分析

```bash
curl -X POST http://localhost:${port}/api/audio/analyze \
  -F "file=@bgm.mp3" | jq .
# 返回 loudness LUFS、峰值、频谱特征
```

### 多轨混音（BGM + 人声 + 音效）

```bash
curl -X POST http://localhost:${port}/api/audio/mix \
  -H "Content-Type: application/json" \
  -d '{
    "tracks": [
      {"file":"bgm.mp3","role":"bgm","gain_db":-18},
      {"file":"voice.wav","role":"voice","gain_db":0},
      {"file":"sfx.wav","role":"sfx","gain_db":-6,"start_sec":3.2}
    ],
    "output":"mixed.mp3"
  }'
```

详见 `capabilities/audio-mixing.md`。Smart mixing 模式会自动识别音轨角色并应用侧链压缩，让人声时 BGM 自动下沉。

## 调色与视觉增强

**不改变画面内容，只调整观感**。创作决策（暖/冷、高饱/低饱）见 `taste/04`。

```bash
# 暖色基调
ffmpeg -i in.mp4 -vf "eq=contrast=1.05:saturation=1.1:gamma_r=1.05:gamma_b=0.95" out.mp4

# 低饱和电影感
ffmpeg -i in.mp4 -vf "curves=preset=color_negative,eq=saturation=0.85" out.mp4
```

更多预设与 LUT 加载方式见 `capabilities/color-grading.md` 和 `capabilities/video-enhancement.md`。

## 平台技术规格（工具侧约束）

成片必须落在目标分发平台可接受的技术规格上。**这是工具约束，不是创作决策**。

完整宽高比 / 分辨率 / FPS / 编码 / 码率 / LUFS / 时长 / 安全区表见 `references/platform-specs.md`——这是 frontend `PlatformPresetSection.tsx` 的同源真值表，更新规格时**两边同步改、同一个 commit 推**。

**关键不变量**：

- 移动端竖屏分发，几乎所有平台底部都有 12-18% 的 UI 安全区（关注 / 评论 / 分享 / 字幕）。关键字幕和关键画面**都要避开**。`subtitle_burn.py` 默认按 `preset.safeZonePct` 避让；手动剪辑时自己注意。
- 编码统一 H.264 mp4，30fps；如目标平台支持 60fps 且素材原生 60fps，可保留。
- 响度按平台目标 LUFS 归一化（多数 -14，小红书 -16）。

## 输出与发布

```bash
# 保存成片到作品资产
curl -X POST http://localhost:${port}/api/works/{workId}/assets \
  -F "file=@final.mp4" \
  -F "type=final_video"
```

## Capabilities 索引

- `capabilities/pro-captions.md` — 字幕美学与样式体系
- `capabilities/subtitle-aesthetics.md` — 字幕视觉设计细则
- `capabilities/beat-sync.md` — 节拍检测与对齐剪辑
- `capabilities/audio-mixing.md` — 多轨混音与侧链压缩
- `capabilities/music-search.md` — 背景音乐库检索
- `capabilities/color-grading.md` — 调色预设与 LUT
- `capabilities/video-enhancement.md` — 画质增强（超分、去噪、稳定）

## 自检

成片交付前：

- [ ] 节奏能对应 `taste/03` 里的目标节奏曲线，不是匀速
- [ ] 切点能回答"为什么这一刀"（情感 / 故事 / 节奏 / 视线）
- [ ] payoff 瞬间被节奏或声音标记（停顿 / drop / 特写）
- [ ] 字幕通过 `subtitle_burn.py` 烧录，避开底部安全区
- [ ] 混音已分轨处理，人声响度 vs BGM 有正确差值
- [ ] 成片技术规格匹配目标平台
- [ ] 对着 `taste/06-rubric.md` 整体评分 ≥ 28
