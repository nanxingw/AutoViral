import { Sequence, useVideoConfig, Img, useCurrentFrame } from "remotion";
import type { OverlayClip, Track } from "../../types";
import { interpolateProperty } from "@shared/keyframes";

/**
 * Pure helper for testability: returns the effective transform + opacity
 * for an overlay clip at a given clip-local frame. Transform keyframes are
 * pixel offsets that compose on top of OverlayClip.position (which is
 * percent-based placement). When no keyframe exists for a property:
 *   - opacity falls back to clip.opacity (D9)
 *   - transform components default to identity (scale=1, x=y=rotation=0)
 *     since OverlayClip has no static transforms field in the schema.
 */
export function computeOverlayPropsForFrame(
  clip: OverlayClip,
  localFrame: number,
  fps: number,
): { scale: number; x: number; y: number; rotation: number; opacity: number } {
  const localSec = localFrame / fps;
  const kfs = clip.keyframes;
  return {
    scale: interpolateProperty(kfs, "scale", localSec) ?? 1,
    x: interpolateProperty(kfs, "x", localSec) ?? 0,
    y: interpolateProperty(kfs, "y", localSec) ?? 0,
    rotation: interpolateProperty(kfs, "rotation", localSec) ?? 0,
    opacity: interpolateProperty(kfs, "opacity", localSec) ?? clip.opacity,
  };
}

function OverlayClipRenderer({ clip }: { clip: OverlayClip }) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const { scale, x, y, rotation, opacity } = computeOverlayPropsForFrame(
    clip,
    frame,
    fps,
  );
  return (
    <Img
      src={clip.src}
      style={{
        position: "absolute",
        left: `${clip.position.xPct}%`,
        top: `${clip.position.yPct}%`,
        width: `${clip.position.wPct}%`,
        height: `${clip.position.hPct}%`,
        opacity,
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
      }}
    />
  );
}

export function OverlayTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as OverlayClip[]).map((c) => (
        <Sequence
          key={c.id}
          from={Math.round(c.trackOffset * fps)}
          durationInFrames={Math.max(1, Math.round(c.duration * fps))}
        >
          <OverlayClipRenderer clip={c} />
        </Sequence>
      ))}
    </>
  );
}
