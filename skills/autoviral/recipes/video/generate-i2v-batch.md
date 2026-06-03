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

For a 9:16 / 30fps composition, request 1080×1920 / 30fps from the i2v API. For 16:9 / 24fps, request 1920×1080 / 24fps. Don't request a resolution the model doesn't support — Seedance 2.0 i2v always outputs 720×1280 / 24fps regardless of what you ask for (then you crop / upscale yourself).

## Generation loop (model-agnostic skeleton)

```bash
IMAGES=($(autoviral list assets --kind image --format json | jq -r '.[].path'))
TOTAL=${#IMAGES[@]}

# Gate
autoviral ask "Generate $TOTAL i2v clips? (~\$$(echo "$TOTAL * 0.76" | bc) at Seedance rates)" --yes-no || exit 0

autoviral progress start "Generating $TOTAL i2v clips" --steps $TOTAL

i=0
for img_path in "${IMAGES[@]}"; do
  i=$((i+1))
  # short id from filename: assets/images/s01.png → s01
  base=$(basename "$img_path" | sed -E 's/\.[^.]+$//')
  out_clip="assets/clips/${base}.mp4"

  # YOUR i2v call here — example using a hypothetical helper
  your-i2v-tool \
    --image "$AUTOVIRAL_CWD/$img_path" \
    --duration 5 \
    --output "$AUTOVIRAL_CWD/$out_clip"

  if [ ! -f "$AUTOVIRAL_CWD/$out_clip" ]; then
    autoviral toast "i2v failed for $base; skipping" --kind error
    continue
  fi

  autoviral progress step $i
done

autoviral progress done
```

## Wiring the new clips into the composition

After generation, each new `assets/clips/sNN.mp4` needs a `clip add` so the Studio shows it on the timeline.

```bash
SEGMENT=5            # each clip is 5s long on the timeline
i=0
for img_path in "${IMAGES[@]}"; do
  base=$(basename "$img_path" | sed -E 's/\.[^.]+$//')
  src="assets/clips/${base}.mp4"
  [ -f "$AUTOVIRAL_CWD/$src" ] || continue

  offset=$(echo "$i * $SEGMENT" | bc)

  autoviral clip add \
    --src "$src" \
    --track video \
    --offset "$offset" \
    --duration "$SEGMENT"

  i=$((i+1))
done

autoviral toast "Added $i clips to the timeline" --kind success
autoviral select clip $(autoviral list clips --track video --format json | jq -r '.[0].id')
autoviral seek 0
```

**Important caveats for Phase 3:**

- `clip add` currently only writes `video` clips. Audio/text/overlay clip-add via the CLI is widened in Phase 5; in the meantime, those tracks must be edited directly.
- The ids are server-generated unless you pre-compute them (the schema accepts `id` in the body but the CLI doesn't expose a `--id` flag yet). After `clip add` prints the new id, capture it if you need to keep mutating.

## Polishing the batch with crossfades

Right after `clip add` returns, the clips are hard-cut. To add crossfades, see `recipes/video/crossfade-between-clips.md` — the `--out` and `--keyframes` patches apply unchanged.

## Cost / quota awareness

i2v calls are expensive (~$0.50–$1.00 per clip). For a 16-clip batch, that's $8–$16. Always:

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
