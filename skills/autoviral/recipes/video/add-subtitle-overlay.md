# Recipe: add a subtitle overlay (CaptionModel strategy)

The user has voice or BGM in their composition and wants per-word captions on screen. AutoViral has two strategies:

- `captionStrategy: burn` (legacy) — libass hard-burns into the video track from `.srt` files or `text` clips. Final, baked.
- `captionStrategy: overlay` (newer) — renders captions via React `<CaptionsLayer>` at compose time, from a structured `CaptionModel`. Regroupable without re-running Whisper.

This recipe covers `overlay`. It's the right default for short-form social video.

## The CaptionModel shape

```yaml
captions:
  modelId: cm_w_20260513
  audioTrackId: trk_audio_bgm        # which track was transcribed; null if from a video track
  language: zh-CN
  segments:                          # per-WORD ASR output (Whisper word-level)
    - { segmentId: seg_0001, start: 0.32, end: 0.61, text: "你" }
    - { segmentId: seg_0002, start: 0.61, end: 0.98, text: "想" }
    - { segmentId: seg_0003, start: 0.98, end: 1.43, text: "要" }
    - { segmentId: seg_0004, start: 1.43, end: 1.82, text: "的" }
    - { segmentId: seg_0005, start: 1.82, end: 2.41, text: "答案" }
  groups:                            # how to visually chunk segments
    - groupId: grp_001
      start: 0.32
      end: 2.41
      segmentIds: [seg_0001, seg_0002, seg_0003, seg_0004, seg_0005]
      style:
        fontSize: 56
        color: "#ffffff"
        background: "rgba(0,0,0,0.55)"
        padding: "8px 14px"
        borderRadius: 6
        textAlign: center
        bottomOffsetPx: 120
      animation:
        entrance: { duration: 0.18, type: slide-up }
        highlight: { activeColor: "#a8c5d6", dimColor: "#9aa0a6", activeScale: 1.04 }
        exit: { duration: 0.18, type: fade }
```

`segments` is the immutable per-word source. `groups` are the visual lines — you can regroup (merge short groups, split long ones) without touching segments.

## Workflow

### Step 1 — get the per-word ASR

Run Whisper (or whichever ASR you have access to) against the workspace's audio track, producing per-word timing:

```bash
# Example with stable-ts / stable_whisper
# pip install stable-ts   (note the dash; module name is stable_whisper)
python -c "
import stable_whisper, json
model = stable_whisper.load_model('large-v3')
result = model.transcribe('$AUTOVIRAL_CWD/assets/audio/voiceover.mp3', word_timestamps=True)
segs = []
for i, w in enumerate(result.all_words()):
    segs.append({
      'segmentId': f'seg_{i:04d}',
      'start': float(w.start),
      'end': float(w.end),
      'text': w.word.strip(),
    })
print(json.dumps(segs, ensure_ascii=False))
" > "$AUTOVIRAL_CWD/plan/segments.json"
```

### Step 2 — chunk into groups

Group word segments into visual lines (typically 5–9 words per group for Chinese, 8–14 for English). One way:

```bash
python -c "
import json, sys
segs = json.load(open('$AUTOVIRAL_CWD/plan/segments.json'))
groups = []
GROUP_MAX_WORDS = 7
GROUP_MAX_DURATION = 3.5
buf = []
buf_start = None
for s in segs:
    if buf_start is None:
        buf_start = s['start']
    buf.append(s)
    duration = s['end'] - buf_start
    if len(buf) >= GROUP_MAX_WORDS or duration >= GROUP_MAX_DURATION:
        groups.append({
          'groupId': f'grp_{len(groups):03d}',
          'start': buf_start,
          'end': buf[-1]['end'],
          'segmentIds': [b['segmentId'] for b in buf],
          'style': {
            'fontSize': 56, 'color': '#ffffff',
            'background': 'rgba(0,0,0,0.55)',
            'padding': '8px 14px', 'borderRadius': 6,
            'textAlign': 'center', 'bottomOffsetPx': 120,
          },
          'animation': {
            'entrance': {'duration': 0.18, 'type': 'slide-up'},
            'highlight': {'activeColor': '#a8c5d6', 'dimColor': '#9aa0a6', 'activeScale': 1.04},
            'exit': {'duration': 0.18, 'type': 'fade'},
          },
        })
        buf, buf_start = [], None
print(json.dumps({'segments': segs, 'groups': groups}, ensure_ascii=False))
" > "$AUTOVIRAL_CWD/plan/captions.json"
```

### Step 3 — write the CaptionModel into the composition

There's no `autoviral captions set` command yet (Phase 5 widens this). For now, the cleanest path is to send a PATCH directly via the bridge HTTP API — `clip set` only handles per-clip patches, not composition-level fields.

If the user has the Studio open, the cleanest path is: drop `plan/captions.json` and ask the user to import it via the Studio's captions panel (the import button calls the right bridge endpoint internally).

Sketch for direct CLI flow (when Phase 5 lands the helper):

```bash
# future API — not yet shipped
# autoviral captions set --from plan/captions.json --strategy overlay
```

### Step 4 — confirm the strategy is set

```bash
autoviral comp show --format json | jq '{strategy: .captionStrategy, hasCaptions: (.captions != null)}'
# expected: { "strategy": "overlay", "hasCaptions": true }
```

If `captionStrategy` is missing or `"burn"`, captions won't render as overlay even with a valid `captions` field. The strategy flag is what flips the render path.

### Step 5 — preview

```bash
autoviral seek 0
autoviral play
```

You should see captions appearing word-by-word with the highlight color cycling through active words.

## Tuning

- **Group too long → reading too fast**: split groups. Smaller `GROUP_MAX_WORDS`, smaller `GROUP_MAX_DURATION`.
- **Captions colliding with platform UI**: increase `bottomOffsetPx` to 160+ for 抖音/TikTok (the Follow / share buttons sit lower).
- **Highlight too aggressive**: drop `activeScale` to 1.0, soften `activeColor` toward the cool-steel `--accent` (`#a8c5d6`).
- **Background too heavy**: reduce alpha — `rgba(0,0,0,0.35)` for cinematic looks, `rgba(0,0,0,0.0)` with a `textStroke` for clean overlays.

## When to use `burn` instead

- The user is exporting for a platform that strips overlay layers (very rare nowadays)
- The user wants a fixed final mp4 with subtitles baked in for re-distribution
- The composition is going to be remixed by a non-AutoViral tool

For everything else, prefer `overlay` — it's regroupable, restyle-able, and faster to iterate.
