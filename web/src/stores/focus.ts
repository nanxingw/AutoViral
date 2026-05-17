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

export interface FocusSnapshot {
  selectedClipId: string | null;
}

export const EMPTY_FOCUS: FocusSnapshot = {
  selectedClipId: null,
};

interface FocusStore {
  workId: string | null;
  focus: FocusSnapshot;
  /** Set the workId this store is bound to. Resets focus when it changes. */
  bindWork: (workId: string | null) => void;
  /** Merge a patch into the snapshot AND push to backend. */
  setSelection: (clipId: string | null) => void;
  /** Apply a server-pushed snapshot without re-broadcasting. Used by the
   *  bridge-events subscriber so server→client doesn't loop. */
  applyServerSnapshot: (snapshot: FocusSnapshot) => void;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  workId: null,
  focus: { ...EMPTY_FOCUS },

  bindWork: (workId) => {
    const prev = get().workId;
    if (prev === workId) return;
    set({ workId, focus: { ...EMPTY_FOCUS } });
  },

  setSelection: (clipId) => {
    set((s) => ({ focus: { ...s.focus, selectedClipId: clipId } }));
    const { workId } = get();
    if (workId) {
      // Fire-and-forget — backend write is broadcast back via ws-bridge
      // for other surfaces (terminal prefix, chat envelope on outbound).
      apiFetch(`/api/bridge/v1/focus`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ selectedClipId: clipId }),
      }).catch(() => {
        // Network failure is non-fatal; next write retries. The UI's
        // local state is what the user actually sees.
      });
    }
  },

  applyServerSnapshot: (snapshot) => {
    set({ focus: { ...snapshot } });
  },
}));

/**
 * Build a pneuma-style `<viewer-context>` envelope from the current focus.
 * Returns null when there's nothing worth telling the agent. Used by
 * ChatPanel via the `getViewerContext` prop.
 */
export function buildViewerContext(): string | null {
  const { focus } = useFocusStore.getState();
  const parts: string[] = [];
  if (focus.selectedClipId) {
    parts.push(`<selected-clip id="${escapeXmlAttr(focus.selectedClipId)}"/>`);
  }
  if (parts.length === 0) return null;
  return `<viewer-context>\n${parts.map((p) => `  ${p}`).join("\n")}\n</viewer-context>`;
}

/**
 * Build the terminal prefix string `[ctx: clip=X]`. Returns null when the
 * focus is empty.
 */
export function buildTerminalPrefix(): string | null {
  const { focus } = useFocusStore.getState();
  const tokens: string[] = [];
  if (focus.selectedClipId) tokens.push(`clip=${focus.selectedClipId}`);
  if (tokens.length === 0) return null;
  return `[ctx: ${tokens.join(" ")}]`;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
