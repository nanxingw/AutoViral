# Platform Export Specs

Phase 6 reference table. Driving source for `PlatformPresetSection.tsx` (frontend) and `comp.exportPresets[0]` validation (server). Updated 2026-05-06.

| Platform | Aspect | Resolution | FPS | Codec | Container | Video bitrate | Audio bitrate | LUFS | Max duration | Safe zone |
|---|---|---|---|---|---|---|---|---|---|---|
| 抖音 | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s/180s | bottom 18% |
| 小红书视频 | 9:16 / 1:1 | 1080×1920 / 1080×1080 | 30 | H.264 | mp4 | 6 Mbps | 192 kbps | -16 | 60s | bottom 12% |
| 视频号 | 9:16 / 1:1 | 1080×1920 / 1080×1080 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s | bottom 15% |
| Bilibili | 16:9 | 1920×1080 | 30 | H.264 | mp4 | 6 Mbps | 192 kbps | -14 | unlimited | none |
| TikTok | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s | bottom 18% |
| Reels | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 10 Mbps | 192 kbps | -14 | 90s | bottom 15% |
| Shorts | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 10 Mbps | 192 kbps | -14 | 60s | bottom 15% |
| YouTube long | 16:9 | 1920×1080 | 30/60 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | unlimited | bottom 5% |

## Safe zones

The "safe zone" column above is the region where in-platform UI overlays (CTA buttons, captions, share rails) sit on top of the user's video. Anything inside the safe zone risks being obscured. Studio's caption/overlay placement engine reads `preset.safeZonePct` (frontend) and aligns subtitle baselines and watermark badges so they never enter the band.

For platforms with multiple aspects (小红书, 视频号), the safe-zone percentage is identical between 9:16 and 1:1 outputs.

For Bilibili (`safe zone: none`) the band is 0%, so overlays are unconstrained.

## Phase 6 implementation notes

- The frontend `PlatformPresetSection.tsx` encodes this table as a `PRESETS` const. If a platform's specs change, update both this doc AND `PRESETS` and ship them in the same commit.
- `ExportPreset.codec` only models `"h264" | "h265" | "vp9" | "av1"`. All current presets pin to `h264`.
- Apply order on preset selection: **(1)** confirm modal → **(2)** zustand atomic transaction (`applyPlatformPreset`) → **(3)** parallel `POST /api/video/reframe` for each video clip → **(4)** `rebindClip(clipId, reframedAssetId)` per response.
