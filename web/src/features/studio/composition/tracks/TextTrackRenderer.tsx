import {
  Sequence,
  AbsoluteFill,
  useVideoConfig,
  interpolate,
  spring,
  useCurrentFrame,
} from "remotion";
import type { TextClip, Track } from "../../types";
import { resolvePosition } from "../layout/positionResolve";

// ─── Animation primitives (pure, exported for tests) ───────────────────────

/**
 * Kinetic-pop: spring-driven scale from 0 → 1.05 (overshoot) → 1.0.
 * Damping intentionally low for a brisk attention-grabbing entrance.
 */
export function computeKineticPopScale(frame: number, fps: number): number {
  return spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.6, stiffness: 180 },
    durationInFrames: 18,
  });
}

/**
 * Typewriter: number of chars to reveal at the given frame. Default cadence
 * is 2 frames per character (≈15 chars/sec @ 30fps), capped at text length.
 */
export function computeTypewriterChars(
  text: string,
  frame: number,
  _fps: number,
  framesPerChar = 2,
): number {
  const max = text.length;
  const revealed = Math.floor(frame / framesPerChar);
  return Math.max(0, Math.min(max, revealed));
}

// ─── Component ─────────────────────────────────────────────────────────────

function AnimatedText({ clip }: { clip: TextClip }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const pos = resolvePosition(clip.position, { width, height });

  let opacity = 1;
  let yOffset = 0;
  let scale = 1;
  let renderedText = clip.text;

  switch (clip.animation) {
    case "fade":
      opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
      break;
    case "slide-up":
      yOffset = interpolate(frame, [0, 12], [40, 0], { extrapolateRight: "clamp" });
      break;
    case "kinetic-pop":
      scale = computeKineticPopScale(frame, fps);
      // Light fade-in companion so the pop doesn't appear from solid full
      opacity = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: "clamp" });
      break;
    case "typewriter":
      renderedText = clip.text.slice(0, computeTypewriterChars(clip.text, frame, fps));
      break;
    default:
      break;
  }

  return (
    <div
      style={{
        ...pos,
        opacity,
        transform: `${pos.transform} translateY(${yOffset}px) scale(${scale})`,
        transformOrigin: "center center",
        fontFamily: clip.style.font,
        fontSize: clip.style.size,
        fontWeight: clip.style.weight,
        fontStyle: clip.style.italic ? "italic" : "normal",
        letterSpacing: clip.style.tracking,
        color: clip.style.color,
        textShadow: clip.style.stroke
          ? `0 0 ${clip.style.stroke.width}px ${clip.style.stroke.color}`
          : undefined,
        whiteSpace: "pre-wrap",
        textAlign: "center",
      }}
    >
      {renderedText}
    </div>
  );
}

export function TextTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as TextClip[]).map((c) => (
        <Sequence
          key={c.id}
          from={Math.round(c.trackOffset * fps)}
          durationInFrames={Math.max(1, Math.round(c.duration * fps))}
        >
          <AbsoluteFill>
            <AnimatedText clip={c} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
}
