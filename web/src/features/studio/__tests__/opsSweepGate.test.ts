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

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { useComposition } from "../store";
import { makeEmptyComposition, type Composition } from "@shared/composition";
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
  // S7 review fix (finding 4) — the header mute/hide toggles used to raw-setState
  // (invisible to this gate). They are now first-class actions through the op.
  setTrackMuted: "setTrackProps",
  setTrackHidden: "setTrackProps",
  // ── S8 (PRD-0014) — down-sunk this slice ──
  updateTransition: "updateTransition",
  removeKeyframe: "removeKeyframe",
  updateKeyframe: "moveKeyframe", // routes through moveKeyframe (time) + setKeyframe (value)
  // ── S5 (PRD-0014) — detach a video clip's source audio to a first-class
  // AudioClip; the store button and `autoviral clip detach-audio` share the op.
  detachClipAudio: "detachAudio",
  // S5 review fix #1 — the REVERSE op: re-enable source audio + delete the
  // detached AudioClip through the shared `ops.attachAudio`.
  reattachClipAudio: "attachAudio",
  // ── S3 (PRD-0014) — set/clear a video clip's ENTRANCE transition; the
  // Inspector selector and `autoviral clip set --transition-in` share the op.
  setClipTransitionIn: "setTransitionIn",
};

