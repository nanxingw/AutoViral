// R46 — GPU encoder auto-detection + preset translation.
//
// Ported from heygen-com/hyperframes packages/engine/src/utils/gpuEncoder.ts.
// Approach: shell out to `ffmpeg -encoders` once per process, cache the
// result, then pick the first available hardware encoder in our priority
// order (NVENC > VideoToolbox > VAAPI > QSV > libx264 software fallback).
//
// Why this matters: pure libx264 software encode is the slowest stage of
// our pipeline by a wide margin. h264_videotoolbox on macOS Apple Silicon
// is typically 2-4× faster on the same h264 baseline output. NVENC on
// Linux/Windows w/ NVIDIA GPU is comparable.
//
// Critical gotcha (also ported): the `medium`/`fast`/`slow` preset
// vocabulary is libx264's. NVENC uses p1..p7 (lower = faster, lower
// quality). VideoToolbox accepts only `realtime` / `quality` / undefined.
// Passing libx264's `medium` to NVENC → AVERROR(EINVAL). We translate.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Logical codec — what the caller wants regardless of hardware. */
export type LogicalCodec = "h264" | "h265" | "vp9" | "av1";

/**
 * Hardware tier in priority order. Software fallback is always last.
 * Detection order matters: NVENC first because it gives the biggest win
 * on the broadest hardware (NVIDIA discrete + integrated). VideoToolbox
 * is macOS-native + free. VAAPI is Linux Intel/AMD. QSV is Intel-specific.
 */
export type EncoderTier = "nvenc" | "videotoolbox" | "vaapi" | "qsv" | "software";

export interface EncoderChoice {
  /** ffmpeg `-c:v` value, e.g. "h264_videotoolbox", "libx264". */
  codec: string;
  /** Tier we picked, for logging / metrics. */
  tier: EncoderTier;
  /**
   * Translated preset args for this encoder. Caller appends these
   * verbatim — they include the flag (e.g. `-preset` or `-realtime`).
   * Empty array = no preset flag (encoder uses its own default).
   */
  presetArgs: string[];
  /**
   * Extra flags this encoder requires for sane output. For example
   * h264_videotoolbox needs `-allow_sw 1` for fallback when GPU is busy,
   * and NVENC benefits from `-rc:v vbr_hq -multipass 2`.
   */
  extraArgs: string[];
}

/**
 * libx264 preset vocabulary that callers use today. We'll translate this
 * to whatever the chosen hardware encoder accepts. "medium" is the
 * libx264 default and our pre-R46 implicit preset.
 */
export type LibX264Preset =
  | "ultrafast" | "superfast" | "veryfast" | "faster" | "fast"
  | "medium" | "slow" | "slower" | "veryslow";

// NVENC preset translation. NVENC uses p1..p7 where p1 is fastest /
// lowest quality and p7 is slowest / highest quality. Pre-NVENC-SDK-10
// presets like `slow`/`fast`/`hq` are deprecated and produce warnings.
// Mapping mirrors hyperframes gpuEncoder.ts:67-78.
const NVENC_PRESET_MAP: Record<LibX264Preset, string> = {
  ultrafast: "p1",
  superfast: "p2",
  veryfast: "p2",
  faster: "p3",
  fast: "p3",
  medium: "p4",
  slow: "p5",
  slower: "p6",
  veryslow: "p7",
};

/**
 * VideoToolbox doesn't have a preset-name vocabulary; speed is implicit
 * in the codec choice. `-realtime 1` forces low-latency at the cost of
 * compression efficiency, useful for proxy encodes. For final encodes we
 * leave it off so VT picks quality-leaning defaults.
 */
function videotoolboxPresetArgs(preset: LibX264Preset): string[] {
  if (preset === "ultrafast" || preset === "superfast" || preset === "veryfast") {
    return ["-realtime", "1"];
  }
  return []; // accept VT defaults
}

// ── Detection ────────────────────────────────────────────────────────────

interface DetectionCache {
  available: Set<string>;
  detectedAt: number;
}

let cache: DetectionCache | null = null;

/**
 * Probe ffmpeg once and cache the encoder list. Process-scoped — we don't
 * worry about ffmpeg being upgraded under us mid-process.
 *
 * Test override: if `process.env.AUTOVIRAL_FAKE_ENCODERS` is set (comma-
 * separated codec names), use that list instead of probing. Lets unit
 * tests assert specific tier picks without spawning ffmpeg.
 */
