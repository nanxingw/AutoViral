---
name: assembly-audio-pipeline
description: 用于 UI 导出或 agent 驱动渲染需要端到端音频保真度时——例如 "BGM 在 voiceover 下要 duck"、"导出抖音版要 -14 LUFS"、"小红书版要 -16"、"硬烧字幕但保留软字幕做编辑"。给出 runRenderPipeline 的阶段决策树、平台 LUFS 表、burnSubtitles 的动画丢失约束。不用于：实时预览的音频处理（Remotion 浏览器内只支持 volume，不做 LUFS / ducking）。
---

# 音频管线统一（Phase 3）

`runRenderPipeline` 是 server-side 的渲染编排器。它把 Remotion 画布渲染、ffmpeg ducking、字幕硬烧、LUFS 二段归一化按顺序穿起来，让 UI 导出按钮和 agent 驱动渲染产出**完全相同保真度**的 MP4。

UI 浏览器侧（Remotion `<Audio>`）的能力上限是 **volume + fade**——`useCurrentFrame()` 驱动 interpolate 实现 fadeIn/fadeOut；ducking 和 LUFS 必须靠服务端 ffmpeg。

## 阶段决策树

```
runRenderPipeline(opts)
  ↓
[1] Remotion 渲染 → intermediate.mp4
  ↓
[2] 任何 AudioClip 有 ducking？
    └── 有 → mixAudioTracks（sidechaincompress trigger="voiceover"）→ ducked.mp4
    └── 无 → 跳过
  ↓
[3] opts.burnSubtitles=true？
    └── 否 → 跳过（保留软字幕由 TextTrackRenderer 在 Remotion 渲）
    └── 是 → 检查 comp 是否有 text track
              └── 无 → 抛错（"runRenderPipeline: burnSubtitles=true but the composition has no text-track clips to burn"）
              └── 有 → burnSubtitles（subtitle_burn.py，flat-list JSON）→ burned.mp4
  ↓
[4] loudnorm 二段归一化（默认 -14 LUFS）→ normalized.mp4
  ↓
[5] 重命名为 final-<timestamp>.mp4
```

## 平台 LUFS 表

| 平台 | Target LUFS | True peak | LRA |
|---|---|---|---|
| YouTube（长视频/Shorts） | -14 | -1.0 | 11 |
| TikTok / Reels / Shorts | -14 | -1.0 | 11 |
| 抖音 | -14 | -1.0 | 11 |
| 小红书 / 视频号 | -16 | -1.0 | 9 |
| Bilibili | -14 | -1.0 | 11 |
| Apple Podcasts | -16 | -1.0 | 11 |
| Spotify | -14 | -1.0 | 11 |

调用时通过 `loudnessTargetLufs` body 字段覆盖默认 -14。

> **当前限制：** `runRenderPipeline` 仅暴露 `loudnessTargetLufs`（target LUFS）；LRA 在内部固定为 11、true peak 固定为 -1.5。Phase 5+ 会让 LRA / true peak 可配置。表中的 LRA 列是 `normalizeLufs` 底层的能力，今天通过 `runRenderPipeline` 间接调用时不可调。

## AudioClip.type 的语义

Phase 3.0 在 `AudioClipSchema` 上加了 `type: "original"|"bgm"|"voiceover"|"sfx"`，默认 `"bgm"`。

- `"voiceover"` — 配音、旁白。**作为 ducking trigger**——其他 type 的 clip 在它之上播放时被压低。
- `"bgm"` — 背景音乐。会被 voiceover ducking。
- `"sfx"` — 音效（撞击、特效）。短促，不参与 ducking。
- `"original"` — 视频原声（保留时带过来的环境声）。GenerationDialog 创建的新 audio 默认不会是 original；这是从 jimeng 等 video-with-audio 生成路径回流的 clip 才会是 original。

`mixAudioTracks` 看的是这个字段决定 ducking 的 trigger。

## 硬烧字幕的动画丢失约束（D2）

`burnSubtitles=true` 的副作用：**TextClip 的 `animation` 字段（kinetic-pop / typewriter / slide-up / fade）会被丢弃**，最终 MP4 上的字幕是 subtitle_burn.py 的 5 种静态样式之一（默认 modern）。原因：

- subtitle_burn.py 用 Pillow + moviepy 逐帧渲染，没有 spring 动画引擎
- 段级 JSON 入参（`{start,end,text}`）也没有 word-level 时序，karaoke 风格的逐词高亮需要 word 级数据

**实践建议：** 默认 `burnSubtitles=false`，让 Remotion 软字幕持续供编辑使用（动画完整保留）。只在导出的最终成片需要兼容不支持软字幕的播放环境（部分平台 / 部分播放器）时打开 burn。

**注意：** `burnSubtitles=true` 但 comp 中无 text track 不是静默 no-op——pipeline 直接抛错（programming error 而非 graceful degradation）。调用前先用 `compositionTextTrackToJson(comp).length > 0` 自检。

## ducking trigger 的限制（Phase 3 MVP）

当前推荐：用 `trigger: "voiceover"`——schema 层支持任意 type 字符串，但 `mixAudioTracks` 是 type→first-match-index 选 trigger，存在多条同类型时只会压一条。`runRenderPipeline` 的 `compositionToMixTracks` 适配器目前硬编码 trigger 为 `"voiceover"`：当 comp 中存在 voiceover 时，所有带 `ducking` 的非-voiceover clip 都对它降低；comp 中无 voiceover 时 ducking 不触发，BGM 按 base volume 播。

未来：Phase 5 / Phase 6 会让 trigger 可配置（per-clip ducking → trigger by id 而非 type），支持 BGM 之间互相 duck（intro 段 BGM 在 build-up BGM 来时降）。

## 字体依赖（assertFontInstalled）

`burnSubtitles` 在调脚本前检查 `~/.autoviral/fonts/NotoSansCJKsc-Regular.otf`：

- 存在 → 透传给 subtitle_burn.py 的 `--font` flag
- 不存在 → 抛错并指明 `python3 skills/autoviral/modules/assets/scripts/font_manager.py install`

设计原因：`subtitle_burn.py` 的 font_manager 导入路径是死代码（指向不存在的 `modules/asset-generation/`，旧的 skill 名）。失败时报错应该清楚不晦涩。

## 调用方式

UI 导出按钮（`POST /api/works/:id/render`）：
```bash
curl -X POST http://localhost:3271/api/works/$ID/render \
  -H 'Content-Type: application/json' \
  -d '{"burnSubtitles": false, "loudnessTargetLufs": -14}'
```

Agent CLI 派发（通过 dispatchGeneration）：暂不直接派发渲染——agent 只生成素材，渲染由 UI 触发。

## See also

- `capabilities/audio-mixing.md` — `mixAudioTracks` 的具体 ffmpeg filter 链
- `capabilities/pro-captions.md` — 字幕生成（whisper → SRT/ASS）
- `capabilities/subtitle-aesthetics.md` — 字幕样式美学
- 主代码：`src/server/render-pipeline.ts`、`src/audio-tools.ts`
