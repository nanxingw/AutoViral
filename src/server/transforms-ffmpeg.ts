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

// S19 (US 29/30) — time-domain warp (reverse + freeze) ffmpeg builders. These
// are the EXPORT mirror of the time-domain fields on a VideoClip. Unlike crop/
// flip (spatial, both preview + export show the same result), reverse is
// EXPORT-ONLY: a browser <video> can't play backwards, so the preview shows an
// explicit "export-only" placeholder (VideoTrackRenderer) while THIS builds the
// real `reverse`/`areverse` filtergraph for the encode. freeze IS shown in both
// (the preview holds the frame; here we trim+tpad it).

/** The subset of a VideoClip the time-warp pass reads. */
export interface TimeWarp {
  reverse?: boolean;
  freezeAtSec?: number;
  /** clip play in-point in the SOURCE (seconds), so reverse trims to [in,out]. */
  inSec?: number;
  /** clip play out-point in the SOURCE (seconds); also the freeze pad length. */
  outSec?: number;
}

/**
 * Build the ffmpeg VIDEO `-vf` chain for a clip's time-warp.
 *   - freeze (precedence) → `trim=start=F,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=D`
 *       grab the single frame at F and clone-hold it for the clip's duration D.
 *   - reverse → `trim=start=IN:end=OUT,setpts=PTS-STARTPTS,reverse`
 *       trim to the user-selected [in,out] SPAN of the source FIRST, reset PTS,
 *       THEN reverse — so the reversed material is the clip's own span, not the
 *       whole source's tail (review-fix high: bare `reverse` reversed the entire
 *       source MP4, and applyTimeWarpPrePass then rewrote the clip to in:0/
 *       out:outSec, so Remotion played the source's LAST outSec reversed — the
 *       wrong footage for any trimmed clip). When inSec/outSec are absent
 *       (whole-source reverse) it degrades to bare `reverse`.
 *   - neither → "" (no-op).
 * Freeze takes precedence over reverse (a held still has no direction).
 */
export function timeWarpVideoFilterChain(
  w: TimeWarp,
  fps: number,
  outSec: number,
): string {
  if (w.freezeAtSec != null) {
    const start = w.freezeAtSec;
    const dur = Math.max(1 / fps, outSec);
    // trim to one frame at `start`, reset PTS to 0, then clone-hold for `dur`.
    return (
      `trim=start=${start}:end=${start + 1 / fps},` +
      `setpts=PTS-STARTPTS,` +
      `tpad=stop_mode=clone:stop_duration=${dur}`
    );
  }
  if (w.reverse) {
    // Trim the source to the clip's [in,out] span BEFORE reversing so we reverse
    // the user-selected material, not the whole source. inSec/outSec are absolute
    // source seconds (NOT the timeline length); fall back to bare `reverse` only
    // when the span isn't known (whole-source reverse).
    if (w.inSec != null && w.outSec != null) {
      return (
        `trim=start=${w.inSec}:end=${w.outSec},` +
        `setpts=PTS-STARTPTS,` +
        `reverse`
      );
    }
    return "reverse";
  }
  return "";
}

/**
 * Build the ffmpeg AUDIO `-af` chain for a clip's time-warp.
 *   - reverse → `atrim=start=IN:end=OUT,asetpts=PTS-STARTPTS,areverse` (audio
 *       played backwards, trimmed to the SAME [in,out] span as the video so the
 *       reversed audio stays in lock-step; degrades to bare `areverse` when the
 *       span isn't known).
 *   - freeze → "" (a held still has no moving audio; the pass silences it -an).
 *   - neither → "".
 */
export function timeWarpAudioFilterChain(w: TimeWarp): string {
  if (w.freezeAtSec != null) return "";
  if (w.reverse) {
    if (w.inSec != null && w.outSec != null) {
      return (
        `atrim=start=${w.inSec}:end=${w.outSec},` +
        `asetpts=PTS-STARTPTS,` +
        `areverse`
      );
    }
    return "areverse";
  }
  return "";
}

/**
 * Cache filename for a clip's time-warp pre-pass output. Params are hashed into
 * the name (mirrors transformsCacheName) so a changed warp → new name → re-render,
 * same warp → cache HIT.
 */
export function timeWarpCacheName(clipId: string, w: TimeWarp): string {
  const sig = JSON.stringify({
    reverse: !!w.reverse,
    freezeAtSec: w.freezeAtSec ?? null,
    // inSec is part of the signature: two reversed clips with the same play
    // length but different source in-points reverse DIFFERENT spans, so they
    // must NOT share a cache file (review-fix high — the bug that bare-reverse
    // masked by reversing the whole source regardless of in).
    inSec: w.inSec ?? null,
    outSec: w.outSec ?? null,
  });
  const hash = createHash("sha1").update(sig).digest("hex").slice(0, 10);
  return `clip-${clipId}-timewarp-${hash}.mp4`;
}

