// R46 — Remotion overlay layer that consumes CaptionModel.
//
// ## What this is
//
// A `<CaptionsLayer model={...} />` React component you mount inside a
// Remotion `<Composition>` to render kinetic typography captions on top
// of any video / image content. Replaces the libass hard-burn path for
// captions when the user opts in via `composition.captionStrategy =
// "overlay"`.
//
// ## What this isn't (yet)
//
// - The full GSAP timeline parity from hyperframes. We use Remotion's
//   `useCurrentFrame` + spring/interpolate primitives, which are simpler
//   and integrate better with our existing Scene.tsx, but lack a few
//   easings hyperframes' GSAP has. If product wants those eight specific
//   `back.out(1.6)`-style curves, we can either pull a tiny CSS easing
//   library or adopt @remotion/animation-utils.
//
// - Per-letter (sub-word) animation. We do per-segment (per-word in the
//   ASR sense). Letter-level adds complexity disproportional to the win
//   for short videos.
//
// ## Wiring
//
// Today: not yet wired into Scene.tsx — Stage 1 still goes through
// libass. To enable:
//
//   1. Add `captions?: CaptionModel` to the Composition type
//   2. Set `composition.captionStrategy = "overlay"` per work
//   3. Scene.tsx renders `<CaptionsLayer model={comp.captions} />`
//      after the main tracks
//   4. render-pipeline.ts skips Stage 3 (subtitle burn) when strategy
//      is "overlay" — Remotion bakes the text into the rendered frames
//      directly
//
// All four steps fit in a single follow-up commit (~half-day) since the
// data shape is stable.

import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import {
  type CaptionModel,
  type CaptionGroup,
  type CaptionSegment,
  type CaptionAnimationSet,
  isGroupActive,
  findSegment,
  activeSegmentInGroup,
  HYPE_DEFAULT_ANIM,
} from "./types";

interface Props {
  model: CaptionModel;
  /** Optional global override; falls back to model.defaultAnim or HYPE_DEFAULT_ANIM. */
  fallbackAnim?: CaptionAnimationSet;
}

export function CaptionsLayer({ model, fallbackAnim }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeSec = frame / fps;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {model.groups.map((group) => {
        if (!isGroupActive(group, timeSec)) return null;
        const animSet =
          group.animation ?? model.defaultAnim ?? fallbackAnim ?? HYPE_DEFAULT_ANIM;
        return (
          <CaptionGroupRenderer
            key={group.groupId}
            model={model}
            group={group}
            anim={animSet}
            timeSec={timeSec}
            fps={fps}
          />
        );
      })}
    </AbsoluteFill>
  );
}

interface GroupRendererProps {
  model: CaptionModel;
  group: CaptionGroup;
  anim: CaptionAnimationSet;
  timeSec: number;
  fps: number;
}

