// S5 (PRD-0007 §4.5) — minimal store for the planning-layer 剧本
// (plan/script.md) markdown text. This is the read-side container the
// useBridgeEvents `plan-changed` → refetchScript path writes into, and the
// ScriptTab markdown editor reads from + commits through.
//
// Deliberately tiny: the script is a single markdown string per work, NOT a
// structured model like the composition. Edits commit straight to disk via the
// works route (services/script.ts saveScript) — the same write path the agent's
// `autoviral script edit` CLI uses (ADR-009 agent-人一致) — and the broadcast +
// refetch keeps every open surface convergent.
//
// TENANCY (HIGH fix, review 2026-06-09): the store is a SINGLE module-level
// instance shared across every work, so it MUST record WHICH work the held
// string belongs to. Without `workId` an A→B route hop leaves B showing (and,
// worse, committing) A's 剧本 until B's async load resolves — a cross-work
// data-bleed. Every writer stamps the owning workId; readers/committers gate on
// `workId === theirWorkId` and `reset()` clears tenancy synchronously on switch.

import { create } from "zustand";

interface ScriptState {
  /** Which work the current `script` belongs to. null = empty / just reset.
   *  Any surface can ask "is the held script mine?" via `workId === myWorkId`. */
  workId: string | null;
  /** The current plan/script.md markdown. "" = empty plan (not yet written). */
  script: string;
  /** True once a load has resolved (so the editor can distinguish "" from "loading"). */
  loaded: boolean;
  /** True while a load is IN FLIGHT for `workId`. Lets any surface (ScriptTab,
   *  ScriptReader) dedup: whoever finds `loading` already set does NOT fire a
   *  second GET for the same work. Cleared by setScript (success) / endLoad
   *  (error/abort) / reset (work switch). */
  loading: boolean;
  /** Replace the script text for `workId` (refetchScript + editor mount-load/commit). */
  setScript: (workId: string, md: string) => void;
  /** Mark a load in flight for `workId`, stamping tenancy so a concurrent surface
   *  sees `loading` and skips its own fetch. When the held script belongs to a
   *  DIFFERENT work we also wipe it here (a work switch) so no foreign content
   *  shows during the load window; when it's the SAME work we only flip `loading`
   *  and preserve any already-loaded text (a redundant re-fetch must not flash
   *  the editor empty). */
  beginLoad: (workId: string) => void;
  /** Clear the in-flight flag WITHOUT marking loaded — for a failed/aborted load
   *  so the surface can fall back to its error/empty state instead of spinning. */
  endLoad: () => void;
  /** Synchronously clear on a work switch — BEFORE the new work's load resolves,
   *  so the editor never shows (or commits) the previous work's script. */
  reset: () => void;
}

export const useScript = create<ScriptState>((set) => ({
  workId: null,
  script: "",
  loaded: false,
  loading: false,
  setScript: (workId, md) => set({ workId, script: md, loaded: true, loading: false }),
  beginLoad: (workId) =>
    set((s) =>
      s.workId === workId
        ? { loading: true }
        : { workId, script: "", loaded: false, loading: true },
    ),
  endLoad: () => set({ loading: false }),
  reset: () => set({ workId: null, script: "", loaded: false, loading: false }),
}));
