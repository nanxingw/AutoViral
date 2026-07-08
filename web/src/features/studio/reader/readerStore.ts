import { create } from "zustand";

// ScriptReader open/close switch — a tiny zustand store mirroring diveStore. The
// center-docked 剧本/分镜 reading panel is opened from the Studio top bar OR from
// a sidebar scene card's ⤢ (which also names the scene to scroll to); it closes
// on ESC, the header close button. Kept SEPARATE from diveStore so the two big
// surfaces (Dive canvas vs Reader) never share one `open` flag and can't fight
// over it.

export interface ReaderState {
  open: boolean;
  /** Scene the docked panel should scroll to once its card is rendered. Set by
   *  the sidebar ⤢ hand-off; the reader consumes it (→ null) after scrolling so
   *  a later plain open doesn't re-scroll to a stale target. */
  focusSceneId: string | null;
  /** Open the reader. Takes the workId for symmetry with diveStore.openCanvas
   *  (the reader reads the actual script/scenes from the comp + script stores,
   *  so it doesn't retain the id — the argument keeps the call sites identical).
   *  Re-invoking while already open just retargets the focus — the docked panel
   *  follows the sidebar clicks. */
  openReader: (workId: string, opts?: { focusSceneId?: string }) => void;
  closeReader: () => void;
  /** Called by the reader after it scrolled to the focus target. */
  consumeFocus: () => void;
}

export const useReader = create<ReaderState>((set) => ({
  open: false,
  focusSceneId: null,
  openReader: (_workId, opts) =>
    set({ open: true, focusSceneId: opts?.focusSceneId ?? null }),
  closeReader: () => set({ open: false, focusSceneId: null }),
  consumeFocus: () => set({ focusSceneId: null }),
}));
