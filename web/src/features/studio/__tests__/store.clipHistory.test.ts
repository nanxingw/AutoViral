// S20 (US 32) — clip-level undo stack. Mirrors the track-op undo in
// store.tracks.test.ts but scoped to clip mutations: split / trim (resizeClip)
// / move (moveClipToTrack + moveClipWithinTrack) / set (updateClip) /
// removeClip / addClip. Each clip op snapshots the full tracks array BEFORE
// mutating; undoClipOp restores it, redoClipOp replays. A fresh clip op
// invalidates the redo branch (standard editor semantics).
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
