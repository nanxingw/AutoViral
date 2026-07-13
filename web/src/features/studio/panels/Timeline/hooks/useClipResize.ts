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
// - Snap pass uses `collectSnapPoints` + `snapToNearest` with the shared
//   6px screen-space radius converted through the active px/s scale.
// - `cancelResize` re-dispatches `resizeClip` with the original
//   anchor time, restoring the clip to its pre-resize state. Pneuma
//   only commits a single trim command on mouseup; we mutate live, so
//   Escape needs an explicit revert (pneuma lines 217-237 emit the
//   commit; AutoViral inverts to a per-move dispatch + revert).
// - Source duration comes from the composition asset registry
//   (`clip.src` ↔ `asset.uri`). It caps the right edge and defines the
//   complete-source ghost shown during a trim.
//
// The hook is pointer-event source-agnostic: it exposes
// `beginResize / dragResize / endResize / cancelResize` as imperative
// methods. The Clip component owns the actual `pointerdown` listener
// and translates it into these calls — that keeps the hook trivial to
// test (no document/window pointer plumbing required).

import { useCallback, useRef, useState } from "react";
import { useComposition } from "../../../store";
import {
  collectSnapPoints,
  snapToNearest,
  clipDuration,
  snapToleranceSeconds,
} from "@autoviral/timeline";
import { replaceTimelineSelection } from "../selectionMath";

interface ResizeStart {
  edge: "left" | "right";
  startClientX: number;
  /** Original timeline-time of the moving edge — also the revert target. */
  anchorTime: number;
  originalStart: number;
  originalIn: number;
  originalOut: number;
  hasSourceWindow: boolean;
  assetDuration: number;
  sourceGhost: SourceGhostBounds | null;
}

export interface SourceGhostBounds {
  startSec: number;
  endSec: number;
}

export interface UseClipResize {
  isResizing: boolean;
  beginResize: (edge: "left" | "right", clientX: number) => void;
  dragResize: (clientX: number) => void;
  endResize: () => void;
  cancelResize: () => void;
  sourceGhost: SourceGhostBounds | null;
}

const MIN_TRIM_DURATION = 0.1;

function comparableAssetPath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

function sourceDurationForClip(
  state: ReturnType<typeof useComposition.getState>,
  src: string,
): number {
  const comparableSrc = comparableAssetPath(src);
  const duration = state.comp?.assets.find(
    (asset) => comparableAssetPath(asset.uri) === comparableSrc,
  )?.metadata.duration;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? duration
    : Infinity;
}

function clampResizeTime(
  start: ResizeStart,
  desiredTimelineTime: number,
): number {
  if (start.edge === "left") {
    const sourceStartOnTimeline = start.originalStart - start.originalIn;
    const minTimelineTime = start.hasSourceWindow
      ? Math.max(0, sourceStartOnTimeline)
      : 0;
    const maxTimelineTime =
      start.originalStart +
      (start.originalOut - MIN_TRIM_DURATION - start.originalIn);
    return Math.min(maxTimelineTime, Math.max(minTimelineTime, desiredTimelineTime));
  }
  const minTimelineTime = start.originalStart + MIN_TRIM_DURATION;
  const maxTimelineTime = Number.isFinite(start.assetDuration)
    ? start.originalStart + (start.assetDuration - start.originalIn)
    : Infinity;
  return Math.min(maxTimelineTime, Math.max(minTimelineTime, desiredTimelineTime));
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
      const effectiveTimelineSelection =
        state.timelineSelection.primaryId === state.selection
          ? state.timelineSelection
          : replaceTimelineSelection(state.selection);
      if (
        effectiveTimelineSelection.ids.length > 1 &&
        effectiveTimelineSelection.primaryId !== clipId
      ) {
        return;
      }
      const anchorTime =
        edge === "left"
          ? clip.trackOffset
          : clip.trackOffset + clipDuration(clip);
      const hasSourceWindow = clip.kind === "video" || clip.kind === "audio";
      const originalIn = hasSourceWindow ? clip.in : 0;
      const originalOut = hasSourceWindow
        ? clip.out
        : clipDuration(clip);
      const assetDuration = hasSourceWindow
        ? sourceDurationForClip(state, clip.src)
        : Infinity;
      const sourceGhost =
        hasSourceWindow && Number.isFinite(assetDuration)
          ? {
              startSec: clip.trackOffset - originalIn,
              endSec: clip.trackOffset - originalIn + assetDuration,
            }
          : null;
      startRef.current = {
        edge,
        startClientX: clientX,
        anchorTime,
        originalStart: clip.trackOffset,
        originalIn,
        originalOut,
        hasSourceWindow,
        assetDuration,
        sourceGhost,
      };
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
      const candidate = clampResizeTime(start, start.anchorTime + dt);
      const fps = state.comp.fps || 30;
      const playhead = state.currentFrame / fps;
      const points = collectSnapPoints(
        state.comp,
        new Set([clipId]),
        playhead,
        state.beats,
      );
      const snap = snapToNearest(
        candidate,
        points,
        snapToleranceSeconds(pxPerSecond),
      );
      const resizedTime = clampResizeTime(start, snap.time);
      state.resizeClip(clipId, start.edge, resizedTime);
      state.setSnapGuide(
        snap.snappedTo != null && Math.abs(resizedTime - snap.snappedTo) < 1e-6
          ? snap.snappedTo
          : null,
      );
    },
    [clipId, pxPerSecond],
  );

  const endResize = useCallback(() => {
    useComposition.getState().setSnapGuide(null);
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
    useComposition.getState().setSnapGuide(null);
    startRef.current = null;
    setIsResizing(false);
  }, [clipId]);

  return {
    isResizing,
    beginResize,
    dragResize,
    endResize,
    cancelResize,
    sourceGhost: isResizing ? startRef.current?.sourceGhost ?? null : null,
  };
}
