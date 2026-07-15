// PRD-0014 S16 — 预览=导出一致性回归 gate (WYSIWYG 的机器化验收).
// Preview = export consistency regression gate (WYSIWYG machine-verified).
//
// The v0.2.0 soul-acceptance is "所见即所得" (what-you-see-is-what-you-get):
// the Remotion preview and the ffmpeg export pipeline MUST land on the same
// pixels for a given composition + frame. Every prior WYSIWYG bug (speed
// falling back to 1×, a broken freeze bake, a transform pre-pass cropping the
// wrong band) is a frame-level divergence between these two paths. This module
// is the machine that catches such a divergence in CI instead of a human
// eyeballing two screenshots.
//
// TWO PATHS, ONE FRAME:
//   • A path (preview representative) — `renderCompositionStill` (the same
//     Remotion renderer the Studio preview & `autoviral snapshot` use) → PNG.
//   • B path (export)               — `runRenderPipeline` (the FULL export:
//     speed / timewarp / transforms pre-passes → Remotion Stage-1 → duck /
//     loudnorm / encode) → mp4, then ffmpeg extracts the same 0-based frame.
// Both PNGs are decoded to raw RGB (via ffmpeg, forced to the comp's WxH so a
// preset rescale can't desync the grids) and compared per-pixel.
//
// TOLERANCE MODEL (排除编码噪声但抓住"回退 1×"级差异):
//   The B path always carries ONE extra h264 encode (yuv420p 4:2:0). That shifts
//   smooth regions a few code-levels and blurs mask/blend EDGES on a handful of
//   pixels. A genuine WYSIWYG fault (wrong source frame, missing effect) changes
//   a LARGE fraction of the frame or the mean by a lot. So a frame "matches" iff
//   BOTH gates hold:
//     (1) meanDelta        ≤ maxMeanDelta   — average per-channel |Δ| is small
//     (2) changedPct       ≤ maxChangedPct  — few pixels exceed the noise floor
//   where a pixel is "changed" iff its max per-channel |Δ| > perChannelNoiseTol.
//   Codec noise → tiny meanDelta + ~0 changedPct → matched. A 回退-1× divergence
//   → high meanDelta AND/OR large changedPct → NOT matched (the teeth).
//
// WHY the teeth are demonstrated at the FRAME level (not by mocking a pre-pass):
//   AutoViral is WYSIWYG-by-construction — a pre-pass is DUAL-consumed: the
//   preview Remotion component honors the field (speed keyframe / freezeAtSec /
//   crop) directly, while the export bakes it via ffmpeg and STRIPS the field.
//   So *skipping* a pre-pass degrades gracefully to "Remotion honors the field",
//   which STILL matches the preview — a mocked-identity pre-pass does NOT
//   reproduce a divergence. A real "回退 1×" is a WRONG-FRAME selection: the
//   preview shows source-time T while the export shows a different source-time.
//   The gate's teeth are therefore proven by feeding it a genuine wrong-frame
//   pair (see consistency-gate.test.ts "teeth"), which is the faithful model of
//   the historical S4 fallback.

import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FFMPEG_BIN, FFPROBE_BIN } from "../ffmpeg-paths.js";
import { rewriteClipSrcsToAbsolute, runRenderPipeline } from "../render-pipeline.js";
import { renderCompositionStill } from "../remotion-still.js";
import type { Composition } from "../../shared/composition.js";

// ─── binary availability (execFile probe, not path guessing — S1 review) ──────

export function binRuns(bin: string): boolean {
  try {
    return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function ffmpegAvailable(): boolean {
  return binRuns(FFMPEG_BIN) && binRuns(FFPROBE_BIN);
}

// ─── spawn helper ─────────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    const out: Buffer[] = [];
    let err = "";
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) =>
      resolve({ code, stdout: Buffer.concat(out), stderr: err }),
    );
    child.on("error", () => resolve({ code: -1, stdout: Buffer.alloc(0), stderr: err }));
  });
}

