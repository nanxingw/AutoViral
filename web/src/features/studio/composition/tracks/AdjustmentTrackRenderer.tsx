import { Sequence, useVideoConfig } from "remotion";
import { resolveClipEffects } from "@shared/composition";
import {
  effectsToCssFilter,
  effectOverlayLayers,
  blendModeToCss,
} from "../filters/cssFilters";
import type { Track, AdjustmentClip } from "../../types";

// PRD-0014 S14 — an ADJUSTMENT lane. Each adjustment clip is an EFFECT WINDOW: a
// `<Sequence>` over `[trackOffset, trackOffset+duration)` that paints a full-frame
// layer whose CSS `backdrop-filter` applies the clip's effect stack to the
// COMPOSITED output of every track painted BELOW it (a lane placed later in the
// composition's track array = higher z, so it grades the z-lower video/overlay
// tracks). Consumed identically by preview + the headless export (renderMedia
// runs this SAME tree) — WYSIWYG by construction, no ffmpeg dual. Outside the
// window the <Sequence> renders nothing, so the grade is time-bounded.
export function AdjustmentTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as AdjustmentClip[]).map((clip) => {
        const from = Math.round(clip.trackOffset * fps);
        const dur = Math.max(1, Math.round(clip.duration * fps));
        const effects = resolveClipEffects(clip);
        // grade / blur → a `backdrop-filter` that grades the z-lower tracks.
        const filter = effectsToCssFilter(effects);
        // Review fix (finding #4) — vignette / grain are NOT CSS `filter`
        // functions, so effectsToCssFilter drops them. They must still take
        // effect on an adjustment lane: paint them as overlay layers OVER the
        // composited z-lower output (a darkening / noise veil). Two of the four
        // built-in effect types were silently inert on adjustment tracks before.
        const overlays = effectOverlayLayers(effects);
        // Nothing to apply (empty / all-disabled stack) → render no layer at all.
        if (!filter && overlays.length === 0) return null;
        const blend = blendModeToCss(clip.blendMode);
        const blendStyle = blend
          ? { mixBlendMode: blend as React.CSSProperties["mixBlendMode"] }
          : {};
        return (
          <Sequence key={clip.id} from={from} durationInFrames={dur}>
            {filter ? (
              <div
                data-test="adjustment-layer"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  backdropFilter: filter,
                  WebkitBackdropFilter: filter,
                  ...blendStyle,
                }}
              />
            ) : null}
            {overlays.map((o) => (
              <div
                key={o.key}
                data-test={o.testId}
                style={{ ...o.style, ...blendStyle }}
              />
            ))}
          </Sequence>
        );
      })}
    </>
  );
}
