// S20 (US 32) — clip-level undo stack. Mirrors the track-op undo in
// store.tracks.test.ts but scoped to clip mutations: split / trim (resizeClip)
// / move (moveClipToTrack + moveClipWithinTrack) / set (updateClip) /
// removeClip / addClip / ripple-delete / collapse-gaps. Each clip op snapshots
// the full tracks array BEFORE mutating; undoClipOp restores it, redoClipOp
// replays. A fresh clip op invalidates the redo branch (standard editor
// semantics).
//
// S20 fix-up coverage (every assertion below is a real, previously-failing
// case): move (moveClipToTrack + moveClipWithinTrack) undo was claimed but
// untested; ripple-delete + collapse-gaps never pushed history at all; no-op
// patches (same-value updateClip / same-index move) padded the stack; and
// undo over add/remove left a dangling `selection`. All are pinned here.
//
// The real Cmd+Z keybinding that drives undoClipOp from the keyboard is a UI
// concern verified by the E2E workflow; here we pin the store action only.

import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../test/composition-fixtures";
import type { Clip, Composition } from "../types";

function comp(): Composition {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  const b = makeVideoClip({ id: "b", trackOffset: 4, in: 0, out: 4 });
  return makeCompositionWithClips([a, b]);
}

function clipsOnFirstTrack(): Clip[] {
  return useComposition.getState().comp!.tracks[0].clips as Clip[];
}

beforeEach(() => {
  useComposition.setState({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
    dragState: null,
    bladeMode: false,
    trackHistory: { past: [], future: [] },
    clipHistory: { past: [], future: [] },
  });
});