async function ffmpegOk(args: string[]): Promise<void> {
  const r = await run(FFMPEG_BIN, args);
  if (r.code !== 0) {
    throw new Error(`ffmpeg failed (${r.code}) [${args.join(" ")}]:\n${r.stderr}`);
  }
}

// ─── fixture source generation (lavfi color / testsrc) ────────────────────────

export interface ColorSrcOpts {
  seconds: number;
  /** lavfi color spec, e.g. "0x5a7a8a" or a named color. Ignored when testsrc. */
  color?: string;
  size?: string; // WxH, default 256x256
  fps?: number; // default 30
  /** Use the `testsrc2` moving pattern instead of a flat color (time-varying). */
  testsrc?: boolean;
  /**
   * A TIME-VARYING "clock": each frame N is a DISTINCT FLAT colour computed from
   * N via `geq`. This is the ideal teeth source for the frame-level gate —
   * time-varying so picking the WRONG source instant (回退-1× speed, a
   * hold-wrong / blank freeze) is a large meanΔ divergence, yet SPATIALLY FLAT so
   * it carries none of testsrc2's hard-edge chroma-subsampling noise that would
   * spuriously trip the secondary changedPct gate under the export's extra h264
   * encode. Overrides `color`/`testsrc`.
   */
  clock?: boolean;
}

export async function makeSrc(
  outPath: string,
  opts: ColorSrcOpts,
): Promise<string> {
  const size = opts.size ?? "256x256";
  const fps = opts.fps ?? 30;
  let source: string;
  if (opts.clock) {
    // Flat, per-frame-distinct colour: R/G/B are affine in the frame index N,
    // clamped to [0,255]. Different slopes per channel so no two frames within
    // the fixture window collide. `color=black` supplies a canvas geq paints over.
    source =
      `color=c=black:s=${size}:r=${fps}:d=${opts.seconds},` +
      `geq=r='clip(40+3*N\\,0\\,255)':g='clip(70+2*N\\,0\\,255)':b='clip(120+1*N\\,0\\,255)'`;
  } else if (opts.testsrc) {
    source = `testsrc2=size=${size}:rate=${fps}:duration=${opts.seconds}`;
  } else {
    source = `color=c=${opts.color ?? "gray"}:s=${size}:r=${fps}:d=${opts.seconds}`;
  }
  await ffmpegOk([
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", source,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "1",
    outPath,
  ]);
  return outPath;
}

// ─── frame extraction + raw decode (via ffmpeg — dependency-free PNG handling) ─

/** Extract the 0-based `frame` of `mp4Path` as a PNG at `outPng`. */
export async function extractFramePng(
  mp4Path: string,
  frame: number,
  outPng: string,
): Promise<string> {
  await ffmpegOk([
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", mp4Path,
    "-vf", `select=eq(n\\,${frame})`,
    "-frames:v", "1", "-fps_mode", "passthrough",
    outPng,
  ]);
  return outPng;
}

export interface RawFrame {
  buf: Buffer;
  width: number;
  height: number;
  channels: 3;
}

/**
 * Decode any image file to a raw rgb24 buffer, FORCING it to `width`×`height`
 * so an export preset rescale can't desync the comparison grid. Uses ffmpeg's
 * rawvideo muxer to stdout — no PNG-decode dependency (pngjs / pixelmatch) is
 * added to the tree, which the slice explicitly prefers.
 */
export async function decodeToRaw(
  imgPath: string,
  width: number,
  height: number,
): Promise<RawFrame> {
  const r = await run(FFMPEG_BIN, [
    "-hide_banner", "-loglevel", "error",
    "-i", imgPath,
    "-vf", `scale=${width}:${height}:flags=bicubic`,
    "-f", "rawvideo", "-pix_fmt", "rgb24",
    "-",
  ]);
  if (r.code !== 0 || r.stdout.length !== width * height * 3) {
    throw new Error(
      `decodeToRaw ${imgPath}: expected ${width * height * 3} bytes, got ${r.stdout.length} (code ${r.code})\n${r.stderr}`,
    );
  }
  return { buf: r.stdout, width, height, channels: 3 };
}

