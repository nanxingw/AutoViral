// Phase 4.F — useClipResize.
//
// Pneuma reference:
//   .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/useClipResize.ts
//   (274 lines, full read). Pneuma uses a `displayState` ref + `dispatch`
//   commands; AutoViral instead drives the Zustand `resizeClip` action
//   directly so each pointermove yields the authoritative store value
//   (Track / Clip render off `clip.in/out/trackOffset`, no display ref).
//
// Key adaptations:
// - Pneuma anchors on `originalOutPoint` and shifts `displayOutPoint`
//   directly. We store `anchorTime` (= original timeline time of the
//   moving edge) and dispatch `resizeClip(id, edge, snappedTime)`. The
//   D2 right-edge clamp (next clip's start) and `MIN_CLIP_DUR` floor
//   live inside the store action, so the hook stays a thin glue layer.
// - Snap pass uses `collectSnapPoints` + `snapToNearest` (D1 0.06s).
//   Pneuma's `SNAP_PX = 5 / pps` is roughly equivalent at our default
//   zoom but D1 is the audit-locked threshold, so we use the absolute
//   second value.
// - `cancelResize` re-dispatches `resizeClip` with the original
//   anchor time, restoring the clip to its pre-resize state. Pneuma
//   only commits a single trim command on mouseup; we mutate live, so
//   Escape needs an explicit revert (pneuma lines 217-237 emit the
//   commit; AutoViral inverts to a per-move dispatch + revert).
// - Pneuma additionally clamps right-edge outPoint to `assetDuration`
//   (pneuma:148,188). AutoViral's Clip schema has no source-duration
//   field today, so this upper bound is silently dropped — the only
//   cap on the right edge is the next clip's start (D2). TODO: once
//   Clip carries `assetDuration` (asset metadata schema work), add
//   `Math.min(cap, assetDuration)` inside resizeClip.
//
// The hook is pointer-event source-agnostic: it exposes
// `beginResize / dragResize / endResize / cancelResize` as imperative
// methods. The Clip component owns the actual `pointerdown` listener
// and translates it into these calls — that keeps the hook trivial to
// test (no document/window pointer plumbing required).

import { useCallback, useRef, useState } from "react";
import { useComposition } from "../../../store";
import { collectSnapPoints, snapToNearest, clipDuration } from "@autoviral/timeline";

const SNAP_THRESHOLD = 0.06;

interface ResizeStart {
  edge: "left" | "right";
  startClientX: number;
  /** Original timeline-time of the moving edge — also the revert target. */
  anchorTime: number;
}

export interface UseClipResize {
  isResizing: boolean;
  beginResize: (edge: "left" | "right", clientX: number) => void;
  dragResize: (clientX: number) => void;
  endResize: () => void;
  cancelResize: () => void;
}

export function useClipResize({
  clipId,
  pxPerSecond,
}: {
  clipId: string;
  pxPerSecond: number;
}): UseClipResize {
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef<ResizeStart | null>(null);

  const beginResize = useCallback(
    (edge: "left" | "right", clientX: number) => {
      const state = useComposition.getState();
      const clip = state.comp?.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!clip) return;
      const anchorTime =
        edge === "left"
          ? clip.trackOffset
          : clip.trackOffset + clipDuration(clip);
      startRef.current = { edge, startClientX: clientX, anchorTime };
      setIsResizing(true);
    },
    [clipId],
  );

  const dragResize = useCallback(
    (clientX: number) => {
      const start = startRef.current;
      if (!start) return;
      if (pxPerSecond <= 0) return;
      const state = useComposition.getState();
      if (!state.comp) return;
      const dx = clientX - start.startClientX;
      const dt = dx / pxPerSecond;
      const candidate = start.anchorTime + dt;
      const fps = state.comp.fps || 30;
      const playhead = state.currentFrame / fps;
      const points = collectSnapPoints(
        state.comp,
        new Set([clipId]),
        playhead,
      );
      const snap = snapToNearest(candidate, points, SNAP_THRESHOLD);
      state.resizeClip(clipId, start.edge, snap.time);
    },
    [clipId, pxPerSecond],
  );

  const endResize = useCallback(() => {
    startRef.current = null;
    setIsResizing(false);
  }, []);

  const cancelResize = useCallback(() => {
    const start = startRef.current;
    if (start) {
      // Revert the clip back to its pre-resize edge position. The store
      // action re-clamps but anchorTime is by construction inside the
      // valid range, so the round-trip is identity.
      useComposition
        .getState()
        .resizeClip(clipId, start.edge, start.anchorTime);
    }
    startRef.current = null;
    setIsResizing(false);
  }, [clipId]);

  return { isResizing, beginResize, dragResize, endResize, cancelResize };
}
