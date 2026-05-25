import { describe, it, expect } from "vitest";
import { CompositionSchema, makeEmptyComposition } from "./types";

describe("Composition schema", () => {
  it("makes a valid empty composition for short-video", () => {
    const c = makeEmptyComposition({ workId: "w1", aspect: "9:16" });
    const parsed = CompositionSchema.parse(c);
    expect(parsed.fps).toBe(30);
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1920);
    // Phase D (issue #31) — 4 default lanes: V1 video / A1 BGM audio / A2 VO
    // audio / CC1 text. All track ids are `trk_<uuid>`; displayOrder is 0..3.
    expect(parsed.tracks).toHaveLength(4);
    expect(parsed.tracks.map((t) => t.kind)).toEqual([
      "video",
      "audio",
      "audio",
      "text",
    ]);
    for (const t of parsed.tracks) {
      expect(t.id).toMatch(/^trk_/);
    }
    expect(parsed.tracks.map((t) => t.displayOrder)).toEqual([0, 1, 2, 3]);
    // CC1 carries language "zh" by default; everyone else leaves it unset.
    expect(parsed.tracks[3].language).toBe("zh");
  });

  it("rejects negative duration", () => {
    expect(() =>
      CompositionSchema.parse(
        makeEmptyComposition({ workId: "w", aspect: "9:16", duration: -1 }),
      ),
    ).toThrow();
  });

  it("supports 1:1 and 16:9 aspect", () => {
    const square = makeEmptyComposition({ workId: "w", aspect: "1:1" });
    expect(square.width).toBe(square.height);
    const wide = makeEmptyComposition({ workId: "w", aspect: "16:9" });
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 2);
  });
});
