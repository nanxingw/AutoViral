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
import { FFMPEG_BIN } from "../ffmpeg-paths.js";

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
    const ff = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
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
  // R46 #5 — use `color` (solid black source) + `geq` (per-pixel
  // expression) to synthesize the orange streak with smooth alpha
  // falloff. The `gradient` filter doesn't exist in ffmpeg 8.x; geq is
  // universally available since ffmpeg 4.0.
  //
  // Streak shape (in normalized X coordinates 0..1):
  //   - Centered around X=0.5
  //   - Peak alpha ~180 (out of 255) at center
  //   - Quadratic falloff to 0 alpha at X=0.35 and X=0.65
  //   - Outside [0.35, 0.65]: fully transparent
  //
  // Color is hex 0xff8c1a (warm orange / sunset). Pre-multiplied with
  // alpha so the screen-blend looks bright but not posterized.
  const streakLeft = 0.35;
  const streakRight = 0.65;
  const peakAlpha = 180;
  const args = [
    "-y", "-loglevel", "error",
    "-f", "lavfi",
    "-i", `color=c=black@0:size=${width}x${height}:duration=1:rate=1`,
    "-vf",
    [
      "format=rgba",
      // geq runs per-pixel. X/W is the normalized horizontal position.
      // The alpha expression evaluates to 0 outside the streak window
      // and to peakAlpha * (1 - (2*offsetFromCenter / streakWidth)^2)
      // inside it — a smooth bump centered at W/2.
      `geq=` +
        `r='255':` +
        `g='140':` +
        `b='26':` +
        `a='if(between(X/W,${streakLeft},${streakRight}),` +
        `${peakAlpha}*(1-pow(2*(X/W-0.5)/${streakRight - streakLeft},2)),` +
        `0)'`,
    ].join(","),
    "-frames:v", "1",
    tmp,
  ];
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
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

// ── Glitch-cut transition ───────────────────────────────────────────

/**
 * Glitch-cut: during the transition window we crossfade A→B while
 * applying RGB channel-split + horizontal jitter, mimicking VHS / data-
 * mosh aesthetic. Pure ffmpeg — uses `geq` for per-channel offset.
 *
 * NOTE re: ffmpeg 8.x — geq's random() lookup is non-deterministic
 * across frames; we substitute a periodic `sin(t*200)*15` jitter that
 * still reads as "glitch" without flicker artefacts.
 */