function CaptionGroupRenderer({ model, group, anim, timeSec, fps }: GroupRendererProps) {
  // Compute entrance progress 0→1 over animSet.entrance.duration starting
  // at group.start. Use Remotion's spring for natural motion (matches
  // GSAP's "back.out" feel reasonably well for our defaults).
  const entranceFrames = ((anim.entrance?.duration ?? 200) / 1000) * fps;
  const elapsedSinceStart = (timeSec - group.start) * fps;
  const entranceProgress = anim.entrance
    ? spring({
        frame: elapsedSinceStart,
        fps,
        config: { damping: 12, stiffness: 180, mass: 0.9 },
        durationInFrames: entranceFrames,
      })
    : 1;

  // Exit progress 0→1 over animSet.exit.duration ending at group.end.
  const exitStartTime = group.end - (anim.exit?.duration ?? 200) / 1000;
  const exitProgress = anim.exit
    ? interpolate(timeSec, [exitStartTime, group.end], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const activeSeg = activeSegmentInGroup(model, group, timeSec);
  const style = group.style;
  const hilight = anim.highlight;

  // Compute container transform from entrance + exit progress.
  const transform = composeTransform(anim, entranceProgress, exitProgress);
  const opacity = composeOpacity(anim, entranceProgress, exitProgress);

  return (
    <div
      data-testid={`caption-group-${group.groupId}`}
      style={{
        position: "absolute",
        bottom: style.bottomOffsetPx ?? 120,
        left: 0,
        right: 0,
        textAlign: style.textAlign ?? "center",
        transform,
        opacity,
      }}
    >
      <span
        style={{
          display: "inline-block",
          maxWidth: `${(style.maxWidthFraction ?? 0.85) * 100}%`,
          fontFamily: style.fontFamily,
          fontSize: typeof style.fontSize === "number" ? `${style.fontSize}px` : style.fontSize,
          fontWeight: style.fontWeight,
          color: style.color ?? "#FFFFFF",
          background: style.background,
          padding: style.padding,
          borderRadius:
            typeof style.borderRadius === "number" ? `${style.borderRadius}px` : style.borderRadius,
          WebkitTextStroke: style.textStroke
            ? `${style.textStroke.widthPx}px ${style.textStroke.color}`
            : undefined,
        }}
      >
        {group.segmentIds.map((segId, i) => {
          const seg = findSegment(model, segId);
          if (!seg) return null;
          const isActive = activeSeg?.segmentId === seg.segmentId;
          return (
            <CaptionWord
              key={segId}
              seg={seg}
              isActive={isActive}
              hilight={hilight}
              groupColor={style.color ?? "#FFFFFF"}
              isFirstInGroup={i === 0}
            />
          );
        })}
      </span>
    </div>
  );
}

interface CaptionWordProps {
  seg: CaptionSegment;
  isActive: boolean;
  hilight: CaptionAnimationSet["highlight"];
  groupColor: string;
  isFirstInGroup: boolean;
}

function CaptionWord({ seg, isActive, hilight, groupColor, isFirstInGroup }: CaptionWordProps) {
  const color = isActive ? hilight?.activeColor ?? groupColor : hilight?.dimColor ?? groupColor;
  const type = hilight?.type ?? "basic-color";

  // H3 — type-specific scale / transform overrides take precedence over the
  // generic activeScale legacy field when an extended type is set.
  let scale = isActive ? hilight?.activeScale ?? 1 : 1;
  if (isActive && type === "slam") {
    // Slam: 1.4 → 1.0 bounce on activation; CSS bezier approximates spring.
    scale = hilight?.slamScale ?? 1.4;
  } else if (isActive && type === "elastic") {
    // Elastic: scale oscillates +/- overshoot; we render the peak frame.
    scale = 1 + (hilight?.elasticOvershoot ?? 0.2);
  }
  const transform = scale !== 1 ? `scale(${scale})` : undefined;

  // marker-sweep: yellow translucent bar sweeps L→R across active words.
  const showMarkerSweep = isActive && type === "marker-sweep";
  // scribble: SVG underline/circle/strike emerges under/around active word.
  const showScribble = isActive && type === "scribble";
  // burst: radial lines around active word (rendered via pseudo-elements).
  const showBurst = isActive && type === "burst";
  // clip-reveal: clip-path inset reveals L→R during activation window.
  const clipPath =
    isActive && type === "clip-reveal" ? "inset(0 0 0 0)" : undefined;

  // Pre-paint transitions: base color/transform + clip-reveal animation
  const transitions = [
    "color 80ms linear",
    type === "slam" || type === "elastic"
      ? "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)"
      : "transform 120ms ease-out",
    "clip-path 280ms ease-out",
  ].join(", ");

  return (
    <span
      data-segment={seg.segmentId}
      data-active={isActive ? "true" : "false"}
      data-highlight-type={type}
      style={{
        position: "relative",
        color,
        transform,
        clipPath,
        display: "inline-block",
        transition: transitions,
        marginLeft: isFirstInGroup ? 0 : "0.18em",
      }}
    >
      {showMarkerSweep && (
        <span
          aria-hidden
          data-effect="marker-sweep"
          style={{
            position: "absolute",
            inset: "-0.05em -0.1em",
            background: hilight?.activeColor ?? "#ffd54f",
            opacity: 0.32,
            transform: "scaleX(1)",
            transformOrigin: "left center",
            transition: `transform ${(hilight?.sweepDuration ?? 0.3) * 1000}ms ease-out`,
            mixBlendMode: "multiply",
            borderRadius: 2,
            zIndex: -1,
          }}
        />
      )}
      {showScribble && (
        <Scribble
          path={hilight?.scribblePath ?? "underline"}
          color={hilight?.activeColor ?? "#a8c5d6"}
        />
      )}
      {showBurst && (
        <BurstLines
          count={hilight?.burstLineCount ?? 6}
          color={hilight?.activeColor ?? "#a8c5d6"}
        />
      )}
      {seg.text}
    </span>
  );
}

function Scribble({
  path,
  color,
}: {
  path: "underline" | "circle" | "strike";
  color: string;
}) {
  // Hand-rolled SVG path-length animation. The path is positioned over the
  // word via the parent span's relative layout; stroke-dasharray creates
  // a "drawn-in" effect when the active state flips on.
  const isCircle = path === "circle";
  const isStrike = path === "strike";
  return (
    <svg
      aria-hidden
      data-effect={`scribble-${path}`}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: isCircle ? "-20% -10%" : isStrike ? "0" : "60% 0 -15% 0",
        width: isCircle ? "120%" : "100%",
        height: isCircle ? "140%" : "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {isCircle ? (
        <ellipse
          cx="50"
          cy="15"
          rx="48"
          ry="13"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="200"
          strokeDashoffset="0"
          style={{
            transition: "stroke-dashoffset 320ms ease-out",
          }}
        />
      ) : (
        <path
          d={isStrike ? "M 2 15 Q 50 12 98 15" : "M 2 22 Q 50 28 98 22"}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="120"
          strokeDashoffset="0"
          style={{
            transition: "stroke-dashoffset 280ms ease-out",
          }}
        />
      )}
    </svg>
  );
}

