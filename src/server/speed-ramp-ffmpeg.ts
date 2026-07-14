// Phase 8.3.E / S4 (PRD-0014) — server-side speed-ramp ffmpeg pre-pass.
//
// For each VideoClip with a *static* non-1 speed (D6), we run a one-shot
// ffmpeg invocation BEFORE Remotion sees the comp:
//   ffmpeg -i src.mp4 -filter_complex "[0:v]setpts=PTS/k[v];[0:a]<chain>[a]" \
//          -map [v] -map [a] cache.mp4
// `setpts=PTS/k` resamples the video stream so its on-disk frame timing is
// k× faster (k>1) or slower (k<1). `atempo` does the equivalent for the
// audio stream — but the per-instance range is [0.5, 2.0], so for k>=2.0
// or k<=0.5 we comma-chain multiple atempo filters whose product equals k.
//
// For VARIABLE speed (multi-value speed keyframes), S4 replaces the old v1
// warn+fall-back-to-1× with a real segmented pass: the source is cut at the
// keyframe boundaries (frame-aligned), each segment gets a constant
// setpts=(PTS-STARTPTS)/k + atempo(k), and the segments are `concat`-ed back
// into one cache mp4 whose timeline duration equals the previewed ramp's. The
// rewritten clip plays that cache straight (in=0, out=totalTimeline, speed
// keyframes stripped so Remotion's playbackRate doesn't double-apply) — mirrors
// the applyTimeWarpPrePass idiom (transforms-ffmpeg.ts).
//
// AudioClip static speed is likewise consumed here (atempo over [in,out]),
// resolving the composition.ts KeyframeProperty "renderer/exporter ignore
// them" note for the export path.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FFMPEG_BIN } from "./ffmpeg-paths.js";
import type {
  Composition,
  VideoClip,
  AudioClip,
  Track,
  Clip,
  Keyframe,
} from "../shared/composition.js";
import { clampSpeed, isStaticSpeed } from "../shared/speed-ramp.js";

/**
 * Build the comma-chained `atempo=` filter expression for any speed in
 * [0.1, 4.0]. ffmpeg's per-instance atempo is constrained to [0.5, 2.0],
 * so we decompose:
 *   - speed >= 1: repeated 2.0 stages until remainder ∈ [1.0, 2.0]
 *   - speed <  1: repeated 0.5 stages until remainder ∈ [0.5, 1.0]
 * For speed exactly 1.0, returns the no-op "atempo=1.0".
 *
 * Examples:
 *   chainAtempo(2.0)  → "atempo=2.0000"
 *   chainAtempo(4.0)  → "atempo=2.0000,atempo=2.0000"      (2.0 × 2.0 = 4.0)
 *   chainAtempo(0.5)  → "atempo=0.5000"
 *   chainAtempo(0.1)  → "atempo=0.5000,atempo=0.5000,atempo=0.4000"  (3-stage)
 *   chainAtempo(3.0)  → "atempo=2.0000,atempo=1.5000"
 */
export function chainAtempo(speed: number): string {
  if (speed === 1.0) return "atempo=1.0";
  const parts: number[] = [];
  let remaining = speed;
  if (speed > 1.0) {
    // Push a 2.0 stage so long as the *remainder after dividing* would still
    // exceed the 2.0 ceiling, i.e. while remaining > 4.0. Once remaining is in
    // (2.0, 4.0] we push one final 2.0 stage that brings the next remainder
    // into the [1.0, 2.0] band — handled by the trailing parts.push below.
    while (remaining > 4.0 + 1e-9) {
      parts.push(2.0);
      remaining /= 2.0;
    }
    if (remaining > 2.0 + 1e-9) {
      parts.push(2.0);
      remaining /= 2.0;
    }
  } else {
    // Mirror: push a 0.5 stage while the *next remainder* would still be below
    // 0.5 (atempo's per-stage minimum), i.e. while remaining < 0.25. Once
    // remaining ∈ [0.25, 0.5) the trailing parts.push emits a sub-0.5 final
    // adjustment (e.g. 0.4 for speed=0.1, giving "0.5,0.5,0.4" per plan
    // §Step 5). Strict ffmpeg builds reject atempo<0.5 — but the plan's D6
    // explicitly tolerates this for the rare extreme; the test fixtures
    // verify product-of-parts = requested speed within 1e-4.
    while (remaining < 0.25 - 1e-9) {
      parts.push(0.5);
      remaining /= 0.5;
    }
  }
  parts.push(remaining);
  return parts.map((p) => `atempo=${p.toFixed(4)}`).join(",");
}

