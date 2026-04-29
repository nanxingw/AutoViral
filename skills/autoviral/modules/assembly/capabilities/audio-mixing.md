# 智能音频混音模块

AI 生成的视频片段可能自带有价值的音频（环境音、音效、人声）。不要总是替换——根据上下文智能混音。

---

## 核心原则

1. **先分析再决策** — 每个 clip 的音频属性不同，不能一刀切
2. **保留有价值的原始音频** — AI 生成的环境音、音效可能比静音+BGM 效果更好
3. **人声优先** — 有意义的人声永远是主音轨，其他音轨配合它
4. **多轨混音** — 不再用简单的 `amix` 叠加，而是通过 API 精确控制每一轨

---

## 决策流程

### 第1步：分析每个 clip 的音频

对每个视频片段调用音频分析 API：

```bash
curl -X POST http://localhost:3271/api/audio/analyze \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/clip_01.mp4"}'
```

返回值示例：
```json
{
  "hasAudio": true,
  "hasMeaningfulAudio": true,
  "avgVolume": -18.5,
  "peakVolume": -6.2,
  "silenceRatio": 0.12,
  "durationMs": 5200
}
```

字段说明：
- `hasAudio`：是否包含音频轨道
- `hasMeaningfulAudio`：音频是否有意义（非纯噪声/纯静音）
- `avgVolume`：平均音量（dBFS），-20 以上算较响
- `peakVolume`：峰值音量（dBFS）
- `silenceRatio`：静音占比，> 0.8 基本等于无音频

### 第2步：结合生成上下文

你（Agent）在生成 clip 时已经知道：
- 该 clip 是否被要求生成人声（prompt 中有没有 voice/speech 相关指令）
- 场景类型：对话、风景、动作、展示等
- 是否有独立配音轨道需要叠加

将 API 返回的音频分析结果与你自己的上下文综合判断。

### 第3步：决策矩阵

| 生成上下文 | 音频分析结果 | 混音策略 |
|-----------|------------|---------|
| 要求了人声 | `hasMeaningfulAudio = true` | 原始音频作为主音轨（volume 0.8-1.0），BGM 做 ducking |
| 风景/环境镜头 | `hasMeaningfulAudio = true` | 原始音频作为环境音（volume 0.2-0.3），BGM 正常播放 |
| 动作/展示镜头 | `hasMeaningfulAudio = true` | 原始音频作为音效（volume 0.3-0.5），BGM 正常播放 |
| 任何上下文 | `silenceRatio > 0.8` 或 `hasAudio = false` | 忽略原始音频，仅 BGM + 配音 |
| 有独立配音 | 任何 | 配音作为主音轨（volume 0.8-1.0），BGM 做 ducking，原始音频降低或静音 |

### 第4步：调用混音 API

根据决策结果构建 tracks 配置，调用混音 API：

```bash
curl -X POST http://localhost:3271/api/audio/mix \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "w_20260428_xxxxx_xxxx",
    "videoPath": "input.mp4",
    "outputFilename": "mixed_output.mp4",
    "tracks": [
      {
        "source": "/path/to/clip_01.mp4",
        "type": "original",
        "volume": 0.25,
        "delay": 0,
        "fadeIn": 0,
        "fadeOut": 0.5
      },
      {
        "source": "/path/to/bgm_chorus.mp3",
        "type": "bgm",
        "volume": 0.5,
        "delay": 0,
        "fadeIn": 1.0,
        "fadeOut": 2.0,
        "ducking": {
          "trigger": "voiceover",
          "ratio": 4,
          "threshold": 0.02
        }
      },
      {
        "source": "/path/to/voiceover.mp3",
        "type": "voiceover",
        "volume": 0.9,
        "delay": 0.5,
        "fadeIn": 0.2,
        "fadeOut": 0.3
      }
    ]
  }'
```

> **字段命名约定（与 `MixTrack` 接口一致）：** 顶层 body 必须包含 `workId` / `videoPath` / `tracks` / `outputFilename`。每个 track 的字段是 `source`（不是 `filePath`）、`delay` / `fadeIn` / `fadeOut`（单位**秒**，不是毫秒）。`ducking` 子对象用 `trigger`（不是 `triggerTrack`），且不需要 `enabled`——只要存在 `ducking` 对象就启用。注意：`/api/audio/analyze` 端点用的是 `filePath`，与 mix API 不同。

上面这个示例演示了一个典型的三轨混音：
1. **原始音频** — clip 自带的环境音，降低音量作为氛围
2. **BGM** — 背景音乐，带 ducking（当配音响起时自动降低）
3. **配音** — 语音旁白，延迟 500ms 后开始

---

## 音量参考值

| 音轨类型 | 音量范围 | 说明 |
|---------|---------|------|
| 人声（原始或配音） | 0.8 - 1.0 | 永远是最突出的音轨 |
| BGM（有人声时，auto ducking） | 0.3 - 0.5 | ducking 激活时会自动再降低 |
| BGM（纯音乐，无人声） | 0.5 - 0.7 | 可以稍响，但不要盖过画面节奏 |
| 环境音 / 氛围音效 | 0.15 - 0.3 | 若太响会干扰，宁低勿高 |
| SFX（转场音效、打击音等） | 0.5 - 0.8 | 短促爆发型，可以较响 |

---

## Ducking 参数推荐

Ducking 指当主音轨（通常是人声）响起时，自动压低 BGM 音量。

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `ratio` | 4 | 压缩比。2 = 轻压（BGM 只降一点），4 = 常规，8 = 重压（BGM 几乎消失） |
| `threshold` | 0.02 | 触发阈值。人声音量超过此值时开始压低 BGM |
| `attack` | 200ms | 内置参数，ducking 开始的渐变时间 |
| `release` | 1000ms | 内置参数，人声结束后 BGM 恢复的渐变时间 |

**场景选择建议：**
- `ratio: 2`（轻压）— 访谈/对话场景，BGM 只需略降
- `ratio: 4`（标准）— 大部分场景的默认选择
- `ratio: 8`（重压）— 教程/解说，需要人声极其清晰

---

## 验证

混音完成后，使用 ffprobe 检查输出文件：

```bash
# 检查音频轨道信息
ffprobe -v quiet -print_format json -show_streams -select_streams a mixed_audio.mp3

# 检查音量是否正常（不应有削波）
ffprobe -v quiet -print_format json -show_entries stream=codec_name,sample_rate,channels,bit_rate mixed_audio.mp3
```

确认要点：
- 输出文件存在且时长正确
- 采样率 ≥ 44100Hz
- 无削波（peak 不超过 0 dBFS）
- 主观听感：人声清晰、BGM 不抢戏、环境音自然融入