export async function detectAvailableEncoders(): Promise<Set<string>> {
  if (cache) return cache.available;

  const fake = process.env.AUTOVIRAL_FAKE_ENCODERS;
  if (fake !== undefined) {
    const set = new Set(fake.split(",").map((s) => s.trim()).filter(Boolean));
    cache = { available: set, detectedAt: Date.now() };
    return set;
  }

  const set = new Set<string>();
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-encoders"], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    // Output format is one encoder per line after the " ------" separator,
    // e.g. " V....D h264_videotoolbox  VideoToolbox H.264 Encoder"
    // We only care about the second whitespace-delimited token.
    const lines = stdout.split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("---")) continue;
      const m = line.match(/^[A-Z\.]+\s+(\S+)/);
      if (m) set.add(m[1]!);
    }
  } catch {
    // ffmpeg unreachable / not installed — caller will fall back to
    // libx264 string but the spawn will then fail with a clear error.
    // We don't throw here so the rest of the module is testable.
  }

  cache = { available: set, detectedAt: Date.now() };
  return set;
}

/** Test-only — clears the encoder cache. */
export function _resetEncoderCacheForTests(): void {
  cache = null;
}

// ── Selection ────────────────────────────────────────────────────────────

/**
 * Pick the best available hardware encoder for `codec`, honouring the
 * given libx264-vocabulary preset. Returns the ffmpeg codec name + the
 * already-translated preset args ready to splice into the ffmpeg command.
 */
export async function pickEncoder(
  codec: LogicalCodec,
  preset: LibX264Preset = "medium",
): Promise<EncoderChoice> {
  const available = await detectAvailableEncoders();

  // Order: NVENC > VideoToolbox > VAAPI > QSV > software.
  // For each tier we check the codec-specific encoder name. h264 has the
  // broadest support; av1 hardware support is sparse so we frequently
  // fall through to libaom-av1.
  const tiers: Array<{
    tier: EncoderTier;
    name: string;
    presetArgs: string[];
    extraArgs: string[];
  }> = [];

  if (codec === "h264") {
    tiers.push(
      {
        tier: "nvenc",
        name: "h264_nvenc",
        presetArgs: ["-preset", NVENC_PRESET_MAP[preset]],
        // -rc vbr + lookahead gives quality on par with libx264 medium
        // at multiples the speed. -b_ref_mode middle is a safe default
        // for sub-1080p and 1080p source — disable on 4K if quality
        // regressions appear.
        extraArgs: ["-rc:v", "vbr", "-rc-lookahead", "20", "-b_ref_mode", "middle"],
      },
      {
        tier: "videotoolbox",
        name: "h264_videotoolbox",
        presetArgs: videotoolboxPresetArgs(preset),
        // allow_sw lets VT fall back to software when GPU is contended.
        // realtime 0 (the default) tells VT to use quality-leaning mode.
        extraArgs: ["-allow_sw", "1"],
      },
      { tier: "vaapi", name: "h264_vaapi", presetArgs: [], extraArgs: [] },
      { tier: "qsv", name: "h264_qsv", presetArgs: ["-preset", preset], extraArgs: [] },
    );
  } else if (codec === "h265") {
    tiers.push(
      {
        tier: "nvenc",
        name: "hevc_nvenc",
        presetArgs: ["-preset", NVENC_PRESET_MAP[preset]],
        extraArgs: ["-rc:v", "vbr", "-rc-lookahead", "20"],
      },
      {
        tier: "videotoolbox",
        name: "hevc_videotoolbox",
        presetArgs: videotoolboxPresetArgs(preset),
        extraArgs: ["-allow_sw", "1"],
      },
      { tier: "vaapi", name: "hevc_vaapi", presetArgs: [], extraArgs: [] },
      { tier: "qsv", name: "hevc_qsv", presetArgs: ["-preset", preset], extraArgs: [] },
    );
  } else if (codec === "vp9") {
    // Hardware VP9 is rare; QSV has it on Intel 11th-gen+. Otherwise
    // libvpx-vp9 software is the only path.
    tiers.push({ tier: "qsv", name: "vp9_qsv", presetArgs: [], extraArgs: [] });
  } else if (codec === "av1") {
    // AV1 hardware encode is even rarer. NVENC has it on Ada+ (RTX 40-
    // series). VT added support on M3+. QSV on Arc / Battlemage.
    tiers.push(
      { tier: "nvenc", name: "av1_nvenc", presetArgs: ["-preset", NVENC_PRESET_MAP[preset]], extraArgs: [] },
      { tier: "videotoolbox", name: "av1_videotoolbox", presetArgs: [], extraArgs: ["-allow_sw", "1"] },
      { tier: "qsv", name: "av1_qsv", presetArgs: [], extraArgs: [] },
    );
  }

  for (const t of tiers) {
    if (available.has(t.name)) {
      return { codec: t.name, tier: t.tier, presetArgs: t.presetArgs, extraArgs: t.extraArgs };
    }
  }

  // Software fallback always available (ffmpeg ships libx264/libx265/
  // libvpx-vp9/libaom-av1 by default in homebrew + Linux distros).
  const softwareName: Record<LogicalCodec, string> = {
    h264: "libx264",
    h265: "libx265",
    vp9: "libvpx-vp9",
    av1: "libaom-av1",
  };
  return {
    codec: softwareName[codec],
    tier: "software",
    presetArgs: ["-preset", preset],
    extraArgs: [],
  };
}
