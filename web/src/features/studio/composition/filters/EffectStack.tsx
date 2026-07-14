import type { Effect } from "../../types";
import { effectStackSteps } from "./cssFilters";

// PRD-0014 S14 (review fix, finding #3) — nest an ORDERED effect stack around a
// clip's media `node`. Walk the steps in array order; each step wraps the
// accumulated node so a LATER effect sits OUTSIDE an EARLIER one. Concretely:
//   - a filter step (grade / blur) → a `<div style={{filter}}>` wrapper. A blur
//     added AFTER a vignette blurs the vignette too; a grade added AFTER a blur
//     re-grades the blurred result — order is observable in both the DOM and the
//     pixels.
//   - an overlay step (vignette / grain) → a wrapper holding the node PLUS the
//     overlay div painted on top. A filter wrapping this overlay (because it came
//     later) will therefore also transform the overlay.
// Consumed IDENTICALLY by the browser preview and the headless export (renderMedia
// runs this SAME tree) — WYSIWYG by construction, no ffmpeg dual. When the stack
// is empty / all-disabled this returns `node` unchanged (back-compat: a clip with
// no effects renders byte-identically to pre-S14).
export function wrapWithEffectStack(
  node: React.ReactNode,
  effects: Effect[] | undefined,
): React.ReactNode {
  const steps = effectStackSteps(effects);
  if (steps.length === 0) return node;
  let acc = node;
  for (const step of steps) {
    if (step.kind === "filter") {
      acc = (
        <div
          key={`fx-${step.id}`}
          data-test="effect-filter"
          data-effect-type={step.effectType}
          style={{ position: "absolute", inset: 0, filter: step.css }}
        >
          {acc}
        </div>
      );
    } else {
      acc = (
        <div
          key={`ov-${step.id}`}
          data-test="effect-overlay-wrap"
          data-effect-type={step.effectType}
          style={{ position: "absolute", inset: 0 }}
        >
          {acc}
          <div data-test={step.testId} style={step.style} />
        </div>
      );
    }
  }
  return acc;
}
