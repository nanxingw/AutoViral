import { describe, it, expect } from "vitest";
import { PALETTES, resolvePalette } from "./palettes";

describe("palettes", () => {
  it("exposes all 5 preset palettes", () => {
    expect(Object.keys(PALETTES).sort()).toEqual([
      "earth",
      "mono",
      "neon",
      "noir",
      "pastel",
    ]);
  });

  it("resolvePalette falls back to mono on unknown id", () => {
    expect(resolvePalette("nope" as never).id).toBe("mono");
  });

  it("each palette has required color slots", () => {
    for (const p of Object.values(PALETTES)) {
      expect(p.bg).toMatch(/^#/);
      expect(p.fg).toMatch(/^#/);
      expect(p.accent).toMatch(/^#/);
      expect(p.muted).toMatch(/^#/);
      expect(p.surface).toMatch(/^#/);
    }
  });
});
