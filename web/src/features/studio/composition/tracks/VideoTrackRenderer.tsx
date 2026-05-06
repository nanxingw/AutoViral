import { Sequence, OffthreadVideo, useVideoConfig, useCurrentFrame } from "remotion";
import type { VideoClip, Track } from "../../types";
import { toCssFilter } from "../filters/cssFilters";
import { interpolateProperty } from "@shared/keyframes";
import {
  computeVideoSpeedForFrame,
  effectiveClipDuration,
} from "@shared/speed-ramp";

/**
 * Pure helper for testability: returns the effective transform for a video
 * clip at a given clip-local frame. Each transform component falls back to
 * `clip.transforms.<prop>` when no keyframe exists for that property (D9).
 *
 * Volume keyframes are intentionally ignored on VideoClip in v1 (D5) — the
 * underlying MP4's audio track is not routed through Remotion's volume prop
 * yet. AudioClip is the only renderer that consumes volume keyframes.
 *
 * "speed" keyframes feed Remotion's playbackRate via computeVideoSpeedForFrame
 * below; they are NOT routed through the CSS transform string (D8).
 */
export function computeVideoTransformForFrame(
  clip: VideoClip,
  localFrame: number,
  fps: number,
): { scale: number; x: number; y: number; rotation: number } {
  const localSec = localFrame / fps;
  const t = clip.transforms;
  const kfs = clip.keyframes;
  return {
    scale: interpolateProperty(kfs, "scale", localSec) ?? t.scale,
    x: interpolateProperty(kfs, "x", localSec) ?? t.x,
    y: interpolateProperty(kfs, "y", localSec) ?? t.y,
    rotation: interpolateProperty(kfs, "rotation", localSec) ?? t.rotation,
  };
}

function VideoClipRenderer({ clip }: { clip: VideoClip }) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const filter = toCssFilter(clip.filters);
  const { scale, x, y, rotation } = computeVideoTransformForFrame(clip, frame, fps);
  // Phase 8.3.C — read speed keyframes (D3 fallback 1.0, D4 clamp). Routed
  // through Remotion's playbackRate prop, NOT the CSS transform (D8).
  const speed = computeVideoSpeedForFrame(clip, frame, fps);
  return (
    <OffthreadVideo
      src={clip.src}
      startFrom={Math.round(clip.in * fps)}
      endAt={Math.round(clip.out * fps)}
      playbackRate={speed}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: filter || undefined,
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
      }}
    />
  );
}

export function VideoTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as VideoClip[]).map((c) => {
        const from = Math.round(c.trackOffset * fps);
        // Phase 8.3.C — Sequence durationInFrames reflects the speed-adjusted
        // timeline width (D7); for static speed=k, that's (out - in) / k.
        const dur = Math.max(1, Math.round(effectiveClipDuration(c) * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <VideoClipRenderer clip={c} />
          </Sequence>
        );
      })}
    </>
  );
}
