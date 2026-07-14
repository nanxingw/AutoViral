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
import { FFMPEG_BIN, FFPROBE_BIN } from "./ffmpeg-paths.js";
import type {
  Composition,
  VideoClip,
  AudioClip,
  Track,
  Clip,
  Keyframe,
} from "../shared/composition.js";
import {
  clampSpeed,
  isStaticSpeed,
  effectiveClipDuration,
} from "../shared/speed-ramp.js";
import { interpolateProperty } from "../shared/keyframes.js";

/**
 * Build the comma-chained `atempo=` filter expression for any speed in
 * [0.1, 4.0]. ffmpeg's per-instance atempo is constrained to [0.5, 2.0], so we
 * decompose into a chain whose product equals `speed` AND whose EVERY factor
 * lies in [0.5, 2.0] (a strict ffmpeg build errors on any atempo outside that
 * range — S4 review, finding 5). We peel whole 2.0× (speed>1) or 0.5× (speed<1)
 * stages until the remainder itself falls inside a single atempo's band:
 *   - speed > 1: peel 2.0 while remaining > 2.0  → remainder ∈ (1.0, 2.0]
 *   - speed < 1: peel 0.5 while remaining < 0.5  → remainder ∈ [0.5, 1.0)
 * For speed exactly 1.0, returns the no-op "atempo=1.0".
 *
 * Examples:
 *   chainAtempo(2.0)  → "atempo=2.0000"
 *   chainAtempo(4.0)  → "atempo=2.0000,atempo=2.0000"                 (2×2 = 4)
 *   chainAtempo(0.5)  → "atempo=0.5000"
 *   chainAtempo(0.1)  → "atempo=0.5000,atempo=0.5000,atempo=0.5000,atempo=0.8000"
 *                        (0.5³ × 0.8 = 0.1 — every factor ≥ 0.5, 4-stage)
 *   chainAtempo(3.0)  → "atempo=2.0000,atempo=1.5000"
 */
