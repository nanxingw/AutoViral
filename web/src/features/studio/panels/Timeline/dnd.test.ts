import { describe, it, expect } from "vitest";
import {
  TIMELINE_DND_MIME,
  assetTargetTrackKind,
  canAcceptDrop,
  writeDragPayload,
  readDragPayload,
  dropTimeFromPointer,
  resolveDropTime,
  resolveDrop,
  resolveDragTargetTrack,
  type AssetDragPayload,
  type ClipDragPayload,
  type TrackView,
} from "./dnd";
import {
  makeVideoClip,
  makeCompositionWithClips,
} from "../../../../test/composition-fixtures";

const asset = (kind: AssetDragPayload["assetKind"]): AssetDragPayload => ({
  source: "asset",
  assetPath: `media/x.${kind === "image" ? "png" : kind === "audio" ? "mp3" : "mp4"}`,
  assetKind: kind,
});
const clip = (clipKind: ClipDragPayload["clipKind"]): ClipDragPayload => ({
  source: "clip",
  clipId: "c1",
  clipKind,
});

describe("assetTargetTrackKind", () => {
  it("maps video→video / audio→audio / image→overlay", () => {
    expect(assetTargetTrackKind("video")).toBe("video");
    expect(assetTargetTrackKind("audio")).toBe("audio");
    expect(assetTargetTrackKind("image")).toBe("overlay");
  });
  it("returns null for non-placeable kinds", () => {
    expect(assetTargetTrackKind("text")).toBeNull();
    expect(assetTargetTrackKind("other")).toBeNull();
  });
});

describe("canAcceptDrop — asset → track (I19 type constraint)", () => {
  it("accepts a video asset onto a video track", () => {
    expect(canAcceptDrop(asset("video"), "video")).toBe(true);
  });
  it("rejects a video asset onto an audio track", () => {
    expect(canAcceptDrop(asset("video"), "audio")).toBe(false);
  });
  it("accepts an audio asset onto an audio track, rejects onto video", () => {
    expect(canAcceptDrop(asset("audio"), "audio")).toBe(true);
    expect(canAcceptDrop(asset("audio"), "video")).toBe(false);
  });
  it("routes an image asset onto an overlay track, rejects onto video/audio/text", () => {
    expect(canAcceptDrop(asset("image"), "overlay")).toBe(true);
    expect(canAcceptDrop(asset("image"), "video")).toBe(false);
    expect(canAcceptDrop(asset("image"), "audio")).toBe(false);
    expect(canAcceptDrop(asset("image"), "text")).toBe(false);
  });
  it("rejects a non-placeable asset kind on every track", () => {
    for (const tk of ["video", "audio", "text", "overlay"] as const) {
      expect(canAcceptDrop(asset("text"), tk)).toBe(false);
      expect(canAcceptDrop(asset("other"), tk)).toBe(false);
    }
  });
});

describe("canAcceptDrop — clip → track (I20 cross-track guard)", () => {
  it("accepts a video clip onto another video track", () => {
    expect(canAcceptDrop(clip("video"), "video")).toBe(true);
  });
  it("rejects a video clip onto an audio track (cross-kind)", () => {
    expect(canAcceptDrop(clip("video"), "audio")).toBe(false);
  });
  it("accepts an audio clip onto an audio track only", () => {
    expect(canAcceptDrop(clip("audio"), "audio")).toBe(true);
    expect(canAcceptDrop(clip("audio"), "video")).toBe(false);
    expect(canAcceptDrop(clip("audio"), "text")).toBe(false);
  });
});

describe("writeDragPayload / readDragPayload round-trip", () => {
  function fakeDT() {
    const store = new Map<string, string>();
    return {
      setData: (t: string, d: string) => void store.set(t, d),
      getData: (t: string) => store.get(t) ?? "",
    };
  }

  it("round-trips an asset payload through the custom MIME", () => {
    const dt = fakeDT();
    writeDragPayload(dt, asset("image"));
    expect(dt.getData(TIMELINE_DND_MIME)).toContain("image");
    expect(readDragPayload(dt)).toEqual(asset("image"));
  });
  it("round-trips a clip payload", () => {
    const dt = fakeDT();
    writeDragPayload(dt, clip("video"));
    expect(readDragPayload(dt)).toEqual(clip("video"));
  });
  it("returns null when the MIME is absent (e.g. a plain file drop)", () => {
    expect(readDragPayload(fakeDT())).toBeNull();
  });
  it("returns null on malformed JSON", () => {
    const dt = fakeDT();
    dt.setData(TIMELINE_DND_MIME, "{not json");
    expect(readDragPayload(dt)).toBeNull();
  });
  it("returns null on an unknown source discriminant", () => {
    const dt = fakeDT();
    dt.setData(TIMELINE_DND_MIME, JSON.stringify({ source: "ghost", x: 1 }));
    expect(readDragPayload(dt)).toBeNull();
  });
});

