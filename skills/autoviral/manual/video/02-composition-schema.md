# Composition schema

`composition.yaml` is the data the Studio renders. Source of truth: `src/shared/composition.ts` (zod). This file is a working summary — when in doubt, run `autoviral comp show` and inspect the live shape.

## Top-level shape

```yaml
id: comp_w_20260513_1919_74d_v2
workId: w_20260513_1919_74d
fps: 24                    # one of 24 | 25 | 30 | 60 (locked at create-time)
width: 1280                # pixels
height: 720
duration: 81.40282         # seconds — derived from the longest track
aspect: '16:9'             # one of 9:16 | 1:1 | 16:9 | 4:5
tracks: [...]              # ordered list, see below
assets: [...]              # asset registry
provenance: [...]          # how assets were produced (model, prompt, seed)
exportPresets: [...]       # platform render configs
scenes: [...]              # optional grouping for the timeline
captionStyle: {...}        # optional defaults for text clips
captions: {...}            # optional CaptionModel (overlay strategy)
captionStrategy: overlay   # 'burn' (default) | 'overlay'
```

## Tracks

Four kinds, each with a typed clip array. The Studio renders them top-to-bottom, but the on-disk order doesn't determine z-order — the `kind` does.

```yaml
tracks:
  - id: trk_video_main
    kind: video             # video | audio | text | overlay
    label: main · 15 i2v · onset-aligned
    muted: false
    hidden: false
    clips: [...]
```

## Clip kinds

### `video` clips

```yaml
- id: vc_s01
  kind: video
  src: assets/clips/s01.mp4      # relative to workspace root
  in: 0                          # source-time start (seconds into the file)
  out: 5                         # source-time end
  trackOffset: 0                 # absolute position on the track (seconds)
  transforms: { scale: 1, x: 0, y: 0, rotation: 0 }
  filters:    { brightness: -0.03, contrast: 0.06, saturation: -0.08 }
  keyframes: [...]               # optional, see below
```

Effective duration on the timeline = `out - in`. So a clip with `in: 0, out: 5, trackOffset: 0` occupies seconds 0–5 on the track.

### `audio` clips

```yaml
- id: ac_bgm
  kind: audio
  src: assets/audio/bgm.mp3
  in: 0
  out: 81.4
  trackOffset: 0
  volume: 1.0                    # 0..1.5
  fadeIn: 0.5
  fadeOut: 2.0
  ducking: { ratio: 0.4, attack: 0.05, release: 0.3 }   # optional
  type: bgm                      # original | bgm | voiceover | sfx
```

### `text` clips

```yaml
- id: tc_title
  kind: text
  text: "你的标题"
  trackOffset: 1.0
  duration: 3.0                  # NOTE: text uses `duration`, not in/out
  style: { font: Inter, size: 64, weight: 700, color: "#ffffff" }
  position: { anchor: bottom, xPct: 50, yPct: 85 }
  animation: kinetic-pop          # kinetic-pop | typewriter | slide-up | fade
```

### `overlay` clips

```yaml
- id: ov_watermark
  kind: overlay
  src: assets/images/logo.png
  trackOffset: 0
  duration: 81.4
  position: { xPct: 5, yPct: 5, wPct: 12, hPct: 8 }
  opacity: 0.7
```

## Keyframes (the crossfade primitive)

A flat `keyframes: [...]` array on a clip animates one numeric property over time. The `time` is **relative to the clip's local timeline** (0 = clip start), not absolute on the track.

```yaml
keyframes:
  - property: opacity      # opacity | scale | x | y | rotation | volume | speed
    time: 0                # seconds since clip start
    value: 0
    easing: linear         # linear | easeIn | easeOut | easeInOut
  - property: opacity
    time: 0.18
    value: 1
    easing: easeOut
```

That snippet is the **first half of a crossfade** — fade in over 0.18s. See `recipes/video/crossfade-between-clips.md` for the full pattern (extend `out` + paired keyframes on consecutive clips).

Speed keyframes are special: their `value` must be in `[0.1, 4.0]`. The schema rejects out-of-range values on the clip's superRefine.

## Assets registry

```yaml
assets:
  - id: a_s01
    name: s01.mp4
    kind: video               # image | video | audio | subtitle
    path: assets/clips/s01.mp4
    sourceUrl: null           # populated when the asset was pulled from a URL
    metadata:                 # ONLY physical/format props live here
      sizeBytes: 1234567
      durationMs: 5000
      width: 1920
      height: 1080
      codec: h264
    status: ready             # pending | ready | failed
```

`metadata` is **physical only** — never put `model`, `prompt`, `seed`, `costUsd` there. Those belong in the provenance edge:

```yaml
provenance:
  - assetId: a_s01
    fromAssetId: a_img01      # null = root asset (upload or text-only generation)
    operation:
      type: i2v               # i2v | t2i | t2v | trim | mix | upscale | ...
      actor: agent
      params: { model: "seedance-2.0-i2v", seed: 42, durationSec: 5 }
      timestamp: "2026-05-13T19:30:00Z"
```

This separation is enforced by zod and by the render pipeline — drift breaks E2E.

## Export presets

```yaml
exportPresets:
  - id: p_douyin
    label: 抖音 1080×1920 / H.264
    platform: douyin             # douyin | xiaohongshu | weixin-channels | bilibili
                                 # | tiktok | reels | shorts | youtube-long | custom
    width: 1080
    height: 1920
    fps: 30
    videoBitrate: 8000000
    audioBitrate: 192000
    codec: h264
    container: mp4
    maxDurationSec: 60
    loudnessTargetLufs: -14
    safeZonePct: 0.05
```

`autoviral export --preset douyin` looks up by `id`. `autoviral export` (no flag) uses `exportPresets[0]`.

## Captions

Two strategies. The `captionStrategy` field on the composition picks one:

- `burn` (or absent) — libass hard-burns subtitles into the video track. Captions come from a `.srt` reference somewhere or from `text` clips.
- `overlay` — uses the `captions: CaptionModel` field below. Per-word ASR segments are rendered via React `<CaptionsLayer>` at compose time. Regroupable without re-running Whisper.

See `recipes/add-subtitle-overlay.md` for the wire-up.

## What the CLI lets you set on `clip set`

`autoviral clip set <id> --key value` sends the patch verbatim. Anything in the clip schema is fair game; the server zod-validates before write. Common keys:

- video: `--in`, `--out`, `--trackOffset`
- audio: `--volume`, `--fadeIn`, `--fadeOut`
- text: `--text`, `--duration`, `--trackOffset`

(overlay clips aren't CLI-creatable yet — `clip add --track overlay` throws, HTTP 400 — so there's no overlay clip to `clip set` against.)

`clip set` does **not** currently merge nested objects (transforms/filters/position/style) — patches at those keys would replace the whole sub-tree. To tweak one filter, fetch with `comp show`, mutate locally, and `clip set --filters '{...}'` with the full object.
