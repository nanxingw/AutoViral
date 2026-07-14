import { describe, it, expect } from "vitest";
import type { Composition, Track } from "../../composition.js";
import { importClip } from "./importClip.js";
import { CompositionOpError } from "./errors.js";

// Pure in-place op tests (ADR-009 decision #2) — no CompositionSchema.parse.
// Mirrors track.test.ts's minimal-comp scaffolding.
function track(
  id: string,
  kind: Track["kind"],
  displayOrder: number,
  clips: unknown[] = [],
): unknown {
  return {
    id,
    kind,
    label: id,
    displayOrder,
    volume: 0,
    muted: false,
    hidden: false,
    clips,
    transitions: [],
  };
}

function videoClip(id: string, trackOffset: number, dur: number): unknown {
  return {
    id,
    kind: "video",
    src: `clip/${id}.mp4`,
    in: 0,
    out: dur,
    trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

function audioClip(id: string): unknown {
  return {
    id,
    kind: "audio",
    src: `clip/${id}.mp3`,
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function textClip(id: string): unknown {
  return { id, kind: "text", text: "hi", trackOffset: 0, duration: 3 };
}

function compWith(tracks: unknown[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 0,
    aspect: "9:16",
    tracks,
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

function defaultComp(): Composition {
  return compWith([
    track("trk_v0", "video", 0),
    track("trk_a1", "audio", 1, [audioClip("ac_1")]),
    track("trk_cc", "text", 2, [textClip("tc_1")]),
  ]);
}

describe("ops.importClip — clip construction", () => {
  it("builds a VideoClip with in=0, out=duration onto the first video track", () => {
    const comp = defaultComp();
    const { clipId, assetId } = importClip(comp, {
      probe: { durationSec: 7.5, width: 1920, height: 1080, fps: 24 },
      src: "output/final.mp4",
    });
    expect(clipId).not.toBe(assetId);
    const vtrack = comp.tracks.find((t) => t.id === "trk_v0")!;
    const clip = vtrack.clips.find((c) => c.id === clipId)! as any;
    expect(clip.kind).toBe("video");
    expect(clip.src).toBe("output/final.mp4");
    expect(clip.in).toBe(0);
    expect(clip.out).toBe(7.5);
    // fresh clip should carry sane transform/filter defaults
    expect(clip.transforms.scale).toBe(1);
    expect(clip.filters.brightness).toBe(0);
  });

  it("registers an AssetEntry(kind:video) with probe metadata + an import ProvenanceEdge", () => {
    const comp = defaultComp();
    const { assetId } = importClip(comp, {
      probe: { durationSec: 5, width: 1080, height: 1920, fps: 30 },
      src: "output/a.mp4",
      name: "final cut",
    });
    const asset = comp.assets.find((a) => a.id === assetId)! as any;
    expect(asset).toBeTruthy();
    expect(asset.kind).toBe("video");
    expect(asset.uri).toBe("output/a.mp4");
    expect(asset.name).toBe("final cut");
    expect(asset.metadata.duration).toBe(5);
    expect(asset.metadata.width).toBe(1080);
    expect(asset.metadata.height).toBe(1920);
    expect(asset.metadata.fps).toBe(30);

    const edge = comp.provenance.find((e) => e.toAssetId === assetId)! as any;
    expect(edge).toBeTruthy();
    expect(edge.fromAssetId).toBeNull();
    expect(edge.operation.type).toBe("import");
    expect(typeof edge.operation.timestamp).toBe("string");
  });

  it("defaults trackOffset to the end of the destination video track (append)", () => {
    const comp = compWith([
      track("trk_v0", "video", 0, [videoClip("vc_a", 0, 4)]),
      track("trk_a1", "audio", 1),
    ]);
    const { clipId } = importClip(comp, {
      probe: { durationSec: 3 },
      src: "output/b.mp4",
    });
    const clip = comp.tracks[0].clips.find((c) => c.id === clipId)! as any;
    // existing clip ends at 0 + (4-0) = 4 → new clip appends at 4
    expect(clip.trackOffset).toBe(4);
  });

  it("honours an explicit atSec as trackOffset", () => {
    const comp = defaultComp();
    const { clipId } = importClip(comp, {
      probe: { durationSec: 3 },
      src: "output/c.mp4",
      atSec: 1.25,
    });
    const clip = comp.tracks[0].clips.find((c) => c.id === clipId)! as any;
    expect(clip.trackOffset).toBe(1.25);
  });
});

describe("ops.importClip — replaceTimeline semantics", () => {
  it("clears ALL video-track clips, keeps audio/text tracks, places single clip at 0", () => {
    const comp = compWith([
      track("trk_v0", "video", 0, [videoClip("vc_a", 0, 4), videoClip("vc_b", 4, 4)]),
      track("trk_v1", "video", 1, [videoClip("vc_c", 0, 2)]),
      track("trk_a1", "audio", 2, [audioClip("ac_1")]),
      track("trk_cc", "text", 3, [textClip("tc_1")]),
    ]);
    const { clipId } = importClip(comp, {
      probe: { durationSec: 9 },
      src: "output/full.mp4",
      replaceTimeline: true,
    });
    const v0 = comp.tracks.find((t) => t.id === "trk_v0")!;
    const v1 = comp.tracks.find((t) => t.id === "trk_v1")!;
    const a1 = comp.tracks.find((t) => t.id === "trk_a1")!;
    const cc = comp.tracks.find((t) => t.id === "trk_cc")!;
    // only the newly-imported clip survives on the target video track
    expect(v0.clips.map((c) => c.id)).toEqual([clipId]);
    // the OTHER video track is emptied too
    expect(v1.clips).toHaveLength(0);
    // audio + text tracks are untouched
    expect(a1.clips.map((c) => c.id)).toEqual(["ac_1"]);
    expect(cc.clips.map((c) => c.id)).toEqual(["tc_1"]);
    // the single clip sits at 0
    const clip = v0.clips[0] as any;
    expect(clip.trackOffset).toBe(0);
  });
});

describe("ops.importClip — composition.duration (review S6 finding 1)", () => {
  it("grows a fresh-work duration to the placed clip's end (not left at 0)", () => {
    // A brand-new work ships duration:0; without a recompute the Player/export
    // would render a single frame regardless of the imported clip's length.
    const comp = compWith([track("trk_v0", "video", 0)]);
    expect(comp.duration).toBe(0);
    importClip(comp, { probe: { durationSec: 8 }, src: "output/final.mp4" });
    expect(comp.duration).toBe(8);
  });

  it("extends duration when appending a clip longer than the current end", () => {
    const comp = compWith([
      track("trk_v0", "video", 0, [videoClip("vc_a", 0, 4)]),
    ]);
    comp.duration = 4; // current content end
    importClip(comp, { probe: { durationSec: 10 }, src: "output/long.mp4" });
    // appended at 4 → new content end = 4 + 10 = 14
    expect(comp.duration).toBe(14);
  });

  it("recomputes duration across ALL tracks after replaceTimeline", () => {
    const comp = compWith([
      track("trk_v0", "video", 0, [videoClip("vc_a", 0, 30)]),
      track("trk_a1", "audio", 1, [audioClip("ac_1")]), // ends at 5
    ]);
    comp.duration = 30;
    importClip(comp, {
      probe: { durationSec: 9 },
      src: "output/full.mp4",
      replaceTimeline: true,
    });
    // video wiped + single 9s clip at 0; audio clip still ends at 5 → max = 9
    expect(comp.duration).toBe(9);
  });
});

describe("ops.importClip — replaceTimeline clears dangling transitions (review S6 finding 2)", () => {
  it("wipes a video track's transitions along with its clips (no dangling afterClipId)", () => {
    const vtrack = track("trk_v0", "video", 0, [
      videoClip("vc_a", 0, 4),
      videoClip("vc_b", 4, 4),
    ]) as { transitions: unknown[] };
    // an existing cut-point transition after the first clip
    vtrack.transitions = [{ afterClipId: "vc_a", preset: "fade", durationSec: 0.5 }];
    const comp = compWith([
      vtrack,
      track("trk_a1", "audio", 1, [audioClip("ac_1")]),
    ]);
    importClip(comp, {
      probe: { durationSec: 9 },
      src: "output/full.mp4",
      replaceTimeline: true,
    });
    const v0 = comp.tracks.find((t) => t.id === "trk_v0")! as unknown as {
      transitions: unknown[];
    };
    // clips replaced with the single import; transitions must be emptied so the
    // stale afterClipId "vc_a" cannot dangle through the write-path refine (400).
    expect(v0.transitions).toEqual([]);
  });
});

describe("ops.importClip — guards", () => {
  it("throws CompositionOpError{code:4} on a missing/invalid duration", () => {
    for (const bad of [0, -1, NaN, Number.POSITIVE_INFINITY]) {
      const comp = defaultComp();
      try {
        importClip(comp, { probe: { durationSec: bad as number }, src: "x.mp4" });
        expect.unreachable(`importClip should reject duration ${bad}`);
      } catch (err) {
        expect(err).toBeInstanceOf(CompositionOpError);
        expect((err as CompositionOpError).code).toBe(4);
      }
    }
  });

  it("throws CompositionOpError{code:4} for an unknown trackId", () => {
    const comp = defaultComp();
    try {
      importClip(comp, {
        probe: { durationSec: 3 },
        src: "x.mp4",
        trackId: "trk_nope",
      });
      expect.unreachable("importClip should reject unknown trackId");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("throws CompositionOpError{code:4} when trackId is not a video lane", () => {
    const comp = defaultComp();
    try {
      importClip(comp, {
        probe: { durationSec: 3 },
        src: "x.mp4",
        trackId: "trk_a1",
      });
      expect.unreachable("importClip should reject a non-video trackId");
    } catch (err) {
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("throws CompositionOpError{code:4} when there is no video track at all", () => {
    const comp = compWith([track("trk_a1", "audio", 0)]);
    try {
      importClip(comp, { probe: { durationSec: 3 }, src: "x.mp4" });
      expect.unreachable("importClip should reject when no video lane exists");
    } catch (err) {
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("mutates comp in place — never replaces comp.tracks / comp.assets refs (ADR-009 #1)", () => {
    const comp = defaultComp();
    const tracksRef = comp.tracks;
    const assetsRef = comp.assets;
    const clipsRef = comp.tracks[0].clips;
    importClip(comp, { probe: { durationSec: 3 }, src: "x.mp4" });
    expect(comp.tracks).toBe(tracksRef);
    expect(comp.assets).toBe(assetsRef);
    expect(comp.tracks[0].clips).toBe(clipsRef);
  });
});
