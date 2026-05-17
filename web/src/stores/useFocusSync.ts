/**
 * Bridge `useComposition.selection` → `useFocusStore.selectedClipId`.
 *
 * useComposition is the existing UI SSoT for clip selection (set by
 * timeline clip-click, inspector, drag handlers, etc.). We don't refactor
 * every call site to write into the focus store directly — instead we
 * subscribe here and mirror every selection change into the focus store,
 * which then POSTs to the backend bridge.
 *
 * Mount this once at the Studio level (above Timeline / Inspector / etc.)
 * so the focus channel reflects whatever the user clicked through.
 */
import { useEffect } from "react";
import { useComposition } from "@/features/studio/store";
import { useFocusStore } from "./focus";

export interface UseFocusSyncOptions {
  workId: string | null;
}

export function useFocusSync({ workId }: UseFocusSyncOptions): void {
  // Bind the focus store to the active work — resets focus on work change.
  useEffect(() => {
    useFocusStore.getState().bindWork(workId);
  }, [workId]);

  // Mirror useComposition.selection → focus.selectedClipId on every change.
  useEffect(() => {
    let prev: string | null = useComposition.getState().selection;
    // Push the initial selection through so a re-mount with a pre-selected
    // clip propagates correctly.
    useFocusStore.getState().setSelection(prev);
    const unsub = useComposition.subscribe((s) => {
      const next = s.selection;
      if (next === prev) return;
      prev = next;
      useFocusStore.getState().setSelection(next);
    });
    return unsub;
  }, [workId]);
}