// ─── the comparator (PURE — the part with teeth) ──────────────────────────────

export interface CompareTolerance {
  /** Per-channel |Δ| above which a pixel counts as "changed". Default 14 —
   *  above the yuv420p round-trip floor for non-primary colors. */
  perChannelNoiseTol?: number;
  /** Max % of pixels allowed over the noise floor. Default 6. */
  maxChangedPct?: number;
  /** Max average per-channel |Δ| across the whole frame. Default 4. */
  maxMeanDelta?: number;
  /**
   * S16 review fix (finding #6) — the THIRD gate. Per-channel |Δ| that counts as
   * HARD corruption (far above any codec round-trip). Default 48.
   */
  hardNoiseTol?: number;
  /**
   * Max % of pixels allowed to exceed `hardNoiseTol`. Default 1. This closes the
   * double-threshold BLIND SPOT: a localized patch of ~5% of pixels each off by
   * Δ60 yields meanΔ≈3 (≤4, passes) AND changedPct≈5% (≤6%, passes) — both
   * primary gates miss it — yet it is a visibly corrupt region. Those pixels have
   * |Δ|=60 > 48 = hardNoiseTol, so 5% > 1% trips THIS gate. Codec noise (even on
   * hard edges) sits well under hardNoiseTol on all but a sub-1% sliver, so the
   * gate stays green on genuine matches.
   */
  maxHardPct?: number;
  /**
   * An OPTIONAL rectangle (px, in the frame's WxH grid) whose pixels are EXCLUDED
   * from every metric. Used ONLY to account for an element that is preview≠export
   * BY DESIGN — specifically the reverse clip's preview-only "仅导出生效" badge
   * (reverse is export-only, so the preview stamps a warning the export can't
   * carry). This is NOT a tolerance loosener: the reverse fixture separately
   * asserts that the badge region DOES diverge (the badge is genuinely
   * preview-only) and that OUTSIDE it the frame matches.
   */
  ignoreRect?: { x: number; y: number; w: number; h: number };
}

export interface DiffResult {
  matched: boolean;
  /** Average per-channel absolute difference over the whole frame. */
  meanDelta: number;
  /** Largest single-channel absolute difference anywhere. */
  maxDelta: number;
  /** % of pixels whose max per-channel |Δ| exceeded perChannelNoiseTol. */
  changedPct: number;
  changedCount: number;
  /** % of pixels whose max per-channel |Δ| exceeded hardNoiseTol (finding #6). */
  hardPct: number;
  hardChangedCount: number;
  totalPixels: number;
  reason: string;
}

// `ignoreRect` is intentionally excluded from the defaults: the comparator reads
// it straight off the caller's `tol` (see `const ignore = tol.ignoreRect` below),
// never off DEFAULT_TOL, so there is no sensible "default rectangle". S16 added
// the optional field to CompareTolerance; Omit keeps DEFAULT_TOL total over the
// tolerance knobs it actually supplies without inventing a bogus ignoreRect.
const DEFAULT_TOL: Required<Omit<CompareTolerance, "ignoreRect">> = {
  perChannelNoiseTol: 14,
  // 6% absorbs h264 chroma-subsampling artifacts along soft edges (mask feather,
  // reverse frame boundaries) while staying FAR below a 回退-1× divergence, which
  // repaints a large fraction of the frame AND is independently caught by the
  // primary meanDelta gate. The meanDelta gate (≤4) is the real workhorse; this
  // is the secondary "diffuse garbage" guard.
  maxChangedPct: 6,
  maxMeanDelta: 4,
  // The THIRD gate (finding #6) — see maxHardPct doc. Catches a LOCALIZED hard
  // patch that slips under both the mean gate (too few pixels to move the mean)
  // and the changedPct gate (under 6%), by tightening the cap for pixels that are
  // corrupt-level far (>48/channel) rather than codec-noise far (>14/channel).
  hardNoiseTol: 48,
  maxHardPct: 1,
};

