/**
 * Bridge UI state → focus store.
 *
 * useComposition is the existing UI SSoT for clip selection, playhead
 * (currentFrame), play state. We don't refactor every call site to write
 * into the focus store directly — instead we subscribe here and mirror
 * relevant changes into the focus store, which then POSTs to the backend
 * bridge.
 *
 * H0.1 mirrored `selection` → `selectedClipId`.
 * H0.2 adds:
 *   • currentFrame + fps → playheadSec (throttled inside the focus store)
 *   • document.activeElement crawl → activePanel
 *
 * selectedSegmentId is wired in the inspector's segment-chip onClick
 * directly (no useComposition equivalent to mirror).
 *
 * Mount this once at the Studio level (above Timeline / Inspector / etc.)
 * so the focus channel reflects whatever the user clicked through.
 */
import { useEffect } from "react";
import { useComposition } from "@/features/studio/store";
import { useFocusStore, type ActivePanel } from "./focus";

export interface UseFocusSyncOptions {
  workId: string | null;
}

function resolveActivePanel(): ActivePanel | null {
  if (typeof document === "undefined") return null;
  const target = document.activeElement;
  if (!target || target === document.body) return null;
  // Walk up looking for the closest `data-area="..."` ancestor — Studio
  // panels declare this attribute (timeline / preview / inspector / etc.).
  let el: Element | null = target;
  while (el && el !== document.body) {
    const area = (el as HTMLElement).dataset?.area;
    if (area === "timeline") return "timeline";
    if (area === "preview") return "preview";
    if (area === "inspector" || area === "tweaks") return "inspector";
    if (area === "sidebar" || area === "assets") return "sidebar";
    el = el.parentElement;
  }
  return null;
}

export function useFocusSync({ workId }: UseFocusSyncOptions): void {
  // Bind the focus store to the active work — resets focus on work change.
  useEffect(() => {
    useFocusStore.getState().bindWork(workId);
  }, [workId]);

  // Mirror useComposition.selection → focus.selectedClipId on every change.
  useEffect(() => {
    let prevSel: string | null = useComposition.getState().selection;
    useFocusStore.getState().setSelection(prevSel);

    let prevFrame: number = useComposition.getState().currentFrame;
    let prevFps: number = useComposition.getState().comp?.fps ?? 30;
    useFocusStore.getState().setPlayhead(prevFrame / prevFps);

    const unsub = useComposition.subscribe((s) => {
      // Selection change → focus.selectedClipId
      if (s.selection !== prevSel) {
        prevSel = s.selection;
        useFocusStore.getState().setSelection(s.selection);
      }
      // Frame / fps change → focus.playheadSec (throttled in store)
      const fps = s.comp?.fps ?? 30;
      if (s.currentFrame !== prevFrame || fps !== prevFps) {
        prevFrame = s.currentFrame;
        prevFps = fps;
        useFocusStore.getState().setPlayhead(prevFrame / prevFps);
      }
    });
    return unsub;
  }, [workId]);

  // Track which Studio panel currently owns focus via window focus/blur +
  // a low-rate poll of document.activeElement. Polling avoids tying every
  // panel into a custom focus-tracking system.
  useEffect(() => {
    let lastPanel: ActivePanel | null = null;
    const sync = () => {
      const next = resolveActivePanel();
      if (next !== lastPanel) {
        lastPanel = next;
        useFocusStore.getState().setActivePanel(next);
      }
    };
    // focusin bubbles across the document — one listener catches all
    // input/button/contenteditable focus changes.
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    sync();
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
    };
  }, [workId]);
}
