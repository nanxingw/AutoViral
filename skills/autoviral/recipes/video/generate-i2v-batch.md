# Recipe: generate an i2v (image-to-video) batch

The user says *"turn these 16 image stills into 5-second clips"*. You drive the external i2v model (Seedance / Kling / Runway / whatever the user has API keys for) and then write the resulting clips into the composition.

## Setup — know what you have

```bash
# What images are in the workspace?
autoviral list assets --kind image

# Existing video clips on the main track?
autoviral list clips --track video

# Composition's fps + aspect (determines the right resolution to request)
autoviral comp show --format json | jq '{fps, aspect, width, height}'
```

Match the request to the composition. With AutoViral's `POST /api/generate/video` (Seedance 2.0 via OpenRouter), the parameters are honored: `aspectRatio` (one of `1:1` / `3:4` / `9:16` / `4:3` / `16:9` / `21:9` / `9:21`; omit it and it follows the work's canvas, `4:5` mapping to `3:4`), `resolution` (`480p` / `720p` / `1080p`), `durationSec` (integer `4`–`15`). **fps is fixed at 24** — it isn't a parameter.

> The old observation that "Seedance i2v always outputs 720×1280 / 24fps regardless of what you ask" came from a bug, not a model limit: the adapter wrapped every parameter in an `input:{}` object the OpenRouter gateway silently dropped, so requests degraded to bare model+prompt. That nesting was removed (2026-06-10); aspect/resolution/duration now reach the model.
>
> **Probe-verified 2026-06-10** (real generations, ffprobe-confirmed): ① explicit `aspectRatio` always wins — a 9:16 portrait anchor + explicit `16:9` produced a true 1280×720 landscape clip; ② `1080p` is real (9:16 → 1080×1920, ≈$0.34/s vs 720p ≈$0.15/s); ③ every output is 24fps. ④ **Anchor-image gotcha**: ByteDance rejects i2v input images that look like a real person (`InputImageSensitiveContentDetected.PrivacyInformation`, HTTP 400 at enqueue, not billed) — stylized/object/scenery anchors pass. Plan "参考人物" workflows around stylized characters, not photo-real faces.

## Generation loop (model-agnostic skeleton)

```bash
IMAGES=($(autoviral list assets --kind image --format json | jq -r '.[].path'))
TOTAL=${#IMAGES[@]}

# Gate — Seedance bills per second: 720p ≈ $0.15/s, 1080p ≈ $0.34/s
autoviral ask "Generate $TOTAL i2v clips? (~\$$(echo "$TOTAL * 5 * 0.15" | bc) at 720p·5s Seedance rates)" --yes-no || exit 0

autoviral progress start "Generating $TOTAL i2v clips" --steps $TOTAL

: > /tmp/i2v-clips.txt
i=0
for img_path in "${IMAGES[@]}"; do
  i=$((i+1))
  # short id from filename: assets/images/s01.png → s01
  base=$(basename "$img_path" | sed -E 's/\.[^.]+$//')

  # i2v via the work's own endpoint. firstFrame is a work-relative asset path
  # (the server converts it to a data URI for the gateway). aspectRatio omitted
  # = canvas-follow; pass it explicitly only to deviate from the canvas.
  resp=$(curl -s -X POST "http://localhost:$AUTOVIRAL_PORT/api/generate/video" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg w "$AUTOVIRAL_WORK_ID" --arg img "$img_path" --arg f "${base}.mp4" \
          '{workId:$w, prompt:"<per-shot motion prompt>", filename:$f, firstFrame:$img, durationSec:5}')")

  if [ "$(echo "$resp" | jq -r '.success')" != "true" ]; then
    autoviral toast "i2v failed for $base: $(echo "$resp" | jq -r '.error // "unknown"')" --kind error
    continue
  fi
  # Response carries assetId (already registered in composition.assets) and
  # previewUrl; derive the work-relative clip path for the wiring loop below.
  echo "$resp" | jq -r --arg w "$AUTOVIRAL_WORK_ID" '.previewUrl | ltrimstr("/api/works/\($w)/")' >> /tmp/i2v-clips.txt

  autoviral progress step $i
done

autoviral progress done
```

## Wiring the new clips into the composition

After generation, each new `assets/clips/sNN.mp4` needs a `clip add` so the Studio shows it on the timeline.

```bash
SEGMENT=5            # each clip is 5s long on the timeline
i=0
while IFS= read -r src; do
  [ -f "$AUTOVIRAL_CWD/$src" ] || continue

  offset=$(echo "$i * $SEGMENT" | bc)

  autoviral clip add \
    --src "$src" \
    --track video \
    --offset "$offset" \
    --duration "$SEGMENT"

  i=$((i+1))
done < /tmp/i2v-clips.txt

autoviral toast "Added $i clips to the timeline" --kind success
autoviral select clip $(autoviral list clips --track video --format json | jq -r '.[0].id')
autoviral seek 0
```

**Important caveats for Phase 3:**

- `clip add` writes `video`, `audio`, `text`, and `overlay` (picture-in-picture) clips. Overlay needs an overlay *lane* first (`track add --kind overlay`, or target one with `--track-id`) — without one the bridge returns `No track of kind overlay` (HTTP 400).
- The ids are server-generated unless you pre-compute them (the schema accepts `id` in the body but the CLI doesn't expose a `--id` flag yet). After `clip add` prints the new id, capture it if you need to keep mutating.

## Polishing the batch with crossfades

Right after `clip add` returns, the clips are hard-cut. To add crossfades, see `recipes/video/crossfade-between-clips.md`. The `--out` scalar patch (`clip set <id> --out <s>`) works unchanged. The `--keyframes` patch does **NOT** — `clip set` sends `keyframes` as a scalar string, but the schema demands a `Keyframe[]` array, so the bridge rejects it (HTTP 400) and `composition.yaml` is never touched. Use the dedicated verbs instead: `autoviral transition add` for the easy dissolve between adjacent clips, or `autoviral clip keyframe add/set` to hand-author an opacity fade — both write the comp directly. Don't reach for `clip set --keyframes`.

## Cost / quota awareness

i2v calls bill by output seconds × resolution: 720p ≈ $0.15/s（5s ≈ $0.75/clip），1080p ≈ $0.34/s（5s ≈ $1.70/clip）。For a 16-clip 5s batch that's ~$12 (720p) to ~$27 (1080p). Always:

1. Gate with `autoviral ask` showing the cost estimate
2. Use `autoviral progress` so the user can cancel partway by closing the terminal (the CLI calls die with the pty)
3. Surface failures with `autoviral toast --kind warn` per-clip; don't fail the whole batch on one bad image

## Reusing existing renders

Before regenerating, check if a clip with the same name already exists:

```bash
if [ -f "$AUTOVIRAL_CWD/assets/clips/${base}.mp4" ]; then
  if ! autoviral ask "$base already exists; regenerate?" --yes-no; then
    continue
  fi
fi
```

## When to use `--proxy` rendering after

`autoviral render` (= `export --proxy`) is the right next step after a fresh i2v batch — fast feedback at lower quality. Only call `autoviral export` (full quality) once the user has approved the cut.
