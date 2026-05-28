import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import type { VideoClip } from "../types";

// #54 Phase 1 — add/update/remove transition store actions, plus the
// remove-clip-prunes-orphan-transition invariant.

function videoClip(id: string, trackOffset: number, out = 3): VideoClip {
  return {
    id, kind: "video", src: "x.mp4",
    in: 0, out, trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

function tracks() {
  return useComposition.getState().comp!.tracks;
}
function videoTrack() {
  return tracks().find((t) => t.kind === "video")!;
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  // Seed two video clips on V1 so transition validation has somewhere to land.
  const v1 = videoTrack();
  useComposition.getState().addClip(v1.id, videoClip("c1", 0, 3));
  useComposition.getState().addClip(v1.id, videoClip("c2", 3, 3));
});

describe("addTransition (#54)", () => {
  it("adds a transition between two clips and returns its id", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1",
      preset: "cross-dissolve",
    });
    expect(id).toMatch(/^tr_/);
    const trs = videoTrack().transitions!;
    expect(trs).toHaveLength(1);
    expect(trs[0].afterClipId).toBe("c1");
    expect(trs[0].durationSec).toBeCloseTo(0.5, 5); // preset default
  });

  it("clamps a too-long duration to the available handle (half of smaller clip)", () => {
    const v1 = videoTrack();
    // Both clips are 3s → max half each = 1.5s → max transition = 3s.
    // Ask for 99s; should clamp to 3s.
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1",
      preset: "cross-dissolve",
      durationSec: 99,
    });
    expect(videoTrack().transitions![0].durationSec).toBeCloseTo(3, 5);
  });

  it("rejects (returns null) when afterClipId is the LAST clip (no successor)", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c2", // last
      preset: "cross-dissolve",
    });
    expect(id).toBeNull();
    expect(videoTrack().transitions ?? []).toHaveLength(0);
  });

  it("rejects on a non-video track (audio lane, Phase 1 video-only)", () => {
    const a1 = tracks().find((t) => t.kind === "audio")!;
    const id = useComposition.getState().addTransition(a1.id, {
      afterClipId: "c1",
      preset: "cross-dissolve",
    });
    expect(id).toBeNull();
  });

  it("rejects on unknown trackId / afterClipId", () => {
    expect(
      useComposition.getState().addTransition("trk_nope", {
        afterClipId: "c1", preset: "cross-dissolve",
      }),
    ).toBeNull();
    expect(
      useComposition.getState().addTransition(videoTrack().id, {
        afterClipId: "ghost", preset: "cross-dissolve",
      }),
    ).toBeNull();
  });
});

describe("updateTransition (#54)", () => {
  it("patches preset/alignment/easing in place", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    })!;
    useComposition.getState().updateTransition(v1.id, id, {
      preset: "wipe-left", alignment: "start", easing: "spring",
    });
    const tr = videoTrack().transitions![0];
    expect(tr.preset).toBe("wipe-left");
    expect(tr.alignment).toBe("start");
    expect(tr.easing).toBe("spring");
  });

  it("re-clamps durationSec on update (handle invariant survives clip trims)", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve", durationSec: 0.5,
    })!;
    useComposition.getState().updateTransition(v1.id, id, { durationSec: 99 });
    expect(videoTrack().transitions![0].durationSec).toBeCloseTo(3, 5); // clamped
  });
});

describe("removeTransition + removeClip prune (#54)", () => {
  it("removeTransition drops the named transition only", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    })!;
    useComposition.getState().removeTransition(v1.id, id);
    expect(videoTrack().transitions ?? []).toHaveLength(0);
  });

  it("removeClip prunes transitions pinned to that clip (no schema-orphan)", () => {
    const v1 = videoTrack();
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    });
    expect(videoTrack().transitions).toHaveLength(1);
    useComposition.getState().removeClip("c1");
    expect(videoTrack().transitions ?? []).toHaveLength(0);
  });
});
