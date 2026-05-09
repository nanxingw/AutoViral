// R46 — CaptionModel data shape, ported from heygen-com/hyperframes
// packages/studio/src/captions/types.ts:46-145 with simplifications for
// our Remotion-based Stage.
//
// R46 #4 wire-in (2026-05-09): the canonical Zod schema + types now live
// in src/shared/composition.ts so both server (Composition validation)
// and web (Scene.tsx + CaptionsLayer) share one source of truth. This
// file keeps the helper functions + the HYPE_DEFAULT_ANIM preset; the
// types are re-exported from shared.
//
// ## Why this exists alongside subtitle_burn.py
//
// Today our subtitle pipeline is:
//   audio → caption_generate.py (ASR) → ASS subtitles → subtitle_burn.py
//   → libass overlay → hard-baked into final mp4.
//
// Hard-baking means *every text tweak forces a full re-render*. For an
// editorial workflow where we iterate on copy 5-10× per video, that's
// ~30-60 minutes of pure re-render time per session, all of which is
// avoidable.
//
// This `CaptionModel` is the data shape for a *separate overlay layer*
// rendered through Remotion or composited at the very end of the
// pipeline. The actual "render captions on top" implementation lives in
// `CaptionsLayer.tsx` (next to this file). Both can coexist with the
// libass path during a transition period — the user picks per-comp via
// `composition.captionStrategy = "burn" | "overlay"`.
//
// ## Hyperframes lineage
//
// Their CaptionModel splits semantic data (segments — per-word ASR
// output) from visual data (groups — visual line/block grouping with
// shared style). That separation is critical: the same underlying ASR
// can be regrouped (more lines / fewer / different splits) without
// re-running Whisper. We adopt the same shape.

// Re-export the canonical types from the shared schema. Keeps the
// public surface compatible with code that imports from this file
// while consolidating definitions.
export type {
  CaptionSegment,
  CaptionGroup,
  CaptionGroupStyle,
  CaptionAnimationSet,
  CaptionModel,
  CaptionStrategy,
} from "@shared/composition";

import type {
  CaptionGroup,
  CaptionGroupStyle,
  CaptionModel,
  CaptionSegment,
  CaptionAnimationSet,
} from "@shared/composition";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Look up a segment by ID. O(N) — acceptable since groups have ~10
 * segments each and we only walk on regrouping.
 */
export function findSegment(
  model: CaptionModel,
  segmentId: string,
): CaptionSegment | undefined {
  return model.segments.find((s) => s.segmentId === segmentId);
}

/**
 * Determine if a group is "active" at a given time. Used by
 * CaptionsLayer to decide which DOM nodes to mount.
 */
export function isGroupActive(group: CaptionGroup, timeSec: number): boolean {
  return timeSec >= group.start && timeSec <= group.end;
}

/**
 * For a given group + current time, return which segment (if any) is
 * the "active" word — the one being spoken right now. Used to drive
 * the highlight color.
 */
export function activeSegmentInGroup(
  model: CaptionModel,
  group: CaptionGroup,
  timeSec: number,
): CaptionSegment | undefined {
  for (const segId of group.segmentIds) {
    const seg = findSegment(model, segId);
    if (seg && timeSec >= seg.start && timeSec <= seg.end) return seg;
  }
  return undefined;
}

/**
 * Default animation set tuned for douyin-style hype captions. Other
 * presets (xhs-soft, editorial-slow, news-ticker) live in a separate
 * file (TODO) — this is the one we'd reach for if no override.
 */
export const HYPE_DEFAULT_ANIM: CaptionAnimationSet = {
  entrance: {
    duration: 280,
    ease: "back.out(1.6)",
    type: "scale-pop",
  },
  highlight: {
    activeColor: "#FFEB3B", // brand-yellow
    dimColor: "#FFFFFF",
    activeScale: 1.08,
  },
  exit: {
    duration: 200,
    ease: "power2.in",
    type: "scale-out",
  },
};

/**
 * Auto-grouping helper: given a flat segment list (raw whisper output),
 * produce a default groups array splitting on punctuation + max-words.
 * This is the "plumbing" port of hyperframes' default grouper — the
 * style + content choices belong in our `taste/` layer eventually.
 */
export function autoGroupSegments(
  segments: CaptionSegment[],
  opts: {
    maxWordsPerGroup?: number;
    style: CaptionGroupStyle;
  },
): CaptionGroup[] {
  const maxWords = opts.maxWordsPerGroup ?? 5;
  const groups: CaptionGroup[] = [];
  let bucket: CaptionSegment[] = [];

  const flushBucket = () => {
    if (bucket.length === 0) return;
    groups.push({
      groupId: `g_${groups.length}`,
      start: bucket[0]!.start,
      end: bucket[bucket.length - 1]!.end,
      segmentIds: bucket.map((s) => s.segmentId),
      style: opts.style,
    });
    bucket = [];
  };

  for (const seg of segments) {
    bucket.push(seg);
    // Split on terminal punctuation OR max-words reached.
    const trimmed = seg.text.trim();
    const ends = /[.!?。！？]$/.test(trimmed) || bucket.length >= maxWords;
    if (ends) flushBucket();
  }
  flushBucket();
  return groups;
}
