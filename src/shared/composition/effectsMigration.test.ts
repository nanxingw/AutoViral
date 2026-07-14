import { describe, it, expect } from "vitest";
import {
  projectLegacyFilters,
  resolveClipEffects,
  filtersToGradeParams,
  LEGACY_GRADE_EFFECT_ID,
  CompositionSchema,
} from "../composition.js";

// PRD-0014 S14 — the legacy `filters` → `effects` grade projection. A composition
// authored before S14 (flat brightness/contrast/saturation/lut) loads with those
// knobs folded into ONE leading `grade` effect entry, filters reset to neutral,
// and re-loading the migrated comp is a byte-identical no-op (二次载入幂等 — the
// snapshot regression lock the禁 "丢弃旧 filters 数据" defends).

function rawComp(clipOverrides: Record<string, unknown>): Record<string, unknown> {
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
        transitions: [],
        clips: [
          {
            id: "v1",
            kind: "video",
            src: "assets/x.mp4",
            in: 0,
            out: 5,
            trackOffset: 0,
            transforms: {},
            ...clipOverrides,
          },
        ],
      },
    ],
    updatedAt: "2026-07-14T00:00:00.000Z",
    assets: [],
    provenance: [],
    exportPresets: [],
  };
}

function firstClip(comp: unknown): Record<string, unknown> {
  return (
    ((comp as { tracks: { clips: unknown[] }[] }).tracks[0].clips[0]) as Record<string, unknown>
  );
}

describe("filtersToGradeParams (S14)", () => {
  it("drops the zero knobs, keeps the non-zero ones + lut", () => {
    expect(
      filtersToGradeParams({ brightness: 0.2, contrast: 0, saturation: -0.3, lut: "teal" }),
    ).toEqual({ brightness: 0.2, saturation: -0.3, lut: "teal" });
  });
  it("returns null for a default/empty filter (nothing to project)", () => {
    expect(filtersToGradeParams({ brightness: 0, contrast: 0, saturation: 0 })).toBeNull();
    expect(filtersToGradeParams(undefined)).toBeNull();
  });
});

describe("projectLegacyFilters (S14)", () => {
  it("folds a non-default filters into one leading grade effect + resets filters", () => {
    const migrated = projectLegacyFilters(
      rawComp({ filters: { brightness: 0.2, contrast: 0, saturation: 0.1 } }),
    );
    const clip = firstClip(migrated);
    expect(clip.effects).toEqual([
      {
        id: LEGACY_GRADE_EFFECT_ID,
        type: "grade",
        params: { brightness: 0.2, saturation: 0.1 },
        enabled: true,
      },
    ]);
    expect(clip.filters).toEqual({ brightness: 0, contrast: 0, saturation: 0 });
  });

  it("is IDEMPOTENT — re-projecting the migrated comp is a byte-identical no-op", () => {
    const once = projectLegacyFilters(
      rawComp({ filters: { brightness: 0.5, contrast: 0.2, saturation: 0 } }),
    );
    const twice = projectLegacyFilters(once);
    expect(twice).toEqual(once);
    // No SECOND grade entry sneaks in.
    expect((firstClip(twice).effects as unknown[]).length).toBe(1);
  });

  it("leaves a clip that already has effects untouched (effects wins)", () => {
    const existing = [{ id: "eff_keep", type: "blur", params: { radius: 4 }, enabled: true }];
    const migrated = projectLegacyFilters(
      rawComp({ filters: { brightness: 0.9 }, effects: existing }),
    );
    // effects unchanged; filters NOT reset (we never touch an effects-carrying clip).
    expect(firstClip(migrated).effects).toEqual(existing);
    expect(firstClip(migrated).filters).toEqual({ brightness: 0.9 });
  });

  it("leaves a default-filter clip untouched (no empty grade)", () => {
    const raw = rawComp({ filters: { brightness: 0, contrast: 0, saturation: 0 } });
    const migrated = projectLegacyFilters(raw);
    expect(firstClip(migrated)).not.toHaveProperty("effects");
    // Same reference through (nothing touched).
    expect(migrated).toBe(raw);
  });

  it("the migrated comp round-trips through CompositionSchema.parse", () => {
    const migrated = projectLegacyFilters(
      rawComp({ filters: { brightness: 0.2, contrast: 0, saturation: 0.1 } }),
    );
    const parsed = CompositionSchema.parse(migrated);
    const clip = parsed.tracks[0].clips[0] as { effects?: unknown[] };
    expect(clip.effects).toHaveLength(1);
  });
});

describe("resolveClipEffects (S14)", () => {
  it("returns the explicit effects stack when present", () => {
    const effects = [{ id: "e1", type: "grade" as const, params: {}, enabled: true }];
    expect(resolveClipEffects({ effects })).toBe(effects);
  });
  it("projects legacy filters on the fly when there is no effects stack", () => {
    expect(resolveClipEffects({ filters: { brightness: 0.4 } })).toEqual([
      { id: LEGACY_GRADE_EFFECT_ID, type: "grade", params: { brightness: 0.4 }, enabled: true },
    ]);
  });
  it("returns [] for a clip with neither effects nor a non-default filter", () => {
    expect(resolveClipEffects({})).toEqual([]);
    expect(resolveClipEffects({ filters: { brightness: 0, contrast: 0, saturation: 0 } })).toEqual([]);
  });
});
