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

// ─── PRD-0014 S2 · stylize + motion presets rendered PURELY via Remotion ──────
// glitch / light-leak / whip-pan-left / whip-pan-right / zoom-in / zoom-out have
// no ffmpeg dual — they are custom TransitionPresentations built from CSS
// filter/transform/opacity interpolated off `presentationProgress`. The SAME
// component drives both the browser preview AND the headless export (Stage 1
// of render-pipeline runs this exact <TransitionSeries>), so they are WYSIWYG
// by construction like every #54 preset. Each stamps a `data-transition-preset`
// marker so the render tree is inspectable + provably not the fade() fallback.

/** The six presets this module renders itself (not delegated to @remotion). */
export type S2Preset =
  | "glitch"
  | "light-leak"
  | "whip-pan-left"
  | "whip-pan-right"
  | "zoom-in"
  | "zoom-out";

function round(n: number): number {
  return Number(n.toFixed(3));
}

/**
 * Pure style mapper (exported for test): given a preset, the cross-fade
 * `progress` (0→1) and whether this scene is `entering` or `exiting`, return
 * the CSS the wrapper applies plus (for light-leak) the warm-flash overlay
 * opacity. Kept pure + free of Remotion hooks so it's identical in preview and
 * headless render and unit-testable without a Composition context.
 */
export function s2TransitionStyle(
  preset: S2Preset,
  progress: number,
  direction: "entering" | "exiting",
): { style: React.CSSProperties; leak: number } {
  const entering = direction === "entering";
  const p = Math.min(1, Math.max(0, progress));
  // 0 at both ends, 1 at mid — the "energy" of a stylize/motion accent peaks at
  // the cut and settles as the incoming scene lands.
  const bump = Math.sin(p * Math.PI);
  const fadeOpacity = entering ? p : 1 - p;

  switch (preset) {
    case "whip-pan-left": {
      // Cut travels LEFT: incoming slides in from the right (+100%→0), outgoing
      // slides off to the left (0→-100%), with directional motion blur mid-pan.
      const tx = entering ? (1 - p) * 100 : -p * 100;
      return {
        style: {
          transform: `translateX(${round(tx)}%)`,
          filter: bump > 0.001 ? `blur(${round(bump * 14)}px)` : undefined,
        },
        leak: 0,
      };
    }
    case "whip-pan-right": {
      // Mirror of whip-pan-left: incoming from the left, outgoing off the right.
      const tx = entering ? -(1 - p) * 100 : p * 100;
      return {
        style: {
          transform: `translateX(${round(tx)}%)`,
          filter: bump > 0.001 ? `blur(${round(bump * 14)}px)` : undefined,
        },
        leak: 0,
      };
    }
    case "zoom-in": {
      // Camera pushes IN: incoming grows from 0.7→1 while fading in; outgoing
      // over-scales 1→1.6 while fading out.
      const scale = entering ? 0.7 + 0.3 * p : 1 + 0.6 * p;
      return {
        style: {
          transform: `scale(${round(scale)})`,
          opacity: round(fadeOpacity),
          filter: bump > 0.001 ? `blur(${round(bump * 6)}px)` : undefined,
        },
        leak: 0,
      };
    }
    case "zoom-out": {
      // Camera pulls OUT: incoming settles from 1.4→1; outgoing shrinks 1→0.6.
      const scale = entering ? 1.4 - 0.4 * p : 1 - 0.4 * p;
      return {
        style: {
          transform: `scale(${round(scale)})`,
          opacity: round(fadeOpacity),
          filter: bump > 0.001 ? `blur(${round(bump * 6)}px)` : undefined,
        },
        leak: 0,
      };
    }
    case "glitch": {
      // RGB-split jitter that spikes at the cut: chromatic drop-shadows split
      // apart, a small horizontal shudder, saturation crush — settles to a clean
      // frame as the incoming scene lands.
      const shove = (entering ? -1 : 1) * bump * 6;
      const split = round(bump * 5);
      return {
        style: {
          opacity: round(fadeOpacity),
          transform: `translateX(${round(shove)}px)`,
          filter:
            bump > 0.001
              ? `drop-shadow(${split}px 0 0 rgba(255,32,64,0.55)) ` +
                `drop-shadow(${round(-bump * 5)}px 0 0 rgba(32,220,255,0.55)) ` +
                `saturate(${round(1 + bump)})`
              : undefined,
        },
        leak: 0,
      };
    }
    case "light-leak": {
      // Warm flash: the incoming scene fades in while a screen-blended amber
      // glow blooms over the cut (overlay opacity = bump; rendered by the
      // component below). No transform — the leak carries the transition.
      return {
        style: { opacity: round(fadeOpacity) },
        leak: round(bump),
      };
    }
    default: {
      const _exhaustive: never = preset;
      void _exhaustive;
      return { style: { opacity: round(fadeOpacity) }, leak: 0 };
    }
  }
}

const ABSOLUTE_FILL: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
};

type S2ComponentProps = {
  presentationProgress: number;
  presentationDirection: "entering" | "exiting";
  passedProps: { preset: S2Preset };
  children: React.ReactNode;
};

/**
 * The single React component every S2 preset routes through. It reads the
 * preset off `passedProps` (Remotion threads the presentation's `props` here),
 * computes the pure style, wraps the scene in an absolutely-filled layer marked
 * with `data-transition-preset`, and — for light-leak — stacks a warm
 * screen-blended overlay whose opacity tracks the cut energy.
 */
function S2TransitionPresentation({
  presentationProgress,
  presentationDirection,
  passedProps,
  children,
}: S2ComponentProps) {
  const preset = passedProps.preset;
  const { style, leak } = s2TransitionStyle(
    preset,
    presentationProgress,
    presentationDirection,
  );
  return (
    <div
      data-transition-preset={preset}
      style={{ ...ABSOLUTE_FILL, ...style }}
    >
      {children}
      {preset === "light-leak" && leak > 0.001 ? (
        <div
          data-test="light-leak-overlay"
          style={{
            ...ABSOLUTE_FILL,
            pointerEvents: "none",
            opacity: leak,
            mixBlendMode: "screen",
            background:
              "radial-gradient(circle at 70% 30%, rgba(255,196,120,0.95) 0%, " +
              "rgba(255,120,64,0.55) 35%, rgba(255,80,40,0) 70%)",
          }}
        />
      ) : null}
    </div>
  );
}

/** Build the S2 presentation value for a preset (pins the preset into props). */
function s2Presentation(
  preset: S2Preset,
): TransitionPresentation<Record<string, unknown>> {
  return {
    component: S2TransitionPresentation as unknown as TransitionPresentation<
      Record<string, unknown>
    >["component"],
    props: { preset },
  };
}

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

    // ④ motion completion + ⑤ stylize (PRD-0014 S2) — all rendered by the
    // shared S2 presentation component (CSS transform/filter/opacity off
    // progress). No @remotion/transitions primitive; no ffmpeg dual.
    case "whip-pan-left":
    case "whip-pan-right":
    case "zoom-in":
    case "zoom-out":
    case "glitch":
    case "light-leak":
      return s2Presentation(preset);

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
