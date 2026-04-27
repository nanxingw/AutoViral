import { describe, it, expect } from "vitest";
import { snapToBeat } from "./snapToBeat";

describe("snapToBeat", () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5];
  it("snaps within tolerance", () => {
    expect(snapToBeat(1.04, beats, 0.06)).toBe(1.0);
  });
  it("returns input outside tolerance", () => {
    expect(snapToBeat(1.2, beats, 0.06)).toBe(1.2);
  });
  it("handles empty beat list", () => {
    expect(snapToBeat(0.7, [], 0.1)).toBe(0.7);
  });
});