describe("clip-level undo / redo (S20)", () => {
  it("undoClipOp on an empty stack is a silent no-op", () => {
    useComposition.getState().loadComposition(comp());
    const before = clipsOnFirstTrack().map((c) => c.id);
    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack().map((c) => c.id)).toEqual(before);
  });

  it("split → undo restores the un-split clip; redo re-splits", () => {
    useComposition.getState().loadComposition(comp());
    expect(clipsOnFirstTrack()).toHaveLength(2);
    // Split clip "a" (0..4) at 2s into two halves.
    useComposition.getState().splitClip("a", 2);
    expect(clipsOnFirstTrack()).toHaveLength(3);

    useComposition.getState().undoClipOp();
    const undone = clipsOnFirstTrack();
    expect(undone).toHaveLength(2);
    expect(undone.map((c) => c.id).sort()).toEqual(["a", "b"]);

    useComposition.getState().redoClipOp();
    expect(clipsOnFirstTrack()).toHaveLength(3);
  });

  it("updateClip (set) → undo restores the previous field value", () => {
    useComposition.getState().loadComposition(comp());
    const origOffset = clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset;
    useComposition.getState().updateClip("b", { trackOffset: 9 });
    expect(clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset).toBe(9);

    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset).toBe(
      origOffset,
    );
  });

  it("removeClip → undo brings the clip back", () => {
    useComposition.getState().loadComposition(comp());
    useComposition.getState().removeClip("b");
    expect(clipsOnFirstTrack().some((c) => c.id === "b")).toBe(false);

    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack().some((c) => c.id === "b")).toBe(true);
  });

  it("addClip → undo removes the freshly added clip", () => {
    useComposition.getState().loadComposition(comp());
    const trackId = useComposition.getState().comp!.tracks[0].id;
    useComposition.getState().addClip(trackId, {
      id: "c",
      kind: "video",
      src: "/c.mp4",
      in: 0,
      out: 2,
      trackOffset: 8,
      fitMode: "cover",
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    expect(clipsOnFirstTrack().some((c) => c.id === "c")).toBe(true);

    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack().some((c) => c.id === "c")).toBe(false);
  });

  it("resizeClip (trim) → undo restores the original out point", () => {
    useComposition.getState().loadComposition(comp());
    const origOut = (clipsOnFirstTrack().find((c) => c.id === "a")! as {
      out: number;
    }).out;
    // Trim a's right edge to 2s.
    useComposition.getState().resizeClip("a", "right", 2);
    expect(
      (clipsOnFirstTrack().find((c) => c.id === "a")! as { out: number }).out,
    ).not.toBe(origOut);

    useComposition.getState().undoClipOp();
    expect(
      (clipsOnFirstTrack().find((c) => c.id === "a")! as { out: number }).out,
    ).toBe(origOut);
  });

  it("a fresh clip op after undo invalidates the redo branch", () => {
    useComposition.getState().loadComposition(comp());
    // op1: split a → 3 clips
    useComposition.getState().splitClip("a", 2);
    // undo back to 2 clips; future now holds the post-split state
    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack()).toHaveLength(2);
    // fresh op: remove b → future must be wiped
    useComposition.getState().removeClip("b");
    // redo must be a no-op (cannot resurrect the wiped split future)
    useComposition.getState().redoClipOp();
    const after = clipsOnFirstTrack();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("a");
  });

  it("ripple-delete → undo brings the clip back AND restores neighbour offsets", () => {
    useComposition.getState().loadComposition(comp());
    // a:[0,4) b:[4,8). Ripple-delete a → b shifts left to trackOffset 0.
    const bOffsetBefore = clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset;
    useComposition.getState().rippleDeleteClip("a");
    const afterDelete = clipsOnFirstTrack();
    expect(afterDelete.some((c) => c.id === "a")).toBe(false);
    // b rippled left to 0
    expect(afterDelete.find((c) => c.id === "b")!.trackOffset).toBe(0);

    useComposition.getState().undoClipOp();
    const undone = clipsOnFirstTrack();
    // a is back
    expect(undone.some((c) => c.id === "a")).toBe(true);
    // and b is back at its original offset (the ripple shift was undone)
    expect(undone.find((c) => c.id === "b")!.trackOffset).toBe(bOffsetBefore);
  });

  it("collapse-gaps → undo restores the original clip offsets", () => {
    useComposition.getState().loadComposition(comp());
    const trackId = useComposition.getState().comp!.tracks[0].id;
    // Open a gap: push b out to 10 so collapse-gaps will pull it back to 4.
    useComposition.getState().updateClip("b", { trackOffset: 10 });
    expect(clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset).toBe(10);

    useComposition.getState().collapseGaps(trackId);
    // a stays at 0 (dur 4), b collapses back to 4.
    expect(clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset).toBe(4);

    useComposition.getState().undoClipOp();
    // collapse undone → b back at 10 (the pre-collapse state).
    expect(clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset).toBe(10);
  });

  it("moveClipToTrack → undo restores the clip to its original lane", () => {
    useComposition.getState().loadComposition(comp());
    const sourceTrackId = useComposition.getState().comp!.tracks[0].id;
    // Add a second same-kind (video) lane to move into.
    const destTrackId = useComposition.getState().addTrack("video");

    useComposition.getState().moveClipToTrack("b", destTrackId);
    const tracksAfter = useComposition.getState().comp!.tracks;
    const dest = tracksAfter.find((t) => t.id === destTrackId)!;
    const source = tracksAfter.find((t) => t.id === sourceTrackId)!;
    expect((dest.clips as Clip[]).some((c) => c.id === "b")).toBe(true);
    expect((source.clips as Clip[]).some((c) => c.id === "b")).toBe(false);

    useComposition.getState().undoClipOp();
    const restored = useComposition.getState().comp!.tracks;
    const destAfter = restored.find((t) => t.id === destTrackId)!;
    const sourceAfter = restored.find((t) => t.id === sourceTrackId)!;
    // b is back on the source lane, gone from the dest lane.
    expect((sourceAfter.clips as Clip[]).some((c) => c.id === "b")).toBe(true);
    expect((destAfter.clips as Clip[]).some((c) => c.id === "b")).toBe(false);
  });

  it("moveClipWithinTrack → undo restores the original order + offsets", () => {
    useComposition.getState().loadComposition(comp());
    const trackId = useComposition.getState().comp!.tracks[0].id;
    const orderBefore = clipsOnFirstTrack().map((c) => c.id);
    const offsetsBefore = clipsOnFirstTrack().map((c) => c.trackOffset);

    // Reorder a (idx 0) to idx 1, swapping with b.
    useComposition.getState().moveClipWithinTrack(trackId, 0, 1);
    expect(clipsOnFirstTrack().map((c) => c.id)).toEqual(["b", "a"]);

    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack().map((c) => c.id)).toEqual(orderBefore);
    expect(clipsOnFirstTrack().map((c) => c.trackOffset)).toEqual(offsetsBefore);
  });

  it("updateClip with a no-op patch (same value) does NOT push history", () => {
    useComposition.getState().loadComposition(comp());
    const currentOffset = clipsOnFirstTrack().find((c) => c.id === "b")!.trackOffset;
    const depthBefore = useComposition.getState().clipHistory.past.length;
    // Patch trackOffset to the value it already has → must be a no-op push-wise.
    useComposition.getState().updateClip("b", { trackOffset: currentOffset });
    expect(useComposition.getState().clipHistory.past.length).toBe(depthBefore);
  });

  it("moveClipWithinTrack with fromIndex === toIndex does NOT push history", () => {
    useComposition.getState().loadComposition(comp());
    const trackId = useComposition.getState().comp!.tracks[0].id;
    const depthBefore = useComposition.getState().clipHistory.past.length;
    useComposition.getState().moveClipWithinTrack(trackId, 0, 0);
    expect(useComposition.getState().clipHistory.past.length).toBe(depthBefore);
  });

  it("undo of an addClip whose new clip is selected clears the dangling selection", () => {
    useComposition.getState().loadComposition(comp());
    const trackId = useComposition.getState().comp!.tracks[0].id;
    useComposition.getState().addClip(trackId, {
      id: "c",
      kind: "video",
      src: "/c.mp4",
      in: 0,
      out: 2,
      trackOffset: 8,
      fitMode: "cover",
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    // Select the freshly added clip.
    useComposition.getState().setSelection("c");
    expect(useComposition.getState().selection).toBe("c");

    // Undo removes clip "c" — selection must not dangle.
    useComposition.getState().undoClipOp();
    expect(clipsOnFirstTrack().some((cl) => cl.id === "c")).toBe(false);
    expect(useComposition.getState().selection).toBeNull();
  });

  it("undo that keeps the selected clip alive preserves the selection", () => {
    useComposition.getState().loadComposition(comp());
    useComposition.getState().setSelection("b");
    // A set on "a" (not "b") — undoing it must NOT clear the still-valid
    // selection on "b".
    useComposition.getState().updateClip("a", { trackOffset: 99 });
    useComposition.getState().undoClipOp();
    expect(useComposition.getState().selection).toBe("b");
  });

  it("clip ops do not push onto the track-op history stack (and vice-versa)", () => {
    useComposition.getState().loadComposition(comp());
    useComposition.getState().splitClip("a", 2);
    // The split pushed one CLIP-history entry but zero TRACK-history entries.
    expect(useComposition.getState().clipHistory.past).toHaveLength(1);
    expect(useComposition.getState().trackHistory.past).toHaveLength(0);
    // A track op pushes onto trackHistory and leaves the clip stack untouched.
    const clipDepthBefore = useComposition.getState().clipHistory.past.length;
    useComposition.getState().addTrack("audio");
    expect(useComposition.getState().trackHistory.past).toHaveLength(1);
    expect(useComposition.getState().clipHistory.past).toHaveLength(
      clipDepthBefore,
    );
  });
});
