import { describe, it, expect } from "vitest";
import { detachAudio } from "./detachAudio.js";
import { CompositionOpError } from "./errors.js";
import { resolveSourceAudio, type Composition } from "../../composition.js";
import { makeEmptyComposition } from "../../composition.js";

// PRD-0014 S5 — `detachAudio(comp, { clipId })`: a two-step ATOMIC op that
//   (1) generates a same-source AudioClip (src/in/out/trackOffset aligned,
//       type:"original", volume carried from the source) on an audio lane
//       (minted if none exists), AND
//   (2) mutes the video clip's own source (sourceAudio.enabled=false),
// so the source and the detached track never DOUBLE-play. A second call on an
// already-detached clip is a hard error (never a duplicate audio clip).

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

function compWithVideo(extra: Record<string, unknown> = {}): Composition {
  const comp = makeEmptyComposition({ workId: "w-detach" });
  const videoTrack = comp.tracks.find((t) => t.kind === "video")!;
  (videoTrack.clips as unknown[]).push(videoClip("vc1", extra));
  return comp;
}

function audioClips(comp: Composition) {
  return comp.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips as unknown[]) as {
    id: string;
    kind: string;
    src: string;
    in: number;
    out: number;
    trackOffset: number;
    volume: number;
    type: string;
  }[];
}

function findVideo(comp: Composition, id: string) {
  return comp.tracks
    .flatMap((t) => t.clips as unknown[])
    .find((c) => (c as { id: string }).id === id) as {
    id: string;
    sourceAudio?: { enabled?: boolean; volume?: number };
  };
}

describe("detachAudio op (S5)", () => {
  it("generates a same-source AudioClip with in/out/offset aligned + type original", () => {
    const comp = compWithVideo();
    const { audioClipId, trackId } = detachAudio(comp, { clipId: "vc1" });
    const auds = audioClips(comp);
    expect(auds).toHaveLength(1);
    const a = auds[0];
    expect(a.id).toBe(audioClipId);
    expect(a.kind).toBe("audio");
    expect(a.src).toBe("assets/shot.mp4");
    expect(a.in).toBe(1.5);
    expect(a.out).toBe(6.5);
    expect(a.trackOffset).toBe(2);
    expect(a.type).toBe("original");
    // landed on the returned track
    const track = comp.tracks.find((t) => t.id === trackId)!;
    expect(track.kind).toBe("audio");
    expect((track.clips as { id: string }[]).some((c) => c.id === audioClipId)).toBe(true);
  });

  it("flips the source clip's sourceAudio.enabled to false", () => {
    const comp = compWithVideo();
    detachAudio(comp, { clipId: "vc1" });
    const v = findVideo(comp, "vc1");
    expect(resolveSourceAudio(v).enabled).toBe(false);
  });

  it("mutual exclusion: after detach the source is muted AND exactly one audio clip exists", () => {
    const comp = compWithVideo();
    detachAudio(comp, { clipId: "vc1" });
    expect(resolveSourceAudio(findVideo(comp, "vc1")).enabled).toBe(false);
    expect(audioClips(comp)).toHaveLength(1);
  });

  it("carries the resolved source volume onto the detached AudioClip (default 1)", () => {
    const comp = compWithVideo();
    detachAudio(comp, { clipId: "vc1" });
    expect(audioClips(comp)[0].volume).toBe(1);
  });

  it("preserves an existing sourceAudio.volume (spread-guard) and copies it to the AudioClip", () => {
    const comp = compWithVideo({ sourceAudio: { enabled: true, volume: 0.4 } });
    detachAudio(comp, { clipId: "vc1" });
    const v = findVideo(comp, "vc1");
    expect(v.sourceAudio).toEqual({ enabled: false, volume: 0.4 });
    expect(audioClips(comp)[0].volume).toBe(0.4);
  });

  it("mints an audio lane when the composition has none", () => {
    const comp = makeEmptyComposition({ workId: "w-noaudio" });
    // strip all audio tracks
    comp.tracks = comp.tracks.filter((t) => t.kind !== "audio");
    const videoTrack = comp.tracks.find((t) => t.kind === "video")!;
    (videoTrack.clips as unknown[]).push(videoClip("vc1"));
    expect(comp.tracks.some((t) => t.kind === "audio")).toBe(false);
    const { trackId } = detachAudio(comp, { clipId: "vc1" });
    const track = comp.tracks.find((t) => t.id === trackId)!;
    expect(track.kind).toBe("audio");
    expect(audioClips(comp)).toHaveLength(1);
  });

  it("throws CompositionOpError{code:4} for an unknown clip id", () => {
    const comp = compWithVideo();
    expect(() => detachAudio(comp, { clipId: "nope" })).toThrow(CompositionOpError);
    try {
      detachAudio(comp, { clipId: "nope" });
    } catch (e) {
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws for a non-video clip (audio id)", () => {
    const comp = makeEmptyComposition({ workId: "w-aud" });
    const audioTrack = comp.tracks.find((t) => t.kind === "audio")!;
    (audioTrack.clips as unknown[]).push({
      id: "ac1",
      kind: "audio",
      src: "a.mp3",
      in: 0,
      out: 4,
      trackOffset: 0,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      type: "bgm",
    });
    expect(() => detachAudio(comp, { clipId: "ac1" })).toThrow(CompositionOpError);
  });

  it("stamps a detachedFrom back-link on the minted AudioClip (review fix #1)", () => {
    const comp = compWithVideo();
    const { audioClipId } = detachAudio(comp, { clipId: "vc1" });
    const a = audioClips(comp).find((c) => c.id === audioClipId) as unknown as {
      detachedFrom?: string;
    };
    expect(a.detachedFrom).toBe("vc1");
  });

  it("REJECTS detach on a speed-ramped clip (review fix #3 — would desync audio)", () => {
    const comp = compWithVideo({
      keyframes: [
        { property: "speed", time: 0, value: 2, easing: "linear" },
        { property: "speed", time: 2, value: 0.5, easing: "linear" },
      ],
    });
    expect(() => detachAudio(comp, { clipId: "vc1" })).toThrow(CompositionOpError);
    // and it did NOT half-mutate: no audio clip minted, source still enabled.
    expect(audioClips(comp)).toHaveLength(0);
    expect(resolveSourceAudio(findVideo(comp, "vc1")).enabled).toBe(true);
  });

  it("REJECTS detach on a static non-1 speed clip too (review fix #3)", () => {
    const comp = compWithVideo({
      keyframes: [{ property: "speed", time: 0, value: 2, easing: "linear" }],
    });
    expect(() => detachAudio(comp, { clipId: "vc1" })).toThrow(CompositionOpError);
  });

  it("ALLOWS detach when speed keyframes are all no-op 1.0 (no clock warp)", () => {
    const comp = compWithVideo({
      keyframes: [{ property: "speed", time: 0, value: 1, easing: "linear" }],
    });
    expect(() => detachAudio(comp, { clipId: "vc1" })).not.toThrow();
    expect(audioClips(comp)).toHaveLength(1);
  });

  it("second call on an already-detached clip is a hard error (no duplicate audio clip)", () => {
    const comp = compWithVideo();
    detachAudio(comp, { clipId: "vc1" });
    expect(audioClips(comp)).toHaveLength(1);
    expect(() => detachAudio(comp, { clipId: "vc1" })).toThrow(CompositionOpError);
    // still exactly one detached audio clip — the reject did NOT create a second
    expect(audioClips(comp)).toHaveLength(1);
  });
});
