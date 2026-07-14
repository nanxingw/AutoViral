// PRD-0014 S7 — sweep matrix gate (feedback_contract_test_sweep_gate pattern).
//
// The product invariant this gate defends: every EDITING verb that mutates the
// persistent composition must live in the shared `src/shared/composition/ops`
// core, so the human-UI store path and the agent-CLI/bridge path converge on ONE
// implementation. The historical病灶 (transition update wired to UI only, patch
// wired to bridge only) is exactly what this catches.
//
// The gate enumerates EVERY function on the studio store and forces each into one
// of three explicit buckets:
//   • SUNK          — down-sunk to a shared op; the op must be EXPORTED and the
//                     store source must actually reference `ops.<name>`.
//   • SINK_PENDING  — a known store-only editing verb not yet lifted, tagged with
//                     the slice/reason. Documented debt, not a silent leak.
//   • UI_ONLY       — transient UI / playback / selection / history / drag state;
//                     genuinely no composition data, exempt by design.
// A store function in NONE of the buckets FAILS the gate: a new editing verb must
// be classified (sink it, or explicitly defer it) — you can't add a store-only
// mutation and slip past.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { useComposition } from "../store";
import * as ops from "@shared/composition/ops";

// store action name → shared op export it MUST delegate to.
const SUNK: Record<string, string> = {
  splitClip: "splitClip",
  resizeClip: "trimClip", // right-edge video/audio path routes through ops.trimClip
  moveClipToTrack: "moveClipToTrack",
  addTransition: "addTransition",
  removeTransition: "removeTransition",
  addTrack: "addTrack",
  removeTrack: "removeTrack",
  addKeyframe: "addKeyframe",
  setAspectRatio: "setAspectRatio",
  setFps: "setFps",
  // ── S7 (PRD-0014) — down-sunk this slice ──
  rippleDeleteClip: "rippleDeleteClip",
  collapseGaps: "collapseGapsOnTrack",
  renameTrack: "setTrackProps",
  setTrackLanguage: "setTrackProps",
  setTrackVolume: "setTrackProps",
};

// Store-only editing verbs NOT yet lifted. Each carries the slice/reason so the
// debt is visible. (S8 continues this down-sinking; some — addClip/removeClip —
// have a bridge-side inline twin and may or may not get a dedicated op.)
const SINK_PENDING: Record<string, string> = {
  addClip: "bridge POST /clip inlines placement; no dedicated op yet",
  updateClip: "ops.patchClipProps exists; store rewire pending",
  removeClip: "bridge DELETE /clip inlines filter; no dedicated op yet",
  moveClipWithinTrack: "pending",
  updateTransition: "S8 — ops.updateTransition",
  removeKeyframe: "S8 — ops.removeKeyframe",
  updateKeyframe: "S8 — ops.moveKeyframe/setKeyframe",
  reorderTracks: "pending",
  rebindClip: "pending",
  applyPlatformPreset: "partial: rescale via ops.rescaleCompositionForResize",
  removeTimelineSelection: "pending (multi-select batch delete)",
  addAsset: "pending (asset registry mutation)",
  addProvenance: "pending (provenance graph mutation)",
  removeAsset: "pending (asset registry mutation)",
  recomputeDuration: "ops.compositionContentEnd exists; store rewire pending",
};

// Transient UI / playback / history / drag state — no persistent composition
// data, exempt by design.
const UI_ONLY = new Set<string>([
  "loadComposition",
  "setBladeMode",
  "setSelection",
  "setTimelineSelection",
  "clearTimelineSelection",
  "setFrame",
  "requestSeekFrame",
  "reportPlayerFrame",
  "setPlaying",
  "setBeats",
  "beginDrag",
  "setSnapGuide",
  "updateDragCandidate",
  "updateDragTarget",
  "commitDrag",
  "cancelDrag",
  "undoTrackOp",
  "redoTrackOp",
  "undoClipOp",
  "redoClipOp",
]);

function storeFunctionNames(): string[] {
  const state = useComposition.getState() as Record<string, unknown>;
  return Object.keys(state).filter((k) => typeof state[k] === "function");
}

// Read the store source to assert each SUNK verb is actually wired through its
// op. jsdom's import.meta.url isn't a file:// URL, so resolve from cwd (repo
// root when run via `npm run test:web`, or web/ when run from there).
const STORE_PATH = [
  resolve(process.cwd(), "web/src/features/studio/store.ts"),
  resolve(process.cwd(), "src/features/studio/store.ts"),
].find(existsSync);
if (!STORE_PATH) throw new Error("opsSweepGate: could not locate studio store.ts");
const STORE_SRC = readFileSync(STORE_PATH, "utf8");

describe("shared-ops sweep matrix gate (S7)", () => {
  it("every store function is classified (SUNK / SINK_PENDING / UI_ONLY)", () => {
    const unclassified = storeFunctionNames().filter(
      (name) =>
        !(name in SUNK) && !(name in SINK_PENDING) && !UI_ONLY.has(name),
    );
    expect(
      unclassified,
      `unclassified store action(s) — a new editing verb must be sunk to a shared op or explicitly deferred in SINK_PENDING, ` +
        `a new UI-state action added to UI_ONLY: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("every SUNK verb has a shared op EXPORTED from src/shared/composition/ops", () => {
    const missing = Object.entries(SUNK)
      .filter(([, opName]) => typeof (ops as Record<string, unknown>)[opName] !== "function")
      .map(([action, opName]) => `${action} → ops.${opName}`);
    expect(missing, `SUNK verb(s) with no exported op: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("every SUNK store action actually references its shared op (no store-only leak)", () => {
    const unwired = Object.entries(SUNK)
      .filter(([, opName]) => !STORE_SRC.includes(`ops.${opName}`))
      .map(([action, opName]) => `${action} → ops.${opName}`);
    expect(
      unwired,
      `SUNK verb(s) not wired through their op in store.ts (store-only leak): ${unwired.join(", ")}`,
    ).toEqual([]);
  });

  it("SUNK verbs are all real store functions (no stale mapping)", () => {
    const names = new Set(storeFunctionNames());
    const stale = Object.keys(SUNK).filter((a) => !names.has(a));
    expect(stale, `SUNK maps a non-existent store action: ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
