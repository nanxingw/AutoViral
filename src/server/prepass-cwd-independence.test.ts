// PRD-0014 S18 finding A [critical] — the pre-Remotion ffmpeg pre-passes
// (speed-ramp / time-warp / crop-flip) run in render-pipeline Stage 0/0.4/0.5,
// BEFORE rewriteClipSrcsToAbsolute, so they see the RAW work-relative `clip.src`
// out of composition.yaml (e.g. "assets/clips/s.mp4"). The old code fed that
// relative string straight to ffprobe/ffmpeg, which resolved it against the
// DAEMON's cwd (the repo root in prod, NOT the work dir) → "No such file or
// directory" the instant a variable/static-speed or cropped/reversed clip was
// exported (recon E2E D3).
//
// These tests pin the fix's external contract WITHOUT spawning a real binary:
// every pre-pass must hand ffprobe/ffmpeg an ABSOLUTE path anchored at the work
// ROOT = dirname(outDir), no matter what process.cwd() is. We inject the
// probe/runner seam each pre-pass already exposes and capture the path it's fed.

import { describe, it, expect } from "vitest";
import { isAbsolute } from "node:path";
import { resolvePrePassSourcePath } from "./safe-paths.js";
import { applySpeedRampPrePass } from "./speed-ramp-ffmpeg.js";
import {
  applyTransformsPrePass,
  applyTimeWarpPrePass,
} from "./transforms-ffmpeg.js";
import type { Composition } from "../shared/composition.js";

// outDir is "<workRoot>/output" in every production caller (bridge route +
// render-queue worker); the source lives at "<workRoot>/assets/...".
const OUT = "/work/root/output";
const REL = "assets/clips/s.mp4";
const ABS = "/work/root/assets/clips/s.mp4"; // dirname(OUT) + REL

function speedClipComp(src: string, keyframes: unknown[]): Composition {
  return {
    id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
    duration: 4, aspect: "9:16", updatedAt: "2026-07-14T00:00:00Z",
    tracks: [
      {
        id: "trk_v", kind: "video", label: "V",
        muted: false, hidden: false, volume: 0, displayOrder: 0, transitions: [],
        clips: [
          {
            id: "vc1", kind: "video", src, in: 0, out: 2, trackOffset: 0,
            transforms: {}, filters: {}, keyframes,
          },
        ],
      },
    ],
    assets: [], provenance: [], exportPresets: [],
  } as unknown as Composition;
}

function transformsClipComp(src: string, extra: Record<string, unknown>): Composition {
  return {
    id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
    duration: 4, aspect: "9:16", updatedAt: "2026-07-14T00:00:00Z",
    tracks: [
      {
        id: "trk_v", kind: "video", label: "V",
        muted: false, hidden: false, volume: 0, displayOrder: 0, transitions: [],
        clips: [
          {
            id: "vc1", kind: "video", src, in: 0, out: 2, trackOffset: 0,
            transforms: {}, filters: {}, ...extra,
          },
        ],
      },
    ],
    assets: [], provenance: [], exportPresets: [],
  } as unknown as Composition;
}

const speedKf = (time: number, value: number) => ({
  property: "speed" as const, time, value, easing: "linear" as const,
});

describe("resolvePrePassSourcePath — cwd-independent work-relative resolution", () => {
  const base = "/home/u/.autoviral/works/w1/output";
  const root = "/home/u/.autoviral/works/w1";

  it("work-relative assets/… → <workRoot>/assets/…", () => {
    expect(resolvePrePassSourcePath("assets/clips/s.mp4", base)).toBe(
      `${root}/assets/clips/s.mp4`,
    );
  });
  it("work-relative output/… → <workRoot>/output/…", () => {
    expect(resolvePrePassSourcePath("output/final.mp4", base)).toBe(
      `${root}/output/final.mp4`,
    );
  });
  it("page-absolute API uri → <workRoot>/assets/…", () => {
    expect(
      resolvePrePassSourcePath("/api/works/w1/assets/clips/s.mp4", base),
    ).toBe(`${root}/assets/clips/s.mp4`);
  });
  it("already-absolute fs path (prior pre-pass cache) → unchanged", () => {
    const p = `${root}/output/clip-x-speed-200-fps30.mp4`;
    expect(resolvePrePassSourcePath(p, base)).toBe(p);
  });
  it("data: URI → unchanged", () => {
    expect(resolvePrePassSourcePath("data:video/mp4;base64,AAAA", base)).toBe(
      "data:video/mp4;base64,AAAA",
    );
  });
  it("http(s) URL → unchanged", () => {
    expect(resolvePrePassSourcePath("https://cdn.example/x.mp4", base)).toBe(
      "https://cdn.example/x.mp4",
    );
  });
  it("empty src → unchanged", () => {
    expect(resolvePrePassSourcePath("", base)).toBe("");
  });
});

describe("pre-pass wiring — ffprobe/ffmpeg is fed an ABSOLUTE work-root path (S18 A)", () => {
  it("STATIC speed pre-pass resolves src before probing (not the bare relative path)", async () => {
    let seen = "";
    const probe = async (src: string) => {
      seen = src;
      throw new Error("STOP"); // halt before the (real-ffmpeg) setpts pass
    };
    const comp = speedClipComp(REL, [speedKf(0, 2)]);
    await expect(
      applySpeedRampPrePass(comp, OUT, undefined, probe),
    ).rejects.toThrow("STOP");
    expect(isAbsolute(seen)).toBe(true);
    expect(seen).toBe(ABS);
  });

  it("VARIABLE speed pre-pass resolves src before probing", async () => {
    let seen = "";
    const probe = async (src: string) => {
      seen = src;
      throw new Error("STOP");
    };
    const comp = speedClipComp(REL, [speedKf(0, 1), speedKf(2, 2)]);
    await expect(
      applySpeedRampPrePass(comp, OUT, undefined, probe),
    ).rejects.toThrow("STOP");
    expect(seen).toBe(ABS);
  });

  it("crop/flip pre-pass resolves src before ffprobing dims", async () => {
    let seen = "";
    const probeDims = async (src: string) => {
      seen = src;
      throw new Error("STOP");
    };
    const comp = transformsClipComp(REL, {
      transforms: { crop: { x: 0, y: 0, w: 0.5, h: 1 } },
    });
    await expect(
      applyTransformsPrePass(comp, OUT, undefined, probeDims),
    ).rejects.toThrow("STOP");
    expect(seen).toBe(ABS);
  });

  it("time-warp pre-pass resolves src before running the reverse pass", async () => {
    let seen = "";
    const runWarp = async (input: string) => {
      seen = input; // no-op stub — no real ffmpeg
    };
    const comp = transformsClipComp(REL, { reverse: true });
    await applyTimeWarpPrePass(comp, OUT, undefined, runWarp);
    expect(seen).toBe(ABS);
  });
});