/**
 * Build the ffmpeg argv for a single clip's time-warp pass.
 *   ffmpeg -y -loglevel error -i {in} -vf {vChain} [-af {aChain} | -an] {out}
 * When the audio chain is empty (freeze) we pass `-an` so the held still is
 * silenced rather than carrying stale audio.
 */
export function buildTimeWarpFilterArgs(
  input: string,
  output: string,
  vChain: string,
  aChain: string,
): string[] {
  const args = ["-y", "-loglevel", "error", "-i", input, "-vf", vChain];
  if (aChain) {
    args.push("-af", aChain);
  } else {
    args.push("-an");
  }
  args.push(output);
  return args;
}

/**
 * Spawn ffmpeg for the time-warp pass. Mirrors runTransformsPass.
 */
export async function runTimeWarpPass(
  input: string,
  output: string,
  vChain: string,
  aChain: string,
  signal?: AbortSignal,
): Promise<void> {
  const args = buildTimeWarpFilterArgs(input, output, vChain, aChain);
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("runTimeWarpPass: aborted before spawn"));
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
        reject(new Error("runTimeWarpPass: aborted"));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`runTimeWarpPass: ffmpeg exit ${code}\n${stderr}`));
      }
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
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

/**
 * S19 (US 29/30) — pre-Remotion time-warp stage. For each VideoClip carrying
 * `reverse` and/or `freezeAtSec`, run the ffmpeg reverse/areverse or trim+tpad
 * freeze pass, rewrite clip.src to the cached output, and STRIP the consumed
 * time-domain fields so Remotion does NOT re-apply them (the on-disk frames are
 * already warped). Clips with neither are left untouched.
 *
 * This is the EXPORT consumption of the same `reverse`/`freezeAtSec` fields the
 * preview reads — but with a deliberate asymmetry: freeze IS WYSIWYG (preview
 * holds the same frame), reverse is EXPORT-ONLY (the preview can't play a
 * <video> backwards, so it shows an explicit "export-only" placeholder; here is
 * where the reverse actually happens). Runs BEFORE the crop/flip pre-pass so a
 * clip can be both reversed AND cropped (crop layers on the warped output).
 *
 * Never mutates the input composition; returns a deep-cloned comp with affected
 * clips rewritten. Mirrors applyTransformsPrePass.
 */
export async function applyTimeWarpPrePass(
  comp: Composition,
  workDir: string,
  signal?: AbortSignal,
  // `runWarp` is injectable so tests can assert the EXACT vChain/aChain the
  // prepass feeds ffmpeg (proving reverse trims [in,out], not the source tail)
  // without a real ffmpeg on the host; production passes the default.
  runWarp: (
    input: string,
    output: string,
    vChain: string,
    aChain: string,
    signal?: AbortSignal,
  ) => Promise<void> = runTimeWarpPass,
): Promise<Composition> {
  const newTracks: Track[] = await Promise.all(
    comp.tracks.map(async (track) => {
      if (track.kind !== "video") return track;
      const newClips: Clip[] = await Promise.all(
        track.clips.map(async (clipRaw) => {
          if (clipRaw.kind !== "video") return clipRaw;
          const c = clipRaw as VideoClip;
          const hasFreeze = c.freezeAtSec != null;
          const hasReverse = !!c.reverse;
          if (!hasFreeze && !hasReverse) return c; // no warp → no-op
          const playLen = Math.max(0, c.out - c.in);
          // For REVERSE we trim the SOURCE to [c.in, c.out] before reversing, so
          // the warp object carries the absolute source in/out (NOT the timeline
          // length). For FREEZE the pad length is the same play length; we pass it
          // as outSec and the video-chain branch reads freezeAtSec instead.
          const warp: TimeWarp = {
            reverse: c.reverse,
            freezeAtSec: c.freezeAtSec,
            inSec: c.reverse ? c.in : undefined,
            outSec: c.reverse ? c.out : playLen,
          };
          const vChain = timeWarpVideoFilterChain(warp, comp.fps, playLen);
          const aChain = timeWarpAudioFilterChain(warp);
          if (vChain === "") return c; // defensive (shouldn't happen given guards)
          const cachePath = join(workDir, timeWarpCacheName(c.id, warp));
          // The warp bakes the clip's [in,out] span into the cached MP4 (reverse
          // trims to [in,out] before reversing; freeze holds the freezeAtSec frame
          // for the play length), so the cache is exactly `playLen` long and starts
          // at 0 — the rewritten clip plays it straight (in=0, out=playLen, the
          // consumed warp fields gone so Remotion doesn't re-apply them).
          const consumed: VideoClip = {
            ...c,
            src: cachePath,
            in: 0,
            out: playLen,
            reverse: undefined,
            freezeAtSec: undefined,
          };
          try {
            await stat(cachePath);
            return consumed;
          } catch {
            /* miss — fall through to ffmpeg */
          }
          await runWarp(c.src, cachePath, vChain, aChain, signal);
          return consumed;
        }),
      );
      return { ...track, clips: newClips };
    }),
  );
  return { ...comp, tracks: newTracks };
}
