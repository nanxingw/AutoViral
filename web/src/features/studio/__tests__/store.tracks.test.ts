// Phase E (issue #32) — lane mutation actions + undo/redo.
//
// What we cover here:
//   - addTrack default placement (end of same-kind block, never bleeds across
//     kinds), explicit `afterTrackId`, returned id matches the new lane.
//   - removeTrack two-step contract: empty-lane removes immediately, lane
//     with clips returns `{ ok: false, reason: "has-clips" }`, `{ force: true }`
//     orphans the clips and removes anyway.
//   - reorderTracks across kinds (the global `displayOrder` invariant means
//     a text lane can land between two audio lanes — kind is not a constraint
//     on order, only on filtering).
//   - renameTrack / setTrackLanguage / setTrackVolume happy + warn paths.
//   - The displayOrder invariant — `sort(displayOrder)` is contiguous 0..N-1
//     after every action. Asserted via a helper so every action gets the same
//     verification net (matches the audit sediment in
//     `feedback_contract_test_sweep_gate.md`).
//   - Atomicity (no half-state visible from a getter) — getter mid-action is
//     hard to observe in zustand's synchronous model; we instead assert the
//     pre/post snapshot is internally consistent (no transient duplicate
//     displayOrder).
//   - undo / redo for add and reorder; new ops invalidate the redo branch.

import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition, type Composition, type Track } from "../types";

// ─── helpers ────────────────────────────────────────────────────────────
function freshComp(): Composition {
  return makeEmptyComposition({ workId: "w-phase-e" });
}

function tracksFromState(): Track[] {
  return useComposition.getState().comp!.tracks;
}

function sortedOrders(tracks: Track[]): number[] {
  return [...tracks].map((t) => t.displayOrder).sort((a, b) => a - b);
}

function assertContiguousDisplayOrder(tracks: Track[]) {
  const orders = sortedOrders(tracks);
  const expected = orders.map((_, i) => i);
  expect(orders).toEqual(expected);
}

beforeEach(() => {
  // Reset the store completely between tests — undo/redo stacks plus comp.
  useComposition.setState({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
    dragState: null,
    bladeMode: false,
    trackHistory: { past: [], future: [] },
  });
});

describe("addTrack — placement", () => {
  it("returns a `trk_`-prefixed id and the new lane is visible immediately", () => {
    useComposition.getState().loadComposition(freshComp());
    const id = useComposition.getState().addTrack("audio");
    expect(id).toMatch(/^trk_/);
    const tracks = tracksFromState();
    expect(tracks.some((t) => t.id === id)).toBe(true);
  });

  it("defaults to the end of the same-kind block (audio lands after audio, not after video)", () => {
    useComposition.getState().loadComposition(freshComp());
    // Default comp has V(0), A1(1), A2(2), CC(3). Adding an audio lane must
    // land between A2 and CC — displayOrder 3 — not at the very end.
    const id = useComposition.getState().addTrack("audio");
    const tracks = tracksFromState();
    const added = tracks.find((t) => t.id === id)!;
    const captionTrack = tracks.find((t) => t.kind === "text")!;
    expect(added.displayOrder).toBeLessThan(captionTrack.displayOrder);
    // …and after every existing audio lane.
    const otherAudios = tracks.filter(
      (t) => t.kind === "audio" && t.id !== id,
    );
    for (const a of otherAudios) {
      expect(added.displayOrder).toBeGreaterThan(a.displayOrder);
    }
    assertContiguousDisplayOrder(tracks);
  });

  it("with afterTrackId, inserts directly below the anchor", () => {
    useComposition.getState().loadComposition(freshComp());
    const tracksBefore = tracksFromState();
    const videoAnchor = tracksBefore.find((t) => t.kind === "video")!;
    const id = useComposition.getState().addTrack("audio", {
      afterTrackId: videoAnchor.id,
    });
    const tracks = tracksFromState();
    const added = tracks.find((t) => t.id === id)!;
    expect(added.displayOrder).toBe(videoAnchor.displayOrder + 1);
    assertContiguousDisplayOrder(tracks);
  });

  it("first lane of a never-seen kind falls back to tail-of-all placement", () => {
    // Start from an empty-tracks comp so the kind-block calculation can't
    // find an existing audio lane to anchor on.
    const comp = freshComp();
    comp.tracks = []; // strip defaults
    useComposition.getState().loadComposition(comp);
    const id = useComposition.getState().addTrack("audio");
    const tracks = tracksFromState();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].displayOrder).toBe(0);
  });

  it("passes through opts.label and opts.language", () => {
    useComposition.getState().loadComposition(freshComp());
    const id = useComposition.getState().addTrack("text", {
      label: "CC2 · en",
      language: "en",
    });
    const t = tracksFromState().find((t) => t.id === id)!;
    expect(t.label).toBe("CC2 · en");
    expect(t.language).toBe("en");
  });
});

