import { describe, it, expect } from "vitest";
import { toCssFilter } from "./cssFilters";

describe("toCssFilter", () => {
  it("identity at zeros", () => {
    expect(toCssFilter({ brightness: 0, contrast: 0, saturation: 0 })).toBe(
      "",
    );
  });
  it("brightness +0.5 maps to brightness(1.5)", () => {
    expect(
      toCssFilter({ brightness: 0.5, contrast: 0, saturation: 0 }),
    ).toContain("brightness(1.5)");
  });
  it("clamps extreme values", () => {
    expect(
      toCssFilter({ brightness: 5, contrast: 0, saturation: 0 }),
    ).toContain("brightness(2)");
  });
  it("composes multiple filters", () => {
    const css = toCssFilter({
      brightness: 0.2,
      contrast: 0.3,
      saturation: -0.4,
    });
    expect(css).toContain("brightness");
    expect(css).toContain("contrast");
    expect(css).toContain("saturate");
  });
});
