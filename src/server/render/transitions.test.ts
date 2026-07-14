import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildLightLeakFilterGraph,
  buildGlitchCutFilterGraph,
  buildDomainWarpFilterGraph,
  buildGravLensFilterGraph,
  applyLightLeakTransition,
  applyGlitchCutTransition,
  applyDomainWarpTransition,
  applyGravLensTransition,
  _resetLightLeakCacheForTests,
} from "./transitions.js";
import { FFMPEG_BIN, FFPROBE_BIN } from "../ffmpeg-paths.js";

// We don't spawn ffmpeg in unit tests — the filter-graph builder is a
// pure function so we can assert on its output string. Integration with
// real ffmpeg lives in the S1 describe block at the bottom of this file
// (skipped when the managed ffmpeg binary is unavailable).

describe("buildLightLeakFilterGraph", () => {
  it("includes xfade with the right offset (clipA duration - transitionDuration)", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    // Transition starts at offset = 5 - 1 = 4.
    expect(g).toContain("xfade=transition=fade:duration=1:offset=4");
  });

  it("light-leak overlay is gated by enable='between(t,offset,offset+duration)'", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 4,
      transitionDuration: 0.8,
      fps: 30,
    });
    // NB: overlay/enable use lowercase `t` (the overlay filter's time var);
    // this is correct — only the `geq` filter demands uppercase `T`.
    expect(g).toContain("enable='between(t,3.2,4)'");
  });

  it("audio crossfades with same duration as video transition", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1.5,
      fps: 30,
    });
    expect(g).toContain("[0:a][1:a]acrossfade=d=1.5[a]");
  });

  it("overlay is brought up to target fps in RGBA so blend reads alpha", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 60,
    });
    expect(g).toContain("format=rgba,fps=60");
  });

  it("graph is a single-line semicolon-joined filter chain (ffmpeg requirement)", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    // No newlines (would break -filter_complex).
    expect(g).not.toContain("\n");
    // Has the expected number of filter steps (4: xfade, format, overlay, acrossfade).
    const steps = g.split(";");
    expect(steps).toHaveLength(4);
  });

  it("output stream labels are stable: video=[v], audio=[a]", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 3,
      transitionDuration: 0.5,
      fps: 30,
    });
    // Final video step ends with [v] (the -map [v] target).
    expect(g).toContain("format=auto[v]");
    expect(g).toContain("acrossfade=d=0.5[a]");
  });
});

describe("buildGlitchCutFilterGraph", () => {
  it("includes xfade=transition=fade with offset=clipADuration-transitionDuration", () => {
    const g = buildGlitchCutFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).toContain("xfade=transition=fade:duration=1:offset=4");
  });

  it("audio crossfades across the same window as the video transition", () => {
    const g = buildGlitchCutFilterGraph({
      clipADuration: 6,
      transitionDuration: 0.75,
      fps: 30,
    });
    expect(g).toContain("acrossfade=d=0.75");
  });

  it("uses geq for per-channel RGB jitter and is single-line", () => {
    const g = buildGlitchCutFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).not.toContain("\n");
    expect(g).toContain("geq=");
    // R/B channels get equal-and-opposite jitter; G untouched. geq's time
    // variable is uppercase T (lowercase t is undefined and aborts init).
    expect(g).toContain("sin(T*200)*15");
    expect(g).toContain("-sin(T*200)*15");
  });
});

describe("buildDomainWarpFilterGraph", () => {
  it("includes xfade=transition=fade with offset=clipADuration-transitionDuration", () => {
    const g = buildDomainWarpFilterGraph({
      clipADuration: 4,
      transitionDuration: 1.5,
      fps: 30,
    });
    expect(g).toContain("xfade=transition=fade:duration=1.5:offset=2.5");
  });

  it("audio crossfades with same duration", () => {
    const g = buildDomainWarpFilterGraph({
      clipADuration: 5,
      transitionDuration: 0.6,
      fps: 30,
    });
    expect(g).toContain("acrossfade=d=0.6");
  });

  it("warps via sinusoidal X offset that ramps with progress", () => {
    const g = buildDomainWarpFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 60,
    });
    expect(g).not.toContain("\n");
    // geq time variable is uppercase T.
    expect(g).toContain("sin(Y/30+T*8)*40");
    // Ramp factor (T-offset)/duration must reference the offset (4) and duration (1).
    expect(g).toContain("(T-4)/1");
  });
});

