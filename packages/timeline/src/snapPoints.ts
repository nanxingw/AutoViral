// port from .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/snapPoints.ts:23-99
// (adapted: pneuma's clip.startTime/clip.duration → AutoViral trackOffset + clipDuration(c))
import type { Composition } from "../../types";
import { clipEnd } from "./clipMath";

export interface SnapPoint {
  time: number;
  label: string;
}

export function collectSnapPoints(
  composition: Composition | null,
  excludeClipIds: ReadonlySet<string>,
  playheadTime: number,
): SnapPoint[] {
  const points: SnapPoint[] = [{ time: 0, label: "start" }];
  if (Number.isFinite(playheadTime) && playheadTime >= 0) {
    points.push({ time: playheadTime, label: "playhead" });
  }
  if (!composition) return points;
  for (const track of composition.tracks) {
    for (const clip of track.clips) {
      if (excludeClipIds.has(clip.id)) continue;
      points.push({ time: clip.trackOffset, label: `${clip.id}:start` });
      points.push({ time: clipEnd(clip), label: `${clip.id}:end` });
    }
  }
  return points;
}

export function snapToNearest(
  candidate: number,
  points: readonly SnapPoint[],
  threshold: number,
): { time: number; snappedTo: number | null } {
  let bestDelta = threshold;
  let best: SnapPoint | null = null;
  for (const p of points) {
    const d = Math.abs(candidate - p.time);
    if (d < bestDelta) {
      bestDelta = d;
      best = p;
    }
  }
  if (best === null) return { time: candidate, snappedTo: null };
  return { time: best.time, snappedTo: best.time };
}

export function snapDraggedStartToPoints(
  candidateStart: number,
  draggedDuration: number,
  points: readonly SnapPoint[],
  threshold: number,
): { start: number; snapTime: number | null } {
  let start = Math.max(0, candidateStart);
  const end = start + draggedDuration;
  let snapTime: number | null = null;
  let bestDelta = threshold;

  for (const p of points) {
    const startDelta = Math.abs(start - p.time);
    if (startDelta < bestDelta) {
      bestDelta = startDelta;
      start = p.time;
      snapTime = p.time;
    }
    const endDelta = Math.abs(end - p.time);
    if (endDelta < bestDelta) {
      bestDelta = endDelta;
      start = p.time - draggedDuration;
      snapTime = p.time;
    }
  }

  return { start: Math.max(0, start), snapTime };
}
