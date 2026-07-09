import { describe, it, expect } from "vitest";
import type { Composition } from "../../composition.js";
import { setFps } from "./setFps.js";
import { CompositionOpError } from "./errors.js";

// Pure in-place op (ADR-009 decision #2) → no CompositionSchema.parse here. We
// hand-build a minimal comp with one video clip so we can also assert the op
// never touches scenes/assets/tracks — only `comp.fps`.
function compWith(fps: number): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps,
    width: 1080,
    height: 1920,
    duration: 6,
    aspect: "9:16",
    tracks: [
      {
        id: "trk_v",
        kind: "video",
        label: "V1",
        displayOrder: 0,
        volume: 0,
        muted: false,
        hidden: false,
        clips: [
          {
            id: "v0",
            kind: "video",
            src: "a.mp4",
            in: 0,
            out: 6,
            trackOffset: 0,
            transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
            filters: {},
          },
        ],
        transitions: [],
      },
    ],
    assets: [{ id: "a0", kind: "video" } as never],
    provenance: [{ id: "p0" } as never],
  } as unknown as Composition;
}

describe("@shared composition ops — setFps", () => {
  it.each([24, 25, 30, 60] as const)("accepts %d as a canonical fps value", (fps) => {
    const comp = compWith(30 === fps ? 24 : 30); // start from a different value
    setFps(comp, { fps });
    expect(comp.fps).toBe(fps);
  });

  it("re-applying the SAME fps is inert / idempotent", () => {
    const comp = compWith(24);
    setFps(comp, { fps: 24 });
    expect(comp.fps).toBe(24);
    setFps(comp, { fps: 24 });
    expect(comp.fps).toBe(24);
  });

  it("does not touch scenes/assets/tracks/provenance", () => {
    const comp = compWith(30);
    const tracksRef = comp.tracks;
    const assetsRef = comp.assets;
    const provenanceRef = comp.provenance;
    setFps(comp, { fps: 24 });
    expect(comp.tracks).toBe(tracksRef);
    expect(comp.assets).toBe(assetsRef);
    expect(comp.provenance).toBe(provenanceRef);
    expect(comp.tracks[0].clips).toHaveLength(1);
  });

  it("mutates comp IN PLACE — never replaces the comp reference", () => {
    const comp = compWith(30);
    setFps(comp, { fps: 24 });
    expect(comp.fps).toBe(24);
  });

  it.each([0, 23, 23.976, 120, -24, NaN])(
    "rejects invalid fps %s with CompositionOpError code 4, comp left untouched",
    (bad) => {
      const comp = compWith(30);
      let caught: unknown;
      try {
        setFps(comp, { fps: bad as never });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CompositionOpError);
      expect((caught as CompositionOpError).code).toBe(4);
      expect(comp.fps).toBe(30);
    },
  );
});