describe("dropTimeFromPointer", () => {
  it("converts pointer X relative to the lane left into seconds", () => {
    // lane starts at x=200; cursor at 300 with 50px/s → 2s
    expect(dropTimeFromPointer(300, 200, 50)).toBeCloseTo(2);
  });
  it("clamps negative times to 0 (cursor left of the lane)", () => {
    expect(dropTimeFromPointer(180, 200, 50)).toBe(0);
  });
  it("returns 0 for a non-positive scale", () => {
    expect(dropTimeFromPointer(300, 200, 0)).toBe(0);
  });
});

describe("resolveDropTime — snaps against composition edges", () => {
  it("snaps a near-edge raw time onto an existing clip end", () => {
    // clip a: 0..2 on a video track
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const comp = makeCompositionWithClips([a]);
    // raw 2.04 within 0.06 of a.end (2) → snaps to 2
    const r = resolveDropTime(comp, 2.04, 1, 0, null);
    expect(r.start).toBeCloseTo(2);
    expect(r.snapTime).toBeCloseTo(2);
  });
  it("excludes the dragged clip's own edges during a cross-track move", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const comp = makeCompositionWithClips([a]);
    // dragging clip a itself: its own end (2) is excluded, so 2.04 doesn't snap
    const r = resolveDropTime(comp, 2.04, 2, 0, "a");
    expect(r.snapTime).toBeNull();
    expect(r.start).toBeCloseTo(2.04);
  });
  it("leaves a far-from-everything time untouched", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const comp = makeCompositionWithClips([a]);
    const r = resolveDropTime(comp, 9, 1, 0, null);
    expect(r.snapTime).toBeNull();
    expect(r.start).toBeCloseTo(9);
  });
});

describe("resolveDrop — payload + target → store intent", () => {
  const vTrack = { id: "t_video", kind: "video" as const };
  const aTrack = { id: "t_audio", kind: "audio" as const };
  const oTrack = { id: "t_overlay", kind: "overlay" as const };

  it("asset → matching track yields an add-asset intent at the snapped start", () => {
    const intent = resolveDrop(asset("video"), vTrack, 3.5, null);
    expect(intent).toEqual({
      type: "add-asset",
      assetPath: asset("video").assetPath,
      assetKind: "video",
      trackId: "t_video",
      start: 3.5,
    });
  });
  it("image asset → overlay track yields an add-asset intent", () => {
    const intent = resolveDrop(asset("image"), oTrack, 0, null);
    expect(intent.type).toBe("add-asset");
  });
  it("asset → wrong-kind track is rejected", () => {
    expect(resolveDrop(asset("video"), aTrack, 1, null)).toEqual({ type: "reject" });
    expect(resolveDrop(asset("audio"), vTrack, 1, null)).toEqual({ type: "reject" });
    expect(resolveDrop(asset("text"), vTrack, 1, null)).toEqual({ type: "reject" });
  });
  it("clip → a different same-kind track yields a move-clip intent", () => {
    const intent = resolveDrop(clip("video"), { id: "t_video_2", kind: "video" }, 0, "t_video");
    expect(intent).toEqual({
      type: "move-clip",
      clipId: "c1",
      targetTrackId: "t_video_2",
    });
  });
  it("clip → cross-kind track is rejected", () => {
    expect(resolveDrop(clip("video"), aTrack, 0, "t_video")).toEqual({ type: "reject" });
    expect(resolveDrop(clip("audio"), vTrack, 0, "t_audio")).toEqual({ type: "reject" });
  });
  it("clip dropped on its own track is a no-op reject", () => {
    expect(resolveDrop(clip("video"), vTrack, 0, "t_video")).toEqual({ type: "reject" });
  });
});

describe("resolveDragTargetTrack — #3 clip-body cross-track target", () => {
  // V1 / V2 (video) + A1 (audio): a same-kind pair + a cross-kind lane.
  const tracks: TrackView[] = [
    { id: "t_v1", kind: "video" },
    { id: "t_v2", kind: "video" },
    { id: "t_a1", kind: "audio" },
  ];

  it("returns the hovered lane when it differs from the source AND shares its kind", () => {
    expect(resolveDragTargetTrack(tracks, "t_v1", "t_v2")).toBe("t_v2");
  });
  it("returns null when hovering the clip's own source lane (same track)", () => {
    expect(resolveDragTargetTrack(tracks, "t_v1", "t_v1")).toBeNull();
  });
  it("returns null when hovering a cross-kind lane (audio lane, video source)", () => {
    expect(resolveDragTargetTrack(tracks, "t_v1", "t_a1")).toBeNull();
  });
  it("returns null when no lane is hovered (label column / outside any lane)", () => {
    expect(resolveDragTargetTrack(tracks, "t_v1", null)).toBeNull();
  });
  it("returns null when the source track id is unknown / null", () => {
    expect(resolveDragTargetTrack(tracks, null, "t_v2")).toBeNull();
    expect(resolveDragTargetTrack(tracks, "ghost", "t_v2")).toBeNull();
  });
  it("returns null when the hovered track id is not in the composition", () => {
    expect(resolveDragTargetTrack(tracks, "t_v1", "ghost")).toBeNull();
  });
});
