import type { MessageKey } from "@/i18n/useT";

export type TimelineTrackKind = "video" | "audio" | "text" | "overlay" | "adjustment";

interface TimelineKindTokens {
  base: string;
  soft: string;
  border: string;
}

function timelineTokens(name: "video" | "audio" | "caption" | "overlay" | "adjustment") {
  return {
    base: `var(--timeline-${name})`,
    soft: `var(--timeline-${name}-soft)`,
    border: `var(--timeline-${name}-border)`,
  } satisfies TimelineKindTokens;
}

export const TIMELINE_KIND_TOKENS: Record<TimelineTrackKind, TimelineKindTokens> = {
  video: timelineTokens("video"),
  audio: timelineTokens("audio"),
  text: timelineTokens("caption"),
  overlay: timelineTokens("overlay"),
  // S14 (PRD-0014) — adjustment lane: a neutral muted-mauve, kept in the same
  // low-saturation family as the other four kinds.
  adjustment: timelineTokens("adjustment"),
};

export const EMPTY_TRACK_MESSAGE_KEYS = {
  video: "studio.timeline.emptyTrack.video",
  audio: "studio.timeline.emptyTrack.audio",
  text: "studio.timeline.emptyTrack.text",
  overlay: "studio.timeline.emptyTrack.overlay",
  adjustment: "studio.timeline.emptyTrack.adjustment",
} as const satisfies Record<TimelineTrackKind, MessageKey>;
