import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import type { AudioClip } from "../types";

// #88 — moveClipToTrack lets a clip change lanes (same kind), preserving its
// time position. The default lane set has two audio lanes (A1 BGM / A2), which
// is exactly the issue's "empty A2 can never be filled" scenario.

function audioClip(id: string, trackOffset: number): AudioClip {
  return {
    id,
    kind: "audio",
    src: "a.mp3",
    in: 0,
    out: 3,
    trackOffset,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  };
}

function tracks() {
  return useComposition.getState().comp!.tracks;
}
function audioLanes() {
  return tracks().filter((t) => t.kind === "audio");
}

describe("moveClipToTrack (#88)", () => {
  beforeEach(() => {
    useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  });

  it("moves a clip to another same-kind lane, preserving trackOffset", () => {
    const [a1, a2] = audioLanes();
    useComposition.getState().addClip(a1.id, audioClip("c1", 2));
    useComposition.getState().moveClipToTrack("c1", a2.id);
    expect(tracks().find((t) => t.id === a1.id)!.clips).toHaveLength(0);
    const moved = tracks().find((t) => t.id === a2.id)!.clips;
    expect(moved).toHaveLength(1);
    expect(moved[0].trackOffset).toBe(2); // time position preserved
  });

  it("is a no-op across incompatible kinds (audio clip → video lane)", () => {
    const [a1] = audioLanes();
    const videoId = tracks().find((t) => t.kind === "video")!.id;
    useComposition.getState().addClip(a1.id, audioClip("c1", 0));
    useComposition.getState().moveClipToTrack("c1", videoId);
    expect(tracks().find((t) => t.id === a1.id)!.clips).toHaveLength(1); // stays
    expect(tracks().find((t) => t.id === videoId)!.clips).toHaveLength(0);
  });

  it("no-ops on unknown clip / unknown target / same track", () => {
    const [a1, a2] = audioLanes();
    useComposition.getState().addClip(a1.id, audioClip("c1", 0));
    useComposition.getState().moveClipToTrack("nope", a2.id);
    useComposition.getState().moveClipToTrack("c1", "trk_does_not_exist");
    useComposition.getState().moveClipToTrack("c1", a1.id);
    expect(tracks().find((t) => t.id === a1.id)!.clips).toHaveLength(1);
    expect(tracks().find((t) => t.id === a2.id)!.clips).toHaveLength(0);
  });
});
