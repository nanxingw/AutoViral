import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "./store";
import {
  makeEmptyComposition,
  VideoClipSchema,
  type Composition,
  type VideoClip,
  type TextClip,
} from "./types";
import { effectiveClipDuration } from "@shared/speed-ramp";

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
    // Phase D (issue #31) — track ids are now `trk_<uuid>`. Resolve the
    // video lane by kind+displayOrder instead of hardcoding "video-0".
    const videoTrackId = c.tracks.find((t) => t.kind === "video")!.id;
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
    const after = useComposition.getState().comp!;
    expect(after.tracks[0].clips).toHaveLength(1);
    expect(after.duration).toBeGreaterThanOrEqual(5);
  });

  it("updateClip applies a partial patch", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    const videoTrackId = c.tracks.find((t) => t.kind === "video")!.id;
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
    useComposition.getState().updateClip("v1", { trackOffset: 2 });
    const v = useComposition.getState().comp!.tracks[0].clips[0];
    expect(v.trackOffset).toBe(2);
  });

  it("removeClip drops the clip and recomputes duration", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    const videoTrackId = c.tracks.find((t) => t.kind === "video")!.id;
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

// ─── Phase 8.2.B — keyframe actions ──────────────────────────────────────────
// addKeyframe / removeKeyframe / updateKeyframe mutate `keyframes?: Keyframe[]`
// on Video/Audio/Overlay clips. TextClip has no keyframes field (D8) → no-op.
// (property, time) collision → replace in place via addOrReplaceKeyframe (D4).

function makeCompWithVideoClip(
  clipId: string,
  overrides: Partial<VideoClip> = {},
): Composition {
  const c = makeEmptyComposition({ workId: "w-kf" });
  const clip: VideoClip = {
    id: clipId,
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...overrides,
  };
  (c.tracks[0].clips as VideoClip[]).push(clip);
  c.duration = 5;
  return c;
}

function makeCompWithTextClip(
  clipId: string,
  overrides: Partial<TextClip> = {},
): Composition {
  const c = makeEmptyComposition({ workId: "w-kf" });
  const clip: TextClip = {
    id: clipId,
    kind: "text",
    text: "hi",
    trackOffset: 0,
    duration: 2,
    style: {
      font: "Inter",
      size: 64,
      weight: 700,
      italic: false,
      tracking: 0,
      color: "#fff",
    },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
    ...overrides,
  };
  // Phase D (issue #31) — default lanes are now V1/A1/A2/CC1, so the text
  // track is at index 3 (it was index 2 pre-Phase-D when defaults were
  // V/A/T/Overlay). Find by kind to stay decoupled from index ordering.
  const textTrack = c.tracks.find((t) => t.kind === "text")!;
  (textTrack.clips as TextClip[]).push(clip);
  c.duration = 2;
  return c;
}

function findClip(comp: Composition, id: string) {
  for (const t of comp.tracks) {
    const c = (t.clips as { id: string }[]).find((c) => c.id === id);
    if (c) return c;
  }
  return undefined;
}

describe("useComposition — keyframe actions", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
  });

  it("addKeyframe pushes a new entry on a clip that had no keyframes (creates the array)", () => {
    useComposition.setState({ comp: makeCompWithVideoClip("clip-1") });
    useComposition.getState().addKeyframe("clip-1", {
      property: "scale",
      time: 0,
      value: 1,
      easing: "linear",
    });
    const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
    expect(c.keyframes).toBeDefined();
    expect(c.keyframes!.length).toBe(1);
    expect(c.keyframes![0].value).toBe(1);
    expect(c.keyframes![0].property).toBe("scale");
  });

  it("addKeyframe replaces the existing entry when (property, time) matches within EPSILON (D4)", () => {
    useComposition.setState({
      comp: makeCompWithVideoClip("clip-1", {
        keyframes: [
          { property: "scale", time: 1, value: 1, easing: "linear" },
        ],
      }),
    });
    useComposition.getState().addKeyframe("clip-1", {
      property: "scale",
      time: 1,
      value: 2,
      easing: "easeOut",
    });
    const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
    expect(c.keyframes!.length).toBe(1);
    expect(c.keyframes![0].value).toBe(2);
    expect(c.keyframes![0].easing).toBe("easeOut");
  });

  it("removeKeyframe splices the entry at the given index", () => {
    useComposition.setState({
      comp: makeCompWithVideoClip("clip-1", {
        keyframes: [
          { property: "scale", time: 0, value: 1, easing: "linear" },
          { property: "scale", time: 2, value: 2, easing: "linear" },
        ],
      }),
    });
    useComposition.getState().removeKeyframe("clip-1", 0);
    const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
    expect(c.keyframes!.length).toBe(1);
    expect(c.keyframes![0].time).toBe(2);
  });

  it("updateKeyframe applies the patch in place at the given original-array index", () => {
    useComposition.setState({
      comp: makeCompWithVideoClip("clip-1", {
        keyframes: [
          { property: "scale", time: 0, value: 1, easing: "linear" },
        ],
      }),
    });
    useComposition.getState().updateKeyframe("clip-1", 0, {
      value: 1.5,
      easing: "easeIn",
    });
    const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
    expect(c.keyframes![0].value).toBe(1.5);
    expect(c.keyframes![0].easing).toBe("easeIn");
    expect(c.keyframes![0].time).toBe(0); // time unchanged
  });

  it("actions are no-ops when clipId does not resolve to a clip", () => {
    useComposition.setState({ comp: makeCompWithVideoClip("clip-1") });
    expect(() => {
      useComposition.getState().addKeyframe("does-not-exist", {
        property: "scale",
        time: 0,
        value: 1,
        easing: "linear",
      });
      useComposition.getState().removeKeyframe("does-not-exist", 0);
      useComposition.getState().updateKeyframe("does-not-exist", 0, {
        value: 5,
      });
    }).not.toThrow();
    const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
    expect(c.keyframes).toBeUndefined();
  });

  it("actions are no-ops when clipId resolves to a TextClip (D8)", () => {
    useComposition.setState({ comp: makeCompWithTextClip("text-1") });
    useComposition.getState().addKeyframe("text-1", {
      property: "opacity",
      time: 0,
      value: 0.5,
      easing: "linear",
    });
    const c = findClip(useComposition.getState().comp!, "text-1") as unknown as {
      keyframes?: unknown;
    };
    expect(c.keyframes).toBeUndefined();
  });

  // ─── Phase 8.3.B — speed keyframes reuse the existing actions (D2) ─────────
  it("adding speed keyframes shrinks the clip's effective timeline duration (D2 regression)", () => {
    useComposition.setState({ comp: makeCompWithVideoClip("clip-1") });
    {
      const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
      expect(effectiveClipDuration(c)).toBe(5);
    }
    // Reuse the existing addKeyframe action — no new store API per D2.
    useComposition.getState().addKeyframe("clip-1", {
      property: "speed",
      time: 0,
      value: 2.0,
      easing: "linear",
    });
    useComposition.getState().addKeyframe("clip-1", {
      property: "speed",
      time: 5,
      value: 2.0,
      easing: "linear",
    });
    const c = findClip(useComposition.getState().comp!, "clip-1") as VideoClip;
    expect(c.keyframes?.length).toBe(2);
    expect(c.keyframes?.[0].property).toBe("speed");
    // (out - in) / 2 = 5 / 2 = 2.5
    expect(effectiveClipDuration(c)).toBeCloseTo(2.5, 3);
  });

  it("VideoClipSchema rejects speed keyframes outside [0.1, 4.0] (D4/D10)", () => {
    expect(() =>
      VideoClipSchema.parse({
        id: "v1",
        kind: "video",
        src: "/x.mp4",
        in: 0,
        out: 1,
        trackOffset: 0,
        keyframes: [
          { property: "speed", time: 0, value: 5, easing: "linear" },
        ],
      }),
    ).toThrow();
  });
});