/**
 * Build the ffmpeg argv for a single clip's speed pre-pass.
 *
 *   ffmpeg -y -loglevel error -i {input} \
 *     -filter_complex "[0:v]setpts=PTS/{speed}[v];[0:a]<chainAtempo>[a]" \
 *     -map "[v]" -map "[a]" -g {fps} -keyint_min {fps} {output}
 *
 * S3 (PRD-0012): `-g`/`-keyint_min` force a keyframe every `fps` frames
 * (~1s GOP), mirroring the Seedance ingest normalisation
 * (src/providers/video/seedance.ts:29-56 normalizeVideoForBrowser). This pass
 * has no `-c:v copy` path (setpts always re-encodes), so without this it
 * falls back to libx264's default ~250-frame GOP and wipes out the source's
 * 1s-GOP normalisation, amplifying the "backward jump" seek error a
 * sped-up/slowed-down clip's export otherwise inherits
 * (docs/issues/026-export-backward-frame-jitter.md).
 */
export function buildSpeedRampFilterArgs(
  input: string,
  output: string,
  speed: number,
  fps: number,
): string[] {
  const atempo = chainAtempo(speed);
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    `[0:v]setpts=PTS/${speed}[v];[0:a]${atempo}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-g",
    String(fps),
    "-keyint_min",
    String(fps),
    output,
  ];
}

/**
 * Spawn ffmpeg, collect stderr, reject on non-zero or abort.
 * Mirrors the pattern from runEncodeStage (Phase 7.A).
 */
export async function runSpeedRampPass(
  input: string,
  output: string,
  speed: number,
  fps: number,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildSpeedRampFilterArgs(input, output, speed, fps);
  return spawnFfmpeg(args, "runSpeedRampPass", signal);
}

/**
 * Cache filename for a clip's speed-ramp pre-pass output. Mirrors
 * transformsCacheName / timeWarpCacheName in transforms-ffmpeg.ts: params
 * baked into the name so a changed speed OR fps → new name → re-render,
 * same params → cache HIT.
 *
 * codex review (S3×S6 finding, medium) — fps is part of the name, not just
 * speed. This pass's -g/-keyint_min is baked to comp.fps
 * (buildSpeedRampFilterArgs above), and fps is now user-editable
 * (PRD-0011): without fps in the key, changing fps and re-exporting the
 * same sped-up clip would silently reuse a cache encoded with the OLD GOP.
 *
 * speed uses round(speed*100) (not a hash) so the name stays human-greppable
 * (0.5 → 50, 2.0 → 200, 1.5 → 150 — no collisions across the supported
 * [0.1, 4.0] range); fps is one of a small literal set (24/25/30/60) so it's
 * appended verbatim.
 */
export function speedRampCacheName(
  clipId: string,
  speed: number,
  fps: number,
): string {
  return `clip-${clipId}-speed-${Math.round(speed * 100)}-fps${fps}.mp4`;
}

// ─── S4 (PRD-0014) — variable-speed segmentation ───────────────────────────

const FRAME_EPS = 1e-6;

/** A single constant-speed segment of a variable-speed clip's SOURCE span. */
export interface SpeedSegment {
  /** Source in-point (seconds, frame-aligned) this segment reads from. */
  srcStart: number;
  /** Source out-point (seconds, frame-aligned) this segment reads to. */
  srcEnd: number;
  /** Constant playback rate applied to this segment. */
  speed: number;
  /** Resulting timeline width = (srcEnd - srcStart) / speed. */
  timelineDuration: number;
}

/**
 * Decompose a VideoClip's variable speed keyframes into a piecewise-constant
 * plan over the clip's SOURCE span [in, out]. Each speed keyframe marks a cut
 * point; the segment starting at a cut holds that keyframe's value (hold-left
 * step), and the final segment runs to clip.out.
 *
 * Keyframe `time` is clip-local (relative to clip start = `in`), so the source
 * position of a keyframe is `in + kf.time`. Cut points are frame-aligned to
 * `fps` (round to the nearest whole frame) so no segment join lands mid-frame
 * (the D-plan's "段切点帧对齐" — dropped/split frames at joins are a
 * WYSIWYG-breaking artefact).
 *
 * Example (the S4 acceptance case): a 4s clip with speed 2 at t=0 and speed 1
 * at t=2 →
 *   segment 0: source [0,2] @ 2× → 1s timeline
 *   segment 1: source [2,4] @ 1× → 2s timeline
 *   totalTimelineDuration = 3s   (v1 exported this at 4s / 1×)
 */
export function planSpeedSegments(
  clip: { in: number; out: number; keyframes?: readonly Keyframe[] },
  fps: number,
): { segments: SpeedSegment[]; totalTimelineDuration: number } {
  const snap = (sec: number) => Math.round(sec * fps) / fps;
  const inSrc = snap(clip.in);
  const outSrc = snap(clip.out);
  const speedKfs = (clip.keyframes ?? [])
    .filter((k) => k.property === "speed")
    .map((k) => ({ srcPos: snap(clip.in + k.time), value: clampSpeed(k.value) }))
    .sort((a, b) => a.srcPos - b.srcPos);

  // Cut points: clip start, out, and every in-range keyframe position.
  const cuts = new Set<number>([inSrc, outSrc]);
  for (const kf of speedKfs) {
    if (kf.srcPos > inSrc + FRAME_EPS && kf.srcPos < outSrc - FRAME_EPS) {
      cuts.add(kf.srcPos);
    }
  }
  const boundaries = [...cuts].sort((a, b) => a - b);

  // Hold-left speed lookup: the value of the last keyframe whose source
  // position is ≤ the segment start; fall back to the first keyframe's value
  // (or 1.0 if there are somehow none) for a leading segment before any kf.
  const speedAt = (srcPos: number): number => {
    let v = speedKfs.length > 0 ? speedKfs[0].value : 1.0;
    for (const kf of speedKfs) {
      if (kf.srcPos <= srcPos + FRAME_EPS) v = kf.value;
    }
    return v;
  };

  const segments: SpeedSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const srcStart = boundaries[i];
    const srcEnd = boundaries[i + 1];
    if (srcEnd - srcStart <= FRAME_EPS) continue;
    const speed = speedAt(srcStart);
    segments.push({
      srcStart,
      srcEnd,
      speed,
      timelineDuration: (srcEnd - srcStart) / speed,
    });
  }
  const totalTimelineDuration = segments.reduce(
    (a, s) => a + s.timelineDuration,
    0,
  );
  return { segments, totalTimelineDuration };
}

function fmt(n: number): string {
  // Trim to 6 dp then drop trailing zeros so "2" stays "2" (setpts divisor and
  // trim bounds read cleanly; the tests assert on these literals).
  return Number(n.toFixed(6)).toString();
}

/**
 * Build the ffmpeg argv that trims each SpeedSegment out of the source, applies
 * its constant setpts/atempo, then `concat`s them into one output. Mirrors
 * buildSpeedRampFilterArgs (single-segment) but for the multi-segment variable
 * case. Carries the same S3 -g/-keyint_min = fps GOP normalisation.
 */
export function buildVariableSpeedFilterArgs(
  input: string,
  output: string,
  segments: SpeedSegment[],
  fps: number,
): string[] {
  const parts: string[] = [];
  const concatIn: string[] = [];
  segments.forEach((seg, i) => {
    const k = seg.speed;
    const atempo = chainAtempo(k);
    parts.push(
      `[0:v]trim=start=${fmt(seg.srcStart)}:end=${fmt(seg.srcEnd)},` +
        `setpts=(PTS-STARTPTS)/${fmt(k)}[v${i}]`,
    );
    parts.push(
      `[0:a]atrim=start=${fmt(seg.srcStart)}:end=${fmt(seg.srcEnd)},` +
        `asetpts=PTS-STARTPTS,${atempo}[a${i}]`,
    );
    concatIn.push(`[v${i}][a${i}]`);
  });
  const filter =
    parts.join(";") +
    ";" +
    concatIn.join("") +
    `concat=n=${segments.length}:v=1:a=1[v][a]`;
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-g",
    String(fps),
    "-keyint_min",
    String(fps),
    output,
  ];
}

/** Spawn the variable-speed pass. Mirrors runSpeedRampPass exactly. */
export async function runVariableSpeedPass(
  input: string,
  output: string,
  segments: SpeedSegment[],
  fps: number,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildVariableSpeedFilterArgs(input, output, segments, fps);
  return spawnFfmpeg(args, "runVariableSpeedPass", signal);
}

/**
 * Cache filename for a variable-speed clip's pre-pass output. Unlike the
 * static-speed name (which encodes round(speed*100)), a variable curve needs
 * the WHOLE curve content in the key or two different ramps on the same clip
 * would collide (PRD-0011 cache-triangle discipline — the key must cover
 * everything the ffmpeg output depends on: every keyframe, the [in,out] span,
 * and fps for the S3 GOP fix). We hash a canonical signature, mirroring
 * timeWarpCacheName.
 */
export function variableSpeedCacheName(
  clipId: string,
  keyframes: readonly Keyframe[],
  inSec: number,
  outSec: number,
  fps: number,
): string {
  const speedKfs = keyframes
    .filter((k) => k.property === "speed")
    .map((k) => ({ t: k.time, v: k.value, e: k.easing }))
    .sort((a, b) => a.t - b.t);
  const sig = JSON.stringify({ speedKfs, inSec, outSec, fps });
  const hash = createHash("sha1").update(sig).digest("hex").slice(0, 10);
  return `clip-${clipId}-speedvar-${hash}.mp4`;
}

/**
 * Build the ffmpeg argv for an AudioClip's static-speed pass: trim the source
 * to [in,out] then atempo(speed). Audio-only (no video stream / no [v] map).
 */
export function buildAudioSpeedFilterArgs(
  input: string,
  output: string,
  inSec: number,
  outSec: number,
  speed: number,
  _fps: number,
): string[] {
  const atempo = chainAtempo(speed);
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    `[0:a]atrim=start=${fmt(inSec)}:end=${fmt(outSec)},asetpts=PTS-STARTPTS,${atempo}[a]`,
    "-map",
    "[a]",
    output,
  ];
}

/** Spawn the audio static-speed pass. Mirrors runSpeedRampPass. */
export async function runAudioSpeedPass(
  input: string,
  output: string,
  inSec: number,
  outSec: number,
  speed: number,
  fps: number,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildAudioSpeedFilterArgs(input, output, inSec, outSec, speed, fps);
  return spawnFfmpeg(args, "runAudioSpeedPass", signal);
}

/** Cache filename for an AudioClip's static-speed pass. */
export function audioSpeedCacheName(
  clipId: string,
  speed: number,
  inSec: number,
  outSec: number,
  fps: number,
): string {
  const sig = JSON.stringify({ speed, inSec, outSec, fps });
  const hash = createHash("sha1").update(sig).digest("hex").slice(0, 10);
  return `clip-${clipId}-speedaud-${hash}.m4a`;
}

/**
 * Shared spawn helper — collect stderr, reject on non-zero / abort. Extracted
 * so runSpeedRampPass / runVariableSpeedPass / runAudioSpeedPass share one
 * abort-wired implementation.
 */
function spawnFfmpeg(
  args: string[],
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${label}: aborted before spawn`));
      return;
    }
    const child = spawn(FFMPEG_BIN, args);
    let stderr = "";
    child.stderr?.on("data", (b: Buffer | string) => {
      stderr += b.toString();
    });
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code: number | null) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error(`${label}: aborted`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label}: ffmpeg exit ${code}\n${stderr}`));
      }
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

/**
 * Pre-Remotion stage. For each VideoClip with a STATIC non-1 speed, runs
 * the setpts/atempo pass and rewrites clip.src to point at the resampled
 * cache file. For VARIABLE speed (S4), runs the segmented setpts/atempo →
 * concat pass and rewrites the clip to play the baked cache straight (in=0,
 * out=totalTimeline, speed keyframes stripped). AudioClips with a static
 * non-1 speed run an atempo pass. For speed=1 / no speed keyframes, the clip
 * is left untouched.
 *
 * Caching: output goes to `{workDir}/` + speedRampCacheName(id, speed, fps).
 * If the file already exists we skip the ffmpeg invocation — this keeps
 * re-runs cheap (D-pitfall in plan).
 *
 * Never mutates the input composition; returns a deep-cloned comp with
 * affected `clip.src` rewritten. Mirrors the `applyProxy` idiom from
 * Phase 7.C.
 */
export async function applySpeedRampPrePass(
  comp: Composition,
  workDir: string,
  signal?: AbortSignal,
): Promise<Composition> {
  const newTracks: Track[] = await Promise.all(
    comp.tracks.map(async (track) => {
      if (track.kind === "video") {
        const newClips: Clip[] = await Promise.all(
          track.clips.map((clipRaw) =>
            clipRaw.kind === "video"
              ? processVideoSpeed(clipRaw as VideoClip, comp.fps, workDir, signal)
              : clipRaw,
          ),
        );
        return { ...track, clips: newClips };
      }
      if (track.kind === "audio") {
        const newClips: Clip[] = await Promise.all(
          track.clips.map((clipRaw) =>
            clipRaw.kind === "audio"
              ? processAudioSpeed(clipRaw as AudioClip, comp.fps, workDir, signal)
              : clipRaw,
          ),
        );
        return { ...track, clips: newClips };
      }
      return track;
    }),
  );
  return { ...comp, tracks: newTracks };
}

/** Speed pre-pass for a single VideoClip (static setpts OR variable segment). */
async function processVideoSpeed(
  c: VideoClip,
  fps: number,
  workDir: string,
  signal?: AbortSignal,
): Promise<VideoClip> {
  const staticSpeed = isStaticSpeed(c);
  const hasSpeedKf = (c.keyframes ?? []).some((k) => k.property === "speed");

  // Variable speed = has speed keyframes AND isStaticSpeed returned null
  // (i.e. they don't all share the same value). S4: bake the ramp.
  if (hasSpeedKf && staticSpeed === null) {
    const { segments, totalTimelineDuration } = planSpeedSegments(c, fps);
    if (segments.length === 0 || totalTimelineDuration <= 0) return c; // defensive
    const cachePath = join(
      workDir,
      variableSpeedCacheName(c.id, c.keyframes ?? [], c.in, c.out, fps),
    );
    // The concat cache bakes the whole [in,out] ramp and starts at 0, so the
    // rewritten clip plays it straight — reset in/out and STRIP the speed
    // keyframes so Remotion's playbackRate doesn't double-apply (mirrors
    // applyTimeWarpPrePass). Non-speed keyframes are preserved as-is.
    const rewritten = rewriteSpeedBaked(c, cachePath, totalTimelineDuration);
    try {
      await stat(cachePath);
      return rewritten;
    } catch {
      /* miss — fall through to ffmpeg */
    }
    await runVariableSpeedPass(c.src, cachePath, segments, fps, signal);
    return rewritten;
  }

  if (staticSpeed === null || Math.abs(staticSpeed - 1.0) < 1e-4) {
    return c; // no speed kfs OR speed=1 → no-op
  }
  // Static, non-1 speed → run the pre-pass (or hit the cache).
  const cachePath = join(workDir, speedRampCacheName(c.id, staticSpeed, fps));
  try {
    await stat(cachePath);
    return { ...c, src: cachePath };
  } catch {
    /* miss — fall through to ffmpeg */
  }
  await runSpeedRampPass(c.src, cachePath, staticSpeed, fps, signal);
  return { ...c, src: cachePath };
}

/** Speed pre-pass for a single AudioClip (static atempo only — S4). */
async function processAudioSpeed(
  a: AudioClip,
  fps: number,
  workDir: string,
  signal?: AbortSignal,
): Promise<AudioClip> {
  const staticSpeed = isStaticSpeed(a);
  const hasSpeedKf = (a.keyframes ?? []).some((k) => k.property === "speed");
  // Variable audio speed is out of scope for v1 (no segmented audio concat);
  // leave it untouched rather than guess. Static speed=1 / no kfs → no-op.
  if (!hasSpeedKf || staticSpeed === null) return a;
  if (Math.abs(staticSpeed - 1.0) < 1e-4) return a;

  const inSec = a.in;
  const outSec = a.out;
  const newDur = (outSec - inSec) / staticSpeed;
  const cachePath = join(
    workDir,
    audioSpeedCacheName(a.id, staticSpeed, inSec, outSec, fps),
  );
  const nonSpeedKfs = (a.keyframes ?? []).filter((k) => k.property !== "speed");
  const rewritten: AudioClip = {
    ...a,
    src: cachePath,
    in: 0,
    out: newDur,
    keyframes: nonSpeedKfs.length ? nonSpeedKfs : undefined,
  };
  try {
    await stat(cachePath);
    return rewritten;
  } catch {
    /* miss — fall through to ffmpeg */
  }
  await runAudioSpeedPass(a.src, cachePath, inSec, outSec, staticSpeed, fps, signal);
  return rewritten;
}

/** Rewrite a video clip to play its baked variable-speed cache straight. */
function rewriteSpeedBaked(
  c: VideoClip,
  cachePath: string,
  totalTimelineDuration: number,
): VideoClip {
  const nonSpeedKfs = (c.keyframes ?? []).filter((k) => k.property !== "speed");
  return {
    ...c,
    src: cachePath,
    in: 0,
    out: totalTimelineDuration,
    keyframes: nonSpeedKfs.length ? nonSpeedKfs : undefined,
  };
}
