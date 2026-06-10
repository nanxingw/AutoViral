# Recipe: generate background music and add it as a BGM track

The user says *"give it some background music"* / *"自己生成配乐"*. You generate a track with Lyria 3 Pro (via OpenRouter), then add it as a `bgm` audio track. **There is exactly one正路: the `POST /api/generate/bgm` endpoint. Never run any `.py` script ("那些脚本已删，是死的") and never reverse-engineer src/ to "兜底" — if the endpoint is unavailable, use `autoviral ask` to tell the user, don't fake it.**

## Setup — know what you have

```bash
# Composition's total duration (the BGM should cover it)
autoviral comp show --format json | jq '{duration, fps}'

# Existing audio tracks (avoid stacking two BGMs)
autoviral list clips --track audio
```

## Generate the music

```bash
# Lyria emits a full ~1–2 min instrumental track (~$0.08). `vocal` defaults to
# false = instrumental only (the server prepends "Instrumental only"). Pass
# durationSeconds (5–180) ONLY to trim the result with ffmpeg afterwards — it is
# NOT a model parameter, and out-of-range values are rejected with HTTP 400.
autoviral ask "Generate background music with Lyria 3 Pro (~\$0.08)?" --yes-no || exit 0

resp=$(curl -s -X POST "http://localhost:$AUTOVIRAL_PORT/api/generate/bgm" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg w "$AUTOVIRAL_WORK_ID" \
        '{workId:$w, prompt:"warm lofi piano, gentle, unhurried", filename:"bgm.mp3"}')")

if [ "$(echo "$resp" | jq -r '.success')" != "true" ]; then
  # 503 = no OPENROUTER_API_KEY configured. Be honest, don't fall back to scripts.
  autoviral toast "BGM generation failed: $(echo "$resp" | jq -r '.error // "unknown"')" --kind error
  exit 1
fi

# The response carries assetId (already registered as an AssetEntry kind:audio +
# library broadcast) and previewUrl; derive the work-relative path.
SRC=$(echo "$resp" | jq -r --arg w "$AUTOVIRAL_WORK_ID" '.previewUrl | ltrimstr("/api/works/\($w)/")')
```

## Add it as a BGM track

```bash
# Cover the whole composition; `--track audio` + the bgm semantics come from the
# audio track. Loop/trim with `clip set --out` if the track is longer/shorter
# than the comp.
DUR=$(autoviral comp show --format json | jq -r '.duration')

autoviral clip add \
  --src "$SRC" \
  --track audio \
  --offset 0 \
  --duration "$DUR"

autoviral toast "Added background music" --kind success
```

## Notes

- `vocal: true` gives a sung track; default `false` is pure instrumental — pick by what the user asked for.
- For per-track volume / fade / ducking against narration, see the audio Inspector controls (the BGM track participates in the mix exactly like any imported audio).
- `referenceImage` (work-relative path) is accepted to condition the mood on a visual, but it's optional.
