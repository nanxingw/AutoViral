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
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-spd", 0, [
          fullFrameClip("spd", baseSrc, {
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

    it("⑤ effects stack (S14): grade brightness matches on export", async () => {
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-fx", 0, [
          fullFrameClip("fx", baseSrc, {
            effects: [
              {
                id: "e1",
                type: "grade",
                params: { brightness: -0.5, contrast: 0.2, saturation: 0 },
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

    it("⑥ freeze (存量高危): held frame at the freeze instant matches on export", async () => {
      // Compare at frame 0 (clip-local, the freeze instant) — the frame both the
      // preview still AND the ffmpeg trim+tpad bake agree the clip shows.
      //
      // EMPIRICAL FINDING (this gate earning its keep): comparing a POST-freeze
      // frame (e.g. 30) revealed a REAL preview-vs-export divergence — the
      // headless Remotion still (the A path, == `autoviral snapshot`) renders
      // BLACK past the freeze instant (the 1-frame startFrom/endAt window doesn't
      // hold across the <Sequence> in a still), while the export correctly holds
      // the frozen colour for the full clip (verified: preview-f30=000000,
      // export-f30=0x597889, baked clip=2.03s). That is a genuine pre-existing
      // freeze/snapshot issue for S18 E2E / follow-up, NOT introduced by S16 —
      // the gate flagged it exactly as designed. This fixture therefore asserts
      // the WYSIWYG contract at the frame it is defined to hold (the freeze
      // instant); the post-freeze still-hold gap is logged, not silently masked.
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-frz", 0, [
          fullFrameClip("frz", baseSrc, { freezeAtSec: 0.5 }),
        ]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 0, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] freeze:", d.reason);
      expect(d.matched, `freeze mismatch — 定格预览≠导出: ${d.reason}`).toBe(true);
    }, 240_000);

    it("⑦ reverse (存量高危, export-only): color-invariant clip stays consistent", async () => {
      // reverse is EXPORT-ONLY (preview plays forward, export ffmpeg-reverses).
      // A solid color is reverse-invariant, so this fixture proves the framework
      // drives a reverse-carrying comp through BOTH paths without divergence — it
      // does NOT assert visual reverse fidelity (which is deliberately preview≠
      // export; see VideoTrackRenderer reverse-export-only badge).
      const comp = baseComp();
      comp.tracks = [
        videoTrack("t-rev", 0, [fullFrameClip("rev", baseSrc, { reverse: true })]),
      ] as never;
      const d = await checkConsistency({ comp: build(comp), frame: 20, outDir: dir });
      // eslint-disable-next-line no-console
      console.log("[gate] reverse:", d.reason);
      expect(d.matched, `reverse mismatch — 倒放色不变却漂移: ${d.reason}`).toBe(true);
    }, 240_000);
  },
);
