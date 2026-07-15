# Recipe index

Recipes are step-by-step patterns for common tasks, partitioned by content type.
Read one with `autoviral docs recipes/<partition>/<name>` (e.g.
`autoviral docs recipes/video/decouple-narration.md`). Read the partition that
matches `work.type`. The manual chapters above cover the *surface*; these recipes
cover *how to combine the verbs into a result*.

## recipes/video/ (short-video)

- `decouple-narration.md` — one continuous locked-voice VO track over silent
  picture; pass the TTS response's `durationSec` as `--duration` so a long
  narration isn't truncated to the 5s fallback.
- `beat-cutting.md` — cut ~4–5s beats at native speed, one dedicated visual per
  phrase, no `setpts` slow-mo fill; entrance vs cut-point transition mechanics.
- `burn-subtitles-asr-aligned.md` — ASR word timing + ground-truth script text via
  `captions generate --script`; the overlay CaptionModel bakes at export.
- `generate-cover.md` — native 中文 title/subtitle/logo poster via the image
  endpoint (`POST /api/generate/image`), then self-check the pixels.
- `add-subtitle-overlay.md` — the full CaptionModel wire-up + styling knobs + the
  manual Whisper path.
- `add-bgm-track.md` — generate a BGM track and duck it under the voiceover.
- `crossfade-between-clips.md` — a cross-dissolve at the cut between two adjacent
  clips (`autoviral transition add`).
- `swap-clip-source.md` — replace a clip's source while keeping its timeline
  placement.
- `generate-i2v-batch.md` — generate a batch of image-to-video shots.
- `apply-platform-preset.md` — apply a platform export preset.
- `ingest-youtube.md` — turn a YouTube URL into a 中文 short via the one-shot
  `autoviral ingest youtube` pipeline.
- `script-to-storyboard.md` — turn a script into a storyboard of scenes.

## recipes/carousel/ (图文)

- `restyle-all-slides.md` — restyle every slide/headline at once (globals PUT vs a
  per-layer `set-layer` loop); also the template for new content-type recipes.
