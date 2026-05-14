import { Sequence, Video, useVideoConfig, useCurrentFrame } from "remotion";
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

// Crossfade fix — read opacity keyframes from a video clip. Mirrors the
// OverlayTrackRenderer behavior so neighbouring video clips that overlap by a
// fade window get real CSS alpha-compositing instead of a hard cut. Default 1
// (fully visible) when no opacity keyframe is defined.
export function computeVideoOpacityForFrame(
  clip: VideoClip,
  localFrame: number,
  fps: number,
): number {
  return interpolateProperty(clip.keyframes, "opacity", localFrame / fps) ?? 1;
}

function VideoClipRenderer({ clip }: { clip: VideoClip }) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const filter = toCssFilter(clip.filters);
  const { scale, x, y, rotation } = computeVideoTransformForFrame(clip, frame, fps);
  // Phase 8.3.C — read speed keyframes (D3 fallback 1.0, D4 clamp). Routed
  // through Remotion's playbackRate prop, NOT the CSS transform (D8).
  const speed = computeVideoSpeedForFrame(clip, frame, fps);
  const opacity = computeVideoOpacityForFrame(clip, frame, fps);
  // Browser-side player uses <Video> (single <video> element backed by
  // browser native playback) instead of <OffthreadVideo>. OffthreadVideo
  // is more accurate for server-side rendering (FFmpeg + worker, used by
  // render-pipeline.ts), but in the player it spawns a chunk pool of ~16
  // hidden <video> tags that exhaust Chrome's hardware decoder budget,
  // producing periodic ~3s playback hitches as the browser LRU-evicts
  // and re-decodes IDR frames. Server render path is unaffected — that
  // goes through Remotion CLI, not this component. (2026-05-08)
  return (
    <Video
      src={clip.src}
      startFrom={Math.round(clip.in * fps)}
      endAt={Math.round(clip.out * fps)}
      playbackRate={speed}
      // R47-fix5 (Codex pick 2) — widen Remotion's hard-seek drift
      // tolerance from the default 0.45s. Below the threshold Remotion
      // just nudges currentTime; above it does a discrete seek (which
      // the user perceives as a "rewind"). The default trips on every
      // long main-thread commit / decoder hiccup; 1.2s lets normal
      // drift settle on its own. Pairs with `pauseWhenBuffering` so
      // we don't seek during load events either.
      acceptableTimeShiftInSeconds={1.2}
      pauseWhenBuffering
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: filter || undefined,
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
        opacity,
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
