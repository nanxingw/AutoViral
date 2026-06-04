import { describe, it, expect } from "vitest";
import {
  timeWarpVideoFilterChain,
  timeWarpAudioFilterChain,
  timeWarpCacheName,
  buildTimeWarpFilterArgs,
} from "../transforms-ffmpeg.js";

// S19 (US 29/30) — reverse + freeze FFMPEG EXPORT CONSUMPTION proof. reverse /
// freezeAtSec are NOT dead schema fields (the LUT-slider lesson): this asserts
// the ffmpeg filtergraph the export builds actually contains `reverse` (video),
// `areverse` (audio) for a reversed clip, and a `tpad`/`loop`-based hold for a
// freeze. We do NOT run ffmpeg (host has none); we assert the generated
// filtergraph STRING, exactly like the S18 crop+flip consumption test.
//
// DECISION (locked): reverse → real ffmpeg reverse + areverse on EXPORT only
// (preview shows an explicit "export-only" placeholder, never a fake forward
// playback claiming to be reverse). freeze → tpad/setpts hold of the single
// source frame at freezeAtSec; BOTH preview and export freeze.

describe("timeWarpVideoFilterChain (S19 reverse + freeze video consumption)", () => {
  const FPS = 30;
  const OUT_SEC = 5; // clip plays 5s on the timeline

  it("no reverse/freeze → empty chain (old work, no-op)", () => {
    expect(timeWarpVideoFilterChain({}, FPS, OUT_SEC)).toBe("");
  });

  it("reverse:true → video filtergraph contains 'reverse'", () => {
    const chain = timeWarpVideoFilterChain({ reverse: true }, FPS, OUT_SEC);
    expect(chain).toContain("reverse");
  });

  it("freezeAtSec → freezes ONE source frame and holds it (trim+tpad), no 'reverse'", () => {
    const chain = timeWarpVideoFilterChain({ freezeAtSec: 1.5 }, FPS, OUT_SEC);
    // grab exactly the frame at freezeAtSec, then pad it out to the clip length.
    expect(chain).toContain("trim=start=1.5");
    expect(chain).toContain("tpad=");
    expect(chain).not.toContain("reverse");
  });

  it("freeze takes precedence over reverse (a held still has no direction)", () => {
    const chain = timeWarpVideoFilterChain(
      { freezeAtSec: 1.5, reverse: true },
      FPS,
      OUT_SEC,
    );
    expect(chain).toContain("tpad=");
    expect(chain).not.toContain("reverse");
  });
});

describe("timeWarpAudioFilterChain (S19 reverse audio consumption)", () => {
  it("no reverse/freeze → empty audio chain (no-op)", () => {
    expect(timeWarpAudioFilterChain({})).toBe("");
  });

  it("reverse:true → audio filtergraph contains 'areverse' (audio played backwards)", () => {
    expect(timeWarpAudioFilterChain({ reverse: true })).toBe("areverse");
  });

  it("freeze → audio silenced/dropped (a still has no audio) → empty chain", () => {
    // A frozen still carries no moving audio; the video filter holds one frame,
    // so the audio chain stays empty (export mutes the held segment).
    expect(timeWarpAudioFilterChain({ freezeAtSec: 1.5 })).toBe("");
  });
});

describe("timeWarpCacheName (S19 — params hashed so a changed warp re-renders)", () => {
  it("same params → same name (cache HIT); different params → different name", () => {
    const a = timeWarpCacheName("c1", { reverse: true });
    const b = timeWarpCacheName("c1", { reverse: true });
    const c = timeWarpCacheName("c1", { freezeAtSec: 1.5 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^clip-c1-timewarp-[0-9a-f]+\.mp4$/);
  });
});

describe("buildTimeWarpFilterArgs (S19 — argv wiring for the export pass)", () => {
  it("reverse → ffmpeg argv carries -vf reverse AND -af areverse", () => {
    const args = buildTimeWarpFilterArgs(
      "in.mp4",
      "out.mp4",
      "reverse",
      "areverse",
    );
    const vfIdx = args.indexOf("-vf");
    const afIdx = args.indexOf("-af");
    expect(vfIdx).toBeGreaterThanOrEqual(0);
    expect(args[vfIdx + 1]).toBe("reverse");
    expect(afIdx).toBeGreaterThanOrEqual(0);
    expect(args[afIdx + 1]).toBe("areverse");
  });

  it("freeze (no audio chain) → ffmpeg argv carries -vf but drops audio (-an)", () => {
    const args = buildTimeWarpFilterArgs(
      "in.mp4",
      "out.mp4",
      "trim=start=1.5,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=5",
      "",
    );
    expect(args).toContain("-vf");
    // no -af when the audio chain is empty; the held still is silenced (-an).
    expect(args).not.toContain("-af");
    expect(args).toContain("-an");
  });
});
