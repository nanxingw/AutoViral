import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { CompositionSchema, makeEmptyComposition } from "../types";
import type { VideoClip } from "../types";
import { useToastStore } from "@/stores/toast";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";

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
  // Wave 3a fix-up (finding #5) — clear toasts so the 2s dedupe window in the
  // toast store can't make a warn from an earlier test mask a later assertion.
  useToastStore.getState().clear();
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

// Wave 3a fix-up (finding #5) — the store used to SILENTLY swallow the op's
// CompositionOpError on an illegal add/remove, so the CLI (POST /transition
// rejects with code:4) and the UI diverged on the error path. Both store actions
// now SURFACE a localized warn toast (same pattern as splitClip). These assert
// the toast appears AND the composition is still left untouched.
describe("transition error path surfaces a warn toast (finding #5)", () => {
  function lastToast() {
    const entries = useToastStore.getState().entries;
    return entries[entries.length - 1];
  }

  it("illegal addTransition (last-clip anchor) pushes a warn toast", () => {
    const v1 = videoTrack();
    expect(useToastStore.getState().entries).toHaveLength(0);
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c2", // last clip — no successor → CompositionOpError
      preset: "cross-dissolve",
    });
    expect(id).toBeNull(); // still a no-op (composition untouched)
    expect(videoTrack().transitions ?? []).toHaveLength(0);
    const t = lastToast();
    expect(t).toBeDefined();
    expect(t.variant).toBe("warn");
    const locale = useLocaleStore.getState().locale;
    expect(t.message).toBe(MESSAGES[locale].studio.toast.transitionFailed);
    // The op's technical message rides along as the detail line.
    expect(t.detail).toMatch(/last clip/);
  });

  it("illegal addTransition (unknown preset) pushes a warn toast", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1",
      // cast: the store action's preset is typed to the enum, but a misconfigured
      // caller / stale UI can pass a string the registry doesn't know.
      preset: "no-such-preset" as never,
    });
    expect(id).toBeNull();
    const t = lastToast();
    expect(t?.variant).toBe("warn");
    const locale = useLocaleStore.getState().locale;
    expect(t.message).toBe(MESSAGES[locale].studio.toast.transitionFailed);
  });

  it("illegal removeTransition (unknown id) pushes a warn toast", () => {
    useComposition.getState().removeTransition(videoTrack().id, "tr_ghost");
    const t = lastToast();
    expect(t?.variant).toBe("warn");
    const locale = useLocaleStore.getState().locale;
    expect(t.message).toBe(MESSAGES[locale].studio.toast.transitionFailed);
  });

  it("a SUCCESSFUL addTransition does NOT push a toast", () => {
    const v1 = videoTrack();
    const id = useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1",
      preset: "cross-dissolve",
    });
    expect(id).toMatch(/^tr_/);
    expect(useToastStore.getState().entries).toHaveLength(0);
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

  // S8 fix-up — second prune failure mode: removing a clip can make a SURVIVING
  // clip the new last clip of the track, and a transition pinned to it then has
  // no successor (Track superRefine rejects). Seed is [c1, c2] with a transition
  // after c1 (valid — c2 succeeds it). Removing c2 makes c1 the last clip, so the
  // transition after c1 is now a last-clip orphan and must be pruned.
  it("removeClip prunes a transition turned into a last-clip orphan by the removal", () => {
    const v1 = videoTrack();
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    });
    expect(videoTrack().transitions).toHaveLength(1);
    useComposition.getState().removeClip("c2"); // c1 becomes the last clip
    expect(videoTrack().clips.map((c) => c.id)).toEqual(["c1"]);
    expect(videoTrack().transitions ?? []).toHaveLength(0);
    expect(() =>
      CompositionSchema.parse(useComposition.getState().comp),
    ).not.toThrow();
  });
});

