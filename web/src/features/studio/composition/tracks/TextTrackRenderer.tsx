import {
  Sequence,
  AbsoluteFill,
  useVideoConfig,
  interpolate,
  useCurrentFrame,
} from "remotion";
import type { TextClip, Track } from "../../types";
import { resolvePosition } from "../layout/positionResolve";

function AnimatedText({ clip }: { clip: TextClip }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const opacity =
    clip.animation === "fade"
      ? interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" })
      : 1;
  const yOffset =
    clip.animation === "slide-up"
      ? interpolate(frame, [0, 12], [40, 0], { extrapolateRight: "clamp" })
      : 0;
  const pos = resolvePosition(clip.position, { width, height });
  return (
    <div
      style={{
        ...pos,
        opacity,
        transform: `${pos.transform} translateY(${yOffset}px)`,
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
      {clip.text}
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
