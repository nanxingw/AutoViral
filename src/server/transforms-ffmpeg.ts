// S18 (US 27/28) — server-side crop + flip ffmpeg pre-pass.
//
// For each VideoClip whose transforms carry a `crop` and/or `flipH`/`flipV`,
// we run a one-shot ffmpeg invocation BEFORE Remotion sees the comp:
//   ffmpeg -i src.mp4 -vf "crop=W*w:H*h:W*x:H*y,hflip,vflip" -c:a copy cache.mp4
// so the on-disk frame is already cropped/mirrored when Remotion composites it.
//
// This is the EXPORT mirror of the Remotion preview's clip-path inset() +
// CSS scaleX(-1)/scaleY(-1) (VideoTrackRenderer.cssCropInset / cssFlipSuffix):
// preview and export crop/mirror the SAME region (WYSIWYG by construction).
//
// crop is NORMALISED [0,1] (fractions of the source frame); ffmpeg's
// `crop=out_w:out_h:x:y` takes PIXELS, so the chain multiplies by the source
// width/height. flip → `hflip` (horizontal) / `vflip` (vertical). When a clip
// has neither crop nor flip, the chain is empty and the clip is left untouched.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { FFMPEG_BIN } from "./ffmpeg-paths.js";
import type {
  Composition,
  Transforms,
  VideoClip,
  Track,
  Clip,
} from "../shared/composition.js";

/**
 * Build the comma-chained ffmpeg `-vf` filter expression for a clip's crop +
 * flip transforms. Returns "" when neither crop nor flip is present (no-op).
 *
 * Order is crop FIRST (so flip mirrors the cropped frame, not the full source —
 * matching the preview, where clip-path crops the same element CSS transform
 * mirrors). crop is normalised; we multiply by source dims and round to whole
 * pixels (ffmpeg crop wants integer pixel coords).
 *
 * Examples (W=1080, H=1920):
 *   {}                                  → ""
 *   { flipH:true }                      → "hflip"
 *   { flipV:true }                      → "vflip"
 *   { flipH:true, flipV:true }          → "hflip,vflip"
 *   { crop:{x:.1,y:.2,w:.5,h:.6} }      → "crop=540:1152:108:384"
 *   { crop:{x:0,y:0,w:.5,h:1}, flipH }  → "crop=540:1920:0:0,hflip"
 */
export function transformsToFilterChain(
  t: Transforms,
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  if (t.crop) {
    const ow = Math.round(width * t.crop.w);
    const oh = Math.round(height * t.crop.h);
    const ox = Math.round(width * t.crop.x);
    const oy = Math.round(height * t.crop.y);
    parts.push(`crop=${ow}:${oh}:${ox}:${oy}`);
  }
  if (t.flipH) parts.push("hflip");
  if (t.flipV) parts.push("vflip");
  return parts.join(",");
}

/**
 * Build the ffmpeg argv for a single clip's crop+flip pre-pass.
 *
 *   ffmpeg -y -loglevel error -i {input} -vf "{chain}" -c:a copy {output}
 *
 * Audio is stream-copied untouched (crop/flip is a video-only transform).
 */
export function buildTransformsFilterArgs(
  input: string,
  output: string,
  chain: string,
): string[] {
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    chain,
    "-c:a",
    "copy",
    output,
  ];
}

/**
 * Spawn ffmpeg, collect stderr, reject on non-zero or abort.
 * Mirrors runSpeedRampPass (speed-ramp-ffmpeg.ts).
 */
export async function runTransformsPass(
  input: string,
  output: string,
  chain: string,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildTransformsFilterArgs(input, output, chain);
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("runTransformsPass: aborted before spawn"));
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
        reject(new Error("runTransformsPass: aborted"));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`runTransformsPass: ffmpeg exit ${code}\n${stderr}`));
      }
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

/**
 * Pre-Remotion stage. For each VideoClip with a crop and/or flip, runs the
 * ffmpeg crop/flip pass and rewrites clip.src to point at the cached output,
 * then clears the consumed transform fields so Remotion does NOT crop/mirror a
 * second time (the on-disk frame is already transformed). Clips with neither
 * crop nor flip are left untouched.
 *
 * The comp's `width`/`height` (canvas dims) are used as the source-pixel basis
 * for the normalised crop — the same basis the preview uses (clip-path % of the
 * rendered element).
 *
 * Caching: output goes to `{workDir}/clip-{id}-cropflip.mp4`. If the file
 * already exists we skip the ffmpeg invocation (cheap re-runs).
 *
 * Never mutates the input composition; returns a deep-cloned comp with affected
 * clips rewritten. Mirrors applySpeedRampPrePass.
 */
export async function applyTransformsPrePass(
  comp: Composition,
  workDir: string,
  signal?: AbortSignal,
): Promise<Composition> {
  const width = comp.width;
  const height = comp.height;
  const newTracks: Track[] = await Promise.all(
    comp.tracks.map(async (track) => {
      if (track.kind !== "video") return track;
      const newClips: Clip[] = await Promise.all(
        track.clips.map(async (clipRaw) => {
          if (clipRaw.kind !== "video") return clipRaw;
          const c = clipRaw as VideoClip;
          const chain = transformsToFilterChain(c.transforms, width, height);
          if (chain === "") return c; // no crop/flip → no-op
          const cachePath = join(workDir, `clip-${c.id}-cropflip.mp4`);
          // Strip the consumed fields so the Remotion stage doesn't re-apply.
          const consumedTransforms: Transforms = {
            ...c.transforms,
            crop: undefined,
            flipH: undefined,
            flipV: undefined,
          };
          try {
            await stat(cachePath);
            return { ...c, src: cachePath, transforms: consumedTransforms };
          } catch {
            /* miss — fall through to ffmpeg */
          }
          await runTransformsPass(c.src, cachePath, chain, signal);
          return { ...c, src: cachePath, transforms: consumedTransforms };
        }),
      );
      return { ...track, clips: newClips };
    }),
  );
  return { ...comp, tracks: newTracks };
}
