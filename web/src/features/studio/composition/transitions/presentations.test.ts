import { describe, it, expect } from "vitest";
import { presentationFor } from "./presentations";
import { TRANSITION_PRESETS } from "@shared/transitions";

// #54 — every registry preset must map to a real Remotion presentation. The
// switch's `never` check guards this at compile time; this is the runtime
// counterpart (catches a clockWipe/iris that throws without its dims, etc.).
describe("presentationFor (#54 — WYSIWYG preset → Remotion presentation)", () => {
  it("returns a presentation for EVERY registry preset (no throw, incl. clockWipe/iris with dims)", () => {
    for (const preset of TRANSITION_PRESETS) {
      const pres = presentationFor(preset, { width: 1080, height: 1920 });
      expect(pres).toBeTruthy();
      // TransitionPresentation = { component, props } — component is the React
      // element factory Remotion drives the cross-fade with.
      expect(pres.component).toBeDefined();
    }
  });

  it("clock-wipe / iris consume the passed dimensions (radial sweep needs them)", () => {
    // Different dims → still constructs without throwing (the props carry the
    // size through to Remotion's shader).
    expect(() => presentationFor("clock-wipe", { width: 100, height: 200 })).not.toThrow();
    expect(() => presentationFor("iris", { width: 100, height: 200 })).not.toThrow();
  });
});
