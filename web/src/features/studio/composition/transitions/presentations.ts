// #54 Phase 1 — preset → Remotion presentation factory (client-only because
// @remotion/transitions ships React components). The metadata source-of-truth
// (family, ffmpeg name, default duration) lives in src/shared/transitions.ts;
// this module is the visual-mapping half. They MUST stay in lockstep: every
// preset in src/shared/transitions.ts gets a row here, or TS errors at the
// switch's exhaustiveness check below.

import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import type { TransitionPresentation } from "@remotion/transitions";
import type { TransitionPreset } from "@shared/transitions";

/**
 * Build the Remotion <TransitionSeries.Transition presentation={…}> value for
 * a given preset. Returns a freshly-constructed presentation per call (the
 * factories are cheap; React identity isn't important here).
 */
export function presentationFor(
  preset: TransitionPreset,
): TransitionPresentation<Record<string, unknown>> {
  switch (preset) {
    case "cross-dissolve":
      // Family ① dissolve — straight opacity cross-fade.
      return fade();
    case "wipe-left":
      // Family ② wipe — incoming content wipes IN from the right, so the
      // outgoing content appears to be "wiped left" off-screen. Matches the
      // user-facing "wipe-left" label = the cut visibly moves leftward.
      return wipe({ direction: "from-right" });
    case "push-left":
      // Family ③ slide/push — incoming pushes in from the right, displacing
      // the outgoing content leftward (the canonical "push to the left").
      return slide({ direction: "from-right" });
    default: {
      // Exhaustiveness check: adding a preset to TRANSITION_PRESETS without a
      // case here is a type error, so preview can never silently drift behind
      // the schema.
      const _exhaustive: never = preset;
      void _exhaustive;
      return fade();
    }
  }
}
