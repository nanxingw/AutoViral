import { describe, it, expect } from "vitest";
import { CompositionSchema, makeEmptyComposition } from "./types";

describe("Composition schema", () => {
  it("makes a valid empty composition for short-video", () => {
    const c = makeEmptyComposition({ workId: "w1", aspect: "9:16" });
    const parsed = CompositionSchema.parse(c);
    expect(parsed.fps).toBe(30);
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1920);
    expect(parsed.tracks).toHaveLength(4);
    expect(parsed.tracks.map((t) => t.kind)).toEqual([
      "video",
      "audio",
      "text",
      "overlay",
    ]);
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
