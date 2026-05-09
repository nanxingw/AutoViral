// R46 — CaptionModel data shape, ported from heygen-com/hyperframes
// packages/studio/src/captions/types.ts:46-145 with simplifications for
// our Remotion-based Stage.
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

/**
 * One ASR segment — typically a single word, sometimes a short phrase
 * (whisper occasionally groups 2-3 small words like "you know"). Times
 * are in seconds from start of the audio track.
 */
export interface CaptionSegment {
  /** Stable ID across regroupings; opaque string. */
  segmentId: string;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. start < end always. */
  end: number;
  /** The literal text. Punctuation is part of this string. */
  text: string;
}

/**
 * Animation parameters for a caption group's lifecycle:
 * entrance (when it appears) → highlight (per-word karaoke as audio
 * plays it) → exit (when it disappears).
 *
 * R46 ships only the *data shape*. Actual GSAP/CSS implementation
 * lives in CaptionsLayer.tsx — this is the prop contract.
 */
export interface CaptionAnimationSet {
  entrance?: {
    /** ms duration. 0 = no animation. */
    duration: number;
    /** GSAP-compatible ease name, e.g. "power2.out". */
    ease?: string;
    /** From which axis: y (slide up), scale (pop), opacity (fade). */
    type: "slide-up" | "scale-pop" | "fade";
    /** Stagger between words in ms (only for type "slide-up"). */
    staggerMs?: number;
  };
  /** Per-word highlight color while it's the "active" segment. */
  highlight?: {
    /** Color when a word is being spoken. */
    activeColor: string;
    /** Color when a word is upcoming or already passed. */
    dimColor: string;
    /** Optional scale bump on active word for emphasis. 1.0 = none. */
    activeScale?: number;
  };
  exit?: {
    duration: number;
    ease?: string;
    type: "slide-down" | "fade" | "scale-out";
  };
}

/**
 * A visual group of segments rendered as one caption block. Typically
 * 1-3 words for hype-style captions, 5-10 for editorial. The group's
 * `start` and `end` define the wall-clock window when it's visible
 * (entrance starts at start, exit ends at end).
 */
export interface CaptionGroup {
  groupId: string;
  /** Visible window — overlay is mounted from start to end. */
  start: number;
  end: number;
  /** segmentIds (referencing CaptionSegment.segmentId) that this group
   *  composes, in render order. */
  segmentIds: string[];
  /** Style for this group. Per-group so different lines can have
   *  different fonts / colors / sizes (e.g. emphasis line). */
  style: CaptionGroupStyle;
  /** Optional animation override; falls back to CaptionModel.defaultAnim. */
  animation?: CaptionAnimationSet;
}

export interface CaptionGroupStyle {
  /** CSS font-family. */
  fontFamily?: string;
  /** Pixel value or CSS string. */
  fontSize: number | string;
  /** font-weight 100..900 or "bold". */
  fontWeight?: number | string;
  /** Default text color (used by dimColor when highlight is off). */
  color?: string;
  /** Background fill behind text — useful for hype-style cards. */
  background?: string;
  /** padding shorthand string e.g. "8px 14px". */
  padding?: string;
  /** Border-radius pixels or CSS string. */
  borderRadius?: number | string;
  /** text-align. */
  textAlign?: "left" | "center" | "right";
  /** Pixel offset from bottom of stage. Common values: 80 (TikTok),
   *  120 (IG Reels), 200 (Shorts where action layer is at bottom). */
  bottomOffsetPx?: number;
  /** Max line width as fraction of stage width (0..1). 0.85 = 85% wide. */
  maxWidthFraction?: number;
  /** Stroke / outline for legibility on busy backgrounds. */
  textStroke?: { widthPx: number; color: string };
}

/**
 * Top-level caption model attached to a Composition. One model per
 * audio track typically; multiple models supported for multi-track
 * projects with separate captions per voice.
 */
export interface CaptionModel {
  /** Stable ID; lets multiple caption tracks coexist. */
  modelId: string;
  /** Which audio track this model captions. References Composition
   *  audio track id. Null = derived from main video audio. */
  audioTrackId?: string | null;
  /** Source ASR output. Independent of grouping. */
  segments: CaptionSegment[];
  /** Visual rendering. Multiple groups can share segments (e.g. for a
   *  "highlight word" cross-fade); typically 1:N segment→group. */
  groups: CaptionGroup[];
  /** Default animation when group.animation is unset. */
  defaultAnim?: CaptionAnimationSet;
  /** Source language code (zh / en / etc) — for font picks. */
  language?: string;
}

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