export function chainAtempo(speed: number): string {
  if (speed === 1.0) return "atempo=1.0";
  const parts: number[] = [];
  let remaining = speed;
  if (speed > 1.0) {
    // Peel 2.0× stages until the remainder is within a single atempo's ceiling.
    while (remaining > 2.0 + 1e-9) {
      parts.push(2.0);
      remaining /= 2.0;
    }
  } else {
    // Peel 0.5× stages until the remainder is ≥ atempo's 0.5 floor. This keeps
    // the trailing factor in [0.5, 1.0) — never the sub-0.5 value the old
    // `< 0.25` bound emitted (e.g. speed=0.1 used to end in an illegal 0.4).
    while (remaining < 0.5 - 1e-9) {
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
  hasAudio = true,
): string[] {
  // A silent VideoClip (legacy generations, muted sources) has no [0:a]; mapping
  // it makes ffmpeg fail with "matches no streams" (S4 review, finding 2). When
  // hasAudio is false we emit a video-only graph.
  const filter = hasAudio
    ? `[0:v]setpts=PTS/${speed}[v];[0:a]${chainAtempo(speed)}[a]`
    : `[0:v]setpts=PTS/${speed}[v]`;
  const maps = hasAudio ? ["-map", "[v]", "-map", "[a]"] : ["-map", "[v]"];
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    filter,
    ...maps,
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
  hasAudio = true,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildSpeedRampFilterArgs(input, output, speed, fps, hasAudio);
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
 * Eased source-seconds consumed over the clip-local TIMELINE window [tA, tB].
 * Integrates the same eased speed curve `interpolateProperty` feeds Remotion's
 * per-frame `<OffthreadVideo playbackRate>` (midpoint rule, fine step). Out-of-
 * range times clamp to the last keyframe (D3 hold) — matching effectiveClipDuration.
 */
function integrateSourceOverTimeline(
  keyframes: readonly Keyframe[] | undefined,
  tA: number,
  tB: number,
): number {
  const dt = 0.002; // 500 Hz — sub-frame for any real curve
  let consumed = 0;
  let t = tA;
  while (t < tB - 1e-9) {
    const step = Math.min(dt, tB - t);
    const mid = t + step / 2;
    const speed = clampSpeed(interpolateProperty(keyframes, "speed", mid) ?? 1.0);
    consumed += speed * step;
    t += step;
  }
  return consumed;
}

/**
 * Decompose a VideoClip's variable speed keyframes into a piecewise-constant
 * plan whose TOTAL timeline duration equals the preview's effectiveClipDuration
 * (src/shared/speed-ramp.ts) — the WYSIWYG contract this slice exists to honour.
 *
 * Domain (D9, matching the preview — S4 review, finding 1): keyframe `time` is
 * clip-local TIMELINE seconds and the speed curve is EASED via
 * interpolateProperty (the exact function `playbackRate` samples per frame). The
 * old v1 read `time` as SOURCE time with a hold-left step, which diverged from
 * the preview by many frames (e.g. a 4s clip 1→2 previews ~2.5s but the source-
 * domain plan said 3s — >±1 frame, the core acceptance miss).
 *
 * We cut the timeline at each keyframe position (frame-aligned) and at tEnd (the
 * timeline instant all (out-in) source seconds are consumed), then give each
 * interval a CONSTANT speed = (source consumed over the interval, by eased
 * integration) / (interval's frame-aligned timeline width). Per interval that
 * reproduces the exact source span and timeline width, so the concatenated cache
 * duration equals the preview's to sub-frame accuracy. Segment source spans are
 * contiguous and the last lands exactly on clip.out — no dropped/double source.
 *
 * Example (the S4 acceptance case): a 4s clip, speed 1 at t=0 and speed 2 at
 * t=2 (linear) →
 *   timeline [0,2]:   eased 1→2 consumes 3s of source → speed 1.5, 2.0s timeline
 *   timeline [2,2.5]: holds 2× over the last 1s of source → speed 2, 0.5s timeline
 *   totalTimelineDuration = 2.5s   (the v1 source-domain hold-left plan said 3s)
 */
export function planSpeedSegments(
  clip: { in: number; out: number; keyframes?: readonly Keyframe[] },
  fps: number,
): { segments: SpeedSegment[]; totalTimelineDuration: number } {
  const snap = (sec: number) => Math.round(sec * fps) / fps;
  const inSrc = snap(clip.in);
  const outSrc = snap(clip.out);
  const sourceDur = outSrc - inSrc;
  if (sourceDur <= FRAME_EPS) {
    return { segments: [], totalTimelineDuration: 0 };
  }

  const speedKfs = (clip.keyframes ?? []).filter((k) => k.property === "speed");
  const stat = isStaticSpeed(clip);

  // Uniform speed (all keyframes equal) → one constant segment over [in,out].
  if (stat !== null) {
    const timelineDuration = sourceDur / stat;
    return {
      segments: [{ srcStart: inSrc, srcEnd: outSrc, speed: stat, timelineDuration }],
      totalTimelineDuration: timelineDuration,
    };
  }
  // No speed keyframes at all → 1× passthrough (defensive; callers gate on this).
  if (speedKfs.length === 0) {
    return {
      segments: [{ srcStart: inSrc, srcEnd: outSrc, speed: 1, timelineDuration: sourceDur }],
      totalTimelineDuration: sourceDur,
    };
  }

  // Variable speed — TIMELINE-domain, eased. tEnd is where the whole source span
  // is consumed (the preview's own clip width). Cut the timeline at tEnd and at
  // each in-range keyframe, all snapped to whole frames.
  const tEnd = effectiveClipDuration(clip);
  const nEnd = Math.max(1, Math.round(tEnd * fps));
  const bFrames = new Set<number>([0, nEnd]);
  for (const kf of speedKfs) {
    const f = Math.round(kf.time * fps);
    if (f > 0 && f < nEnd) bFrames.add(f);
  }
  const frames = [...bFrames].sort((a, b) => a - b);

  // Raw eased source consumed per timeline interval; scaled so the total lands
  // exactly on sourceDur (removes discretisation drift, keeps segments contiguous).
  const raw = frames.slice(0, -1).map((f, i) => {
    const tA = f / fps;
    const tB = frames[i + 1] / fps;
    return { tA, tB, src: integrateSourceOverTimeline(clip.keyframes, tA, tB) };
  });
  const rawTotal = raw.reduce((a, r) => a + r.src, 0) || sourceDur;
  const scale = sourceDur / rawTotal;

  const segments: SpeedSegment[] = [];
  let cursor = inSrc;
  raw.forEach((r, i) => {
    const width = r.tB - r.tA;
    const isLast = i === raw.length - 1;
    const srcStart = cursor;
    const srcEnd = isLast ? outSrc : cursor + r.src * scale;
    const span = srcEnd - srcStart;
    cursor = srcEnd;
    if (span <= FRAME_EPS || width <= FRAME_EPS) return;
    segments.push({
      srcStart,
      srcEnd,
      speed: span / width,
      timelineDuration: width,
    });
  });
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
  hasAudio = true,
): string[] {
  // Silent source → skip every [0:a] atrim/atempo and concat video-only, else
  // ffmpeg errors on the missing audio stream (S4 review, finding 2).
  const parts: string[] = [];
  const concatIn: string[] = [];
  segments.forEach((seg, i) => {
    const k = seg.speed;
    // `fps=${fps}` re-samples each retimed segment to CFR at the composition fps.
    // setpts alone leaves a VFR stream whose PTS span drifts a frame or two past
    // the intended timeline width; normalising to CFR makes each frame-aligned
    // segment carry EXACTLY round(timelineDuration*fps) frames, so the baked
    // cache's duration equals planSpeedSegments' total (= the preview's
    // effectiveClipDuration) to sub-frame accuracy (S4 review, finding 1/3).
    parts.push(
      `[0:v]trim=start=${fmt(seg.srcStart)}:end=${fmt(seg.srcEnd)},` +
        `setpts=(PTS-STARTPTS)/${fmt(k)},fps=${fps}[v${i}]`,
    );
    if (hasAudio) {
      parts.push(
        `[0:a]atrim=start=${fmt(seg.srcStart)}:end=${fmt(seg.srcEnd)},` +
          `asetpts=PTS-STARTPTS,${chainAtempo(k)}[a${i}]`,
      );
      concatIn.push(`[v${i}][a${i}]`);
    } else {
      concatIn.push(`[v${i}]`);
    }
  });
  const n = segments.length;
  const filter =
    parts.join(";") +
    ";" +
    concatIn.join("") +
    (hasAudio
      ? `concat=n=${n}:v=1:a=1[v][a]`
      : `concat=n=${n}:v=1:a=0[v]`);
  const maps = hasAudio ? ["-map", "[v]", "-map", "[a]"] : ["-map", "[v]"];
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    filter,
    ...maps,
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
  hasAudio = true,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildVariableSpeedFilterArgs(input, output, segments, fps, hasAudio);
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
 * ffprobe whether the source has ≥1 audio stream. Silent VideoClips (legacy
 * generations, muted exports) have none — mapping [0:a] on them makes the
 * setpts/atempo pass fail ("Stream specifier '0:a' matches no streams", S4
 * review finding 2). Mirrors probeVideoDimensions (transforms-ffmpeg.ts).
 * Injectable into applySpeedRampPrePass so unit tests need no real binary.
 */
export function probeHasAudioStream(
  srcPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("probeHasAudioStream: aborted before spawn"));
      return;
    }
    const child = spawn(FFPROBE_BIN, [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      srcPath,
    ]);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer | string) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `probeHasAudioStream: ffprobe exit ${code} for ${srcPath}: ${err}`,
          ),
        );
        return;
      }
      resolve(out.trim().length > 0);
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
  probeAudio: (
    src: string,
    signal?: AbortSignal,
  ) => Promise<boolean> = probeHasAudioStream,
): Promise<Composition> {
  const newTracks: Track[] = await Promise.all(
    comp.tracks.map(async (track) => {
      if (track.kind === "video") {
        const newClips: Clip[] = await Promise.all(
          track.clips.map((clipRaw) =>
            clipRaw.kind === "video"
              ? processVideoSpeed(
                  clipRaw as VideoClip,
                  comp.fps,
                  workDir,
                  probeAudio,
                  signal,
                )
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
  probeAudio: (src: string, signal?: AbortSignal) => Promise<boolean>,
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
    // Probe only on a cache miss (an ffmpeg pass is about to run anyway).
    const hasAudio = await probeAudio(c.src, signal);
    await runVariableSpeedPass(c.src, cachePath, segments, fps, hasAudio, signal);
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
  const hasAudio = await probeAudio(c.src, signal);
  await runSpeedRampPass(c.src, cachePath, staticSpeed, fps, hasAudio, signal);
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
