import { Sequence, Video, useVideoConfig, useCurrentFrame, Easing } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { groupChains } from "../transitions/groupChains";
import { presentationFor } from "../transitions/presentations";
import type { Transition } from "@shared/composition";
import type { VideoClip, Track } from "../../types";

/** Map a transition's `easing` field to a Remotion timing function. Phase 1
 *  persisted easing/alignment but the renderer hardcoded linearTiming, so the
 *  field was dead data; this wires it: spring → springTiming, ease-in-out →
 *  eased linearTiming, linear → straight linearTiming. */
function timingFor(easing: Transition["easing"], durationInFrames: number) {
  switch (easing) {
    case "spring":
      return springTiming({ durationInFrames, config: { damping: 200 } });
    case "ease-in-out":
      return linearTiming({ durationInFrames, easing: Easing.inOut(Easing.ease) });
    case "linear":
    default:
      return linearTiming({ durationInFrames });
  }
}
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
  // S16 (US 25) — fit-fill mode. The renderer used to hardcode objectFit:"cover"
  // (always crop). `fitMode` (default "cover" — back-compat for pre-S16 works
  // with no field) now drives the fill:
  //   cover   → objectFit cover (crop-to-fill, legacy),
  //   contain → objectFit contain (letterbox, no crop),
  //   blur    → a blurred enlarged COVER background behind a CONTAIN foreground,
  //            so the letterbox bars become a soft blurred fill of the frame.
  const fitMode = clip.fitMode ?? "cover";
  const transform = `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
  // Browser-side player uses <Video> (single <video> element backed by
  // browser native playback) instead of <OffthreadVideo>. OffthreadVideo
  // is more accurate for server-side rendering (FFmpeg + worker, used by
  // render-pipeline.ts), but in the player it spawns a chunk pool of ~16
  // hidden <video> tags that exhaust Chrome's hardware decoder budget,
  // producing periodic ~3s playback hitches as the browser LRU-evicts
  // and re-decodes IDR frames. Server render path is unaffected — that
  // goes through Remotion CLI, not this component. (2026-05-08)
  const baseProps = {
    src: clip.src,
    startFrom: Math.round(clip.in * fps),
    endAt: Math.round(clip.out * fps),
    playbackRate: speed,
    // R47-fix5 (Codex pick 2) — widen Remotion's hard-seek drift
    // tolerance from the default 0.45s. Below the threshold Remotion
    // just nudges currentTime; above it does a discrete seek (which
    // the user perceives as a "rewind"). The default trips on every
    // long main-thread commit / decoder hiccup; 1.2s lets normal
    // drift settle on its own. Pairs with `pauseWhenBuffering` so
    // we don't seek during load events either.
    acceptableTimeShiftInSeconds: 1.2,
    pauseWhenBuffering: true,
  } as const;

  // blur → two stacked layers: a blurred cover fill behind a contained frame.
  if (fitMode === "blur") {
    return (
      <div style={{ position: "absolute", inset: 0, opacity }}>
        <Video
          {...baseProps}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // The blurred background scales slightly past the frame so the blur
            // has no hard edges, and stacks the clip's own filter chain on top.
            filter: `blur(48px) ${filter || ""}`.trim(),
            transform: "scale(1.1)",
          }}
        />
        <Video
          {...baseProps}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            filter: filter || undefined,
            transform,
          }}
        />
      </div>
    );
  }

  // cover / contain → a single layer, objectFit driven by fitMode.
  return (
    <Video
      {...baseProps}
      style={{
        width: "100%",
        height: "100%",
        objectFit: fitMode === "contain" ? "contain" : "cover",
        filter: filter || undefined,
        transform,
        opacity,
      }}
    />
  );
}

export function VideoTrackRenderer({ track }: { track: Track }) {
  const { fps, width, height } = useVideoConfig();
  if (track.hidden) return null;
  const chains = groupChains(track.clips as VideoClip[], track.transitions ?? []);
  return (
    <>
      {chains.map((chain) => {
        const first = chain.clips[0];
        const from = Math.round(first.trackOffset * fps);
        // Single-clip chain → plain <Sequence> (unchanged behaviour). This
        // covers ALL tracks until the user adds a transition; matters for
        // back-compat with every existing test + work.
        if (chain.clips.length === 1) {
          const dur = Math.max(1, Math.round(effectiveClipDuration(first) * fps));
          return (
            <Sequence key={first.id} from={from} durationInFrames={dur}>
              <VideoClipRenderer clip={first} />
            </Sequence>
          );
        }
        // Multi-clip chain → wrap the chain at its first clip's time, then let
        // Remotion's <TransitionSeries> compose .Sequence + .Transition. The
        // transition consumes durationInFrames from BOTH adjacent sequences
        // (handles), shortening the chain by sum(transition durations) — same
        // visual outcome as the EXPORT because Stage 1 of render-pipeline runs
        // this exact <Scene/> (WYSIWYG by construction, #54 Phase 1).
        return (
          <Sequence key={chain.clips.map((c) => c.id).join(":")} from={from}>
            <TransitionSeries>
              {chain.clips.flatMap((c, i) => {
                const seqDur = Math.max(1, Math.round(effectiveClipDuration(c) * fps));
                const nodes: React.ReactNode[] = [
                  <TransitionSeries.Sequence
                    key={`s-${c.id}`}
                    durationInFrames={seqDur}
                  >
                    <VideoClipRenderer clip={c} />
                  </TransitionSeries.Sequence>,
                ];
                const t = chain.transitions[i];
                if (t) {
                  const trDur = Math.max(1, Math.round(t.durationSec * fps));
                  nodes.push(
                    <TransitionSeries.Transition
                      key={`t-${t.id}`}
                      presentation={presentationFor(t.preset, { width, height })}
                      timing={timingFor(t.easing, trDur)}
                    />,
                  );
                }
                return nodes;
              })}
            </TransitionSeries>
          </Sequence>
        );
      })}
    </>
  );
}
