// port from .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/dragEngine.ts:26-122
// (adapted: pneuma's clip.startTime/clip.duration → AutoViral trackOffset + clipDuration(c))
//
// Pure helpers for the timeline drag/snap/ripple engine. Verbatim algorithm
// from pneuma: a two-pass cascade (overlap-with-dragged → chain-resolve) that
// pins the dragged clip and pushes neighbours forward.
import type { Clip, Composition } from "../../types";
import { clipDuration, clipEnd } from "./clipMath";
import { collectSnapPoints, snapDraggedStartToPoints, type SnapPoint } from "./snapPoints";

/**
 * Compute preview positions for all clips when `draggedClipId` is placed at
 * `draggedNewStart`. The dragged clip is pinned; other clips are pushed
 * forward when they overlap. Returns a Map keyed by clipId; values are new
 * trackOffset (= start) times. The Map includes every clip in `clips`
 * (matching pneuma's behaviour) — non-overlapping clips get their original
 * trackOffset back.
 *
 * Port of pneuma `computeRipplePreview` (dragEngine.ts:26-71).
 */
export function computeRipplePreview(
  clips: readonly Clip[],
  draggedClipId: string,
  draggedNewStart: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return result;

  result.set(draggedClipId, draggedNewStart);

  const others = clips
    .filter((c) => c.id !== draggedClipId)
    .map((c) => ({ id: c.id, start: c.trackOffset, duration: clipDuration(c) }))
    .sort((a, b) => a.start - b.start);

  const draggedEnd = draggedNewStart + clipDuration(dragged);

  for (const c of others) {
    const cEnd = c.start + c.duration;
    if (c.start < draggedEnd && cEnd > draggedNewStart) {
      c.start = draggedEnd;
    }
    result.set(c.id, c.start);
  }

  const all = clips
    .map((c) => ({
      id: c.id,
      start: result.get(c.id)!,
      duration: clipDuration(c),
      pinned: c.id === draggedClipId,
    }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < all.length; i++) {
    const prevEnd = all[i - 1].start + all[i - 1].duration;
    if (all[i].start < prevEnd) {
      if (all[i].pinned) continue;
      all[i].start = prevEnd;
      result.set(all[i].id, all[i].start);
    }
  }

  return result;
}

/**
 * Snap a free-drag candidate `candidateStart` against the start/end of every
 * non-dragged clip on the same track plus timeline-zero. Returns the adjusted
 * start and the world-time of the snap line (null if no snap fired).
 *
 * Port of pneuma `snapDraggedStart` (dragEngine.ts:80-122). The algorithm is
 * "first-match wins" rather than nearest-point, which matches pneuma exactly.
 */
export function snapDraggedStart(
  clips: readonly Clip[],
  draggedClipId: string,
  candidateStart: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } {
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return { start: candidateStart, snapTime: null };

  const draggedDur = clipDuration(dragged);
  let newStart = Math.max(0, candidateStart);
  const newEnd = newStart + draggedDur;
  let snappedTime: number | null = null;

  for (const c of clips) {
    if (c.id === draggedClipId) continue;
    const cStart = c.trackOffset;
    const cEnd = clipEnd(c);
    if (Math.abs(newStart - cStart) < snapThresholdSeconds) {
      newStart = cStart;
      snappedTime = cStart;
      break;
    }
    if (Math.abs(newStart - cEnd) < snapThresholdSeconds) {
      newStart = cEnd;
      snappedTime = cEnd;
      break;
    }
    if (Math.abs(newEnd - cStart) < snapThresholdSeconds) {
      newStart = cStart - draggedDur;
      snappedTime = cStart;
      break;
    }
    if (Math.abs(newEnd - cEnd) < snapThresholdSeconds) {
      newStart = cEnd - draggedDur;
      snappedTime = cEnd;
      break;
    }
  }
  if (snappedTime === null && Math.abs(newStart) < snapThresholdSeconds) {
    newStart = 0;
    snappedTime = 0;
  }
  newStart = Math.max(0, newStart);
  return { start: newStart, snapTime: snappedTime };
}

/**
 * Convenience wrapper that pulls snap points from the full Composition
 * (i.e. cross-track edges + playhead) using snapPoints.ts, then dispatches
 * to the nearest-point snap. Used at the React seam where the store has
 * the whole composition + currentFrame.
 *
 * Unlike `snapDraggedStart` (intra-track, first-match), this routes through
 * `snapDraggedStartToPoints` (cross-track, nearest-point) — matches the
 * 4.A behaviour the rest of the timeline uses for guideline rendering.
 */
export function snapDraggedStartFull(
  composition: Composition | null,
  draggedClipId: string,
  draggedDuration: number,
  candidateStart: number,
  playheadTime: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } {
  const points: SnapPoint[] = collectSnapPoints(
    composition,
    new Set([draggedClipId]),
    playheadTime,
  );
  const r = snapDraggedStartToPoints(
    candidateStart,
    draggedDuration,
    points,
    snapThresholdSeconds,
  );
  return { start: Math.max(0, r.start), snapTime: r.snapTime };
}
