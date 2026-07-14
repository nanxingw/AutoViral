// PRD-0014 S15 (review fix) — the SINGLE same-track overlap detector.
//
// Before this module the overlap check lived as TWO hand-duplicated loops
// (src/shared/composition/preflight.ts + src/composition/quality/lint.ts) that
// (a) reported only a formatted string, not the structured clip-pair + interval
// the slice requires, (b) compared each clip against ONLY its immediately
// preceding sorted neighbour (missing nested non-adjacent overlaps like
// A=[0,10) ⊃ C=[3,4) once B=[1,2) sits between them), and (c) measured a clip's
// timeline span from raw `out - in`, ignoring speed ramps (a 4s source at 2×
// occupies 2 timeline seconds, at 0.5× it occupies 8 — both were wrong).
//
// This detector fixes all three: it returns STRUCTURED records, does a full
// pairwise sweep so every overlapping pair is reported, and derives each
// video/audio clip's timeline width from `effectiveClipDuration` (speed-aware).
// The preflight warning layer and the `track-overlap` lint rule both consume
// THIS one implementation — they only format the records into their own message
// shape.
//
// Interval semantics: HALF-OPEN [start, end). Clips that touch end-to-start are
// adjacent, NOT overlapping (mirrors the OpenCut placement model). Overlay lanes
// legitimately stack (picture-in-picture), so the caller decides whether to skip
// them — `detectOverlaps` skips overlay tracks; `detectTrackOverlaps` reports for
// whatever track it is handed.

import type { Composition } from "../composition.js";
import { effectiveClipDuration } from "../speed-ramp.js";

/** One overlapping pair on one track, with the overlap interval. */
export interface OverlapRecord {
  trackId: string;
  /** The earlier-starting clip of the pair. */
  clipAId: string;
  /** The later-starting clip of the pair. */
  clipBId: string;
  /** Overlap interval start = max(aStart, bStart) = bStart (b starts no earlier). */
  start: number;
  /** Overlap interval end = min(aEnd, bEnd). */
  end: number;
}

const OVERLAP_EPSILON = 1e-6;

interface Range {
  id: string;
  start: number;
  end: number;
}

/**
 * Timeline range of a single clip. Video/audio clips span their SPEED-AWARE
 * timeline width (`effectiveClipDuration`, not raw `out - in`); text/overlay
 * clips span their `duration`. Returns null for a clip we can't measure.
 */
function clipTimelineRange(clip: unknown): Range | null {
  const c = clip as {
    id?: string;
    trackOffset?: number;
    in?: number;
    out?: number;
    duration?: number;
    keyframes?: readonly import("../composition.js").Keyframe[];
  };
  const start = c.trackOffset ?? 0;
  let dur: number;
  if (c.duration !== undefined) {
    // text / overlay — a flat timeline duration, no source window / speed.
    dur = c.duration;
  } else if (c.in !== undefined && c.out !== undefined) {
    // video / audio — speed ramps shrink (>1×) or stretch (<1×) the timeline span.
    dur = effectiveClipDuration({ in: c.in, out: c.out, keyframes: c.keyframes });
  } else {
    return null;
  }
  return { id: c.id ?? "<unnamed>", start, end: start + dur };
}

/**
 * Every overlapping clip pair on ONE track. FULL pairwise sweep (O(n²) over a
 * track's clips — tracks are small) so nested non-adjacent overlaps are all
 * reported, not just adjacent ones. Caller decides overlay exemption.
 */
export function detectTrackOverlaps(track: {
  id: string;
  clips: readonly unknown[];
}): OverlapRecord[] {
  const ranges = track.clips
    .map(clipTimelineRange)
    .filter((r): r is Range => r !== null)
    .sort((a, b) => a.start - b.start);

  const records: OverlapRecord[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const a = ranges[i]!;
    for (let j = i + 1; j < ranges.length; j++) {
      const b = ranges[j]!;
      // a.start <= b.start (sorted). Half-open overlap iff b starts strictly
      // before a ends. (a.start < b.end holds trivially: a.start <= b.start < b.end.)
      if (b.start < a.end - OVERLAP_EPSILON) {
        records.push({
          trackId: track.id,
          clipAId: a.id,
          clipBId: b.id,
          start: b.start,
          end: Math.min(a.end, b.end),
        });
      }
    }
  }
  return records;
}

/**
 * Every overlapping clip pair across all NON-overlay tracks (video/audio/text).
 * Overlay lanes are exempt — picture-in-picture overlays legitimately stack.
 */
export function detectOverlaps(comp: Composition): OverlapRecord[] {
  const out: OverlapRecord[] = [];
  for (const track of comp.tracks) {
    if ((track as { kind?: string }).kind === "overlay") continue;
    out.push(
      ...detectTrackOverlaps(track as { id: string; clips: readonly unknown[] }),
    );
  }
  return out;
}

/** Human-readable one-liner for a record (names BOTH clip ids + the interval). */
export function formatOverlap(r: OverlapRecord): string {
  return (
    `clip "${r.clipBId}" overlaps "${r.clipAId}" on track "${r.trackId}" ` +
    `(${r.start.toFixed(2)}s starts before ${r.end.toFixed(2)}s)`
  );
}
