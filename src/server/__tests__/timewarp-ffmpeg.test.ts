import { describe, it, expect, vi } from "vitest";
import {
  timeWarpVideoFilterChain,
  timeWarpAudioFilterChain,
  timeWarpCacheName,
  buildTimeWarpFilterArgs,
  applyTimeWarpPrePass,
} from "../transforms-ffmpeg.js";
import { CompositionSchema } from "../../shared/composition.js";
import type { Composition } from "../../shared/composition.js";

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

  it("reverse on a TRIMMED clip (in>0) → trims [in,out] FIRST, THEN reverses that span (not the whole source)", () => {
    // Review-fix high: a reversed clip whose [in,out] is a sub-region of the
    // source MUST trim to [in,out] BEFORE `reverse`, otherwise ffmpeg reverses
    // the whole source and Remotion plays its TAIL, not the user-selected span.
    const chain = timeWarpVideoFilterChain(
      { reverse: true, inSec: 2, outSec: 7 },
      FPS,
      OUT_SEC,
    );
    // the trim must bracket exactly the user-selected [in,out] span...
    expect(chain).toContain("trim=start=2:end=7");
    // ...reset PTS so the reversed segment starts at 0...
    expect(chain).toContain("setpts=PTS-STARTPTS");
    // ...and reverse must come AFTER the trim (reverse the SPAN, not the source).
    const trimIdx = chain.indexOf("trim=start=2:end=7");
    const reverseIdx = chain.indexOf("reverse");
    expect(trimIdx).toBeGreaterThanOrEqual(0);
    expect(reverseIdx).toBeGreaterThan(trimIdx);
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
    expect(timeWarpAudioFilterChain({ reverse: true })).toContain("areverse");
  });

  it("reverse on a TRIMMED clip (in>0) → atrims [in,out] FIRST, THEN areverses that span", () => {
    // Audio must trim the SAME [in,out] span as the video before areversing,
    // otherwise the reversed audio is offset from the reversed video.
    const chain = timeWarpAudioFilterChain({
      reverse: true,
      inSec: 2,
      outSec: 7,
    });
    expect(chain).toContain("atrim=start=2:end=7");
    expect(chain).toContain("asetpts=PTS-STARTPTS");
    const trimIdx = chain.indexOf("atrim=start=2:end=7");
    const reverseIdx = chain.indexOf("areverse");
    expect(reverseIdx).toBeGreaterThan(trimIdx);
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

describe("applyTimeWarpPrePass (S19 — prepass feeds the CLIP SPAN to ffmpeg, not the source tail)", () => {
  // The renderer-consumption proof at the prepass boundary: a TRIMMED reversed
  // clip (in=2, out=7) must produce a vChain that trims [2,7] BEFORE reverse and
  // an aChain that atrims [2,7] before areverse — so the cached MP4 holds the
  // user-selected span reversed, NOT the source's last (out-in) seconds. The
  // pre-fix bug returned bare `reverse` (whole source) → Remotion then played the
  // source tail (in:0/out:5 of a fully-reversed file = source[D, D-5]).
  function reversedTrimmedComp(): Composition {
    return CompositionSchema.parse({
      id: "comp1",
      workId: "w1",
      fps: 30,
      width: 1080,
      height: 1920,
      duration: 5,
      aspect: "9:16",
      updatedAt: "2026-06-05T00:00:00.000Z",
      tracks: [
        {
          id: "trk_v1",
          kind: "video",
          label: "Video",
          displayOrder: 0,
          clips: [
            {
              id: "v1",
              kind: "video",
              src: "assets/clip.mp4",
              in: 2,
              out: 7,
              trackOffset: 0,
              transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
              filters: { brightness: 0, contrast: 0, saturation: 0 },
              reverse: true,
            },
          ],
        },
      ],
    });
  }

  it("reversed TRIMMED clip → ffmpeg gets a vChain trimming [in,out] then reversing (NOT the source tail)", async () => {
    const runWarp = vi.fn<
      (
        input: string,
        output: string,
        vChain: string,
        aChain: string,
        signal?: AbortSignal,
      ) => Promise<void>
    >(async () => {});
    const out = await applyTimeWarpPrePass(
      reversedTrimmedComp(),
      "/work",
      undefined,
      runWarp,
    );
    expect(runWarp).toHaveBeenCalledTimes(1);
    const [, , vChain, aChain] = runWarp.mock.calls[0]!;
    // video: trim the SOURCE to [2,7] FIRST, then reverse that span.
    expect(vChain).toContain("trim=start=2:end=7");
    expect(vChain.indexOf("reverse")).toBeGreaterThan(
      vChain.indexOf("trim=start=2:end=7"),
    );
    // audio: atrim the same span, then areverse.
    expect(aChain).toContain("atrim=start=2:end=7");
    expect(aChain.indexOf("areverse")).toBeGreaterThan(
      aChain.indexOf("atrim=start=2:end=7"),
    );
    // the rewritten clip plays the (out-in)=5s cache straight from 0.
    const clip = (out.tracks[0]!.clips[0]! as { in: number; out: number });
    expect(clip.in).toBe(0);
    expect(clip.out).toBe(5);
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
