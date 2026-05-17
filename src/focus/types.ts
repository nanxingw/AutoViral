/**
 * Focus channel types — the single source of truth for "what is the user
 * currently looking at / has selected" in Studio.
 *
 * H0.1 shipped `selectedClipId`. H0.2 adds `playheadSec`,
 * `selectedSegmentId`, and `activePanel`. All future additions MUST be
 * optional fields so partial focus state is always valid (forward-compat
 * with older clients).
 */

export type ActivePanel = "timeline" | "inspector" | "preview" | "sidebar";

export interface FocusSnapshot {
  /** Currently selected clip id, or null if nothing is selected. */
  selectedClipId: string | null;
  /** Current playhead position in seconds. 0 means at the start. */
  playheadSec: number;
  /** Currently focused caption-segment id (e.g. "seg_0023"), or null. */
  selectedSegmentId: string | null;
  /** Which Studio panel currently has user focus. Null when document is
   *  blurred. Used by agents to know whether the user is editing in the
   *  inspector vs scrubbing the timeline vs previewing playback. */
  activePanel: ActivePanel | null;
}

export interface FocusEvent {
  kind: "focus-changed";
  workId: string;
  focus: FocusSnapshot;
}

export const EMPTY_FOCUS: FocusSnapshot = {
  selectedClipId: null,
  playheadSec: 0,
  selectedSegmentId: null,
  activePanel: null,
};
