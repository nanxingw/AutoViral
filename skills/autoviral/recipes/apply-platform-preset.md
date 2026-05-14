# Recipe: apply a platform export preset

The user says *"set it up for 抖音"* or *"export for B站 instead of TikTok"*. Each platform has different resolution / fps / bitrate / loudness targets; the composition stores them in `exportPresets[]` and the render pipeline picks one by id.

## What's in a preset

```yaml
exportPresets:
  - id: p_douyin
    label: 抖音 1080×1920 / H.264
    platform: douyin
    width: 1080
    height: 1920
    fps: 30
    videoBitrate: 8000000        # 8 Mbps
    audioBitrate: 192000
    codec: h264
    container: mp4
    maxDurationSec: 60
    loudnessTargetLufs: -14
    safeZonePct: 0.05
    notes: "vertical 9:16; under 60s; -14 LUFS"
```

Valid `platform` values: `douyin | xiaohongshu | weixin-channels | bilibili | tiktok | reels | shorts | youtube-long | custom`.

## Suggested preset specs

| Platform | Resolution | fps | LUFS | Max duration |
|---|---|---|---|---|
| 抖音 (douyin) | 1080×1920 | 30 | -14 | 60s (short) / 600s (long) |
| 小红书 (xiaohongshu) | 1080×1920 | 30 | -14 | 60s |
| 微信视频号 (weixin-channels) | 1080×1920 | 30 | -16 | 60s |
| B站 (bilibili) | 1920×1080 | 30/60 | -23 | 600s+ |
| TikTok | 1080×1920 | 30 | -14 | 60s |
| Reels | 1080×1920 | 30 | -14 | 90s |
| Shorts | 1080×1920 | 30 | -14 | 60s |
| YouTube long | 1920×1080 or 3840×2160 | 30/60 | -14 | n/a |

These are starting points, not gospel — platforms tweak their specs. When in doubt, ask the user.

## Adding a preset to the composition

There's no dedicated `autoviral preset add` CLI yet (Phase 5). For now:

1. Build the preset JSON in your scratch
2. Read the current `exportPresets[]`
3. Append the new entry
4. Write it back via the underlying composition mutation (use the user as a fallback)

Sketch — since direct file writes bypass the bridge schema validation, **don't** edit `composition.yaml` directly. Either:

- Ask the user to add it via the Studio export-settings UI (which writes through the bridge), OR
- Wait for `autoviral preset add` in Phase 5

The pattern we recommend today: tell the user *"add a douyin preset in the export settings panel; I'll wait"*, then `autoviral comp show` to confirm and proceed.

## Switching the active preset for export

The `--preset` flag on `autoviral export` matches by preset **id**:

```bash
autoviral export                       # uses exportPresets[0]
autoviral export --preset p_douyin     # by id
autoviral export --preset p_bilibili
autoviral export --proxy               # always uses a low-res proxy regardless of preset
```

If you pass a `--preset` that doesn't exist in the composition, the bridge returns 400 / exit 4.

## Sanity-checking the comp matches the preset

A preset's `width × height` doesn't have to equal the composition's `width × height` — the render pipeline scales (with letterbox or crop based on `safeZonePct`). But mismatches between composition `aspect` and preset orientation hurt:

```bash
comp_aspect=$(autoviral comp show --format json | jq -r '.aspect')
preset_w=$(autoviral comp show --format json | jq -r '.exportPresets[] | select(.id=="p_douyin") | .width')
preset_h=$(autoviral comp show --format json | jq -r '.exportPresets[] | select(.id=="p_douyin") | .height')

if [ "$comp_aspect" = "16:9" ] && [ "$preset_h" -gt "$preset_w" ]; then
  autoviral toast "Composition is 16:9 but preset is vertical — expect letterbox or crop" --kind warn
fi
```

For a clean export, compositions for 抖音/TikTok should be `aspect: '9:16'` (1080×1920 native); compositions for B站 long-form should be `aspect: '16:9'`.

## Render with progress

```bash
autoviral select track $(autoviral list clips --track video --format json | jq -r '.[0].id')
autoviral seek 0
autoviral progress start "Rendering for 抖音" --steps 5

autoviral export --preset p_douyin
# the render pipeline also emits ui-render-progress events; the Studio shows
# its own top-bar progress with stage labels (decode / compose / encode / mux)

autoviral progress done
autoviral toast "Render done" --kind success --duration 6000
```

The CLI prints the output path on success — typically `output/p_douyin-final.mp4` or similar.

## Common gotchas

- **30fps vs 24fps mismatch** — composition locks at one fps. If your preset is 30fps but the comp is 24fps, the render pipeline retimes; smooth for normal content but visible on fast pans.
- **Audio loudness** — `-14 LUFS` is the social-media standard; -23 is broadcast (B站). The render pipeline normalizes; if the user's BGM is hot, expect a level drop.
- **`maxDurationSec`** — the render pipeline truncates if your composition is longer. Use `autoviral comp show --format json | jq '.duration'` to check.
- **Safe zones** — `safeZonePct: 0.05` means the render reserves 5% inset for platform UI overlays. Text clips with `yPct > 95` may get clipped by the platform's "Follow" button.
