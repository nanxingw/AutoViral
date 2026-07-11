import type { MessageKey } from "@/i18n/useT";

export type TimelineTrackKind = "video" | "audio" | "text" | "overlay";

interface TimelineKindTokens {
  base: string;
  soft: string;
  border: string;
}

function timelineTokens(name: "video" | "audio" | "caption" | "overlay") {
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
};

export const EMPTY_TRACK_MESSAGE_KEYS = {
  video: "studio.timeline.emptyTrack.video",
  audio: "studio.timeline.emptyTrack.audio",
  text: "studio.timeline.emptyTrack.text",
  overlay: "studio.timeline.emptyTrack.overlay",
} as const satisfies Record<TimelineTrackKind, MessageKey>;
