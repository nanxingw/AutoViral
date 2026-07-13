import { describe, expect, it } from "vitest";
import { selectFilmstripStep } from "./Filmstrip";

describe("selectFilmstripStep", () => {
  it.each([[384, 0.25], [192, 0.5], [96, 1], [48, 2], [12, 5]])(
    "maps %d px/s to a %s second tile step",
    (pxPerSecond, expected) => expect(selectFilmstripStep(pxPerSecond)).toBe(expected),
  );

  it.each([12, 48, 96, 192, 384])("keeps tiles within 48–96px at %d px/s", (pxPerSecond) => {
    const width = selectFilmstripStep(pxPerSecond) * pxPerSecond;
    expect(width).toBeGreaterThanOrEqual(48);
    expect(width).toBeLessThanOrEqual(96);
  });
});
