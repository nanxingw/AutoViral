import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
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
import { renderRouter } from "../routes/render.js";
import { withTempDataDir, jsonReq } from "../__tests__/_helpers.js";

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

  it("ramps B's distortion over B-LOCAL time [0,duration], not A's absolute window", () => {
    // S1 review fix. B (`[1:v]`) is a standalone clip whose geq runs BEFORE
    // xfade on B-local time, where 0 == the start of the transition. Gating
    // B's ramp on A's absolute [offsetSec,endSec] window (the old bug) means
    // B is undistorted during the whole cut and warped mid-playback after.
    // clipADuration=5, transitionDuration=1 → A window [4,5], B window [0,1].
    const g = buildGravLensFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    // Isolate per-input branches by marker (can't split on ";" — the geq
    // st()/ld() expressions contain their own ";" separators). A branch runs
    // from "[0:v]" to "[1:v]"; B branch from "[1:v]" to the xfade join.
    const aBranch = g.slice(g.indexOf("[0:v]"), g.indexOf("[1:v]"));
    const bBranch = g.slice(g.indexOf("[1:v]"), g.indexOf("[a_dist][b_dist]"));
    // A ramps over its absolute window [4,5].
    expect(aBranch).toContain("between(T,4,5)");
    // B ramps over B-local [0,1] — the transition as B experiences it.
    expect(bBranch).toContain("between(T,0,1)");
    // The regression: B must NOT be gated on A's absolute window.
    expect(bBranch).not.toContain("between(T,4,5)");
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
// color clips and assert ffmpeg exits 0, the product has the right frame
// count, and no frame is black/corrupt. Skipped (not failed) when the
// ffmpeg/ffprobe binaries can't run — CI without a media toolchain stays
// green. ──

const efp = promisify(execFile);

/**
 * S1 review fix #4 — the old gate was `existsSync(FFMPEG_BIN)`. But
 * FFMPEG_BIN can be a BARE command name ("ffmpeg") — the documented
 * last-resort tier in ffmpeg-paths.ts / deps.ts when neither a managed nor
 * vendored binary is present. `existsSync("ffmpeg")` is `false` for a bare
 * name even when ffmpeg is perfectly runnable on PATH, so the whole
 * integration suite silently *skips* and the file reports green without
 * having rendered anything. Probing via execFile resolves PATH and only
 * treats an actual ENOENT (binary genuinely missing) as unavailable.
 */
function binaryRunnable(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
    return true; // spawned and exited 0
  } catch (err) {
    // ENOENT = binary genuinely missing → unavailable (the only legitimate
    // skip reason). Any OTHER failure (e.g. the binary ran but rejected the
    // `-version` flag with a non-zero exit) still proves it is present and
    // spawnable, so it counts as available.
    return (err as NodeJS.ErrnoException)?.code !== "ENOENT";
  }
}

const ffmpegAvailable = binaryRunnable(FFMPEG_BIN) && binaryRunnable(FFPROBE_BIN);
const integrationIt = ffmpegAvailable ? it : it.skip;

describe("S1 · ffmpeg availability is probed, not existsSync'd", () => {
  it("binaryRunnable resolves PATH-based bare names that existsSync misses", () => {
    // `node` is guaranteed runnable (the test runner IS node) and lives on
    // PATH, but a bare "node" is NOT a file in cwd — so the OLD existsSync
    // gate would report it "unavailable" and skip. The execFile probe gets
    // it right. This is exactly the false-skip the old gate caused whenever
    // FFMPEG_BIN fell through to the bare-name PATH tier.
    expect(existsSync("node")).toBe(false);
    expect(binaryRunnable("node")).toBe(true);
    // A genuinely missing binary (ENOENT) is the only legitimate skip reason.
    expect(binaryRunnable("autoviral-definitely-not-a-real-binary-xyz")).toBe(false);
  });
});

// ── Shared render fixtures/helpers for the integration + route suites. ──

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

/** Static high-contrast checkerboard — structured so radial distortion is
 *  visible frame-to-frame (a solid color would hide any warp). */
async function genCheckerClip(out: string): Promise<void> {
  await efp(FFMPEG_BIN, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=30",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    // Commas inside geq are escaped (\,) so ffmpeg's filtergraph parser
    // doesn't mis-split them as filter separators.
    "-vf", "geq=lum='if(gt(mod(floor(X/16)+floor(Y/16)\\,2)\\,0)\\,235\\,16)':cb=128:cr=128",
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

/** Decode every video frame and count them (nb_read_frames). */
async function probeFrameCount(f: string): Promise<number> {
  const { stdout } = await efp(FFPROBE_BIN, [
    "-v", "error",
    "-count_frames",
    "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames",
    "-of", "default=nw=1:nk=1",
    f,
  ]);
  return parseInt(stdout.trim(), 10);
}

/** True iff ffmpeg's blackdetect flags any (near-)fully-black interval. Our
 *  source clips are solid non-black colours, so any black frame means a
 *  dropped/corrupt frame — which a duration tolerance can't catch. */
async function hasBlackFrames(f: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      FFMPEG_BIN,
      ["-i", f, "-vf", "blackdetect=d=0.05:pix_th=0.05", "-an", "-f", "null", "-"],
      (_err, _stdout, stderr) => resolve((stderr ?? "").includes("black_start")),
    );
  });
}

