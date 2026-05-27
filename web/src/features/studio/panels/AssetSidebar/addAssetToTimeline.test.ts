import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  buildClipFromAsset,
  isAddableAsset,
  useAddAssetToTimeline,
  DEFAULT_ASSET_CLIP_DUR,
} from "./addAssetToTimeline";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { AssetItem } from "@/queries/assets";

// #78 — placing a library asset onto the timeline wires the orphaned addClip.

function asset(over: Partial<AssetItem> = {}): AssetItem {
  return {
    path: "assets/clips/a.mp4",
    url: "/api/works/w1/assets/clips/a.mp4",
    kind: "video",
    ext: "mp4",
    name: "a.mp4",
    ...over,
  };
}

describe("buildClipFromAsset (#78)", () => {
  it("video → a video clip carrying the work-relative src and default length", () => {
    const clip = buildClipFromAsset(asset({ kind: "video", path: "assets/clips/x.mp4" }), 2)!;
    expect(clip.kind).toBe("video");
    expect((clip as any).src).toBe("assets/clips/x.mp4");
    expect(clip.trackOffset).toBe(2);
    expect((clip as any).in).toBe(0);
    expect((clip as any).out).toBe(DEFAULT_ASSET_CLIP_DUR);
  });

  it("audio → an audio clip (bgm, unity volume)", () => {
    const clip = buildClipFromAsset(asset({ kind: "audio", path: "assets/audio/b.mp3" }), 0)!;
    expect(clip.kind).toBe("audio");
    expect((clip as any).type).toBe("bgm");
    expect((clip as any).volume).toBe(1);
  });

  it("image → a full-frame overlay clip", () => {
    const clip = buildClipFromAsset(asset({ kind: "image", path: "assets/img/c.png" }), 0)!;
    expect(clip.kind).toBe("overlay");
    expect((clip as any).position).toEqual({ xPct: 0, yPct: 0, wPct: 100, hPct: 100 });
    expect((clip as any).duration).toBe(DEFAULT_ASSET_CLIP_DUR);
  });

  it("text / other → null (no timeline representation)", () => {
    expect(buildClipFromAsset(asset({ kind: "text" }), 0)).toBeNull();
    expect(buildClipFromAsset(asset({ kind: "other" }), 0)).toBeNull();
    expect(isAddableAsset(asset({ kind: "text" }))).toBe(false);
    expect(isAddableAsset(asset({ kind: "video" }))).toBe(true);
  });
});

describe("useAddAssetToTimeline (#78)", () => {
  beforeEach(() => {
    useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
    useComposition.setState({ selection: null });
  });

  function videoTrack() {
    return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
  }

  it("appends a video asset to the video track and selects it", () => {
    const { result } = renderHook(() => useAddAssetToTimeline());
    const id = result.current(asset({ kind: "video", path: "assets/clips/a.mp4" }));
    expect(id).not.toBeNull();
    const clips = videoTrack().clips;
    expect(clips).toHaveLength(1);
    expect((clips[0] as any).src).toBe("assets/clips/a.mp4");
    expect(clips[0].trackOffset).toBe(0);
    expect(useComposition.getState().selection).toBe(id);
  });

  it("a second add appends at the end of the prior clip (no overlap)", () => {
    const { result } = renderHook(() => useAddAssetToTimeline());
    result.current(asset({ kind: "video", path: "assets/clips/a.mp4" }));
    result.current(asset({ kind: "video", path: "assets/clips/b.mp4" }));
    const clips = videoTrack().clips;
    expect(clips).toHaveLength(2);
    // First clip out = DEFAULT, trackOffset 0 → ends at DEFAULT; second starts there.
    expect(clips[1].trackOffset).toBe(DEFAULT_ASSET_CLIP_DUR);
  });

  it("an image creates an overlay track on demand and adds the clip there", () => {
    expect(
      useComposition.getState().comp!.tracks.some((t) => t.kind === "overlay"),
    ).toBe(false);
    const { result } = renderHook(() => useAddAssetToTimeline());
    const id = result.current(asset({ kind: "image", path: "assets/img/c.png" }));
    expect(id).not.toBeNull();
    const overlay = useComposition
      .getState()
      .comp!.tracks.find((t) => t.kind === "overlay");
    expect(overlay).toBeDefined();
    expect(overlay!.clips).toHaveLength(1);
    expect(overlay!.clips[0].kind).toBe("overlay");
  });

  it("a non-placeable asset is a no-op (no clip, returns null)", () => {
    const before = JSON.stringify(useComposition.getState().comp!.tracks);
    const { result } = renderHook(() => useAddAssetToTimeline());
    const id = result.current(asset({ kind: "text", path: "assets/sub.srt", ext: "srt" }));
    expect(id).toBeNull();
    expect(JSON.stringify(useComposition.getState().comp!.tracks)).toBe(before);
  });
});
