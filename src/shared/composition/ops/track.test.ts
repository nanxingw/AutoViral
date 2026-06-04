import { describe, it, expect } from "vitest";
import type { Composition, Track } from "../../composition.js";
import { addTrack, removeTrack } from "./track.js";
import { CompositionOpError } from "./errors.js";

// Minimal multi-track composition. The ops are pure in-place mutators so we
// never run CompositionSchema.parse here (ADR-009 decision #2). We mirror the
// default-comp layout the studio store seeds: V(0) / A1(1) / A2(2) / CC(3).
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
    track("trk_a1", "audio", 1),
    track("trk_a2", "audio", 2),
    track("trk_cc", "text", 3),
  ]);
}

function sortedOrders(comp: Composition): number[] {
  return comp.tracks.map((t) => t.displayOrder).sort((a, b) => a - b);
}

function assertContiguous(comp: Composition) {
  const orders = sortedOrders(comp);
  expect(orders).toEqual(orders.map((_, i) => i));
}

describe("ops.addTrack", () => {
  it("mints a trk_-prefixed id and the new lane is present", () => {
    const comp = defaultComp();
    const { trackId } = addTrack(comp, { kind: "audio" });
    expect(trackId).toMatch(/^trk_/);
    expect(comp.tracks.some((t) => t.id === trackId)).toBe(true);
    assertContiguous(comp);
  });

  it("defaults to the end of the same-kind block (audio lands after audio, before text)", () => {
    const comp = defaultComp();
    const { trackId } = addTrack(comp, { kind: "audio" });
    const added = comp.tracks.find((t) => t.id === trackId)!;
    const cc = comp.tracks.find((t) => t.kind === "text")!;
    expect(added.displayOrder).toBeLessThan(cc.displayOrder);
    for (const a of comp.tracks.filter((t) => t.kind === "audio" && t.id !== trackId)) {
      expect(added.displayOrder).toBeGreaterThan(a.displayOrder);
    }
    assertContiguous(comp);
  });

  it("with afterTrackId inserts directly below the anchor", () => {
    const comp = defaultComp();
    const anchor = comp.tracks.find((t) => t.kind === "video")!;
    const anchorOrder = anchor.displayOrder;
    const { trackId } = addTrack(comp, {
      kind: "audio",
      opts: { afterTrackId: anchor.id },
    });
    const added = comp.tracks.find((t) => t.id === trackId)!;
    expect(added.displayOrder).toBe(anchorOrder + 1);
    assertContiguous(comp);
  });

  it("first lane of a never-seen kind falls back to tail-of-all placement", () => {
    const comp = compWith([]);
    const { trackId } = addTrack(comp, { kind: "audio" });
    expect(comp.tracks).toHaveLength(1);
    expect(comp.tracks[0].id).toBe(trackId);
    expect(comp.tracks[0].displayOrder).toBe(0);
  });

  it("passes through opts.label and opts.language; auto-labels otherwise", () => {
    const comp = defaultComp();
    const { trackId } = addTrack(comp, {
      kind: "text",
      opts: { label: "CC2 · en", language: "en" },
    });
    const t = comp.tracks.find((t) => t.id === trackId)!;
    expect(t.label).toBe("CC2 · en");
    expect(t.language).toBe("en");

    const { trackId: id2 } = addTrack(comp, { kind: "audio" });
    // default comp had A1/A2 → next audio is A3
    expect(comp.tracks.find((t) => t.id === id2)!.label).toBe("A3");
  });

  it("supports overlay tracks (O1 auto-label)", () => {
    const comp = defaultComp();
    const { trackId } = addTrack(comp, { kind: "overlay" });
    const t = comp.tracks.find((t) => t.id === trackId)!;
    expect(t.kind).toBe("overlay");
    expect(t.label).toBe("O1");
    assertContiguous(comp);
  });

  it("mutates comp in place — never replaces comp.tracks reference (ADR-009 #1)", () => {
    const comp = defaultComp();
    const ref = comp.tracks;
    addTrack(comp, { kind: "audio" });
    expect(comp.tracks).toBe(ref);
  });
});

describe("ops.removeTrack", () => {
  it("removes the lane and recompacts displayOrder", () => {
    const comp = defaultComp();
    removeTrack(comp, { trackId: "trk_a1" });
    expect(comp.tracks.some((t) => t.id === "trk_a1")).toBe(false);
    expect(comp.tracks).toHaveLength(3);
    assertContiguous(comp);
  });

  it("throws CompositionOpError{code:4} for an unknown track id", () => {
    const comp = defaultComp();
    try {
      removeTrack(comp, { trackId: "trk_nope" });
      expect.unreachable("removeTrack should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("mutates comp in place — never replaces comp.tracks reference (ADR-009 #1)", () => {
    const comp = defaultComp();
    const ref = comp.tracks;
    removeTrack(comp, { trackId: "trk_a2" });
    expect(comp.tracks).toBe(ref);
  });
});
