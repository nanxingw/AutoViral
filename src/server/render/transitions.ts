// R46 — Cinematic transition POC inspired by hyperframes' shader-
// transitions package (`packages/shader-transitions/`).
//
// ## What's shipped
//
// One transition: light-leak cross-fade. ffmpeg-only — no GLSL compiler
// needed. Builds a filter graph:
//
//   [input A] [input B] [light-leak overlay PNG]
//   → xfade=transition=fade,duration=N
//   → blend with light-leak overlay using mode=screen
//
// The light-leak overlay is a procedurally generated bright spot that
// wipes across the screen during the transition window, giving the
// "vintage film burn" aesthetic that's been viral on editorial reels.
//
// ## What's NOT shipped (deliberate POC scope)
//
// hyperframes ships 5+ transitions: domain-warp, glitch-cut, gravita-
// tional-lens, light-leak, and a few more. Each is a custom GLSL
// shader rendered in WebGL during their Chromium screenshot phase. To
// port the shader-based ones we'd either:
//   - Ship them as Remotion components (use @remotion/shapes + canvas)
//   - Or pre-render the transition as an ffmpeg filter complex
//     (limited; only fade-style approximations work without WebGL)
//
// Light-leak is the easy first one because it can be expressed as
// pure ffmpeg blending — no shader compilation or WebGL needed. The
// rest are TODOs documented at the bottom of this file.

import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export interface TransitionInput {
  /** Path to the outgoing video clip. */
  clipA: string;
  /** Path to the incoming video clip. */
  clipB: string;
  /** Output path for the resulting concatenated video with transition. */
  outputPath: string;
  /** Length of clip A in seconds. Transition starts at clipADuration - transitionDuration. */
  clipADuration: number;
  /** How long the transition itself runs (typically 0.5-1.5s). */
  transitionDuration: number;
  /** Output dimensions. */
  width: number;
  height: number;
  /** Output fps. */
  fps: number;
}

/**
 * Light-leak cross-fade. The B clip fades in while a bright orange
 * "leak" sweeps across the frame, masking the transition seam. Looks
 * like a film burn / lens flare. Very common in viral editorial cuts.
 *
 * Implementation strategy:
 *   1. Generate a 1080x1920 light-leak PNG into a temp file (gradient
 *      with hot center). Done once per output.
 *   2. ffmpeg filter_complex:
 *        [0]xfade=fade=duration=N:offset=M[v01];
 *        [v01][2:v]overlay=enable='between(t,M,M+N)':...,blend=screen[out]
 *   3. Mux audio from clip A + B (xfade also handles audio crossfade
 *      via afade chained off the same offset).
 *
 * Returns the output path on success.
 */