/** Extract one frame at time `t` as raw rgb24 bytes. */
async function frameBytes(f: string, t: number, dir: string): Promise<Buffer> {
  const raw = join(dir, `frame-${t}.rgb`);
  await efp(FFMPEG_BIN, [
    "-y", "-loglevel", "error",
    "-ss", String(t), "-i", f,
    "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", raw,
  ]);
  return readFile(raw);
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  return s / n;
}

describe("S1 · four cinematic endpoints render on real color clips", () => {
  let dir = "";
  let clipA = "";
  let clipB = "";

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
      `${name}: exit 0, correct frame count, no black/corrupt frames`,
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

        // S1 review fix #3 — decode & assert the actual frame count. A 3.168s
        // timeline at 30fps yields exactly 95 decoded frames on the managed
        // ffmpeg (xfade drops the shared boundary frame). The ±1 band tolerates
        // cross-build boundary rounding while still catching the ~6-frame drop
        // the old 0.2s duration tolerance would have let slip.
        const frames = await probeFrameCount(out);
        expect(frames).toBeGreaterThanOrEqual(94);
        expect(frames).toBeLessThanOrEqual(96);

        // ...and assert no frame is black (our sources are solid red/blue).
        expect(await hasBlackFrames(out)).toBe(false);
      },
      60_000,
    );
  }

  // S1 review fix #1 — decoded-frame regression for the grav-lens B-local-time
  // bug. B is a STATIC checkerboard, so any frame-to-frame change AFTER the
  // transition can only come from B being (wrongly) distorted there. The buggy
  // build gated B's ramp on A's absolute window, leaving B distorted — and
  // time-varying — throughout the tail (measured tail MAD ≈ 85). With the fix
  // B is undistorted past the cut, so consecutive tail frames are identical.
  integrationIt(
    "grav-lens: B is undistorted after the cut (static tail, sampled frames)",
    async () => {
      const gDir = await mkdtemp(join(tmpdir(), "autoviral-grav-tail-"));
      try {
        const a = join(gDir, "a.mp4");
        const b = join(gDir, "b.mp4");
        const out = join(gDir, "out.mp4");
        await genColorClip(a, "red");
        await genCheckerClip(b);
        await applyGravLensTransition({
          clipA: a,
          clipB: b,
          outputPath: out,
          clipADuration: 2,
          transitionDuration: 0.8,
          width: 320,
          height: 240,
          fps: 30,
        });
        // Transition ends at 2.0s; sample two frames well inside the B tail.
        const f25 = await frameBytes(out, 2.5, gDir);
        const f29 = await frameBytes(out, 2.9, gDir);
        // Static undistorted tail → near-identical frames. Buggy build → ≈85.
        expect(meanAbsDiff(f25, f29)).toBeLessThan(2);
      } finally {
        await rm(gDir, { recursive: true, force: true });
      }
    },
    90_000,
  );
});

// ── S1 review fix #2 — exercise the four transitions as REAL HTTP routes,
// not just the apply*() functions. POST to each endpoint against a fixture
// work and assert 200 + the output file lands on disk. ──

describe("S1 · POST /api/transitions/* render on a fixture work", () => {
  const endpoints = ["light-leak", "glitch", "domain-warp", "grav-lens"] as const;

  for (const name of endpoints) {
    integrationIt(
      `POST /api/transitions/${name} → 200 + output file exists`,
      async () => {
        await withTempDataDir(async (dataDir) => {
          const workId = "w_tx_route";
          const assetsDir = join(dataDir, "works", workId, "assets");
          await mkdir(assetsDir, { recursive: true });
          await genColorClip(join(assetsDir, "a.mp4"), "red");
          await genColorClip(join(assetsDir, "b.mp4"), "blue");
          _resetLightLeakCacheForTests();

          const outputFilename = `out-${name}.mp4`;
          const res = await renderRouter.fetch(
            jsonReq("POST", `/api/transitions/${name}`, {
              workId,
              clipARelative: "assets/a.mp4",
              clipBRelative: "assets/b.mp4",
              outputFilename,
              clipADuration: 2,
              transitionDuration: 0.8,
            }),
          );
          expect(res.status).toBe(200);
          const body = (await res.json()) as { ok?: boolean; outputPath?: string };
          expect(body.ok).toBe(true);
          const outPath = join(dataDir, "works", workId, "output", outputFilename);
          expect(existsSync(outPath)).toBe(true);
        });
      },
      60_000,
    );
  }
});
