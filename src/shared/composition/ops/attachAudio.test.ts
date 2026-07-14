import { describe, it, expect } from "vitest";
import { detachAudio } from "./detachAudio.js";
import { attachAudio } from "./attachAudio.js";
import { CompositionOpError } from "./errors.js";
import { resolveSourceAudio, type Composition } from "../../composition.js";
import { makeEmptyComposition } from "../../composition.js";

// PRD-0014 S5 review fix #1 — `attachAudio` is the REVERSE of `detachAudio`.
// Re-enabling a video clip's source audio must ATOMICALLY delete the AudioClip
// that was detached from it, or the source + the pulled track double-play (the
// 禁 "detach 后源声双份出声"). This is the regression net for that mutual exclusion
// across the detach → re-enable round-trip.

function videoClip(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "video" as const,
    src: "assets/shot.mp4",
    in: 1.5,
    out: 6.5,
    trackOffset: 2,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...extra,
  };
}

function compWithVideo(): Composition {
  const comp = makeEmptyComposition({ workId: "w-attach" });
  const videoTrack = comp.tracks.find((t) => t.kind === "video")!;
  (videoTrack.clips as unknown[]).push(videoClip("vc1"));
  return comp;
}

function audioClips(comp: Composition) {
  return comp.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips as unknown[]) as { id: string; detachedFrom?: string }[];
}
function findVideo(comp: Composition, id: string) {
  return comp.tracks
    .flatMap((t) => t.clips as unknown[])
    .find((c) => (c as { id: string }).id === id) as {
    id: string;
    sourceAudio?: { enabled?: boolean; volume?: number };
  };
}

describe("attachAudio op (S5 review fix #1)", () => {
  it("detachAudio stamps a detachedFrom back-link on the minted AudioClip", () => {
    const comp = compWithVideo();
    const { audioClipId } = detachAudio(comp, { clipId: "vc1" });
    const a = audioClips(comp).find((c) => c.id === audioClipId)!;
    expect(a.detachedFrom).toBe("vc1");
  });

  it("MUTUAL EXCLUSION regression: detach → re-enable via attachAudio deletes the twin", () => {
    const comp = compWithVideo();
    detachAudio(comp, { clipId: "vc1" });
    // after detach: source muted + exactly one detached audio clip
    expect(resolveSourceAudio(findVideo(comp, "vc1")).enabled).toBe(false);
    expect(audioClips(comp)).toHaveLength(1);

    const { removedAudioClipIds } = attachAudio(comp, { clipId: "vc1" });
    // source is back ON and the pulled clip is GONE — never both playing.
    expect(resolveSourceAudio(findVideo(comp, "vc1")).enabled).toBe(true);
    expect(audioClips(comp)).toHaveLength(0);
    expect(removedAudioClipIds).toHaveLength(1);
  });

  it("preserves the source volume through the round-trip (spread-guard)", () => {
    const comp = makeEmptyComposition({ workId: "w-vol" });
    const videoTrack = comp.tracks.find((t) => t.kind === "video")!;
    (videoTrack.clips as unknown[]).push(
      videoClip("vc1", { sourceAudio: { enabled: true, volume: 0.3 } }),
    );
    detachAudio(comp, { clipId: "vc1" });
    attachAudio(comp, { clipId: "vc1" });
    expect(findVideo(comp, "vc1").sourceAudio).toEqual({ enabled: true, volume: 0.3 });
  });

  it("only deletes the twin of THIS clip, leaving other audio clips untouched", () => {
    const comp = compWithVideo();
    const videoTrack = comp.tracks.find((t) => t.kind === "video")!;
    (videoTrack.clips as unknown[]).push(videoClip("vc2"));
    detachAudio(comp, { clipId: "vc1" });
    detachAudio(comp, { clipId: "vc2" });
    expect(audioClips(comp)).toHaveLength(2);
    attachAudio(comp, { clipId: "vc1" });
    const remaining = audioClips(comp);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].detachedFrom).toBe("vc2");
  });

  it("re-enable with NO detached twin is a benign no-op (still enables, removes 0)", () => {
    const comp = compWithVideo();
    // manually mute WITHOUT detaching (no twin)
    findVideo(comp, "vc1").sourceAudio = { enabled: false };
    const { removedAudioClipIds } = attachAudio(comp, { clipId: "vc1" });
    expect(resolveSourceAudio(findVideo(comp, "vc1")).enabled).toBe(true);
    expect(removedAudioClipIds).toEqual([]);
  });

  it("throws CompositionOpError{code:4} for unknown / non-video clip id", () => {
    const comp = compWithVideo();
    expect(() => attachAudio(comp, { clipId: "nope" })).toThrow(CompositionOpError);
    try {
      attachAudio(comp, { clipId: "nope" });
    } catch (e) {
      expect((e as CompositionOpError).code).toBe(4);
    }
  });
});
