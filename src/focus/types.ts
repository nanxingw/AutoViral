/**
 * Focus channel types — the single source of truth for "what is the user
 * currently looking at / has selected" in Studio.
 *
 * H0.1 (this commit) covers `selectedClipId` only. H0.2 will expand to
 * `playheadSec`, `selectedSegmentId`, `activePanel`. All future additions
 * MUST be optional fields so partial focus state is always valid.
 */

export interface FocusSnapshot {
  /** Currently selected clip id, or null if nothing is selected. */
  selectedClipId: string | null;
  // H0.2 will add:
  //   playheadSec?: number;
  //   selectedSegmentId?: string | null;
  //   activePanel?: "timeline" | "inspector" | "preview" | "sidebar" | null;
}

export interface FocusEvent {
  kind: "focus-changed";
  workId: string;
  focus: FocusSnapshot;
}

export const EMPTY_FOCUS: FocusSnapshot = {
  selectedClipId: null,
};