// Store-only editing verbs NOT yet lifted. Each carries the slice/reason so the
// debt is visible. (S8 continues this down-sinking; some — addClip/removeClip —
// have a bridge-side inline twin and may or may not get a dedicated op.)
const SINK_PENDING: Record<string, string> = {
  addClip: "bridge POST /clip inlines placement; no dedicated op yet",
  updateClip: "ops.patchClipProps exists; store rewire pending",
  removeClip: "bridge DELETE /clip inlines filter; no dedicated op yet",
  moveClipWithinTrack: "pending",
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
  const state = useComposition.getState() as unknown as Record<string, unknown>;
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

// ── S7 review fix (finding 2) — SINK_PENDING is a FROZEN, shrink-only ledger ──
// The substring/classification gate above lets a store-only editing verb "pass"
// by living in SINK_PENDING. Left unbounded that is a silent escape hatch: a new
// store-only mutation could be quietly parked here forever. This ratchet freezes
// the exact set — the debt can only SHRINK (sink a verb → delete its entry). Any
// ADDITION forces a deliberate edit to this snapshot (loud, reviewed), so you
// cannot slip a brand-new store-only verb past the gate by deferring it.
const SINK_PENDING_FROZEN = [
  "addClip",
  "updateClip",
  "removeClip",
  "moveClipWithinTrack",
  "reorderTracks",
  "rebindClip",
  "applyPlatformPreset",
  "removeTimelineSelection",
  "addAsset",
  "addProvenance",
  "removeAsset",
  "recomputeDuration",
].sort();

describe("shared-ops sweep matrix gate — SINK_PENDING ratchet (S7 review)", () => {
  it("SINK_PENDING is the frozen allowlist and can only shrink, never grow", () => {
    const current = Object.keys(SINK_PENDING).sort();
    // A NEW store-only verb dropped into SINK_PENDING (or a resurrected old one)
    // fails here: update the frozen snapshot ONLY by REMOVING an entry you sank.
    expect(
      current,
      "SINK_PENDING changed — you may only REMOVE entries (by sinking the verb " +
        "to a shared op). Adding a store-only verb here is a silent dual-drive leak.",
    ).toEqual(SINK_PENDING_FROZEN);
  });
});

// ── S7 review fix (finding 3) — BEHAVIORAL parity, not a source substring ──
// The wiring assertion above is a global `STORE_SRC.includes("ops.<name>")`
// substring: for the setTrackProps family (renameTrack / setTrackLanguage /
// setTrackVolume / setTrackMuted / setTrackHidden ALL alias ONE op) a single
// reference satisfies the check for all five, so any single action could be
// unwired and the gate stays green. This block closes that hole functionally:
// drive the store action and the shared op from an IDENTICAL starting comp and
// assert the mutated track is byte-identical. A store action that diverged from
// the op (missed spread-guard, wrong field, raw setState) fails here.
describe("shared-ops sweep matrix gate — behavioral parity (S7 review)", () => {
  beforeEach(() => {
    useComposition.setState({ comp: null });
  });

  function base(): Composition {
    return makeEmptyComposition({ workId: "w_parity", aspect: "9:16" });
  }
  function trackById(comp: Composition, id: string) {
    return comp.tracks.find((t) => t.id === id)!;
  }

  // Each row: pick a track by kind, run the store action, and the equivalent
  // ops.setTrackProps call, from the SAME base comp. Assert the tracks match.
  const cases: {
    name: string;
    kind: "video" | "audio" | "text";
    run: (id: string) => void;
    props: ops.TrackProps;
  }[] = [
    {
      name: "renameTrack",
      kind: "video",
      run: (id) => useComposition.getState().renameTrack(id, "V-renamed"),
      props: { label: "V-renamed" },
    },
    {
      name: "setTrackLanguage",
      kind: "text",
      run: (id) => useComposition.getState().setTrackLanguage(id, "en"),
      props: { language: "en" },
    },
    {
      name: "setTrackVolume",
      kind: "audio",
      run: (id) => useComposition.getState().setTrackVolume(id, -6),
      props: { volume: -6 },
    },
    {
      name: "setTrackMuted",
      kind: "audio",
      run: (id) => useComposition.getState().setTrackMuted(id, true),
      props: { muted: true },
    },
    {
      name: "setTrackHidden",
      kind: "video",
      run: (id) => useComposition.getState().setTrackHidden(id, true),
      props: { hidden: true },
    },
  ];

  it.each(cases)(
    "$name produces the SAME track mutation as ops.setTrackProps",
    ({ kind, run, props }) => {
      const seed = base();
      const trackId = seed.tracks.find((t) => t.kind === kind)!.id;

      // store path
      const cStore = structuredClone(seed);
      useComposition.getState().loadComposition(cStore);
      run(trackId);
      const storeTrack = trackById(useComposition.getState().comp!, trackId);

      // op path — mutate an identical clone directly
      const cOp = structuredClone(seed);
      ops.setTrackProps(cOp, { trackId, props });
      const opTrack = trackById(cOp, trackId);

      expect(storeTrack).toEqual(opTrack);
    },
  );

  // ── S8 review fix (finding 4) — BEHAVIORAL parity for the S8 verbs ──
  // The wiring assertion for updateTransition / removeKeyframe / updateKeyframe is
  // ONLY a `STORE_SRC.includes("ops.<name>")` substring — and each of those op
  // names ALSO appears in a store COMMENT (the block docstrings mention
  // `ops.updateTransition` / `ops.removeKeyframe` / `ops.moveKeyframe`). So the
  // substring check is satisfiable by prose alone: delete the real delegation and
  // the gate stays green ("born green"). These cases close that hole functionally
  // — drive the store action and the shared op from an IDENTICAL comp and assert
  // the mutated clip/track is byte-identical. A store action that stopped
  // delegating (raw setState, wrong coordinate) fails here.
  function mkVideo(id: string, off: number, dur: number) {
    return {
      id,
      kind: "video" as const,
      src: `${id}.mp4`,
      in: 0,
      out: dur,
      trackOffset: off,
      transforms: {},
      filters: {},
    };
  }
  function clipById(comp: Composition, clipId: string) {
    return (comp.tracks.flatMap((t) => t.clips as unknown[]) as { id: string }[]).find(
      (c) => c.id === clipId,
    ) as { keyframes?: unknown[] } | undefined;
  }

  it("updateTransition store action matches ops.updateTransition (finding 4)", () => {
    const seed = base();
    const vId = seed.tracks.find((t) => t.kind === "video")!.id;
    seed.tracks.find((t) => t.id === vId)!.clips = [
      mkVideo("a", 0, 3),
      mkVideo("b", 3, 3),
    ] as never;
    // Seed a transition through the shared op so BOTH paths start from the
    // identical id/duration (structuredClone copies it into each clone).
    const { transitionId } = ops.addTransition(seed, {
      trackId: vId,
      afterClipId: "a",
      preset: "cross-dissolve",
      durationSec: 0.5,
    });

    const cStore = structuredClone(seed);
    useComposition.getState().loadComposition(cStore);
    useComposition.getState().updateTransition(vId, transitionId, {
      preset: "wipe-left",
      durationSec: 1.2,
    });
    const storeTrack = trackById(useComposition.getState().comp!, vId);

    const cOp = structuredClone(seed);
    ops.updateTransition(cOp, { transitionId, preset: "wipe-left", durationSec: 1.2 });
    const opTrack = trackById(cOp, vId);

    expect(storeTrack.transitions).toEqual(opTrack.transitions);
  });

  it("removeKeyframe store action matches ops.removeKeyframe (finding 4)", () => {
    const seed = base();
    const vId = seed.tracks.find((t) => t.kind === "video")!.id;
    seed.tracks.find((t) => t.id === vId)!.clips = [mkVideo("a", 0, 4)] as never;
    // Author two keyframes via the shared op so the array is deterministic.
    ops.addKeyframe(seed, { clipId: "a", property: "opacity", atSec: 1, value: 0.5 });
    ops.addKeyframe(seed, { clipId: "a", property: "scale", atSec: 2, value: 1.4 });
    // The store addresses by original-array INDEX; resolve the opacity keyframe's.
    const seedKfs = clipById(seed, "a")!.keyframes as { property: string; time: number }[];
    const idx = seedKfs.findIndex((k) => k.property === "opacity" && k.time === 1);
    expect(idx).toBeGreaterThanOrEqual(0);

    const cStore = structuredClone(seed);
    useComposition.getState().loadComposition(cStore);
    useComposition.getState().removeKeyframe("a", idx);
    const storeKfs = clipById(useComposition.getState().comp!, "a")!.keyframes;

    const cOp = structuredClone(seed);
    ops.removeKeyframe(cOp, { clipId: "a", property: "opacity", atSec: 1 });
    const opKfs = clipById(cOp, "a")!.keyframes;

    expect(storeKfs).toEqual(opKfs);
  });

  it("updateKeyframe store action matches ops.moveKeyframe+setKeyframe (finding 4)", () => {
    const seed = base();
    const vId = seed.tracks.find((t) => t.kind === "video")!.id;
    seed.tracks.find((t) => t.id === vId)!.clips = [mkVideo("a", 0, 4)] as never;
    ops.addKeyframe(seed, { clipId: "a", property: "opacity", atSec: 1, value: 0.5 });
    const seedKfs = clipById(seed, "a")!.keyframes as { property: string; time: number }[];
    const idx = seedKfs.findIndex((k) => k.property === "opacity" && k.time === 1);

    const cStore = structuredClone(seed);
    useComposition.getState().loadComposition(cStore);
    // A combined TIME + VALUE edit — the store routes time through moveKeyframe
    // and value through setKeyframe; replicate both on the op-path clone.
    useComposition.getState().updateKeyframe("a", idx, { time: 2.5, value: 0.8 });
    const storeKfs = clipById(useComposition.getState().comp!, "a")!.keyframes;

    const cOp = structuredClone(seed);
    ops.moveKeyframe(cOp, { clipId: "a", property: "opacity", fromSec: 1, toSec: 2.5 });
    ops.setKeyframe(cOp, {
      clipId: "a",
      property: "opacity",
      atSec: 2.5,
      value: 0.8,
      easing: "linear", // the authored keyframe's original easing (addKeyframe default)
    });
    const opKfs = clipById(cOp, "a")!.keyframes;

    expect(storeKfs).toEqual(opKfs);
  });

  it("rippleDeleteClip store action matches ops.rippleDeleteClip (incl. transition prune)", () => {
    const seed = base();
    const vId = seed.tracks.find((t) => t.kind === "video")!.id;
    const mk = (id: string, off: number, dur: number) => ({
      id,
      kind: "video" as const,
      src: `${id}.mp4`,
      in: 0,
      out: dur,
      trackOffset: off,
      transforms: {},
      filters: {},
    });
    seed.tracks.find((t) => t.id === vId)!.clips = [
      mk("a", 0, 2),
      mk("b", 2, 3),
      mk("c", 5, 1),
    ] as never;
    // Transition after `b` (fades b→c) — orphaned once b is ripple-deleted.
    seed.tracks.find((t) => t.id === vId)!.transitions = [
      { id: "tr_bc", afterClipId: "b", preset: "cross-dissolve", durationSec: 0.5, alignment: "center", easing: "linear" },
    ] as never;

    const cStore = structuredClone(seed);
    useComposition.getState().loadComposition(cStore);
    useComposition.getState().rippleDeleteClip("b");
    const storeTrack = trackById(useComposition.getState().comp!, vId);

    const cOp = structuredClone(seed);
    ops.rippleDeleteClip(cOp, { clipId: "b" });
    const opTrack = trackById(cOp, vId);

    expect((storeTrack.clips as { id: string }[]).map((c) => c.id)).toEqual(
      (opTrack.clips as { id: string }[]).map((c) => c.id),
    );
    expect(storeTrack.transitions).toEqual(opTrack.transitions);
  });
});
