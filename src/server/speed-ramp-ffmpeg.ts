// Phase 8.3.E — server-side speed-ramp ffmpeg pre-pass.
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
// For VARIABLE speed (D6 v1 limitation), we log a one-time warning per
// clip and leave clip.src unchanged — Remotion will preview the ramp via
// `<OffthreadVideo playbackRate>` but the final export plays back at 1×.
// Variable-speed export is deferred to Phase 8.3.5.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { FFMPEG_BIN } from "./ffmpeg-paths.js";
import type {
  Composition,
  VideoClip,
  Track,
  Clip,
} from "../shared/composition.js";
import { isStaticSpeed } from "../shared/speed-ramp.js";

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
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("runSpeedRampPass: aborted before spawn"));
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
        reject(new Error("runSpeedRampPass: aborted"));
      } else if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`runSpeedRampPass: ffmpeg exit ${code}\n${stderr}`),
        );
      }
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
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

/**
 * Pre-Remotion stage. For each VideoClip with a STATIC non-1 speed, runs
 * the setpts/atempo pass and rewrites clip.src to point at the resampled
 * cache file. For VARIABLE speed (D6), logs a warning and leaves the
 * clip unchanged. For speed=1 / no speed keyframes, the clip is also
 * left untouched.
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
  // Track per-clip warnings so we don't double-log if (improbably) the same
  // clip appears across logical entry points in future refactors.
  const newTracks: Track[] = await Promise.all(
    comp.tracks.map(async (track) => {
      if (track.kind !== "video") return track;
      const newClips: Clip[] = await Promise.all(
        track.clips.map(async (clipRaw) => {
          if (clipRaw.kind !== "video") return clipRaw;
          const c = clipRaw as VideoClip;
          const stat_speed = isStaticSpeed(c);
          const hasSpeedKf = (c.keyframes ?? []).some(
            (k) => k.property === "speed",
          );
          // Variable speed = has speed keyframes AND isStaticSpeed returned null
          // (i.e. they don't all share the same value).
          if (hasSpeedKf && stat_speed === null) {
            console.warn(
              `[render-pipeline] Variable-speed export not supported in v1 (clip ${c.id}); ` +
                "rendering at 1×. Variable-speed export ships in 8.3.5.",
            );
            return c;
          }
          if (
            stat_speed === null ||
            Math.abs(stat_speed - 1.0) < 1e-4
          ) {
            return c; // no speed kfs OR speed=1 → no-op
          }
          // Static, non-1 speed → run the pre-pass (or hit the cache).
          const cacheName = speedRampCacheName(c.id, stat_speed, comp.fps);
          const cachePath = join(workDir, cacheName);
          try {
            await stat(cachePath);
            return { ...c, src: cachePath };
          } catch {
            /* miss — fall through to ffmpeg */
          }
          await runSpeedRampPass(c.src, cachePath, stat_speed, comp.fps, signal);
          return { ...c, src: cachePath };
        }),
      );
      return { ...track, clips: newClips };
    }),
  );
  return { ...comp, tracks: newTracks };
}
