# Frame Gacha & Intelligent Audio Mixing Design

> **For agentic workers:** This spec covers two independent features that improve the video creation pipeline's quality ceiling. Implement them as separate tasks.

**Goal:** (1) Add multi-candidate first-frame generation ("抽卡") so users can pick the best frame before committing to expensive video generation; (2) Replace the current audio replacement model with intelligent multi-track mixing that preserves valuable original audio from AI-generated videos.

**Scope:** Skills (methodology) + Backend API. No frontend/Studio UI changes.

---

## Feature 1: Frame Gacha (首帧抽卡)

### Problem

Current pipeline: 1 prompt → 1 first-frame → 1 video. If the first frame is poor, the entire video suffers. Image generation is cheap (~0.5 credits, ~3s); video generation is expensive (~10 credits, ~60s). There is no mechanism to generate alternatives before committing to video.

### Solution

For each shot in the storyboard, generate 4 candidate first-frames with different seeds. Present them to the user in chat. User picks the best one, then video generation proceeds from that frame only.

### File Structure

```
assets/frames/
├── candidates/
│   ├── shot-01/
│   │   ├── seed-4821.png
│   │   ├── seed-7293.png
│   │   ├── seed-1056.png
│   │   └── seed-3847_rejected.png
│   └── shot-02/
│       └── ...
├── frame-01.png       ← selected frame (copied from candidates)
├── frame-02.png
└── ...
```

- All candidates for a shot live in `candidates/{shot-id}/`.
- Selected frame is copied to `assets/frames/frame-{shot-id}.png` for downstream consumption.
- Unselected candidates are renamed with `_rejected` suffix (preserved for potential re-selection).

### API: Batch Image Generation

`POST /api/generate/image/batch`

**Request:**
```typescript
{
  workId: string
  prompt: string
  shotId: string
  count?: number          // default 4, fixed at 4
  width?: number
  height?: number
  aspectRatio?: string    // "9:16", "3:4", etc.
  provider?: string       // optional provider override
}
```

**Response:**
```typescript
{
  success: boolean
  candidates: Array<{
    path: string          // "candidates/shot-01/seed-4821.png"
    seed: number
    previewUrl: string    // "/api/works/{id}/assets/frames/candidates/..."
  }>
  errors?: string[]       // failed candidates (silent failures)
}
```

**Implementation:**
- Generate 4 random seeds.
- Call existing provider `generateImage()` 4 times via `Promise.allSettled()` (concurrent).
- Each call passes a unique seed. Provider interface (`ImageOpts`) already has an optional `seed` field.
- Store results in `assets/frames/candidates/{shotId}/seed-{seed}.png`.
- If a candidate fails, skip it silently. Return as long as >= 1 candidate succeeds.
- If all 4 fail, return `success: false` with error details.

### API: Frame Selection

`POST /api/frames/select`

**Request:**
```typescript
{
  workId: string
  shotId: string
  selectedSeed: number
}
```

**Response:**
```typescript
{
  success: boolean
  framePath: string       // "frames/frame-01.png"
}
```

**Implementation:**
- Copy `candidates/{shotId}/seed-{selectedSeed}.png` → `frames/frame-{shotId}.png`.
- Rename all other candidates in the directory: append `_rejected` to filename (before extension). If already has `_rejected`, skip.
- If user re-selects (calls again with different seed): strip `_rejected` suffix from all candidates first, then copy new selection to `frames/`, then rename all non-selected candidates with `_rejected` suffix.

### Skill Changes: asset-generation

New module: `skills/asset-generation/modules/frame-gacha.md`

Content defines:
- When to trigger gacha: after storyboard is finalized, before video generation.
- Chat interaction pattern: show 4 candidates as numbered images, ask user to pick 1-4.
- Re-roll: if user says "都不满意" or "重新抽", call batch again with new seeds.
- Skip: user can say "跳过" to use the first candidate directly (for speed).
- Integration point: after selection, proceed to existing `image2video` flow unchanged.

Update `skills/asset-generation/SKILL.md`:
- Insert gacha phase between "首帧生成" and "视频生成" steps.
- Reference the new module.

---

## Feature 2: Intelligent Audio Mixing

### Problem

Current pipeline treats audio as replacement: strip original → add BGM. But AI-generated videos (Seedance 2.0) can produce meaningful audio — ambient sounds, sound effects, even human voice when requested. The current approach discards this, degrading output quality.

### Solution

Analyze each clip's audio properties, combine with agent's own generation context (did it request voice?), and make intelligent mixing decisions. Replace the binary "replace audio" model with multi-track layered mixing using FFmpeg filter graphs.

### API: Audio Analysis

`POST /api/audio/analyze`

**Request:**
```typescript
{
  workId: string
  assetPath: string       // "clips/clip-01.mp4"
}
```

**Response:**
```typescript
{
  hasAudio: boolean           // has audio stream at all
  hasMeaningfulAudio: boolean // mean_volume > -40dB
  avgVolume: number           // dB (e.g. -18.5)
  peakVolume: number          // dB (e.g. -3.2)
  silenceRatio: number        // 0.0-1.0
}
```

**Implementation (3 steps, all via child_process.spawn):**

1. **Stream detection:** `ffprobe -v error -show_entries stream=codec_type -of csv=p=0 <file>` — check if `audio` appears in output. If no audio stream, return early with `hasAudio: false`.

