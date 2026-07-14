import { describe, it, expect } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import {
  addEffect,
  removeEffect,
  reorderEffect,
  toggleEffect,
  updateEffectParams,
} from "./effects.js";
import { CompositionOpError } from "./errors.js";

// PRD-0014 S14 — the effect-stack op family (add/remove/reorder/toggle/set),
// pure in-place mutators (ADR-009): never replace comp/tracks/clip references,
// throw CompositionOpError{code:4} on illegal args. The Inspector effects list +
// `autoviral clip effects …` converge on THESE ops.

function videoClip(p: { id: string; effects?: unknown }): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...(p.effects ? { effects: p.effects } : {}),
  } as unknown as Clip;
}

function adjustmentClip(id: string, effects?: unknown): Clip {
  return {
    id,
    kind: "adjustment",
    trackOffset: 0,
    duration: 5,
    ...(effects ? { effects } : {}),
  } as unknown as Clip;
}

function audioClip(id: string): Clip {
  return {
    id,
    kind: "audio",
    src: "assets/a.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  } as unknown as Clip;
}

function compWith(clips: Clip[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 0,
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
        clips: clips as never,
        transitions: [],
      },
    ],
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

function liveClip(comp: Composition, id: string): Record<string, unknown> {
  return (comp.tracks.flatMap((t) => t.clips as unknown[]) as Record<string, unknown>[]).find(
    (c) => c.id === id,
  )!;
}
function effects(comp: Composition, id: string): { id: string; type: string; params: Record<string, unknown>; enabled: boolean }[] {
  return (liveClip(comp, id).effects ?? []) as never;
}

describe("effects ops (S14)", () => {
  it("addEffect appends a grade entry with a minted id + defaulted params/enabled", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const { effectId } = addEffect(comp, { clipId: "v1", type: "grade", params: { brightness: 0.2 } });
    const eff = effects(comp, "v1");
    expect(eff).toHaveLength(1);
    expect(eff[0].id).toBe(effectId);
    expect(eff[0].type).toBe("grade");
    expect(eff[0].params).toEqual({ brightness: 0.2 });
    expect(eff[0].enabled).toBe(true);
  });

  it("addEffect appends in order (stack semantics)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    addEffect(comp, { clipId: "v1", type: "grade" });
    addEffect(comp, { clipId: "v1", type: "blur", params: { radius: 8 } });
    addEffect(comp, { clipId: "v1", type: "vignette" });
    expect(effects(comp, "v1").map((e) => e.type)).toEqual(["grade", "blur", "vignette"]);
  });

  it("addEffect at an explicit index inserts there", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    addEffect(comp, { clipId: "v1", type: "grade" });
    addEffect(comp, { clipId: "v1", type: "grain" });
    addEffect(comp, { clipId: "v1", type: "blur", index: 1 });
    expect(effects(comp, "v1").map((e) => e.type)).toEqual(["grade", "blur", "grain"]);
  });

  it("works on an adjustment clip too", () => {
    const comp = compWith([adjustmentClip("adj1")]);
    addEffect(comp, { clipId: "adj1", type: "grade", params: { saturation: -0.5 } });
    expect(effects(comp, "adj1").map((e) => e.type)).toEqual(["grade"]);
  });

  it("removeEffect drops the addressed entry, keeps the rest in order", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const a = addEffect(comp, { clipId: "v1", type: "grade" }).effectId;
    const b = addEffect(comp, { clipId: "v1", type: "blur" }).effectId;
    const c = addEffect(comp, { clipId: "v1", type: "grain" }).effectId;
    removeEffect(comp, { clipId: "v1", effectId: b });
    expect(effects(comp, "v1").map((e) => e.id)).toEqual([a, c]);
  });

  it("reorderEffect moves an entry to a new index (order stability)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const a = addEffect(comp, { clipId: "v1", type: "grade" }).effectId;
    const b = addEffect(comp, { clipId: "v1", type: "blur" }).effectId;
    const c = addEffect(comp, { clipId: "v1", type: "grain" }).effectId;
    reorderEffect(comp, { clipId: "v1", effectId: c, toIndex: 0 });
    expect(effects(comp, "v1").map((e) => e.id)).toEqual([c, a, b]);
  });

  it("toggleEffect flips enabled when no explicit value", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const a = addEffect(comp, { clipId: "v1", type: "grade" }).effectId;
    toggleEffect(comp, { clipId: "v1", effectId: a });
    expect(effects(comp, "v1")[0].enabled).toBe(false);
    toggleEffect(comp, { clipId: "v1", effectId: a });
    expect(effects(comp, "v1")[0].enabled).toBe(true);
  });

  it("toggleEffect honours an explicit enabled value", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const a = addEffect(comp, { clipId: "v1", type: "grade" }).effectId;
    toggleEffect(comp, { clipId: "v1", effectId: a, enabled: false });
    expect(effects(comp, "v1")[0].enabled).toBe(false);
  });

  it("updateEffectParams merges params (spread-guard — sibling keys survive)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const a = addEffect(comp, {
      clipId: "v1",
      type: "grade",
      params: { brightness: 0.2, contrast: 0.1 },
    }).effectId;
    updateEffectParams(comp, { clipId: "v1", effectId: a, params: { contrast: 0.5 } });
    expect(effects(comp, "v1")[0].params).toEqual({ brightness: 0.2, contrast: 0.5 });
  });

  it("mutates IN PLACE — clip + effects array identity survive", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const before = liveClip(comp, "v1");
    addEffect(comp, { clipId: "v1", type: "grade" });
    const arrRef = liveClip(comp, "v1").effects;
    addEffect(comp, { clipId: "v1", type: "blur" });
    expect(liveClip(comp, "v1")).toBe(before);
    expect(liveClip(comp, "v1").effects).toBe(arrRef);
  });

  it("rejects an unknown clip id (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() => addEffect(comp, { clipId: "nope", type: "grade" })).toThrow(CompositionOpError);
  });

  it("rejects a clip kind that has no effect stack — audio (code 4)", () => {
    const comp = compWith([audioClip("a1")]);
    expect(() => addEffect(comp, { clipId: "a1", type: "grade" })).toThrow(CompositionOpError);
  });

  it("rejects an unknown effect type (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() =>
      addEffect(comp, { clipId: "v1", type: "sharpen" as never }),
    ).toThrow(CompositionOpError);
  });

  it("removeEffect on an unknown effectId throws (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1", effects: [] })]);
    expect(() => removeEffect(comp, { clipId: "v1", effectId: "nope" })).toThrow(
      CompositionOpError,
    );
  });

  it("reorderEffect clamps toIndex into range instead of tearing the array", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const a = addEffect(comp, { clipId: "v1", type: "grade" }).effectId;
    const b = addEffect(comp, { clipId: "v1", type: "blur" }).effectId;
    reorderEffect(comp, { clipId: "v1", effectId: a, toIndex: 99 });
    expect(effects(comp, "v1").map((e) => e.id)).toEqual([b, a]);
  });
});
