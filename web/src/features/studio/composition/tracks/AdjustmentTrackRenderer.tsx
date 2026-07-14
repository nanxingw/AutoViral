import { Sequence, useVideoConfig } from "remotion";
import { resolveClipEffects } from "@shared/composition";
import { effectsToCssFilter, blendModeToCss } from "../filters/cssFilters";
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
        const filter = effectsToCssFilter(resolveClipEffects(clip));
        // Nothing to apply (empty / all-disabled stack) → render no layer at all.
        if (!filter) return null;
        const blend = blendModeToCss(clip.blendMode);
        return (
          <Sequence key={clip.id} from={from} durationInFrames={dur}>
            <div
              data-test="adjustment-layer"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                backdropFilter: filter,
                WebkitBackdropFilter: filter,
                ...(blend
                  ? { mixBlendMode: blend as React.CSSProperties["mixBlendMode"] }
                  : {}),
              }}
            />
          </Sequence>
        );
      })}
    </>
  );
}
