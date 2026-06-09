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
  /** Replace the script text for `workId` (refetchScript + editor mount-load/commit). */
  setScript: (workId: string, md: string) => void;
  /** Synchronously clear on a work switch — BEFORE the new work's load resolves,
   *  so the editor never shows (or commits) the previous work's script. */
  reset: () => void;
}

export const useScript = create<ScriptState>((set) => ({
  workId: null,
  script: "",
  loaded: false,
  setScript: (workId, md) => set({ workId, script: md, loaded: true }),
  reset: () => set({ workId: null, script: "", loaded: false }),
}));
