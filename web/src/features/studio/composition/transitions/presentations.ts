// #54 — preset → Remotion presentation factory (client-only because
// @remotion/transitions ships React components). The metadata source-of-truth
// (family, ffmpeg name, default duration) lives in src/shared/transitions.ts;
// this module is the visual-mapping half. They MUST stay in lockstep: every
// preset in src/shared/transitions.ts gets a row here, or TS errors at the
// switch's exhaustiveness check below.

import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { iris } from "@remotion/transitions/iris";
import { flip } from "@remotion/transitions/flip";
import { none } from "@remotion/transitions/none";
import type { TransitionPresentation } from "@remotion/transitions";
import type { TransitionPreset } from "@shared/transitions";

/**
 * Build the Remotion <TransitionSeries.Transition presentation={…}> value for
 * a given preset. `dims` is the composition's pixel size — clockWipe / iris
 * need it to compute their radial sweep; the directional presets ignore it.
 * Returns a freshly-constructed presentation per call (the factories are
 * cheap; React identity isn't important here).
 */
export function presentationFor(
  preset: TransitionPreset,
  dims: { width: number; height: number },
): TransitionPresentation<Record<string, unknown>> {
  switch (preset) {
    // ① dissolve — straight opacity cross-fade.
    case "cross-dissolve":
      return fade();

    // ② wipe — the incoming content sweeps in from the named edge, so the
    // outgoing content reads as wiped toward the OPPOSITE edge (the label
    // names the visible direction of travel of the cut).
    case "wipe-left":
      return wipe({ direction: "from-right" });
    case "wipe-right":
      return wipe({ direction: "from-left" });
    case "wipe-up":
      return wipe({ direction: "from-bottom" });
    case "wipe-down":
      return wipe({ direction: "from-top" });
    // clockWipe / iris carry required (width,height) props, so their
    // TransitionPresentation isn't assignable to the Record<string,unknown>
    // return type under Remotion's invariant generic — cast (the runtime value
    // is correct; only the type param is narrower).
    case "clock-wipe":
      return clockWipe({
        width: dims.width,
        height: dims.height,
      }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case "iris":
      return iris({
        width: dims.width,
        height: dims.height,
      }) as unknown as TransitionPresentation<Record<string, unknown>>;

    // ③ slide / push — incoming pushes in, displacing the outgoing content.
    case "push-left":
      return slide({ direction: "from-right" });
    case "push-right":
      return slide({ direction: "from-left" });
    case "push-up":
      return slide({ direction: "from-bottom" });
    case "push-down":
      return slide({ direction: "from-top" });

    // ④ motion — 3D card flip.
    case "flip":
      return flip();

    // ⑥ cut — explicit hard cut (no visible blend); lets the picker represent
    // "no transition" as a first-class choice instead of an absence.
    case "hard-cut":
      return none();

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