describe("cross-track move prunes orphan transitions (#3 / #54)", () => {
  // The body-drag (#3) widens the cross-track trigger surface from a 14px grip
  // to the whole clip body, so moving a transition-anchor video clip to another
  // video lane is now trivial. Both the Inspector/native-DnD path
  // (moveClipToTrack, #88) and the body-drag path (commitDrag, #3) must prune
  // the source-track transition that pinned the departing clip — otherwise its
  // afterClipId is orphaned and the Track superRefine rejects the next
  // Composition.parse() (autosave 400 / save round-trip).

  // Add a second video lane (V2) so a same-kind cross-track move is possible.
  function addVideoLane(): string {
    return useComposition.getState().addTrack("video");
  }

  it("moveClipToTrack drops the source-track transition anchored to the moved clip", () => {
    const v1 = videoTrack();
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    });
    expect(videoTrack().transitions).toHaveLength(1);

    const v2 = addVideoLane();
    useComposition.getState().moveClipToTrack("c1", v2);

    // Source lane (V1) lost both the clip and its now-orphan transition.
    const v1After = tracks().find((t) => t.id === v1.id)!;
    expect(v1After.clips.some((c) => c.id === "c1")).toBe(false);
    expect(v1After.transitions ?? []).toHaveLength(0);
    // Composition stays parseable (no dangling afterClipId).
    expect(() =>
      CompositionSchema.parse(useComposition.getState().comp),
    ).not.toThrow();
  });

  it("commitDrag (body cross-track move) drops the orphan transition too", () => {
    const v1 = videoTrack();
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    });
    expect(videoTrack().transitions).toHaveLength(1);

    const v2 = addVideoLane();
    // Mirror the Clip.tsx body-drag sequence: begin → set the resolved
    // same-kind target → commit. No horizontal scrub, so trackOffset is kept.
    useComposition.getState().beginDrag("c1");
    useComposition.getState().updateDragTarget(v2);
    useComposition.getState().commitDrag();

    const v1After = tracks().find((t) => t.id === v1.id)!;
    expect(v1After.clips.some((c) => c.id === "c1")).toBe(false);
    expect(v1After.transitions ?? []).toHaveLength(0);
    const v2After = tracks().find((t) => t.id === v2)!;
    expect(v2After.clips.some((c) => c.id === "c1")).toBe(true);
    expect(() =>
      CompositionSchema.parse(useComposition.getState().comp),
    ).not.toThrow();
  });

  // S8 fix-up — the new-last-clip orphan must also be pruned when the move is the
  // human's drag/Inspector path, not just when the moved clip IS the anchor. Seed
  // [c1, c2] + transition after c1 (valid). Moving c2 to V2 makes c1 the last clip
  // on V1, so the transition after c1 is now a last-clip orphan. Both the
  // Inspector/native-DnD path (moveClipToTrack) and the body-drag path
  // (commitDrag, now routed through the shared op) must drop it.
  it("moveClipToTrack prunes a transition turned into a last-clip orphan by the move", () => {
    const v1 = videoTrack();
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    });
    expect(videoTrack().transitions).toHaveLength(1);

    const v2 = addVideoLane();
    useComposition.getState().moveClipToTrack("c2", v2); // c1 becomes last on V1

    const v1After = tracks().find((t) => t.id === v1.id)!;
    expect(v1After.clips.map((c) => c.id)).toEqual(["c1"]);
    expect(v1After.transitions ?? []).toHaveLength(0);
    expect(() =>
      CompositionSchema.parse(useComposition.getState().comp),
    ).not.toThrow();
  });

  it("commitDrag (body cross-track move) prunes the new-last-clip orphan too", () => {
    const v1 = videoTrack();
    useComposition.getState().addTransition(v1.id, {
      afterClipId: "c1", preset: "cross-dissolve",
    });
    expect(videoTrack().transitions).toHaveLength(1);

    const v2 = addVideoLane();
    useComposition.getState().beginDrag("c2");
    useComposition.getState().updateDragTarget(v2);
    useComposition.getState().commitDrag(); // c1 becomes last on V1

    const v1After = tracks().find((t) => t.id === v1.id)!;
    expect(v1After.clips.map((c) => c.id)).toEqual(["c1"]);
    expect(v1After.transitions ?? []).toHaveLength(0);
    const v2After = tracks().find((t) => t.id === v2)!;
    expect(v2After.clips.some((c) => c.id === "c2")).toBe(true);
    expect(() =>
      CompositionSchema.parse(useComposition.getState().comp),
    ).not.toThrow();
  });
});
