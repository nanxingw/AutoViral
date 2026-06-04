import { describe, it, expect } from "vitest";
import { VideoClipSchema } from "./composition.js";

// S18 (US 27/28) — crop + flip (mirror) on a video clip's transforms. Before
// S18 the Transforms schema only carried scale/x/y/rotation; there was no way
// for the agent or the user to crop a sub-region of the source frame, or to
// horizontally / vertically mirror it. `crop {x,y,w,h}` and `flipH`/`flipV`
// lift those into persisted, agent-settable intent.
//
// These tests pin the SCHEMA contract:
//   - crop is an optional object {x,y,w,h}; flipH/flipV are optional booleans,
//   - they are ALL optional (no default) so EVERY existing work (no crop/flip
//     key) still parses unchanged (back-compat — the renderer treats absent as
//     no-crop / no-flip),
//   - a round-trip preserves explicit values.

function bareVideoClip() {
  // The exact shape an OLD work (authored before S18) carries — NO crop/flip.
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

describe("VideoClip.transforms crop + flip schema (S18)", () => {
  it("an old work with NO crop/flip still parses (back-compat, absent stays absent)", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect(parsed.transforms.crop).toBeUndefined();
    expect(parsed.transforms.flipH).toBeUndefined();
    expect(parsed.transforms.flipV).toBeUndefined();
    // legacy fields untouched
    expect(parsed.transforms.scale).toBe(1);
  });

  it("round-trips an explicit crop {x,y,w,h}", () => {
    const clip = bareVideoClip();
    const parsed = VideoClipSchema.parse({
      ...clip,
      transforms: { ...clip.transforms, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } },
    });
    expect(parsed.transforms.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
  });

  it("round-trips explicit flipH / flipV booleans", () => {
    const clip = bareVideoClip();
    const parsed = VideoClipSchema.parse({
      ...clip,
      transforms: { ...clip.transforms, flipH: true, flipV: true },
    });
    expect(parsed.transforms.flipH).toBe(true);
    expect(parsed.transforms.flipV).toBe(true);
  });

  it("rejects a non-boolean flipH", () => {
    const clip = bareVideoClip();
    expect(() =>
      VideoClipSchema.parse({
        ...clip,
        transforms: { ...clip.transforms, flipH: "yes" },
      }),
    ).toThrow();
  });

  it("rejects a crop missing a leaf (w/h are required when crop is present)", () => {
    const clip = bareVideoClip();
    expect(() =>
      VideoClipSchema.parse({
        ...clip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transforms: { ...clip.transforms, crop: { x: 0, y: 0 } as any },
      }),
    ).toThrow();
  });
});