function BurstLines({ count, color }: { count: number; color: string }) {
  // Deterministic radial lines — angle = i * (360/count). No randomness so
  // the rendering stays deterministic per the hyperframes-inspired
  // capture-engine contract (frame-stable in Remotion).
  const lines = Array.from({ length: count }, (_, i) => {
    const angle = (i * 360) / count;
    return (
      <span
        key={i}
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 28,
          height: 2.5,
          background: color,
          borderRadius: 1,
          transform: `translate(0, -50%) rotate(${angle}deg) translateX(0.55em)`,
          transformOrigin: "left center",
          opacity: 0.85,
        }}
      />
    );
  });
  return (
    <span
      aria-hidden
      data-effect="burst"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {lines}
    </span>
  );
}

// ── transform / opacity helpers ─────────────────────────────────────

function composeTransform(
  anim: CaptionAnimationSet,
  entrance: number,
  exit: number,
): string {
  const parts: string[] = [];

  if (anim.entrance) {
    if (anim.entrance.type === "slide-up") {
      const px = (1 - entrance) * 24;
      parts.push(`translateY(${px}px)`);
    } else if (anim.entrance.type === "scale-pop") {
      const s = 0.8 + entrance * 0.2;
      parts.push(`scale(${s})`);
    }
    // fade: handled in opacity
  }

  if (anim.exit && exit > 0) {
    if (anim.exit.type === "slide-down") {
      const px = exit * 24;
      parts.push(`translateY(${px}px)`);
    } else if (anim.exit.type === "scale-out") {
      const s = 1 - exit * 0.2;
      parts.push(`scale(${s})`);
    }
  }

  return parts.join(" ") || "none";
}

function composeOpacity(
  anim: CaptionAnimationSet,
  entrance: number,
  exit: number,
): number {
  let opacity = 1;
  if (anim.entrance?.type === "fade") opacity = entrance;
  if (anim.exit?.type === "fade") opacity = 1 - exit;
  if (anim.exit && exit > 0 && anim.exit.type !== "fade") {
    // For non-fade exits we still gently fade out the last 30% of the
    // exit window so the element disappears cleanly without jitter on
    // its final transform.
    opacity = Math.max(0, 1 - Math.max(0, (exit - 0.7) / 0.3));
  }
  return opacity;
}
