import { create } from "zustand";

// ScriptReader open/close switch — a tiny zustand store mirroring diveStore. The
// full-screen 剧本/分镜 reader is opened from the Studio top bar and can be closed
// by ESC, the header close button, or a card's "edit" jump. Kept SEPARATE from
// diveStore so the two full-screen overlays (Dive canvas vs Reader) never share
// one `open` flag and can't fight over it.

export interface ReaderState {
  open: boolean;
  /** Open the reader. Takes the workId for symmetry with diveStore.openCanvas
   *  (the reader reads the actual script/scenes from the comp + script stores,
   *  so it doesn't retain the id — the argument keeps the call sites identical). */
  openReader: (workId: string) => void;
  closeReader: () => void;
}

export const useReader = create<ReaderState>((set) => ({
  open: false,
  openReader: () => set({ open: true }),
  closeReader: () => set({ open: false }),
}));