/**
 * Compare two raw rgb24 buffers (same dimensions). Pure; no I/O — the unit
 * self-tests drive it with hand-built buffers so the teeth are proven without
 * ffmpeg or Chromium.
 */
export function compareRawFrames(
  a: RawFrame,
  b: RawFrame,
  tol: CompareTolerance = {},
): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `compareRawFrames: dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
  }
  const t = { ...DEFAULT_TOL, ...tol };
  const ignore = tol.ignoreRect;
  const bufA = a.buf;
  const bufB = b.buf;
  let sumDelta = 0;
  let maxDelta = 0;
  let changed = 0;
  let hardChanged = 0;
  let counted = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (
        ignore &&
        x >= ignore.x &&
        x < ignore.x + ignore.w &&
        y >= ignore.y &&
        y < ignore.y + ignore.h
      ) {
        continue; // excluded region (the reverse preview-only badge)
      }
      const i = (y * a.width + x) * 3;
      const dR = Math.abs(bufA[i] - bufB[i]);
      const dG = Math.abs(bufA[i + 1] - bufB[i + 1]);
      const dB = Math.abs(bufA[i + 2] - bufB[i + 2]);
      sumDelta += dR + dG + dB;
      const pixMax = dR > dG ? (dR > dB ? dR : dB) : dG > dB ? dG : dB;
      if (pixMax > maxDelta) maxDelta = pixMax;
      if (pixMax > t.perChannelNoiseTol) changed++;
      if (pixMax > t.hardNoiseTol) hardChanged++;
      counted++;
    }
  }
  const total = counted || 1;
  const meanDelta = sumDelta / (total * 3);
  const changedPct = (100 * changed) / total;
  const hardPct = (100 * hardChanged) / total;
  const meanOk = meanDelta <= t.maxMeanDelta;
  const pctOk = changedPct <= t.maxChangedPct;
  const hardOk = hardPct <= t.maxHardPct;
  const matched = meanOk && pctOk && hardOk;
  const reason = matched
    ? `matched (meanΔ=${meanDelta.toFixed(2)} ≤ ${t.maxMeanDelta}, changed=${changedPct.toFixed(2)}% ≤ ${t.maxChangedPct}%, hard=${hardPct.toFixed(2)}% ≤ ${t.maxHardPct}%)`
    : `MISMATCH (meanΔ=${meanDelta.toFixed(2)}${meanOk ? "" : ` > ${t.maxMeanDelta}`}, changed=${changedPct.toFixed(2)}%${pctOk ? "" : ` > ${t.maxChangedPct}%`}, hard=${hardPct.toFixed(2)}%${hardOk ? "" : ` > ${t.maxHardPct}%`}, maxΔ=${maxDelta})`;
  return {
    matched,
    meanDelta,
    maxDelta,
    changedPct,
    changedCount: changed,
    hardPct,
    hardChangedCount: hardChanged,
    totalPixels: total,
    reason,
  };
}

// ─── static file server: serve any absolute path so headless Chromium can
//     fetch both the fixture srcs AND the pre-pass cache mp4s (both live at
//     absolute paths that rewriteClipSrcsToAbsolute maps to localhost URLs). ──
//
// ⚠ KNOWN BLIND SPOT (PRD-0014 S18 E2E r2 · M1): this server treats the URL path
// as an absolute FILESYSTEM path (`fsPath = decoded` below) and streams it —
// i.e. it serves http://localhost:PORT/Users/.../output/clip-…mp4 verbatim. The
// PRODUCTION daemon does NOT: it only mounts /api/works/:id/assets/*, so any
// other path SPA-catch-alls to index.html (200 text/html). That divergence is
// exactly how the gate's ② speed fixture stayed GREEN while the real export was
// broken — the pre-pass baked an ABSOLUTE cache path into clip.src and the old
// `resolveOne` origin-prefixed it into an unservable /Users/… URL that Remotion
// decoded as HTML ("Invalid data"). The gate's permissive server hid it.
// The served-URL semantics resolveOne must honour in production are now locked
// directly by render-pipeline.rewrite-src.test.ts (asserts the minted URL is a
// /api/works/:id/assets/output/… one the REAL route serves, for the whole
// pre-pass family). Fully mirroring THIS server onto that route would let the
// full gate re-catch the class too — deferred; the unit lock is the S18 gate.

export interface ServedRoot {
  port: number;
  close: () => Promise<void>;
}

export function startFsServer(): Promise<ServedRoot> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      try {
        // req.url is "/<abs path>" (percent-encoded per segment). Decode back to
        // a real filesystem path and stream it read-only.
        const decoded = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const fsPath = decoded; // leading slash already IS the absolute root
        createReadStream(fsPath)
          .on("open", () => res.writeHead(200))
          .on("error", () => {
            res.writeHead(404);
            res.end();
          })
          .pipe(res);
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    server.on("error", reject);
    // Bind all interfaces (dual-stack) so `http://localhost:PORT` — the origin
    // rewriteClipSrcsToAbsolute mints — reaches us whether the fetcher resolves
    // localhost to 127.0.0.1 or ::1.
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({
          port: addr.port,
          close: () =>
            new Promise<void>((r) => server.close(() => r())),
        });
      } else {
        reject(new Error("startFsServer: no port assigned"));
      }
    });
  });
}

