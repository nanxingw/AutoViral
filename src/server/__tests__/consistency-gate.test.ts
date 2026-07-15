// PRD-0014 S16 — 预览=导出一致性回归 gate (WYSIWYG 机器化验收) — tests.
//
// THREE layers, from cheap-always-on to heavy-gated:
//
//   (1) 证红/证绿 — pure comparator self-tests (no ffmpeg / no Chromium).
//       Hand-built raw RGB buffers prove the tolerance model: identical +
//       codec-noise → GREEN; a 回退-1× magnitude divergence → RED (the teeth).
//       These run on EVERY `test:server`, so the gate's discrimination is always
//       verified even where the heavy binaries are absent.
//
//   (2) real-pixel teeth (ffmpeg-gated) — the SAME teeth with genuine ffmpeg
//       PNGs: two frames of a moving `testsrc2` at DIFFERENT source-times (the
//       preview-frame vs a 1×-fallback export-frame) → RED, while a double
//       re-encode of ONE frame (pure codec noise) → GREEN. This is the faithful
//       model of the S4 "回退 1×" bug (a WRONG-FRAME selection, see
//       consistency-gate.ts header for why a mocked-identity pre-pass would NOT
//       reproduce it — pre-passes are WYSIWYG-by-construction dual-consumed).
//
//   (3) the FULL gate (RUN_CONSISTENCY_GATE=1 + ffmpeg) — 7 fixture classes
//       rendered through BOTH the Remotion still (A / preview) AND the complete
//       export pipeline (B, incl. pre-passes) → same frame extracted → compared.
//       Heavy (Remotion bundle + headless Chromium + ffmpeg per fixture) so it is
//       env-gated to keep CI fast; a capable runner opts in.
//
// Discipline: execFile-probe the binaries (never guess by path — S1 lesson);
// serve fixture srcs + pre-pass cache mp4s over a localhost FS server so headless
// Chromium can fetch them exactly as the daemon would.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompositionSchema, type Composition } from "../../shared/composition.js";
import { timeWarpVideoFilterChain } from "../transforms-ffmpeg.js";
import { FFMPEG_BIN } from "../ffmpeg-paths.js";
import { spawnSync } from "node:child_process";
import {
  compareRawFrames,
  ffmpegAvailable,
  makeSrc,
  extractFramePng,
  decodeToRaw,
  startFsServer,
  checkConsistency,
  type RawFrame,
  type ServedRoot,
} from "./consistency-gate.js";

const RUN_FULL = process.env.RUN_CONSISTENCY_GATE === "1";
const FF = ffmpegAvailable();

// ── raw-buffer helpers for the pure self-tests ────────────────────────────────

function solidRaw(w: number, h: number, rgb: [number, number, number]): RawFrame {
  const buf = Buffer.alloc(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    buf[p * 3] = rgb[0];
    buf[p * 3 + 1] = rgb[1];
    buf[p * 3 + 2] = rgb[2];
  }
  return { buf, width: w, height: h, channels: 3 };
}

/** Add ±`amp` per-channel jitter to every pixel — models h264/yuv codec noise. */
function withNoise(f: RawFrame, amp: number): RawFrame {
  const buf = Buffer.from(f.buf);
  for (let i = 0; i < buf.length; i++) {
    const jitter = ((i * 2654435761) % (2 * amp + 1)) - amp; // deterministic
    buf[i] = Math.max(0, Math.min(255, buf[i] + jitter));
  }
  return { ...f, buf };
}

/** Overwrite a rectangular region with a different color — models a WRONG-FRAME
 *  (a big chunk of the picture is genuinely different, as a 回退-1× would be). */
function paintRegion(
  f: RawFrame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): RawFrame {
  const buf = Buffer.from(f.buf);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * f.width + x) * 3;
      buf[i] = rgb[0];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[2];
    }
  }
  return { ...f, buf };
}

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — pure comparator self-tests (ALWAYS RUN: 证红 + 证绿)
// ════════════════════════════════════════════════════════════════════════════

