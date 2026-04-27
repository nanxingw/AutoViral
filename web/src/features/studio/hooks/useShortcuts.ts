import { useEffect } from "react";
import { useComposition } from "../store";
import { saveComposition } from "../services/composition";

/**
 * Studio keyboard bindings:
 *  - Space: toggle play/pause
 *  - J: seek -5s
 *  - L: seek +5s
 *  - Cmd/Ctrl+S: persist current composition
 *  - Backspace/Delete: remove selected clip
 */
export function useShortcuts(workId: string | null) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack typing in inputs / textareas / contentEditable nodes.
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const state = useComposition.getState();
      const fps = state.comp?.fps ?? 30;

      if (e.code === "Space") {
        e.preventDefault();
        state.setPlaying(!state.isPlaying);
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        state.setFrame(Math.max(0, state.currentFrame - 5 * fps));
        return;
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        state.setFrame(state.currentFrame + 5 * fps);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (workId && state.comp) void saveComposition(workId, state.comp);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selection) {
          e.preventDefault();
          state.removeClip(state.selection);
          state.setSelection(null);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workId]);
}
