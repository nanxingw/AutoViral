import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "./store";
import { makeEmptyComposition } from "./types";

describe("useComposition store", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
  });

  it("loadComposition replaces state", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    expect(useComposition.getState().comp?.id).toBe(c.id);
  });

  it("addClip appends to the right track and grows duration", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    useComposition.getState().addClip("video-0", {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 5,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    const after = useComposition.getState().comp!;
    expect(after.tracks[0].clips).toHaveLength(1);
    expect(after.duration).toBeGreaterThanOrEqual(5);
  });

  it("updateClip applies a partial patch", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    useComposition.getState().addClip("video-0", {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 5,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    useComposition.getState().updateClip("v1", { trackOffset: 2 });
    const v = useComposition.getState().comp!.tracks[0].clips[0];
    expect(v.trackOffset).toBe(2);
  });

  it("removeClip drops the clip and recomputes duration", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    useComposition.getState().addClip("video-0", {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 5,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    useComposition.getState().removeClip("v1");
    expect(useComposition.getState().comp!.tracks[0].clips).toHaveLength(0);
    expect(useComposition.getState().comp!.duration).toBe(0);
  });

  it("selection set/clear", () => {
    useComposition.getState().setSelection("v1");
    expect(useComposition.getState().selection).toBe("v1");
    useComposition.getState().setSelection(null);
    expect(useComposition.getState().selection).toBeNull();
  });
});