describe("removeTrack — two-step contract", () => {
  it("removes an empty lane immediately and recompacts displayOrder", () => {
    useComposition.getState().loadComposition(freshComp());
    const before = tracksFromState();
    const targetId = before.find((t) => t.kind === "audio")!.id;
    const result = useComposition.getState().removeTrack(targetId);
    expect(result).toEqual({ ok: true });
    const after = tracksFromState();
    expect(after.some((t) => t.id === targetId)).toBe(false);
    expect(after).toHaveLength(before.length - 1);
    assertContiguousDisplayOrder(after);
  });

  it("returns { ok: false, reason: 'has-clips' } for a non-empty lane and leaves state untouched", () => {
    useComposition.getState().loadComposition(freshComp());
    const videoTrackId = tracksFromState().find((t) => t.kind === "video")!.id;
    useComposition.getState().addClip(videoTrackId, {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 5,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    const before = tracksFromState();
    const result = useComposition.getState().removeTrack(videoTrackId);
    expect(result).toEqual({ ok: false, reason: "has-clips" });
    // State unchanged — same track count, video lane still there with its clip.
    const after = tracksFromState();
    expect(after).toHaveLength(before.length);
    expect(after.find((t) => t.id === videoTrackId)!.clips).toHaveLength(1);
  });

  it("with { force: true }, deletes a non-empty lane and orphans the clips", () => {
    useComposition.getState().loadComposition(freshComp());
    const videoTrackId = tracksFromState().find((t) => t.kind === "video")!.id;
    useComposition.getState().addClip(videoTrackId, {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 5,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    const result = useComposition
      .getState()
      .removeTrack(videoTrackId, { force: true });
    expect(result).toEqual({ ok: true });
    const after = tracksFromState();
    expect(after.some((t) => t.id === videoTrackId)).toBe(false);
    // Clip is gone with the track (no zombie copy anywhere).
    const allClips = after.flatMap((t) => t.clips);
    expect(allClips.some((c) => c.id === "v1")).toBe(false);
    assertContiguousDisplayOrder(after);
  });

  it("returns { ok: false, reason: 'not-found' } for an unknown id", () => {
    useComposition.getState().loadComposition(freshComp());
    const result = useComposition
      .getState()
      .removeTrack("trk_doesnotexist");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("reorderTracks — global, kind-agnostic", () => {
  it("moves a track to a new index and preserves the invariant", () => {
    useComposition.getState().loadComposition(freshComp());
    // Default: V(0) / A1(1) / A2(2) / CC(3). Move CC to index 0.
    const ccId = tracksFromState().find((t) => t.kind === "text")!.id;
    useComposition.getState().reorderTracks(ccId, 0);
    const after = tracksFromState();
    const cc = after.find((t) => t.id === ccId)!;
    expect(cc.displayOrder).toBe(0);
    assertContiguousDisplayOrder(after);
  });

  it("allows reordering across kinds (text lane can land between two audio lanes)", () => {
    useComposition.getState().loadComposition(freshComp());
    const ccId = tracksFromState().find((t) => t.kind === "text")!.id;
    // V(0) / A1(1) / A2(2) / CC(3) → move CC to index 2 → V / A1 / CC / A2
    useComposition.getState().reorderTracks(ccId, 2);
    const after = tracksFromState();
    const cc = after.find((t) => t.id === ccId)!;
    expect(cc.displayOrder).toBe(2);
    // The two audio lanes are now non-contiguous in the displayOrder sense
    // (A1 at 1, A2 at 3) — that's the whole point of the test.
    const audios = after
      .filter((t) => t.kind === "audio")
      .sort((a, b) => a.displayOrder - b.displayOrder);
    expect(audios[0].displayOrder).toBe(1);
    expect(audios[1].displayOrder).toBe(3);
    assertContiguousDisplayOrder(after);
  });

  it("clamps an out-of-range toIndex into bounds", () => {
    useComposition.getState().loadComposition(freshComp());
    const ccId = tracksFromState().find((t) => t.kind === "text")!.id;
    useComposition.getState().reorderTracks(ccId, 9999);
    const after = tracksFromState();
    const cc = after.find((t) => t.id === ccId)!;
    expect(cc.displayOrder).toBe(after.length - 1);
    assertContiguousDisplayOrder(after);
  });

  it("never mutates the track id (Pitfall #1)", () => {
    useComposition.getState().loadComposition(freshComp());
    const before = tracksFromState().map((t) => t.id).sort();
    const ccId = tracksFromState().find((t) => t.kind === "text")!.id;
    useComposition.getState().reorderTracks(ccId, 0);
    const after = tracksFromState().map((t) => t.id).sort();
    expect(after).toEqual(before);
  });
});

describe("renameTrack / setTrackLanguage / setTrackVolume", () => {
  it("renameTrack updates label and preserves everything else", () => {
    useComposition.getState().loadComposition(freshComp());
    const id = tracksFromState().find((t) => t.kind === "video")!.id;
    useComposition.getState().renameTrack(id, "Master cut");
    const t = tracksFromState().find((t) => t.id === id)!;
    expect(t.label).toBe("Master cut");
  });

  it("setTrackLanguage sets and clears language on text tracks", () => {
    useComposition.getState().loadComposition(freshComp());
    const ccId = tracksFromState().find((t) => t.kind === "text")!.id;
    useComposition.getState().setTrackLanguage(ccId, "en");
    expect(tracksFromState().find((t) => t.id === ccId)!.language).toBe("en");
    useComposition.getState().setTrackLanguage(ccId, null);
    expect(
      tracksFromState().find((t) => t.id === ccId)!.language,
    ).toBeUndefined();
  });

  it("setTrackLanguage on non-text kinds is a friendly no-op (warns, no throw)", () => {
    useComposition.getState().loadComposition(freshComp());
    const audioId = tracksFromState().find((t) => t.kind === "audio")!.id;
    const before = tracksFromState().find((t) => t.id === audioId)!;
    expect(() =>
      useComposition.getState().setTrackLanguage(audioId, "en"),
    ).not.toThrow();
    const after = tracksFromState().find((t) => t.id === audioId)!;
    expect(after.language).toBe(before.language); // unchanged
  });

  it("setTrackVolume attaches a placeholder volume field on audio tracks", () => {
    useComposition.getState().loadComposition(freshComp());
    const audioId = tracksFromState().find((t) => t.kind === "audio")!.id;
    useComposition.getState().setTrackVolume(audioId, -6);
    const t = tracksFromState().find((t) => t.id === audioId)! as Track & {
      volume?: number;
    };
    expect(t.volume).toBe(-6);
  });

  it("setTrackVolume on non-audio kinds is a friendly no-op", () => {
    useComposition.getState().loadComposition(freshComp());
    const videoId = tracksFromState().find((t) => t.kind === "video")!.id;
    expect(() =>
      useComposition.getState().setTrackVolume(videoId, -6),
    ).not.toThrow();
    const t = tracksFromState().find((t) => t.id === videoId)! as Track & {
      volume?: number;
    };
    expect(t.volume).toBeUndefined();
  });
});

describe("undo / redo — track ops only", () => {
  it("add → reorder → undo → redo restores state at each step", () => {
    useComposition.getState().loadComposition(freshComp());
    const baselineIds = tracksFromState()
      .map((t) => t.id)
      .sort();
    const baselineLen = baselineIds.length;

    // 1. Add an audio lane.
    const newId = useComposition.getState().addTrack("audio");
    const afterAdd = tracksFromState();
    expect(afterAdd).toHaveLength(baselineLen + 1);
    expect(afterAdd.some((t) => t.id === newId)).toBe(true);
    assertContiguousDisplayOrder(afterAdd);

    // 2. Reorder: move the newly-added lane to the top.
    useComposition.getState().reorderTracks(newId, 0);
    const afterReorder = tracksFromState();
    expect(afterReorder.find((t) => t.id === newId)!.displayOrder).toBe(0);
    assertContiguousDisplayOrder(afterReorder);

    // 3. Undo reorder → state matches afterAdd.
    useComposition.getState().undoTrackOp();
    const undoReorder = tracksFromState();
    expect(undoReorder).toHaveLength(baselineLen + 1);
    // The undone displayOrder for the new lane should match its post-add value.
    const newAfterAdd = afterAdd.find((t) => t.id === newId)!;
    expect(undoReorder.find((t) => t.id === newId)!.displayOrder).toBe(
      newAfterAdd.displayOrder,
    );
    assertContiguousDisplayOrder(undoReorder);

    // 4. Undo add → back to baseline.
    useComposition.getState().undoTrackOp();
    const undoAdd = tracksFromState();
    expect(undoAdd).toHaveLength(baselineLen);
    expect(undoAdd.map((t) => t.id).sort()).toEqual(baselineIds);
    assertContiguousDisplayOrder(undoAdd);

    // 5. Redo add → lane back.
    useComposition.getState().redoTrackOp();
    const redoAdd = tracksFromState();
    expect(redoAdd).toHaveLength(baselineLen + 1);
    expect(redoAdd.some((t) => t.id === newId)).toBe(true);
    assertContiguousDisplayOrder(redoAdd);

    // 6. Redo reorder → lane back at the top.
    useComposition.getState().redoTrackOp();
    const redoReorder = tracksFromState();
    expect(redoReorder.find((t) => t.id === newId)!.displayOrder).toBe(0);
    assertContiguousDisplayOrder(redoReorder);
  });

  it("a new op after undo invalidates the redo branch", () => {
    useComposition.getState().loadComposition(freshComp());
    const id1 = useComposition.getState().addTrack("audio");
    useComposition.getState().undoTrackOp();
    // Future stack now has the post-add state; performing a fresh op must clear it.
    useComposition.getState().addTrack("text");
    useComposition.getState().redoTrackOp(); // should be a no-op now
    const after = tracksFromState();
    // The post-undo redo should NOT bring back id1 (that future entry was wiped).
    expect(after.some((t) => t.id === id1)).toBe(false);
  });

  it("undoTrackOp on an empty stack is a silent no-op", () => {
    useComposition.getState().loadComposition(freshComp());
    const before = tracksFromState().map((t) => t.id).sort();
    useComposition.getState().undoTrackOp();
    const after = tracksFromState().map((t) => t.id).sort();
    expect(after).toEqual(before);
  });
});

describe("displayOrder invariant — universal sweep", () => {
  // Matches the audit sediment in feedback_contract_test_sweep_gate.md:
  // every mutating action gets checked, not just the ones the PRD called out.
  it("survives every mutating action in sequence", () => {
    useComposition.getState().loadComposition(freshComp());
    assertContiguousDisplayOrder(tracksFromState());

    const audioId = useComposition.getState().addTrack("audio");
    assertContiguousDisplayOrder(tracksFromState());

    useComposition
      .getState()
      .addTrack("text", { language: "en", label: "CC2 · en" });
    assertContiguousDisplayOrder(tracksFromState());

    useComposition.getState().reorderTracks(audioId, 0);
    assertContiguousDisplayOrder(tracksFromState());

    useComposition.getState().renameTrack(audioId, "Hero pad");
    assertContiguousDisplayOrder(tracksFromState());

    useComposition.getState().setTrackVolume(audioId, -3);
    assertContiguousDisplayOrder(tracksFromState());

    useComposition.getState().removeTrack(audioId);
    assertContiguousDisplayOrder(tracksFromState());

    useComposition.getState().undoTrackOp();
    assertContiguousDisplayOrder(tracksFromState());

    useComposition.getState().redoTrackOp();
    assertContiguousDisplayOrder(tracksFromState());
  });
});
