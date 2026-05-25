import { describe, it, expect } from "vitest";
import { grainAlpha, MAX_GRAIN_ALPHA } from "./grain";

// Regression net for #36: a high grain slider value used to paint a fully
// opaque (alpha=255) static field over the whole slide, destroying the photo
// + title and baking the noise into the export. The fix caps the per-pixel
// alpha and blends the grain Rect with `soft-light`. These tests lock the
// alpha invariant; the `soft-light` blend is asserted structurally in the
// EffectsOverlay component.
describe("grainAlpha", () => {
  it("maps grain=0 to a fully transparent pixel (no grain)", () => {
    expect(grainAlpha(0)).toBe(0);
  });

  it("NEVER returns a fully-opaque (255) alpha, even at grain=1.0", () => {
    // The core #36 invariant: the noise can only modulate, never replace.
    expect(grainAlpha(1)).toBeLessThan(255);
    expect(grainAlpha(1)).toBe(Math.round(MAX_GRAIN_ALPHA * 255));
  });

  it("caps at MAX_GRAIN_ALPHA and stays well below opaque (<=128)", () => {
    expect(grainAlpha(1)).toBeLessThanOrEqual(128);
  });

  it("clamps out-of-range inputs to the [0,1] band", () => {
    expect(grainAlpha(-0.5)).toBe(0);
    expect(grainAlpha(5)).toBe(grainAlpha(1));
  });

  it("is monotonic non-decreasing in grain", () => {
    const samples = [0, 0.03, 0.25, 0.5, 0.75, 1];
    for (let i = 1; i < samples.length; i++) {
      expect(grainAlpha(samples[i])).toBeGreaterThanOrEqual(
        grainAlpha(samples[i - 1]),
      );
    }
  });

  it("keeps the default grain (0.03) faint", () => {
    // round(0.03 * 0.5 * 255) = 4 — a barely-there film texture.
    expect(grainAlpha(0.03)).toBeLessThan(10);
    expect(grainAlpha(0.03)).toBeGreaterThan(0);
  });
});