2. **Volume detection:** `ffmpeg -i <file> -af volumedetect -f null /dev/null` — parse stderr for `mean_volume` and `max_volume` values.

3. **Silence detection:** `ffmpeg -i <file> -af silencedetect=noise=-40dB:d=0.3 -f null /dev/null` — parse silence start/end timestamps, compute silence ratio relative to total duration.

`hasMeaningfulAudio = hasAudio && avgVolume > -40`.

No voice detection — the agent knows from its own generation context whether it requested voice for a given clip.

### API: Multi-Track Audio Mix

`POST /api/audio/mix`

**Request:**
```typescript
{
  workId: string
  videoPath: string             // base video: "output/concat.mp4"
  tracks: Array<{
    source: string              // "clips/clip-01.mp4" or "audio/bgm.mp3"
    type: "original" | "bgm" | "voiceover" | "sfx"
    volume: number              // 0.0-1.0
    delay?: number              // start offset in seconds
    fadeIn?: number             // seconds
    fadeOut?: number            // seconds
    ducking?: {
      trigger: string           // type of track that triggers ducking, e.g. "voiceover"
      ratio: number             // compression ratio 2-8, default 4
      threshold?: number        // 0.01-0.1, default 0.02
    }
  }>
  outputFilename: string        // "final-mixed.mp4"
}
```

**Response:**
```typescript
{
  success: boolean
  assetPath: string
  previewUrl: string
}
```

**Implementation — Filter Graph Construction:**

1. Build FFmpeg input list: `-i videoPath -i track1.source -i track2.source ...`
2. For each track, build a filter chain:
   - `volume={track.volume}` — always applied
   - `adelay={track.delay * 1000}|{track.delay * 1000}` — if delay > 0
   - `afade=t=in:d={track.fadeIn}` — if fadeIn specified
   - `afade=t=out:st={totalDuration - track.fadeOut}:d={track.fadeOut}` — if fadeOut specified
   - Output label: `[t{index}]`
3. For tracks with `ducking` config:
   - Find the trigger track's output label
   - Apply `sidechaincompress`: `[t{index}][t{triggerIndex}]sidechaincompress=threshold={threshold}:ratio={ratio}:attack=200:release=1000[t{index}_ducked]`
4. Final mix: `[all_labels]amix=inputs={N}:duration=first[out]`
5. Map: `-map 0:v -map "[out]" -c:v copy -c:a aac`
6. Execute with 5-minute timeout.

**Example generated filter_complex:**
```
[0:a]volume=0.5[t0];
[1:a]volume=0.3,afade=t=in:d=2,afade=t=out:st=28:d=3[t1_pre];
[2:a]volume=1.0,adelay=1500|1500[t2];
[t1_pre][t2]sidechaincompress=threshold=0.02:ratio=4:attack=200:release=1000[t1];
[t0][t1][t2]amix=inputs=3:duration=first[out]
```

**Post-mix verification:** Run `ffprobe` on output to confirm audio stream exists.

### Skill Changes: content-assembly

New module: `skills/content-assembly/modules/audio-mixing.md`

Content defines the agent's mixing decision tree:

1. **For each clip**, check agent's own generation context:
   - Did this clip's prompt request voice/speech? → Mark as `has_intended_voice`
   - Was it a scenic/ambient shot? → Mark as `ambient_likely`

2. **Call `/api/audio/analyze`** on each clip.

3. **Decision matrix:**

   | Clip context | Audio analysis | Strategy |
   |---|---|---|
   | Intended voice | Meaningful audio | Original audio = primary (vol 1.0), BGM ducking on this track |
   | Ambient shot | Meaningful audio | Original audio as ambient (vol 0.2-0.3), BGM normal |
   | Any | Silent/no audio | Ignore original, BGM + voiceover only |

4. **Volume reference values:**
   - Primary voice track (original or voiceover): 0.8-1.0
   - BGM (normal): 0.3-0.5
   - BGM (ducked by voice): auto via sidechaincompress (ratio=4)
   - Ambient/SFX: 0.15-0.3
   - BGM fade-in: 1-2s, fade-out: 2-3s

5. **Construct tracks array** and call `/api/audio/mix`.

Update `skills/content-assembly/SKILL.md`:
- Replace existing "Phase 5: Audio Handling" section with reference to new audio-mixing module.
- Keep the audio verification step (`ffprobe` check) at the end.

---

## Files Changed Summary

### New files:
- `src/server/routes/image-batch.ts` — batch image generation endpoint
- `src/server/routes/frame-select.ts` — frame selection endpoint
- `src/server/routes/audio-analyze.ts` — audio analysis endpoint
- `src/server/routes/audio-mix.ts` — multi-track mixing endpoint
- `skills/asset-generation/modules/frame-gacha.md` — gacha methodology
- `skills/content-assembly/modules/audio-mixing.md` — mixing decision tree

### Modified files:
- `src/server/api.ts` — register new routes
- `src/providers/base.ts` — ensure `seed` field on `ImageOpts` (already exists)
- `skills/asset-generation/SKILL.md` — insert gacha phase reference
- `skills/content-assembly/SKILL.md` — replace audio handling phase reference

### Not changed:
- Frontend/Studio UI (no changes)
- Provider implementations (DreaminaProvider, JimengProvider — used as-is)
- Work store / directory creation logic (candidates dir created on demand by API)
