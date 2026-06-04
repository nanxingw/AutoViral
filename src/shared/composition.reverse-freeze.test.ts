import { describe, it, expect } from "vitest";
import { VideoClipSchema } from "./composition.js";

// S19 (US 29/30) — reverse + freeze (time-domain ops) on a video clip. Before
// S19 a VideoClip carried no way for the agent or the user to FREEZE a single
// source frame (hold it as a still) or REVERSE (play the clip backwards).
//   - `freezeAtSec` (optional number ≥0) — hold the frame at that source time;
//     preview + export BOTH freeze on it.
//   - `reverse` (optional boolean) — export plays the clip (and its audio)
//     backwards; preview shows an explicit "export-only" placeholder.
//
// These tests pin the SCHEMA contract:
//   - both are optional (no default) so EVERY existing work (no key) parses
//     unchanged (back-compat — the renderer treats absent as no-freeze/no-rev),
//   - a round-trip preserves explicit values,
//   - freezeAtSec rejects a negative time.

function bareVideoClip() {
  // The exact shape an OLD work (authored before S19) carries — NO freeze/rev.
  return {
    id: "v1",
    kind: "video" as const,
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

describe("VideoClip reverse + freeze schema (S19)", () => {
  it("an old work with NO freeze/reverse still parses (back-compat, absent stays absent)", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect(parsed.freezeAtSec).toBeUndefined();
    expect(parsed.reverse).toBeUndefined();
    // legacy fields untouched
    expect(parsed.in).toBe(0);
    expect(parsed.out).toBe(5);
  });

  it("round-trips an explicit freezeAtSec", () => {
    const parsed = VideoClipSchema.parse({
      ...bareVideoClip(),
      freezeAtSec: 1.5,
    });
    expect(parsed.freezeAtSec).toBe(1.5);
  });

  it("round-trips reverse:true", () => {
    const parsed = VideoClipSchema.parse({ ...bareVideoClip(), reverse: true });
    expect(parsed.reverse).toBe(true);
  });

  it("round-trips both set together", () => {
    const parsed = VideoClipSchema.parse({
      ...bareVideoClip(),
      freezeAtSec: 2,
      reverse: true,
    });
    expect(parsed.freezeAtSec).toBe(2);
    expect(parsed.reverse).toBe(true);
  });

  it("rejects a NEGATIVE freezeAtSec (a frame time can't be before the clip start)", () => {
    expect(() =>
      VideoClipSchema.parse({ ...bareVideoClip(), freezeAtSec: -1 }),
    ).toThrow();
  });
});
