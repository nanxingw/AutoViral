import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipResize } from "./useClipResize";
import { useComposition } from "../../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../../../test/composition-fixtures";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
  const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
  useComposition.setState({
    comp: makeCompositionWithClips([a, b]),
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
    dragState: null,
  });
});

describe("useClipResize", () => {
  it("right-edge drag updates clip.out via the store", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // a.end currently at 2 → +50px → +1s → newTime = 3s, out = in + (3 - 0) = 3
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(a.out).toBeCloseTo(3);
  });

  it("snaps the resized edge to a neighbouring clip's start (D1 0.06s)", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // a.end=2; b.start=5. Drag +148px → 2 + 148/50 = 4.96 → within 0.06s of 5 → snap to 5.
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(148);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    // out = in + (5 - trackOffset) = 0 + 5 - 0 = 5
    expect(a.out).toBeCloseTo(5);
  });

  it("left-edge drag updates trackOffset + in", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 1, in: 1, out: 4 }),
      ]),
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // anchor = trackOffset = 1; +50px → +1s → newTime = 2 → trackOffset 2, in 2
    act(() => {
      result.current.beginResize("left", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });
    const clip = useComposition.getState().comp!.tracks[0].clips[0] as {
      trackOffset: number;
      in: number;
    };
    expect(clip.trackOffset).toBeCloseTo(2);
    expect(clip.in).toBeCloseTo(2);
  });

  it("returns isResizing true between begin and end", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    expect(result.current.isResizing).toBe(false);
    act(() => result.current.beginResize("right", 0));
    expect(result.current.isResizing).toBe(true);
    act(() => result.current.endResize());
    expect(result.current.isResizing).toBe(false);
  });

  it("right-edge drag is capped by next clip's start (D2 via store)", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // anchor=2, drag +1000px → newTime=22; b.start=5 caps it.
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(1000);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(a.out).toBeCloseTo(5);
  });

  it("left-edge drag clamps to 0 if dragged past the timeline start", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 2, in: 2, out: 5 }),
      ]),
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // anchor=2, drag -1000px → newTime=-18 → store clamps to 0.
    act(() => {
      result.current.beginResize("left", 0);
      result.current.dragResize(-1000);
      result.current.endResize();
    });
    const clip = useComposition.getState().comp!.tracks[0].clips[0] as {
      trackOffset: number;
      in: number;
    };
    expect(clip.trackOffset).toBeCloseTo(0);
    // delta = 0 - 2 = -2 → in becomes 2 + (-2) = 0
    expect(clip.in).toBeCloseTo(0);
  });

  it("cancelResize reverts the clip to its pre-drag state", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(50); // out becomes 3
    });
    const mid = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(mid.out).toBeCloseTo(3);
    act(() => result.current.cancelResize());
    const after = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(after.out).toBeCloseTo(2);
    expect(result.current.isResizing).toBe(false);
  });
});