describe("consistency gate — comparator (证红/证绿, no binaries)", () => {
  const W = 128;
  const H = 128;
  const base = solidRaw(W, H, [90, 122, 138]); // non-primary steel

  it("GREEN: identical frames match", () => {
    const d = compareRawFrames(base, base);
    expect(d.matched).toBe(true);
    expect(d.meanDelta).toBe(0);
    expect(d.changedPct).toBe(0);
  });

  it("GREEN: codec-noise (±4/channel) is under the noise floor → match", () => {
    const noisy = withNoise(base, 4);
    const d = compareRawFrames(base, noisy);
    // meanΔ small, few/no pixels exceed perChannelNoiseTol(14) → matched.
    expect(d.matched).toBe(true);
    expect(d.meanDelta).toBeLessThanOrEqual(4);
  });

  it("RED (teeth): a 回退-1× magnitude divergence (quarter-frame repainted) → MISMATCH", () => {
    // A wrong source frame changes a large fraction of pixels by a lot. Repaint
    // the top-left quadrant (25% of pixels) to a very different color.
    const wrong = paintRegion(base, 0, 0, W / 2, H / 2, [240, 40, 30]);
    const d = compareRawFrames(base, wrong);
    expect(d.matched).toBe(false); // the gate has teeth
    expect(d.changedPct).toBeGreaterThan(20);
  });

  it("RED (teeth): a uniform whole-frame shift beyond the noise floor → MISMATCH", () => {
    const shifted = solidRaw(W, H, [90 + 30, 122 + 30, 138 + 30]);
    const d = compareRawFrames(base, shifted);
    expect(d.matched).toBe(false);
    expect(d.meanDelta).toBeGreaterThan(4);
  });

  it("does not silently pass a mismatch as a rounding fluke (meanΔ gate is real)", () => {
    // Exactly at the edge: +5/channel everywhere. maxMeanDelta default is 4, so
    // meanΔ=5 must FAIL — a codec floor set this high would hide a real shift.
    const edge = solidRaw(W, H, [90 + 5, 122 + 5, 138 + 5]);
    const d = compareRawFrames(edge, base, { perChannelNoiseTol: 14 });
    expect(d.meanDelta).toBeCloseTo(5, 5);
    expect(d.matched).toBe(false);
  });

  // S16 review fix (finding #6) — the double-threshold BLIND SPOT + its closer.
  // A LOCALIZED corrupt patch (≈5% of pixels each off by Δ60) slips under BOTH
  // primary gates: meanΔ ≈ 0.05×60 = 3 ≤ 4, and changedPct ≈ 5% ≤ 6%. Without a
  // third gate the frame would MATCH despite a visible garbage region. The hard
  // gate (pixels with |Δ|>48 capped at 1%) catches it.
  it("RED (finding #6 blind spot): localized 5% × Δ60 patch — passes BOTH primary gates but the hard gate catches it", () => {
    // 5% of 128×128 = 819 pixels. A 29×29 block ≈ 841 px ≈ 5.1%. Off by +60/ch.
    const patch = paintRegion(base, 0, 0, 29, 29, [90 + 60, 122 + 60, 138 + 60]);
    const d = compareRawFrames(base, patch);
    // The two ORIGINAL gates BOTH pass — this is exactly the calibration hole.
    expect(d.meanDelta, `meanΔ should be under the primary gate: ${d.reason}`).toBeLessThanOrEqual(4);
    expect(d.changedPct, `changedPct should be under the primary gate: ${d.reason}`).toBeLessThanOrEqual(6);
    // …yet the frame is NOT matched, because the hard gate (>1% of pixels beyond
    // Δ48) fires on the corrupt patch. The blind spot is closed.
    expect(d.hardPct).toBeGreaterThan(1);
    expect(d.matched, `blind-spot patch must be caught by the hard gate: ${d.reason}`).toBe(false);
  });

  it("GREEN (finding #6 calibration): a sub-1% hard sliver (codec edge) still matches", () => {
    // ~0.88% of pixels off by Δ60 (12×12 = 144 / 16384): under the 1% hard cap
    // AND the primary gates → the hard gate must NOT over-fire on a tiny sliver.
    const sliver = paintRegion(base, 0, 0, 12, 12, [90 + 60, 122 + 60, 138 + 60]);
    const d = compareRawFrames(base, sliver);
    expect(d.hardPct).toBeLessThanOrEqual(1);
    expect(d.matched, `a sub-1% hard sliver must still match: ${d.reason}`).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — real-pixel teeth (ffmpeg-gated): the faithful "回退 1×" model
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(!FF)("consistency gate — real-pixel teeth (ffmpeg)", () => {
  let dir: string;
  const W = 256;
  const H = 256;
  const FPS = 30;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "av-cgate-teeth-"));
  }, 30_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("RED: preview frame (source t=2N) vs 1×-fallback export frame (source t=N) diverge", async () => {
    // A moving pattern: frame n differs from frame m. The S4 bug: preview plays
    // 2× so at timeline-frame N it shows SOURCE frame 2N; the broken export fell
    // back to 1× so it shows SOURCE frame N. Those are different pictures.
    const src = await makeSrc(join(dir, "moving.mp4"), {
      seconds: 4,
      fps: FPS,
      size: `${W}x${H}`,
      testsrc: true,
    });
    const previewPng = join(dir, "preview.png"); // what 2× preview shows
    const brokenPng = join(dir, "broken.png"); // what 1× fallback exports
    await extractFramePng(src, 30, previewPng); // source frame 2N (N=15)
    await extractFramePng(src, 15, brokenPng); // source frame N
    const a = await decodeToRaw(previewPng, W, H);
    const b = await decodeToRaw(brokenPng, W, H);
    const d = compareRawFrames(a, b);
    expect(d.matched).toBe(false); // gate catches the 回退-1× divergence
    expect(d.changedPct).toBeGreaterThan(5);
  }, 60_000);

  it("GREEN: the SAME source frame, re-encoded twice (pure codec noise) → match", async () => {
    const src = await makeSrc(join(dir, "moving2.mp4"), {
      seconds: 2,
      fps: FPS,
      size: `${W}x${H}`,
      testsrc: true,
    });
    const p1 = join(dir, "same-a.png");
    const p2 = join(dir, "same-b.png");
    await extractFramePng(src, 20, p1);
    await extractFramePng(src, 20, p2);
    const a = await decodeToRaw(p1, W, H);
    const b = await decodeToRaw(p2, W, H);
    const d = compareRawFrames(a, b);
    expect(d.matched).toBe(true); // codec noise must NOT trip the gate
  }, 60_000);

  // S16 review fix (finding #2) — an EXPLICIT "inject the old 1× fallback" self-
  // check on the CLOCK source (each frame a distinct flat colour). The 2×-ramped
  // preview at timeline-frame 15 shows source frame ≈30; a broken export that
  // fell back to 1× shows source frame 15 — a DIFFERENT flat colour. The gate
  // MUST go RED. (Companion GREEN case: honoring 2× → same frame → match.) On the
  // old flat baseSrc this divergence was invisible; the clock gives it teeth.
  it("RED: injected 1× fallback (source t=15) ≠ honored-2× preview (source t=30) [speed self-check]", async () => {
    const src = await makeSrc(join(dir, "clock-spd.mp4"), {
      seconds: 3,
      fps: FPS,
      size: `${W}x${H}`,
      clock: true,
    });
    const previewPng = join(dir, "spd-preview.png"); // 2×: timeline 15 → source 30
    const fallbackPng = join(dir, "spd-fallback.png"); // 1× bug: source 15
    await extractFramePng(src, 30, previewPng);
    await extractFramePng(src, 15, fallbackPng);
    const a = await decodeToRaw(previewPng, W, H);
    const b = await decodeToRaw(fallbackPng, W, H);
    const d = compareRawFrames(a, b);
    expect(d.matched, `1× fallback should MISMATCH the 2× preview: ${d.reason}`).toBe(false);
    // A honored 2× export shows the SAME source frame (30) → the gate stays GREEN.
    const honored = compareRawFrames(a, a);
    expect(honored.matched).toBe(true);
  }, 60_000);

  // S16 review fix (finding #4) — reverse is EXPORT-ONLY, so it can't be A(preview)
  // -vs-B(export) checked (preview plays forward by design). Instead verify the
  // REAL reverse builder (timeWarpVideoFilterChain) genuinely REVERSES time-
  // varying material: run the exact ffmpeg -vf the export prepass emits on a clock
  // source, then assert the reversed output's frame k equals SOURCE frame (last-k)
  // — NOT source frame k. On a flat colour倒放 is a visual no-op (every frame the
  // same), so this could never prove the pass ran; the clock makes each frame a
  // distinct colour so a no-op / wrong-frame reverse is a hard mismatch.
  it("reverse builder genuinely time-reverses (clock): reversed[k] == source[last-k], != source[k]", async () => {
    const N = 30; // frames 0..29 over 1s
    const src = await makeSrc(join(dir, "clock-rev.mp4"), {
      seconds: 1,
      fps: FPS,
      size: `${W}x${H}`,
      clock: true,
    });
    // The EXACT video chain the export prepass builds for a whole-span reverse.
    const vChain = timeWarpVideoFilterChain(
      { reverse: true, inSec: 0, outSec: 1 },
      FPS,
      1,
    );
    expect(vChain).toContain("reverse"); // sanity: the builder emits a reverse
    const reversed = join(dir, "clock-reversed.mp4");
    const r = spawnSync(FFMPEG_BIN, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", src,
      "-vf", vChain,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "1",
      reversed,
    ]);
    expect(r.status, `ffmpeg reverse failed: ${r.stderr?.toString()}`).toBe(0);
    const k = 5;
    const kPng = join(dir, "rev-k.png");
    await extractFramePng(reversed, k, kPng);
    const revK = await decodeToRaw(kPng, W, H);
    // reversed[5] must equal SOURCE frame (29-5)=24 (real time-reversal)…
    const src24Png = join(dir, "src-24.png");
    await extractFramePng(src, N - 1 - k, src24Png);
    const srcLastMinusK = await decodeToRaw(src24Png, W, H);
    expect(
      compareRawFrames(revK, srcLastMinusK).matched,
      "reversed[5] should equal source[24] (genuine time-reversal)",
    ).toBe(true);
    // …and must NOT equal source frame 5 (which is what a no-op / forward pass
    // would leave). A distinct clock colour makes this a hard mismatch.
    const src5Png = join(dir, "src-5.png");
    await extractFramePng(src, k, src5Png);
    const srcK = await decodeToRaw(src5Png, W, H);
    expect(
      compareRawFrames(revK, srcK).matched,
      "reversed[5] must NOT equal source[5] — proves the reverse actually ran",
    ).toBe(false);
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — the FULL gate: 7 fixture classes, A (still) vs B (export) per-pixel
// (RUN_CONSISTENCY_GATE=1 + ffmpeg + headless Chromium)
// ════════════════════════════════════════════════════════════════════════════

const W = 256;
const H = 256;
const FPS = 30;
const DUR = 2; // seconds → 60 frames

function baseComp(): Composition {
  return {
    id: "c",
    workId: "cgate",
    fps: FPS,
    width: W,
    height: H,
    duration: DUR,
    aspect: "1:1",
    updatedAt: "2026-07-14T00:00:00Z",
    tracks: [],
    assets: [],
    provenance: [],
    exportPresets: [],
    title: "consistency-gate",
  } as unknown as Composition;
}

function videoTrack(id: string, order: number, clips: unknown[]): unknown {
  // Phase D (#31) — track ids MUST start with `trk_`.
  const trkId = id.startsWith("trk_") ? id : `trk_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  return {
    id: trkId,
    kind: "video",
    label: id,
    muted: false,
    hidden: false,
    volume: 1,
    displayOrder: order,
    clips,
  };
}

function fullFrameClip(id: string, src: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    kind: "video",
    src,
    in: 0,
    out: DUR,
    trackOffset: 0,
    ...extra,
  };
}

// S16 review fix (finding #5) — an `adjustment` lane holds a pure effect window
// (no media). Track kind + clip kind are both "adjustment".
function adjustmentTrack(id: string, order: number, effects: unknown[], blendMode?: string): unknown {
  const trkId = id.startsWith("trk_") ? id : `trk_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  return {
    id: trkId,
    kind: "adjustment",
    label: id,
    muted: false,
    hidden: false,
    volume: 1,
    displayOrder: order,
    clips: [
      {
        id: `${id}-adj`,
        kind: "adjustment",
        trackOffset: 0,
        duration: DUR,
        effects,
        ...(blendMode ? { blendMode } : {}),
      },
    ],
  };
}

/**
 * Run a hand-built fixture through the REAL schema so every renderer-expected
 * field (transforms / filters / fitMode …) gets its production default — the
 * renderer reads `clip.transforms.scale` and crashes on a raw object. Parsing
 * here also proves each fixture is a LEGAL composition (refine passes).
 */
function build(c: Composition): Composition {
  return CompositionSchema.parse(c) as unknown as Composition;
}

describe.skipIf(!RUN_FULL || !FF)(
  "consistency gate — FULL A(still)-vs-B(export) [RUN_CONSISTENCY_GATE=1]",
  () => {
    let dir: string;
    let server: ServedRoot;
    let baseSrc: string; // steel — background / base layer
    let topSrc: string; // amber — feature layer
    let movingSrc: string; // clock — TIME-VARYING (each frame a distinct flat colour)

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "av-cgate-full-"));
      server = await startFsServer();
      process.env.AUTOVIRAL_PORT = String(server.port);
      // Non-primary colors survive yuv420p with a small round-trip error.
      baseSrc = await makeSrc(join(dir, "base.mp4"), {
        seconds: DUR + 2,
        fps: FPS,
        size: `${W}x${H}`,
        color: "0x5a7a8a",
      });
      topSrc = await makeSrc(join(dir, "top.mp4"), {
        seconds: DUR + 2,
        fps: FPS,
        size: `${W}x${H}`,
        color: "0xc08040",
      });
      // A TIME-VARYING source so speed / freeze fixtures have TEETH: a flat
      // colour makes every source frame identical, so a 回退-1× (speed) or a
      // hold-wrong-frame / blank freeze would still match a flat baseline — the
      // fixture would have no bite. This "clock" makes each source frame a
      // DISTINCT flat colour, so picking the WRONG source instant is a real pixel
      // divergence (large meanΔ). It is spatially FLAT (unlike testsrc2's hard
      // edges) so the export's extra h264 encode adds only ~1-code chroma noise,
      // not the ~9% edge churn testsrc2 produces — the teeth without the false
      // secondary-gate trips (S16 review findings #2/#3/#6).
      movingSrc = await makeSrc(join(dir, "moving.mp4"), {
        seconds: DUR + 2,
        fps: FPS,
        size: `${W}x${H}`,
        clock: true,
      });
    }, 120_000);

    afterAll(async () => {
      if (server) await server.close();
      // eslint-disable-next-line no-console
      console.log("[gate] dir:", dir);
      if (dir && !process.env.CGATE_KEEP) await rm(dir, { recursive: true, force: true });
      delete process.env.AUTOVIRAL_PORT;
    });

    // Each fixture builds a composition, picks a compare frame, and asserts
    // A(preview still) == B(export frame) within the codec-noise tolerance.

    it("① transitionIn (S3): cross-dissolve entrance matches on export", async () => {
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-base", 0, [fullFrameClip("base", baseSrc)]),
        videoTrack("t-top", 1, [
          fullFrameClip("top", topSrc, {
            transitionIn: { preset: "cross-dissolve", durationSec: 0.6 },
          }),
        ]),
      ] as never;
      // 0.6s dissolve = 18 frames; compare mid-dissolve (frame 9).
      const d = await checkConsistency({ comp: build(comp), frame: 9, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] transitionIn:", d.reason);
      expect(d.matched, `transitionIn mismatch — 入场转场预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("② multi-value speed (S4): variable speed baked matches preview", async () => {
      // Uses the TIME-VARYING clock source (not a flat colour): a 回退-1× (the S4
      // bug — export ignoring the speed ramp and playing at 1×) would show a
      // DIFFERENT source instant than the 2×-ramped preview, i.e. a distinct flat
      // colour → large meanΔ. On the old flat baseSrc a 1× fallback matched the
      // preview trivially (every frame the same colour) — the fixture had no bite.
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-spd", 0, [
          fullFrameClip("spd", movingSrc, {
            keyframes: [
              { property: "speed", time: 0, value: 1, easing: "linear" },
              { property: "speed", time: 1, value: 2, easing: "linear" },
            ],
          }),
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 15, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] speed:", d.reason);
      expect(d.matched, `speed mismatch — 变速预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("③ mask (S13): ellipse + feather matches on export", async () => {
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-base", 0, [fullFrameClip("base", baseSrc)]),
        videoTrack("t-mask", 1, [
          fullFrameClip("masked", topSrc, {
            mask: {
              type: "ellipse",
              feather: 0.15,
              rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
            },
          }),
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 20, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] mask:", d.reason);
      expect(d.matched, `mask mismatch — 蒙版预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("④ blend (S14): screen blend of overlay matches on export", async () => {
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-base", 0, [fullFrameClip("base", baseSrc)]),
        videoTrack("t-top", 1, [
          fullFrameClip("top", topSrc, { blendMode: "screen" }),
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 20, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] blend:", d.reason);
      expect(d.matched, `blend mismatch — 混合模式预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("⑤ effects stack (S14): ORDERED grade→vignette stack matches on export", async () => {
      // S16 review fix (finding #5) — exercise a TWO-effect ORDERED stack (not a
      // lone grade): grade(brightness+) THEN vignette. Both effects are consumed
      // as CSS by the SAME Remotion tree in preview + export (WYSIWYG by
      // construction), so A must equal B — this proves the ordered stack (grade
      // filter wrapper + vignette overlay-on-top) renders identically through the
      // full export pipeline, not just the single-grade path. (Order-observability
      // — that reversing the two changes the pixels — is DOM-unit-tested in
      // VideoTrackRenderer.effects.test.tsx "cross-type reorder changes NESTING".)
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-fx", 0, [
          fullFrameClip("fx", baseSrc, {
            effects: [
              {
                id: "e1",
                type: "grade",
                params: { brightness: 0.35, contrast: 0.15, saturation: 0 },
                enabled: true,
              },
              {
                id: "e2",
                type: "vignette",
                params: { strength: 0.5 },
                enabled: true,
              },
            ],
          }),
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 20, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] effects:", d.reason);
      expect(d.matched, `effects mismatch — 效果栈预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("⑧ adjustment lane (S14): ordered grade→vignette adjustment window matches on export", async () => {
      // S16 review fix (finding #5) — the FULL gate never drove the `adjustment`
      // lane kind. An adjustment clip is a pure effect window applied over the
      // tracks below it (here a steel base), carrying its OWN ordered effect stack
      // (grade → vignette). Consumed identically in preview + export (single
      // Remotion tree), so A must equal B — this guards against a future export
      // regression that drops or reorders the adjustment lane.
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-base", 0, [fullFrameClip("base", baseSrc)]),
        adjustmentTrack("t-adj", 1, [
          {
            id: "ae1",
            type: "grade",
            params: { brightness: 0.3, contrast: 0.1, saturation: 0 },
            enabled: true,
          },
          {
            id: "ae2",
            type: "vignette",
            params: { strength: 0.45 },
            enabled: true,
          },
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 20, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] adjustment:", d.reason);
      expect(d.matched, `adjustment mismatch — 调整层预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("⑥ freeze (存量高危): held frame stays consistent PAST the freeze instant", async () => {
      // The WYSIWYG contract for freeze: at EVERY frame of the clip the preview
      // and the export show the SAME held source frame — not just at the freeze
      // instant. We therefore compare at frame 30 (a full second PAST the 0.5s
      // freeze point) on a TIME-VARYING source (movingSrc), where a wrong-frame
      // hold or a blank still is a large pixel divergence.
      //
      // HISTORY (S16 review finding #3): the original fixture compared at frame 0
      // (the freeze instant) to stay green, MASKING a real crack the gate had
      // found — the headless Remotion still (A path == `autoviral snapshot`) went
      // BLACK past the freeze instant because the freeze was implemented as a
      // 1-frame startFrom/endAt trim window, which <OffthreadVideo> cannot hold
      // across a longer <Sequence> (past endAt it decodes no frame → black),
      // while the export bakes a frozen MP4 (ffmpeg trim+tpad) that holds for the
      // whole clip. The fix wraps the freeze body in Remotion's <Freeze> so the
      // preview/still HOLDS the frozen source frame for the entire clip — WYSIWYG
      // at every frame. This fixture now asserts that at the honest frame 30.
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-frz", 0, [
          fullFrameClip("frz", movingSrc, { freezeAtSec: 0.5 }),
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 30, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] freeze:", d.reason);
      expect(d.matched, `freeze mismatch — 定格预览≠导出(frame 30): ${d.reason}`).toBe(true);
    }, 240_000);

    it("⑦ reverse (存量高危, export-only): ONLY the preview-only badge diverges; the frame is otherwise consistent", async () => {
      // reverse is EXPORT-ONLY: the preview plays forward and stamps an EXPLICIT
      // "倒放 · 仅导出生效" badge (top-left) telling the user reverse only takes
      // effect on export; the export prepass STRIPS `reverse` (bakes it into the
      // source MP4) so the exported frames carry NO badge. So preview≠export BY
      // DESIGN — but the ONLY licensed divergence is that badge.
      //
      // S16 review fix (findings #4/#6) — the old fixture used a flat colour and a
      // loose gate, so it (a) hid any reversed-content drift behind an invariant
      // colour and (b) tolerated the badge under the 6% changedPct gate. The new
      // hard gate exposed the badge as a real localized divergence. We now assert
      // the HONEST contract: (1) EXCLUDING the badge rect the frame MATCHES (the
      // reversed flat content is WYSIWYG-consistent), and (2) the badge rect
      // GENUINELY diverges (the preview-only warning is really there, not faked).
      // Reverse取帧 fidelity on TIME-VARYING material is proven separately by the
      // ffmpeg reverse-builder self-check above (finding #4).
      const BADGE = { x: 0, y: 0, w: 200, h: 56 }; // generous top-left badge box
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-rev", 0, [fullFrameClip("rev", baseSrc, { reverse: true })]),
      ] as never;
      const res = await checkConsistency({
        comp: build(comp),
        frame: 20,
        outDir: dir,
        tol: { ignoreRect: BADGE },
      });
      // eslint-disable-next-line no-console
      console.log("[gate] reverse (badge-excluded):", res.reason);
      expect(
        res.matched,
        `reverse mismatch OUTSIDE the badge — 倒放正片区漂移: ${res.reason}`,
      ).toBe(true);
      // (2) The badge region is GENUINELY preview-only — a full compare (no
      // exclusion) MUST diverge, and the divergence must be LOCALIZED (hard gate
      // fires, i.e. the badge is a real dark box, not diffuse noise).
      const a = await decodeToRaw(res.previewPng, W, H);
      const b = await decodeToRaw(res.exportPng, W, H);
      const full = compareRawFrames(a, b);
      // eslint-disable-next-line no-console
      console.log("[gate] reverse (full, badge visible):", full.reason);
      expect(full.matched, "reverse full-frame should diverge (badge is preview-only)").toBe(false);
      expect(full.hardPct, "the badge is a localized hard divergence").toBeGreaterThan(1);
    }, 240_000);
  },
);
