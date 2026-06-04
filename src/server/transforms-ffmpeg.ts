// S18 (US 27/28) — server-side crop + flip ffmpeg pre-pass.
//
// For each VideoClip whose transforms carry a `crop` and/or `flipH`/`flipV`,
// we run a one-shot ffmpeg invocation BEFORE Remotion sees the comp:
//   ffmpeg -i src.mp4 -vf "crop=W*w:H*h:W*x:H*y,hflip,vflip" -c:a copy cache.mp4
// so the on-disk frame is already cropped/mirrored when Remotion composites it.
//
// This is the EXPORT mirror of the Remotion preview's CROP-AND-ZOOM + CSS
// scaleX(-1)/scaleY(-1) (VideoTrackRenderer.cssCropZoom / cssFlipSuffix). BOTH
// sides perform the same operation: crop the source to the {x,y,w,h} sub-region
// and RESCALE it to fill the canvas box. export does this by producing a smaller
// MP4 (ffmpeg crop=) that Remotion's objectFit:cover then enlarges; preview does
// it by enlarging the inner <Video> 1/w × 1/h inside an overflow:hidden window.
// (Review fix: the preview previously used clip-path inset() — a MASK that kept
// the sub-region in place rather than zooming it — so it diverged from export.)
//
// crop is NORMALISED [0,1] (fractions of the SOURCE frame); ffmpeg's
// `crop=out_w:out_h:x:y` takes PIXELS, so the chain multiplies by the SOURCE's
// real width/height (ffprobed per clip — NOT the canvas dims). flip → `hflip`
// (horizontal) / `vflip` (vertical). When a clip has neither crop nor flip, the
// chain is empty and the clip is left untouched.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { FFMPEG_BIN, FFPROBE_BIN } from "./ffmpeg-paths.js";
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
    // `width`/`height` are the SOURCE video's real pixel dims (review fix high
    // — caller ffprobes them; crop is normalised fractions OF THE SOURCE, not of
    // the canvas). Round to whole pixels (ffmpeg crop wants ints), then clamp so
    // x+out_w<=W and y+out_h<=H — a defence against any out-of-bounds crop that
    // slipped past CropSchema (legacy / hand-rolled in-memory comp), which would
    // otherwise make ffmpeg abort with "Invalid too big or non positive size".
    let ow = Math.round(width * t.crop.w);
    let oh = Math.round(height * t.crop.h);
    let ox = Math.round(width * t.crop.x);
    let oy = Math.round(height * t.crop.y);
    ox = Math.max(0, Math.min(ox, width - 1));
    oy = Math.max(0, Math.min(oy, height - 1));
    ow = Math.max(1, Math.min(ow, width - ox));
    oh = Math.max(1, Math.min(oh, height - oy));
    parts.push(`crop=${ow}:${oh}:${ox}:${oy}`);
  }
  if (t.flipH) parts.push("hflip");
  if (t.flipV) parts.push("vflip");
  return parts.join(",");
}

/**
 * Cache filename for a clip's crop+flip pre-pass output. The crop/flip PARAMS
 * are hashed into the name (review fix high — the old `clip-{id}-cropflip.mp4`
 * keyed only on the clip id, so changing the crop region re-served a stale file
 * forever). A short content hash of the normalised crop+flip means: same params
 * → same name (cache HIT), any param change → new name → automatic re-render,
 * with the old file naturally orphaned. Mirrors speed-ramp's parameterised name.
 */
export function transformsCacheName(clipId: string, t: Transforms): string {
  const sig = JSON.stringify({
    crop: t.crop ?? null,
    flipH: !!t.flipH,
    flipV: !!t.flipV,
  });
  const hash = createHash("sha1").update(sig).digest("hex").slice(0, 10);
  return `clip-${clipId}-cropflip-${hash}.mp4`;
}

/**
 * ffprobe a video's real pixel dimensions (review fix high). crop is normalised
 * fractions OF THE SOURCE, so the ffmpeg crop= pixel coords must be computed
 * from the source's own width/height — not the canvas. Returns the first video
 * stream's coded width/height. Mirrors probeAudio in audio/peaks.ts.
 */
export function probeVideoDimensions(
  srcPath: string,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("probeVideoDimensions: aborted before spawn"));
      return;
    }
    const child = spawn(FFPROBE_BIN, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      srcPath,
    ]);
    const chunks: Buffer[] = [];
    let errBuf = "";
    child.stdout?.on("data", (d: Buffer) => chunks.push(d));
    child.stderr?.on("data", (d: Buffer) => {
      errBuf += d.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`ffprobe failed (exit ${code}) for ${srcPath}: ${errBuf}`),
        );
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        const stream = parsed.streams?.[0] ?? {};
        const width = parseInt(String(stream.width ?? "0"), 10);
        const height = parseInt(String(stream.height ?? "0"), 10);
        if (!(width > 0) || !(height > 0)) {
          reject(
            new Error(
              `probeVideoDimensions: invalid dims for ${srcPath}: ${width}x${height}`,
            ),
          );
          return;
        }
        resolve({ width, height });
      } catch (err) {
        reject(err);
      }
    });
  });
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
 * The crop's pixel basis is the SOURCE video's real dims (ffprobed per clip —
 * review fix high), NOT comp.width/height. crop is normalised fractions of the
 * source frame; using the canvas dims cropped the wrong region whenever the
 * source AR ≠ canvas AR (and could overrun the source → ffmpeg abort).
 *
 * Caching: output goes to `{workDir}/clip-{id}-cropflip-{hash}.mp4` where the
 * hash encodes the crop/flip PARAMS (review fix high — the old id-only name
 * re-served a stale crop after the region changed). Same params → cache HIT,
 * any change → new name → re-render.
 *
 * `probeDims` is injectable so render-pipeline tests don't need a real ffprobe;
 * production passes the default probeVideoDimensions.
 *
 * Never mutates the input composition; returns a deep-cloned comp with affected
 * clips rewritten. Mirrors applySpeedRampPrePass.
 */
export async function applyTransformsPrePass(
  comp: Composition,
  workDir: string,
  signal?: AbortSignal,
  probeDims: (
    src: string,
    signal?: AbortSignal,
  ) => Promise<{ width: number; height: number }> = probeVideoDimensions,
): Promise<Composition> {
  const newTracks: Track[] = await Promise.all(
    comp.tracks.map(async (track) => {
      if (track.kind !== "video") return track;
      const newClips: Clip[] = await Promise.all(
        track.clips.map(async (clipRaw) => {
          if (clipRaw.kind !== "video") return clipRaw;
          const c = clipRaw as VideoClip;
          const hasCrop = c.transforms.crop != null;
          const hasFlip = !!c.transforms.flipH || !!c.transforms.flipV;
          if (!hasCrop && !hasFlip) return c; // no crop/flip → no-op (skip probe)
          // The pixel basis for crop= is the SOURCE frame; ffprobe it. flip-only
          // clips don't strictly need real dims (hflip/vflip is resolution-free),
          // but we probe uniformly to keep one code path — cheap (one ffprobe).
          const { width, height } = await probeDims(c.src, signal);
          const chain = transformsToFilterChain(c.transforms, width, height);
          if (chain === "") return c; // defensive (shouldn't happen given guards)
          const cachePath = join(
            workDir,
            transformsCacheName(c.id, c.transforms),
          );
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
