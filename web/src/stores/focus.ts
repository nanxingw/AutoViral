/**
 * Focus store — client-side SSoT for "what is the user currently looking at".
 *
 * Mirrors backend `src/focus/` schema. Any component that owns a selection
 * gesture (timeline clip-click, segment-chip click, panel-focus tracker)
 * should write here. Both ChatPanel (via getViewerContext) and TerminalPanel
 * (via prefix line) read here.
 *
 * Writes are propagated to the backend via POST /api/bridge/v1/focus so
 * agents calling `autoviral context` see the latest state.
 *
 * H0.1: ships selectedClipId only. H0.2 will add playheadSec, segment,
 * activePanel. All future additions MUST be optional fields.
 */

import { create } from "zustand";
import { apiFetch } from "@/lib/api";

export type ActivePanel = "timeline" | "inspector" | "preview" | "sidebar";

export interface FocusSnapshot {
  selectedClipId: string | null;
  playheadSec: number;
  selectedSegmentId: string | null;
  activePanel: ActivePanel | null;
}

export const EMPTY_FOCUS: FocusSnapshot = {
  selectedClipId: null,
  playheadSec: 0,
  selectedSegmentId: null,
  activePanel: null,
};

/**
 * Playhead throttle window. Preview scrubbing fires `setPlayhead` at
 * ~60 Hz; pushing 60 WS writes per second is overkill. 100 ms keeps the
 * agent's view "good enough fresh" without saturating the bridge.
 *
 * The throttle is "trailing edge" — first call goes through immediately
 * to feel responsive, subsequent calls within the window are deferred
 * to a single trailing flush.
 */
const PLAYHEAD_THROTTLE_MS = 100;

interface FocusStore {
  workId: string | null;
  focus: FocusSnapshot;
  /** Set the workId this store is bound to. Resets focus when it changes. */
  bindWork: (workId: string | null) => void;
  /** Merge a patch into the snapshot AND push to backend (non-throttled). */
  setSelection: (clipId: string | null) => void;
  /** Throttled (≤10 Hz) playhead writer. Use for scrub / play-tick. */
  setPlayhead: (seconds: number) => void;
  /** Set the currently focused caption segment id. Non-throttled. */
  setSelectedSegment: (segmentId: string | null) => void;
  /** Set which Studio panel has focus. Non-throttled. */
  setActivePanel: (panel: ActivePanel | null) => void;
  /** Apply a server-pushed snapshot without re-broadcasting. Used by the
   *  bridge-events subscriber so server→client doesn't loop. */
  applyServerSnapshot: (snapshot: FocusSnapshot) => void;
}

// Module-scoped throttle state (not on Zustand state — UI doesn't care
// about the timer, only about the snapshot it produces).
let playheadTimer: ReturnType<typeof setTimeout> | null = null;
let playheadLastFlush = 0;
let playheadPending: number | null = null;

function flushPlayhead(workId: string | null): void {
  if (playheadPending === null) return;
  const value = playheadPending;
  playheadPending = null;
  playheadLastFlush = Date.now();
  if (workId) {
    apiFetch(`/api/bridge/v1/focus`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ playheadSec: value }),
    }).catch(() => {});
  }
}

function postPatch(workId: string | null, patch: Partial<FocusSnapshot>): void {
  if (!workId) return;
  apiFetch(`/api/bridge/v1/focus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AutoViral-Work-Id": workId,
    },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  workId: null,
  focus: { ...EMPTY_FOCUS },

  bindWork: (workId) => {
    const prev = get().workId;
    if (prev === workId) return;
    // Cancel any in-flight throttle so it doesn't write to the old workId.
    if (playheadTimer) {
      clearTimeout(playheadTimer);
      playheadTimer = null;
    }
    playheadPending = null;
    // Reset the last-flush timestamp so the next setPlayhead's leading-edge
    // fires immediately. Without this, switching works could leave stale
    // timing data that suppresses the first write.
    playheadLastFlush = 0;
    set({ workId, focus: { ...EMPTY_FOCUS } });
  },

  setSelection: (clipId) => {
    set((s) => ({ focus: { ...s.focus, selectedClipId: clipId } }));
    postPatch(get().workId, { selectedClipId: clipId });
  },

  setPlayhead: (seconds) => {
    // Always update local state immediately — UI responsiveness is more
    // important than backend throttle.
    set((s) => ({ focus: { ...s.focus, playheadSec: seconds } }));
    const workId = get().workId;
    playheadPending = seconds;

    const now = Date.now();
    const elapsed = now - playheadLastFlush;
    if (elapsed >= PLAYHEAD_THROTTLE_MS) {
      // Leading-edge flush so the first scrub feels instant.
      flushPlayhead(workId);
    } else if (!playheadTimer) {
      // Trailing-edge flush schedules a single deferred write.
      playheadTimer = setTimeout(() => {
        playheadTimer = null;
        flushPlayhead(get().workId);
      }, PLAYHEAD_THROTTLE_MS - elapsed);
    }
    // If a timer is already scheduled, playheadPending is overwritten
    // above so it always flushes the latest value.
  },

  setSelectedSegment: (segmentId) => {
    set((s) => ({ focus: { ...s.focus, selectedSegmentId: segmentId } }));
    postPatch(get().workId, { selectedSegmentId: segmentId });
  },

  setActivePanel: (panel) => {
    set((s) => ({ focus: { ...s.focus, activePanel: panel } }));
    postPatch(get().workId, { activePanel: panel });
  },

  applyServerSnapshot: (snapshot) => {
    set({ focus: { ...snapshot } });
  },
}));

/**
 * Build a pneuma-style `<viewer-context>` envelope from the current focus.
 * Returns null when there's nothing worth telling the agent. Used by
 * ChatPanel via the `getViewerContext` prop.
 *
 * H0.2 expanded to include playhead, segment, and panel fields. Each is
 * rendered only when non-empty so the envelope stays minimal.
 */
export function buildViewerContext(): string | null {
  const { focus } = useFocusStore.getState();
  const parts: string[] = [];
  if (focus.selectedClipId) {
    parts.push(`<selected-clip id="${escapeXmlAttr(focus.selectedClipId)}"/>`);
  }
  if (focus.playheadSec > 0) {
    parts.push(`<playhead seconds="${focus.playheadSec.toFixed(2)}"/>`);
  }
  if (focus.selectedSegmentId) {
    parts.push(
      `<selected-segment id="${escapeXmlAttr(focus.selectedSegmentId)}"/>`,
    );
  }
  if (focus.activePanel) {
    parts.push(`<active-panel name="${focus.activePanel}"/>`);
  }
  if (parts.length === 0) return null;
  return `<viewer-context>\n${parts.map((p) => `  ${p}`).join("\n")}\n</viewer-context>`;
}

/**
 * Build the terminal prefix string `[ctx: clip=X seg=Y head=12.3s panel=Z]`.
 * Returns null when the focus is empty. Tokens are space-separated and
 * appear in a fixed order so the prefix line shape is stable.
 */
export function buildTerminalPrefix(): string | null {
  const { focus } = useFocusStore.getState();
  const tokens: string[] = [];
  if (focus.selectedClipId) tokens.push(`clip=${focus.selectedClipId}`);
  if (focus.selectedSegmentId) tokens.push(`seg=${focus.selectedSegmentId}`);
  if (focus.playheadSec > 0)
    tokens.push(`head=${focus.playheadSec.toFixed(1)}s`);
  if (focus.activePanel) tokens.push(`panel=${focus.activePanel}`);
  if (tokens.length === 0) return null;
  return `[ctx: ${tokens.join(" ")}]`;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
