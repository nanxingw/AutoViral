import { useEffect } from "react";
import { useComposition } from "../store";
import { saveComposition } from "../services/composition";
import { clipEnd, OFFSET_EPSILON } from "@autoviral/timeline";
import type { Clip } from "../types";

/**
 * Studio keyboard bindings:
 *  - Space: toggle play/pause
 *  - J: seek -5s
 *  - L: seek +5s
 *  - Cmd/Ctrl+S: persist current composition
 *  - Cmd/Ctrl+Shift+G: collapse gaps on the selected clip's track (Phase 4.J)
 *  - Cmd/Ctrl+B: split clip under the playhead on the selected track (Phase 4.J, D4)
 *  - B: toggle blade mode (Phase 4.J — user-overridden binding; pneuma uses S)
 *  - Shift+Backspace / Shift+Delete: ripple-delete selected clip (Phase 4.J, D6)
 *  - Backspace / Delete: remove selected clip (plain, leaves gap; D6 preserved)
 *
 * Listener attachment + input-element guard ported from
 * `.cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts:12-18,28-30,111-112`.
 * The `S`-for-split key in pneuma is intentionally replaced by the
 * user's `B / Cmd+B` mapping per master-plan §4.2.J adaptation.
 */
export function useShortcuts(workId: string | null) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack typing in inputs / textareas / contentEditable nodes.
      // port from .cache/pneuma-clipcraft/.../useTimelineShortcuts.ts:12-18
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      // Held keys: ignore auto-repeat so a long-press of `B` doesn't
      // rapid-toggle bladeMode (Phase 4.J quality review nit).
      if (e.repeat) return;

      const state = useComposition.getState();
      const fps = state.comp?.fps ?? 30;
      const isMod = e.metaKey || e.ctrlKey;

      if (e.code === "Space") {
        e.preventDefault();
        state.setPlaying(!state.isPlaying);
        return;
      }
      if (!isMod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        state.setFrame(Math.max(0, state.currentFrame - 5 * fps));
        return;
      }
      if (!isMod && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        state.setFrame(state.currentFrame + 5 * fps);
        return;
      }

      // Cmd+Shift+G — collapse gaps on the selected clip's track.
      if (isMod && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (state.selection && state.comp) {
          const track = state.comp.tracks.find((t) =>
            t.clips.some((c) => c.id === state.selection),
          );
          if (track) state.collapseGaps(track.id);
        }
        return;
      }

      // Cmd+S — save (existing).
      if (isMod && !e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (workId && state.comp) void saveComposition(workId, state.comp);
        return;
      }

      // Cmd+B — split the clip currently containing the playhead on the
      // selected track. D4: out-of-clip / boundary playheads are silent
      // no-ops. Per Phase 4.J test fixture, the split target is the
      // selected clip itself — not any clip on the same track that
      // happens to overlap the playhead.
      if (isMod && !e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        if (state.selection && state.comp) {
          let selectedClip: Clip | null = null;
          for (const t of state.comp.tracks) {
            const found = (t.clips as Clip[]).find(
              (c) => c.id === state.selection,
            );
            if (found) {
              selectedClip = found;
              break;
            }
          }
          const playheadTime = state.currentFrame / fps;
          if (
            selectedClip &&
            playheadTime > selectedClip.trackOffset + OFFSET_EPSILON &&
            playheadTime < clipEnd(selectedClip) - OFFSET_EPSILON
          ) {
            state.splitClip(state.selection, playheadTime);
          }
        }
        return;
      }

      // B (no modifier) — toggle blade mode (user-overridden binding).
      if (!isMod && !e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        state.setBladeMode(!state.bladeMode);
        return;
      }

      // Shift+Backspace / Shift+Delete — ripple delete.
      // D6: must precede the plain-Backspace branch so the modifier
      // short-circuits before muscle-memory delete fires.
      if (e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) {
        if (state.selection) {
          e.preventDefault();
          state.rippleDeleteClip(state.selection);
          state.setSelection(null);
        }
        return;
      }

      // Plain Backspace / Delete — non-ripple remove (D6 preserved).
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
