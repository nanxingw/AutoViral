import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { presentationFor } from "./presentations";
import { TRANSITION_PRESETS } from "@shared/transitions";
import type { TransitionPreset } from "@shared/transitions";

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

// PRD-0014 S2 — the stylize (glitch / light-leak) + motion (whip-pan / zoom)
// presets render as DEDICATED Remotion presentations, not the fade() fallback.
// Each stamps a `data-transition-preset` marker on its wrapper so the preview
// render tree is inspectable AND provably distinct from the exhaustiveness
// default. These are RED until the six switch cases + components land (the
// default branch returns fade(), which carries no marker).
const S2_PRESETS: TransitionPreset[] = [
  "glitch",
  "light-leak",
  "whip-pan-left",
  "whip-pan-right",
  "zoom-in",
  "zoom-out",
];

describe("presentationFor — S2 stylize/motion presets (PRD-0014)", () => {
  it.each(S2_PRESETS)(
    "%s → a dedicated presentation node (marker present) wrapping its children",
    (preset) => {
      const pres = presentationFor(preset, { width: 1080, height: 1920 });
      expect(pres.component).toBeDefined();
      const Comp = pres.component as React.ComponentType<Record<string, unknown>>;
      const { container } = render(
        <Comp
          presentationProgress={0.5}
          presentationDirection="entering"
          passedProps={pres.props}
          presentationDurationInFrames={12}
          bothEnteringAndExiting={false}
        >
          <div data-test="child-content">hi</div>
        </Comp>,
      );
      // Dedicated marker → NOT the fade() fallback (fade has no such attribute).
      expect(
        container.querySelector(`[data-transition-preset="${preset}"]`),
      ).not.toBeNull();
      // Children must be composited through (the transition wraps the scene).
      expect(container.querySelector('[data-test="child-content"]')).not.toBeNull();
    },
  );

  it("entering vs exiting produce distinct styles (progress + direction drive the effect)", () => {
    const pres = presentationFor("whip-pan-left", { width: 100, height: 100 });
    const Comp = pres.component as React.ComponentType<Record<string, unknown>>;
    const enter = render(
      <Comp
        presentationProgress={0.4}
        presentationDirection="entering"
        passedProps={pres.props}
        presentationDurationInFrames={12}
        bothEnteringAndExiting={false}
      >
        <span />
      </Comp>,
    );
    const exit = render(
      <Comp
        presentationProgress={0.4}
        presentationDirection="exiting"
        passedProps={pres.props}
        presentationDurationInFrames={12}
        bothEnteringAndExiting={false}
      >
        <span />
      </Comp>,
    );
    const eNode = enter.container.querySelector(
      '[data-transition-preset="whip-pan-left"]',
    ) as HTMLElement;
    const xNode = exit.container.querySelector(
      '[data-transition-preset="whip-pan-left"]',
    ) as HTMLElement;
    expect(eNode).not.toBeNull();
    expect(xNode).not.toBeNull();
    // A whip pan travels opposite directions for the incoming vs outgoing scene.
    expect(eNode.style.transform).not.toBe(xNode.style.transform);
  });
});
