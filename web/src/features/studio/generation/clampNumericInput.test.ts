import { describe, it, expect } from "vitest";
import { clampNumericInput } from "./GenerationDialog";

// #75 — edit-site clamp for GenerationDialog's number inputs. The bare
// `Number(e.target.value)` handlers let out-of-range typed values reach a
// PAID generation script (--duration / --image-size). HTML min/max only
// gate the spinner + :invalid styling, never typed values. This is the
// same bug class as #40 (keyframe time) and #58 (TextClipPanel), but the
// blast radius is a billable external job, so the contract is pinned hard.

describe("clampNumericInput (#75)", () => {
  describe("BGM duration bounds [5, 180]", () => {
    const opts = { min: 5, max: 180 };

    it("clamps 9999 down to the 180s ceiling (no 3-hour paid BGM)", () => {
      expect(clampNumericInput("9999", opts)).toBe(180);
    });

    it("clamps -5 up to the 5s floor (no negative --duration)", () => {
      expect(clampNumericInput("-5", opts)).toBe(5);
    });

    it("rounds fractional seconds to an integer (7.5 → 8)", () => {
      // The script takes whole seconds; the input has no `step` so the
      // implied granularity is 1. 7.5 round-trips to 8, in-bounds.
      expect(clampNumericInput("7.5", opts)).toBe(8);
    });

    it("passes an in-range integer through unchanged", () => {
      expect(clampNumericInput("30", opts)).toBe(30);
    });

    it("keeps the boundary values exactly (5 and 180)", () => {
      expect(clampNumericInput("5", opts)).toBe(5);
      expect(clampNumericInput("180", opts)).toBe(180);
    });
  });

  describe("width/height — positive-integer floor, no invented ceiling", () => {
    const opts = { min: 1 };

    it("clamps 0 up to 1 (image dims must be positive)", () => {
      expect(clampNumericInput("0", opts)).toBe(1);
    });

    it("clamps a negative dimension up to 1", () => {
      expect(clampNumericInput("-200", opts)).toBe(1);
    });

    it("does NOT impose a ceiling — large valid dimensions pass through", () => {
      // We deliberately don't know the gen script's max; clamping a fake
      // ceiling would block legitimate high-res requests.
      expect(clampNumericInput("4096", opts)).toBe(4096);
    });

    it("rounds a fractional pixel count to an integer", () => {
      expect(clampNumericInput("1080.7", opts)).toBe(1081);
    });
  });

  describe("empty / invalid input → undefined (caller falls back to default)", () => {
    it("returns undefined for an empty string", () => {
      expect(clampNumericInput("", { min: 5, max: 180 })).toBeUndefined();
    });

    it("returns undefined for non-numeric garbage", () => {
      expect(clampNumericInput("abc", { min: 5, max: 180 })).toBeUndefined();
    });

    it("returns undefined for a lone minus sign (mid-typing)", () => {
      expect(clampNumericInput("-", { min: 5, max: 180 })).toBeUndefined();
    });
  });

  describe("no bounds → round-only pass-through", () => {
    it("rounds but does not clamp when min/max are omitted", () => {
      expect(clampNumericInput("42.4")).toBe(42);
      expect(clampNumericInput("-7.6")).toBe(-8);
    });
  });
});
