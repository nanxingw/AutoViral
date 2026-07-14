# Recipe: add a subtitle overlay (CaptionModel strategy)

The user has voice or BGM in their composition and wants captions on screen. The path is `captionStrategy: "overlay"` — captions render via the React `<CaptionsLayer>` inside the single Remotion pass (preview = export), from a structured `CaptionModel`. Lines are regroupable/restyleable without re-running Whisper.

> The old standalone libass hard-burn (`captionStrategy: "burn"`) was **retired** — `src/domain/audio-tools.ts::burnSubtitles` throws unconditionally now, so don't reach for it. If you need captions baked into the pixels for redistribution, you don't need libass either: put the lines on a `text` track and burn just that lane at export via `autoviral export --caption-tracks <lang>` (Remotion composites the first language's text track into the video, further languages become sidecar `.srt`s). See "Baking captions in" at the bottom.

## Fastest path — `captions generate --script`

If the user already has the **ground-truth script** (the exact lines that were spoken — e.g. a TTS input or a shot-list narration), align it to the audio and get a CaptionModel in one shot:

```bash
autoviral captions generate --script plan/narration.txt --max-cjk-chars 14
```

This runs ASR for **word-level timing**, coarse-aligns (LCS anchoring) the ground-truth text onto those anchors — so the on-screen text is your exact script, never the ASR's mis-heard words — splits CJK into ≤ `--max-cjk-chars` (default 14) lines at word/punctuation boundaries, and writes `captions: CaptionModel` + `captionStrategy: "overlay"` into the composition. Studio refreshes automatically. Prefer this whenever the truth text exists; it's the difference between clean captions and captions littered with Whisper errors.

If there's **no** ground-truth script, fall back to the raw ASR verb (`autoviral captions generate`, no `--script`) or the manual Whisper path below.

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

**Easiest path — `autoviral captions generate`.** If you just want timecoded captions written onto the timeline, run the closed-loop verb: it shares the ASR core, writes each segment as a `TextClip` into the text track, and broadcasts so Studio refreshes — the same path a human's "生成字幕" button takes. By default it transcribes the first audio-track clip; pass `--asset <relativePath>` / `--language <code>` to override. See the "ASR captions" table in `autoviral docs _shared/03-cli-reference`.

```bash
autoviral captions generate                       # transcribe the first audio clip → text track
autoviral captions generate --asset assets/audio/voiceover.mp3 --language zh-CN
```

(The raw `POST /api/audio/captions` endpoint returns the segment JSON *without* writing the composition — use it only when you want to post-process segments yourself before the CaptionModel step below.)

**Manual path (full control over grouping/styling).** Run Whisper directly against the workspace's audio track, producing per-word timing, then chunk + write the `CaptionModel` yourself (Steps 2–3):

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

## Baking captions in (redistribution)

Sometimes the user wants a flattened mp4 with subtitles welded into the pixels — a platform that strips overlay layers (rare now), or a file headed for a non-AutoViral remix tool. **You do not need the retired libass path for this.** Put the caption lines on a `text` track, then burn just that lane at export:

```bash
# The first --caption-tracks language is composited into the video by Remotion
# (same renderer as preview); any further languages ride along as sidecar .srt.
autoviral export --caption-tracks zh
autoviral export --caption-tracks zh,en     # zh burned in, en as a sidecar .srt
```

For everything else, prefer `overlay` — it's regroupable, restyle-able, and faster to iterate.

## Managed-ffmpeg gotcha

Every burn/encode step shells out to a **workstation-resolved ffmpeg**, not whatever `ffmpeg` happens to be on `PATH`. Resolution (`src/infra/deps.ts`, surfaced as `ffmpeg-paths.ts`) walks a fixed precedence and takes the first that exists:

1. **env override** — `FFMPEG_PATH` / `FFPROBE_PATH` (the packaged desktop app points these at its bundled binaries).
2. **managed** — `~/.autoviral/bin/ffmpeg` if a copy has been provisioned there.
3. **vendored** — the bundled `ffmpeg-static` absolute path. This is the **default on a normal install**: it works under a stripped `PATH` with zero system ffmpeg, so most exports never touch `~/.autoviral/bin` at all.
4. **bare `ffmpeg`** — last-resort lookup on `PATH`.

So "managed ffmpeg in `~/.autoviral/bin`" is only one tier, and usually not the one in play. If a caption export dies with a missing-binary error, it means every tier missed — provisioning, not your composition, is the gap:

- **`autoviral setup`** — INSTALLS: creates `~/.autoviral/bin` and copies the vendored binaries in (also builds the TTS venv). This is what fixes a missing dependency.
- **`autoviral doctor`** — VERIFIES only: a pure read that prints which tier each binary resolved from. It does not install or re-provision anything; use it to confirm `setup` worked and to see which tier is active.

Never hard-code a system ffmpeg path in a recipe; it drifts across machines and breaks the double-driven (agent + human) parity.