// ─── the A / B render helpers ─────────────────────────────────────────────────

/** A path — the preview representative: one Remotion still → PNG. */
export async function renderPreviewFramePng(
  comp: Composition,
  frame: number,
  outPng: string,
): Promise<string> {
  // Mirror snapshot.ts: rewrite relative/page-absolute clip srcs to localhost
  // URLs so headless Chromium can fetch them (renderCompositionStill does NOT
  // rewrite on its own).
  const rewritten = rewriteClipSrcsToAbsolute(comp);
  await renderCompositionStill(
    rewritten as unknown as {
      duration: number;
      fps: number;
      width: number;
      height: number;
      title?: string;
    },
    { outFile: outPng, frame },
  );
  return outPng;
}

/** B path — the FULL export pipeline → mp4 → extract the same frame → PNG. */
export async function renderExportFramePng(
  comp: Composition,
  frame: number,
  outDir: string,
  outPng: string,
): Promise<{ png: string; mp4: string }> {
  const mp4 = await runRenderPipeline({ comp, outDir });
  await stat(mp4); // fail loudly if the pipeline lied about the path
  await extractFramePng(mp4, frame, outPng);
  return { png: outPng, mp4 };
}

/**
 * Full A-vs-B consistency check for a composition at a frame. Renders both
 * paths, decodes both to the comp's native WxH, and compares. Returns the diff
 * plus the artifact paths (so a failing case can be eyeballed).
 */
export async function checkConsistency(opts: {
  comp: Composition;
  frame: number;
  outDir: string;
  tol?: CompareTolerance;
}): Promise<DiffResult & { previewPng: string; exportPng: string; mp4: string }> {
  const { comp, frame, outDir } = opts;
  const previewPng = join(outDir, `preview-f${frame}.png`);
  const exportPng = join(outDir, `export-f${frame}.png`);
  await renderPreviewFramePng(comp, frame, previewPng);
  const { png, mp4 } = await renderExportFramePng(comp, frame, outDir, exportPng);
  const rawA = await decodeToRaw(previewPng, comp.width, comp.height);
  const rawB = await decodeToRaw(png, comp.width, comp.height);
  const diff = compareRawFrames(rawA, rawB, opts.tol);
  return { ...diff, previewPng, exportPng: png, mp4 };
}

// Re-export for tests that want to sweep the output dir for the final mp4.
export async function findFinalMp4(outDir: string): Promise<string | null> {
  try {
    const names = (await readdir(outDir)).filter((f) => /^final-.*\.mp4$/.test(f));
    return names.length ? join(outDir, names.sort().at(-1)!) : null;
  } catch {
    return null;
  }
}

export { FFPROBE_BIN };