export async function applyLightLeakTransition(
  opts: TransitionInput,
): Promise<string> {
  const { clipA, clipB, outputPath, clipADuration, transitionDuration, width, height } = opts;
  const offsetSec = clipADuration - transitionDuration;

  // 1. Generate the light-leak overlay PNG (or reuse a cached one).
  const overlayPath = await ensureLightLeakOverlay(width, height);

  // 2. Build the filter graph. Three inputs:
  //    [0] clipA video, [1] clipB video, [2] static overlay image
  //    Outputs: [v] mixed video, [a] crossfaded audio
  const filterComplex = [
    // xfade transition between the two videos with a `fade` curve.
    `[0:v][1:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offsetSec}[xfaded]`,
    // Bring the overlay image up to fps + RGBA so blend can read its alpha.
    `[2:v]format=rgba,fps=${opts.fps}[ovl]`,
    // Animate the overlay's horizontal position so it sweeps from left to
    // right through the transition window. We use overlay's `x` expression
    // with `enable='between(t,offset,offset+duration)'`.
    `[xfaded][ovl]overlay=x='if(between(t,${offsetSec},${offsetSec + transitionDuration}),(t-${offsetSec})/${transitionDuration}*(W-w)*1.5-w*0.25,NAN)':y=0:enable='between(t,${offsetSec},${offsetSec + transitionDuration})':format=auto[v]`,
    // Audio: simple crossfade aligned with video xfade.
    `[0:a][1:a]acrossfade=d=${transitionDuration}[a]`,
  ].join(";");

  await mkdir(dirname(outputPath), { recursive: true });
  const args = [
    "-y", "-loglevel", "error",
    "-i", clipA,
    "-i", clipB,
    "-loop", "1", "-i", overlayPath,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`light-leak transition: ffmpeg exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
}

// ── Light-leak overlay generation ───────────────────────────────────

let cachedOverlay: { path: string; width: number; height: number } | null = null;

/**
 * Ensure a light-leak overlay PNG exists at the right size, returning
 * its path. Cached per-process — overlay is deterministic so we don't
 * regenerate on every transition.
 *
 * The overlay is a 1080x1920 (or arbitrary) RGBA image with:
 *   - Mostly-transparent background (alpha = 0)
 *   - A bright orange/yellow vertical streak ~30% width centered
 *   - Soft falloff at edges
 *
 * We generate it via ffmpeg's lavfi `color` + gradient filter rather
 * than shipping a binary PNG asset. Keeps the codebase self-contained.
 */
export async function ensureLightLeakOverlay(width: number, height: number): Promise<string> {
  if (cachedOverlay && cachedOverlay.width === width && cachedOverlay.height === height) {
    return cachedOverlay.path;
  }
  const tmp = join(tmpdir(), `autoviral-light-leak-${width}x${height}.png`);
  // ffmpeg's gradient filter: source=gradient, c0=orange, c1=transparent.
  // We use 1px source then scale, since gradient resolves better that way.
  // The streak is built from a `radialgradient` source (added in ffmpeg 5+)
  // — for compatibility we instead synthesize via two-color gradient + crop.
  const args = [
    "-y", "-loglevel", "error",
    "-f", "lavfi",
    // Source: 1xH vertical gradient (light orange in the middle, transparent edges).
    "-i",
    `gradient=size=${Math.round(width * 0.4)}x${height}:c0=0xff8c1a:c1=0x00000000:duration=1:rate=1`,
    // Scale with smooth alpha to full width, transparent everywhere except the streak.
    "-vf",
    `pad=width=${width}:height=${height}:x=(${width}-iw)/2:y=0:color=0x00000000,format=rgba`,
    "-frames:v", "1",
    tmp,
  ];
  await new Promise<void>((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ensureLightLeakOverlay: ffmpeg exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
  cachedOverlay = { path: tmp, width, height };
  return tmp;
}

/** Test-only — clears the cached overlay path. */
export function _resetLightLeakCacheForTests(): void {
  cachedOverlay = null;
}

// ── Filter graph helper (testable) ──────────────────────────────────

/**
 * Pure-function filter graph builder. Exposed so unit tests can assert
 * on the graph string without spawning ffmpeg.
 */
export function buildLightLeakFilterGraph(opts: {
  clipADuration: number;
  transitionDuration: number;
  fps: number;
}): string {
  const offsetSec = opts.clipADuration - opts.transitionDuration;
  return [
    `[0:v][1:v]xfade=transition=fade:duration=${opts.transitionDuration}:offset=${offsetSec}[xfaded]`,
    `[2:v]format=rgba,fps=${opts.fps}[ovl]`,
    `[xfaded][ovl]overlay=x='if(between(t,${offsetSec},${offsetSec + opts.transitionDuration}),(t-${offsetSec})/${opts.transitionDuration}*(W-w)*1.5-w*0.25,NAN)':y=0:enable='between(t,${offsetSec},${offsetSec + opts.transitionDuration})':format=auto[v]`,
    `[0:a][1:a]acrossfade=d=${opts.transitionDuration}[a]`,
  ].join(";");
}

// ─── Roadmap (additional transitions worth porting) ─────────────────
//
// hyperframes packages/shader-transitions/ ships these GLSL shaders.
// To port any of them we'd convert them to one of:
//   (a) Remotion canvas component — runs in headless Chromium during
//       Stage 1 frame loop. Requires the streaming-render path (R46
//       opt #3.a-c) for performance.
//   (b) ffmpeg filter graph — limited to what `xfade=transition=...`
//       and `geq=` expressions can express. Some shaders don't survive
//       the translation (gravitational-lens needs proper sampling).
//
// ### TODO #5.a — Glitch cut (RGB channel split + horizontal jitter)
//   Mirror: hyperframes shader-transitions/glitch.glsl
//   Approach (b) feasible: ffmpeg geq + chromakey. ~1 day work.
//
// ### TODO #5.b — Domain warp (sinusoidal pixel offset)
//   Mirror: hyperframes shader-transitions/domain-warp.glsl
//   Approach (b) feasible via ffmpeg geq, but nicer in Remotion canvas.
//   ~2 days.
//
// ### TODO #5.c — Gravitational lens (radial distortion)
//   Mirror: hyperframes shader-transitions/grav-lens.glsl
//   Approach (a) only — needs proper texture sampling. Wait for
//   streaming-render path. ~3 days when it's there.
//
// Total POC delivered (light-leak): ~1 transition.
// Total ported when all TODOs land: ~4-5 transitions.
// hyperframes ships ~6, with their custom WebGL renderer.