describe("buildGravLensFilterGraph", () => {
  it("includes xfade=transition=fade with offset=clipADuration-transitionDuration", () => {
    const g = buildGravLensFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).toContain("xfade=transition=fade:duration=1:offset=4");
  });

  it("audio crossfades with same duration", () => {
    const g = buildGravLensFilterGraph({
      clipADuration: 7,
      transitionDuration: 1.2,
      fps: 30,
    });
    expect(g).toContain("acrossfade=d=1.2");
  });

  it("applies a time-animated geq radial distortion to both A and B", () => {
    const g = buildGravLensFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).not.toContain("\n");
    // The old approach stuffed a time expression into lenscorrection's
    // static <double> k1 option, which ffmpeg rejects. The ramp now rides
    // a geq expression (the only per-frame-evaluable option here).
    expect(g).not.toContain("lenscorrection");
    expect(g).toContain("[0:v]");
    expect(g).toContain("[1:v]");
    expect(g).toContain("geq=");
    expect(g).toContain("-0.5"); // A ramps inward
    expect(g).toContain("0.5"); // B ramps back out
  });
});

// ── S1 regression: the three geq/lenscorrection defects that aborted
// filter-graph init on real ffmpeg. Pure-string assertions, no spawn. ──

describe("S1 · cinematic filtergraphs are ffmpeg-valid", () => {
  const cases = [
    ["glitch", buildGlitchCutFilterGraph],
    ["domain-warp", buildDomainWarpFilterGraph],
    ["grav-lens", buildGravLensFilterGraph],
  ] as const;

  for (const [name, build] of cases) {
    it(`${name}: uses geq's uppercase T, never lowercase between(t,`, () => {
      const g = build({ clipADuration: 5, transitionDuration: 1, fps: 30 });
      expect(g).not.toContain("between(t,");
      expect(g).toContain("between(T,");
    });

    it(`${name}: does not call the invalid alpha(X,Y) function`, () => {
      const g = build({ clipADuration: 5, transitionDuration: 1, fps: 30 });
      expect(g).not.toContain("alpha(X,Y)");
    });
  }
});

// ── S1 integration: render each of the four endpoints against two solid
// color clips and assert ffmpeg exits 0 with the expected output length.
// Skipped (not failed) when the managed ffmpeg/ffprobe binaries are
// unavailable — CI without a media toolchain must stay green. ──

const ffmpegAvailable = existsSync(FFMPEG_BIN) && existsSync(FFPROBE_BIN);
const integrationIt = ffmpegAvailable ? it : it.skip;
const efp = promisify(execFile);

describe("S1 · four cinematic endpoints render on real color clips", () => {
  let dir = "";
  let clipA = "";
  let clipB = "";

  async function genColorClip(out: string, color: string): Promise<void> {
    await efp(FFMPEG_BIN, [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${color}:size=320x240:duration=2:rate=30`,
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      out,
    ]);
  }

  async function probeDuration(f: string): Promise<number> {
    const { stdout } = await efp(FFPROBE_BIN, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      f,
    ]);
    return parseFloat(stdout.trim());
  }

  beforeAll(async () => {
    if (!ffmpegAvailable) return;
    dir = await mkdtemp(join(tmpdir(), "autoviral-tx-smoke-"));
    clipA = join(dir, "a.mp4");
    clipB = join(dir, "b.mp4");
    await genColorClip(clipA, "red");
    await genColorClip(clipB, "blue");
    _resetLightLeakCacheForTests();
  }, 60_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const endpoints = [
    ["light-leak", applyLightLeakTransition],
    ["glitch", applyGlitchCutTransition],
    ["domain-warp", applyDomainWarpTransition],
    ["grav-lens", applyGravLensTransition],
  ] as const;

  for (const [name, apply] of endpoints) {
    integrationIt(
      `${name} renders exit 0 with a ~3.2s product`,
      async () => {
        const out = join(dir, `out-${name}.mp4`);
        // clipA=2s, clipB=2s, transition=0.8s → timeline = (2-0.8)+2 = 3.2s.
        await apply({
          clipA,
          clipB,
          outputPath: out,
          clipADuration: 2,
          transitionDuration: 0.8,
          width: 320,
          height: 240,
          fps: 30,
        });
        expect(existsSync(out)).toBe(true);
        const dur = await probeDuration(out);
        expect(Number.isFinite(dur)).toBe(true);
        expect(Math.abs(dur - 3.2)).toBeLessThan(0.2);
      },
      60_000,
    );
  }
});
