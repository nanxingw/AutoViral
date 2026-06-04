import { describe, it, expect } from "vitest";
import { VideoClipSchema } from "./composition.js";

// S16 (US 25) — fit-fill mode on a video clip. The renderer used to HARDCODE
// objectFit:"cover", so a source whose aspect ≠ canvas was always centre-cropped
// with no escape valve. `fitMode` is the persisted intent that lets the agent /
// user pick cover (crop, the legacy default) vs contain (letterbox, no crop) vs
// blur (blurred-fill background + contained foreground).
//
// These tests pin the SCHEMA contract:
//   - the field is an enum cover|contain|blur,
//   - it is optional with default "cover" so EVERY existing work (no fitMode)
//     still parses and keeps the legacy crop behaviour (back-compat),
//   - a round-trip preserves an explicit value.

function bareVideoClip() {
  // The exact shape an OLD work (authored before S16) carries — NO fitMode key.
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

describe("VideoClip.fitMode schema (S16)", () => {
  it("an old work with NO fitMode still parses and defaults to 'cover'", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect(parsed.fitMode).toBe("cover");
  });

  it("round-trips an explicit fitMode value (contain / blur)", () => {
    for (const mode of ["cover", "contain", "blur"] as const) {
      const parsed = VideoClipSchema.parse({ ...bareVideoClip(), fitMode: mode });
      expect(parsed.fitMode).toBe(mode);
    }
  });

  it("rejects an unknown fitMode value", () => {
    expect(() =>
      VideoClipSchema.parse({ ...bareVideoClip(), fitMode: "stretch" }),
    ).toThrow();
  });
});
