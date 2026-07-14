import { describe, it, expect } from "vitest";
import type { Composition, Track } from "../../composition.js";
import { setTrackProps } from "./setTrackProps.js";
import { CompositionOpError } from "./errors.js";

function track(id: string, kind: Track["kind"], extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    kind,
    label: id,
    displayOrder: 0,
    volume: 0,
    muted: false,
    hidden: false,
    clips: [],
    transitions: [],
    ...extra,
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

describe("ops.setTrackProps", () => {
  it("updates label without touching sibling fields (spread-guard, #81)", () => {
    const comp = compWith([track("trk_v0", "video", { volume: -3, muted: true })]);
    setTrackProps(comp, { trackId: "trk_v0", props: { label: "Master cut" } });
    const t = comp.tracks[0] as Track & { volume: number; muted: boolean };
    expect(t.label).toBe("Master cut");
    // siblings untouched
    expect(t.volume).toBe(-3);
    expect(t.muted).toBe(true);
    expect(t.hidden).toBe(false);
  });

  it("updates volume (dB) in place", () => {
    const comp = compWith([track("trk_a1", "audio")]);
    setTrackProps(comp, { trackId: "trk_a1", props: { volume: -6 } });
    expect((comp.tracks[0] as Track & { volume: number }).volume).toBe(-6);
  });

  it("sets a language string", () => {
    const comp = compWith([track("trk_cc", "text")]);
    setTrackProps(comp, { trackId: "trk_cc", props: { language: "en" } });
    expect(comp.tracks[0].language).toBe("en");
  });

  it("clears language when passed null/undefined (deletes the optional field)", () => {
    const comp = compWith([track("trk_cc", "text", { language: "en" })]);
    setTrackProps(comp, { trackId: "trk_cc", props: { language: undefined } });
    expect(comp.tracks[0].language).toBeUndefined();
    expect("language" in (comp.tracks[0] as object)).toBe(false);
  });

  it("toggles muted / hidden booleans independently", () => {
    const comp = compWith([track("trk_v0", "video")]);
    setTrackProps(comp, { trackId: "trk_v0", props: { muted: true } });
    expect((comp.tracks[0] as Track).muted).toBe(true);
    expect((comp.tracks[0] as Track).hidden).toBe(false);
    setTrackProps(comp, { trackId: "trk_v0", props: { hidden: true } });
    expect((comp.tracks[0] as Track).muted).toBe(true);
    expect((comp.tracks[0] as Track).hidden).toBe(true);
  });

  it("applies multiple props in a single call, leaving unspecified ones alone", () => {
    const comp = compWith([track("trk_a1", "audio", { volume: 0, label: "A1" })]);
    setTrackProps(comp, {
      trackId: "trk_a1",
      props: { label: "A1 · BGM", volume: -12 },
    });
    const t = comp.tracks[0] as Track & { volume: number };
    expect(t.label).toBe("A1 · BGM");
    expect(t.volume).toBe(-12);
    expect(t.muted).toBe(false);
  });

  it("throws CompositionOpError{code:4} for an unknown track id", () => {
    const comp = compWith([track("trk_v0", "video")]);
    try {
      setTrackProps(comp, { trackId: "trk_nope", props: { label: "x" } });
      expect.unreachable("setTrackProps should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("mutates comp in place — never replaces the track object (ADR-009 #1)", () => {
    const comp = compWith([track("trk_v0", "video")]);
    const ref = comp.tracks[0];
    setTrackProps(comp, { trackId: "trk_v0", props: { label: "x" } });
    expect(comp.tracks[0]).toBe(ref);
  });
});
