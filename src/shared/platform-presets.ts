// S15 (PRD-0004, US 22/23/24) — single source of truth for platform export
// presets. SHARED so the frontend `PlatformPresetSection` dropdown and the
// server-side `runRenderPipeline` consume the SAME table (size / loudness LUFS
// / bitrate). Before this module both halves drifted: the dropdown hard-coded
// its own copy and `/export` received a `preset` name it never read, so every
// render silently fell back to the -14 LUFS default (issue #80). One table,
// two consumers — no duplicate hard-coding, no dead control.
//
// Why a frozen table (not free-form): the platform specs (抖音/小红书/视频号/…)
// are operational constants. Editing them in two places is the failure mode
// this module exists to kill; everyone imports `PLATFORM_PRESETS` from here.

import type { ExportPreset } from "./composition.js";

/** The canonical platform export presets. Mirrors the platform-specs the
 *  Studio offers in its Tweaks panel. Width/height drive aspect + canvas;
 *  loudnessTargetLufs drives the loudnorm stage; videoBitrate/audioBitrate
 *  drive the final encode. */
export const PLATFORM_PRESETS: readonly ExportPreset[] = [
  {
    id: "douyin-9-16",
    label: "抖音 9:16",
    platform: "douyin",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.18,
    maxDurationSec: 60,
  },
  {
    id: "xhs-9-16",
    label: "小红书视频 9:16",
    platform: "xiaohongshu",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 6000,
    audioBitrate: 192,
    loudnessTargetLufs: -16,
    safeZonePct: 0.12,
    maxDurationSec: 60,
  },
  {
    id: "wechat-9-16",
    label: "视频号 9:16",
    platform: "weixin-channels",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -16,
    safeZonePct: 0.15,
    maxDurationSec: 60,
  },
  {
    id: "bilibili-16-9",
    label: "Bilibili 16:9",
    platform: "bilibili",
    width: 1920,
    height: 1080,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 6000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.0,
  },
  {
    id: "tiktok-9-16",
    label: "TikTok 9:16",
    platform: "tiktok",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.18,
    maxDurationSec: 60,
  },
  {
    id: "reels-9-16",
    label: "Reels 9:16",
    platform: "reels",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 10000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.15,
    maxDurationSec: 90,
  },
  {
    id: "shorts-9-16",
    label: "Shorts 9:16",
    platform: "shorts",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 10000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.15,
    maxDurationSec: 60,
  },
  {
    id: "yt-long-16-9",
    label: "YouTube long 16:9",
    platform: "youtube-long",
    width: 1920,
    height: 1080,
    fps: 30,
    codec: "h264",
    container: "mp4",
    videoBitrate: 8000,
    audioBitrate: 192,
    loudnessTargetLufs: -14,
    safeZonePct: 0.05,
  },
];

/** Normalize a user-supplied preset name for matching: trim + lowercase so
 *  `"抖音 9:16"`, `"DOUYIN-9-16"`, and `"douyin"` all resolve to the same row. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Resolve a `--preset <name>` argument (from the CLI / `/export` body) against
 * the canonical table. Matches — case-insensitively — by `id`, then `label`,
 * then `platform`. Returns `undefined` for an unknown name so the caller can
 * fail loud (S3: 400 + code:4) instead of silently falling back to defaults.
 */
export function resolvePlatformPreset(
  name: string | undefined | null,
): ExportPreset | undefined {
  if (name == null) return undefined;
  const key = norm(name);
  if (key.length === 0) return undefined;
  return (
    PLATFORM_PRESETS.find((p) => norm(p.id) === key) ??
    PLATFORM_PRESETS.find((p) => norm(p.label) === key) ??
    PLATFORM_PRESETS.find((p) => norm(p.platform) === key)
  );
}