export async function applyGlitchCutTransition(
  opts: TransitionInput,
): Promise<string> {
  const { clipA, clipB, outputPath, transitionDuration } = opts;
  const filterComplex = buildGlitchCutFilterGraph({
    clipADuration: opts.clipADuration,
    transitionDuration,
    fps: opts.fps,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  const args = [
    "-y", "-loglevel", "error",
    "-i", clipA,
    "-i", clipB,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`glitch-cut transition: ffmpeg exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
}

/** Pure-function filter-graph builder for the glitch-cut transition. */
export function buildGlitchCutFilterGraph(opts: {
  clipADuration: number;
  transitionDuration: number;
  fps: number;
}): string {
  const offsetSec = opts.clipADuration - opts.transitionDuration;
  const endSec = offsetSec + opts.transitionDuration;
  // Per-channel horizontal offset using sin() so it's deterministic
  // and bounded. Red shifts +, blue shifts −, green stays put. Outside
  // the transition window the offset is 0 so the frame is untouched.
  const rOff = `if(between(t,${offsetSec},${endSec}),sin(t*200)*15,0)`;
  const bOff = `if(between(t,${offsetSec},${endSec}),-sin(t*200)*15,0)`;
  return [
    `[0:v][1:v]xfade=transition=fade:duration=${opts.transitionDuration}:offset=${offsetSec}[xfaded]`,
    `[xfaded]format=rgba,fps=${opts.fps}[base]`,
    `[base]geq=` +
      `r='p(X+(${rOff}),Y)':` +
      `g='p(X,Y)':` +
      `b='p(X+(${bOff}),Y)':` +
      `a='alpha(X,Y)'[v]`,
    `[0:a][1:a]acrossfade=d=${opts.transitionDuration}[a]`,
  ].join(";");
}

// ── Domain-warp transition ──────────────────────────────────────────

/**
 * Domain-warp: during the transition window pixels are displaced by a
 * vertical sine wave whose amplitude ramps from 0 → 40 px and back as
 * the transition progresses. Combined with xfade=fade, B emerges
 * through the rippling A frame. Pure ffmpeg `geq`.
 */
export async function applyDomainWarpTransition(
  opts: TransitionInput,
): Promise<string> {
  const { clipA, clipB, outputPath, transitionDuration } = opts;
  const filterComplex = buildDomainWarpFilterGraph({
    clipADuration: opts.clipADuration,
    transitionDuration,
    fps: opts.fps,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  const args = [
    "-y", "-loglevel", "error",
    "-i", clipA,
    "-i", clipB,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`domain-warp transition: ffmpeg exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
}

/** Pure-function filter-graph builder for the domain-warp transition. */
export function buildDomainWarpFilterGraph(opts: {
  clipADuration: number;
  transitionDuration: number;
  fps: number;
}): string {
  const offsetSec = opts.clipADuration - opts.transitionDuration;
  const endSec = offsetSec + opts.transitionDuration;
  // Amplitude ramps in and out across the transition window. Outside
  // the window it's zero so frames pass through unchanged.
  const xOff =
    `if(between(t,${offsetSec},${endSec}),` +
    `sin(Y/30+t*8)*40*((t-${offsetSec})/${opts.transitionDuration}),0)`;
  return [
    `[0:v][1:v]xfade=transition=fade:duration=${opts.transitionDuration}:offset=${offsetSec}[xfaded]`,
    `[xfaded]format=rgba,fps=${opts.fps}[base]`,
    `[base]geq=` +
      `r='p(X+(${xOff}),Y)':` +
      `g='p(X+(${xOff}),Y)':` +
      `b='p(X+(${xOff}),Y)':` +
      `a='alpha(X,Y)'[v]`,
    `[0:a][1:a]acrossfade=d=${opts.transitionDuration}[a]`,
  ].join(";");
}

// ── Gravitational-lens transition ───────────────────────────────────

/**
 * Gravitational-lens: radial barrel/pincushion distortion ramps up on
 * A and down on B during the transition window, simulating a black-hole
 * "swallowing" A while B is "pulled out" of the same point. Uses
 * ffmpeg's `lenscorrection` filter with time-varying k1.
 */
export async function applyGravLensTransition(
  opts: TransitionInput,
): Promise<string> {
  const { clipA, clipB, outputPath, transitionDuration } = opts;
  const filterComplex = buildGravLensFilterGraph({
    clipADuration: opts.clipADuration,
    transitionDuration,
    fps: opts.fps,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  const args = [
    "-y", "-loglevel", "error",
    "-i", clipA,
    "-i", clipB,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`grav-lens transition: ffmpeg exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
}

/** Pure-function filter-graph builder for the grav-lens transition. */
export function buildGravLensFilterGraph(opts: {
  clipADuration: number;
  transitionDuration: number;
  fps: number;
}): string {
  const offsetSec = opts.clipADuration - opts.transitionDuration;
  const endSec = offsetSec + opts.transitionDuration;
  // A ramps from k1=0 → k1=-0.5 (barrel inward) across the window.
  // B starts at k1=+0.5 (pincushion) and ramps back to 0.
  const aK1 = `if(between(t,${offsetSec},${endSec}),-0.5*((t-${offsetSec})/${opts.transitionDuration}),0)`;
  const bK1 = `if(between(t,${offsetSec},${endSec}),0.5*(1-((t-${offsetSec})/${opts.transitionDuration})),0)`;
  return [
    `[0:v]lenscorrection=k1='${aK1}':k2=0[a_dist]`,
    `[1:v]lenscorrection=k1='${bK1}':k2=0[b_dist]`,
    `[a_dist][b_dist]xfade=transition=fade:duration=${opts.transitionDuration}:offset=${offsetSec}[v]`,
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
// ### #5.a — Glitch cut (RGB channel split + horizontal jitter)
//   DONE in R46 #5 follow-up (see applyGlitchCutTransition).
//
// ### #5.b — Domain warp (sinusoidal pixel offset)
//   DONE in R46 #5 follow-up (see applyDomainWarpTransition).
//
// ### #5.c — Gravitational lens (radial distortion)
//   DONE in R46 #5 follow-up (see applyGravLensTransition). ffmpeg
//   `lenscorrection` filter approximates the WebGL shader closely
//   enough for the editorial use-case; Remotion port still possible
//   when streaming-render path lands.
//
// Total POC delivered (light-leak + glitch + domain-warp + grav-lens):
// 4 transitions. hyperframes ships ~6 with their custom WebGL renderer.
