// Phase 4.G — split-tool hover snap.
//
// Pneuma reference: `.cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/
// hooks/useSplitHoverSnap.ts` (46 lines). Pneuma's signature takes
// `(clip, rawLocalPx, pixelsPerSecond)` and returns a snapped local-px
// value because its tool overlay paints **per-clip** dashed guides
// inside each clip's bounding box. AutoViral's BladeTool is a single
// absolute overlay above the lanes container — so this hook tracks a
// timeline-wide hover time and returns the snapped time. We still reuse
// pneuma's snap-points algorithm via `collectSnapPoints` + `snapToNearest`
// (3A: pneuma wins on the magnetic snap math; we adapt the surface to
// match our overlay shape).
import { useState, useMemo } from "react";
import { useComposition } from "../../../store";
import {
  collectSnapPoints,
  snapToNearest,
  snapToleranceSeconds,
} from "@autoviral/timeline";

export interface SplitHoverSnap {
  /** Snapped (or raw) hover time in seconds; null when not hovering. */
  snapTime: number | null;
  /** True when the snap landed on a clip edge / playhead / t=0. */
  snappedToEdge: boolean;
  /** The raw (pre-snap) hover time. */
  raw: number | null;
  /** Setter — feed `pointermove` x → `(x / pxPerSecond)` here. */
  setHoverTime: (t: number | null) => void;
}

export function useSplitHoverSnap(pxPerSecond = 100): SplitHoverSnap {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const comp = useComposition((s) => s.comp);
  const currentFrame = useComposition((s) => s.currentFrame);
  const beats = useComposition((s) => s.beats);
  const fps = comp?.fps ?? 30;
  const playhead = currentFrame / fps;

  const snap = useMemo(() => {
    if (hoverTime === null) {
      return { snapTime: null, snappedToEdge: false, raw: null as number | null };
    }
    const points = collectSnapPoints(comp, new Set(), playhead, beats);
    const r = snapToNearest(
      hoverTime,
      points,
      snapToleranceSeconds(pxPerSecond),
    );
    return {
      snapTime: r.time,
      snappedToEdge: r.snappedTo !== null,
      raw: hoverTime,
    };
  }, [beats, comp, hoverTime, playhead, pxPerSecond]);

  return { ...snap, setHoverTime };
}
