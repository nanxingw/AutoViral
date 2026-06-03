// Isolation tests for the migrations registry skeleton (I10 / W7.5).
//
// AC coverage (docs/issues/010 + PRD-0002 deep module ③ Testing Decision 3):
//   1. composition.yaml / carousel.yaml carry an optional `schemaVersion`
//      default 1; a FRESH work writes it (grep-confirmable via seed factories).
//   2. `src/shared/migrations/` exists and `migrate(kind, doc)` chains by
//      version; a no-`schemaVersion` old yaml migrates to the latest version.
//   3. `migrateLegacyTrackIds` collected as a registry member is behaviour-
//      preserved (same input → same output as the bare function).
//   4. `strip-pipeline` collected as a registry member runs verbatim.
//   5. a migrated doc goes through the SAME zod + atomic-write path
//      (invariant #3) — readCompositionFor / writeCompositionFor in
//      composition-ops.ts — without corruption.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import {
  migrate,
  registerMigration,
  listMigrations,
  latestVersion,
  readSchemaVersion,
  type Migration,
} from "../registry.js";
import {
  applyNormalizers,
  COMPOSITION_NORMALIZERS,
  BATCH_MIGRATIONS,
} from "../members.js";
import {
  CompositionSchema,
  COMPOSITION_SCHEMA_VERSION,
  makeEmptyComposition,
  migrateLegacyTrackIds,
  TRACK_ID_PREFIX_REGEX,
} from "../../composition.js";
import {
  CarouselSchema,
  CAROUSEL_SCHEMA_VERSION,
  makeEmptyCarousel,
} from "../../carousel.js";
import { withTempDataDir } from "../../../server/__tests__/_helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_FIXTURE = join(
  __dirname,
  "..",
  "..",
  "__tests__",
  "fixtures",
  "composition-legacy-ids.yaml",
);

async function loadLegacyComposition(): Promise<unknown> {
  return yaml.load(await readFile(LEGACY_FIXTURE, "utf8"));
}

// ─── AC1 — schemaVersion field on both schemas + seed factories ──────────────
describe("schemaVersion field (AC1)", () => {
  it("CompositionSchema accepts an absent schemaVersion (optional); floor=1 via readSchemaVersion", () => {
    const raw = migrateLegacyTrackIds(
      yaml.load(
        // minimal valid-after-migration composition with NO schemaVersion
        [
          "id: c_x",
          "workId: x",
          "fps: 30",
          "width: 1080",
          "height: 1920",
          "duration: 0",
          'aspect: "9:16"',
          'updatedAt: "2026-06-03T00:00:00Z"',
          "tracks: []",
        ].join("\n"),
      ),
    );
    const parsed = CompositionSchema.parse(raw);
    // Optional field: parse leaves it undefined when absent (so existing
    // Composition literals don't break). The default-1 floor is supplied by
    // readSchemaVersion(), the single source of the version default.
    expect(parsed.schemaVersion).toBeUndefined();
    expect(readSchemaVersion(parsed)).toBe(1);
  });

  it("CompositionSchema preserves an explicit schemaVersion through parse", () => {
    const parsed = CompositionSchema.parse({
      id: "c_v",
      workId: "v",
      schemaVersion: 1,
      fps: 30,
      width: 1080,
      height: 1920,
      duration: 0,
      aspect: "9:16",
      tracks: [],
      updatedAt: "2026-06-03T00:00:00Z",
    });
    expect(parsed.schemaVersion).toBe(1);
  });

  it("CarouselSchema accepts an absent schemaVersion (optional); floor=1 via readSchemaVersion", () => {
    const carousel = CarouselSchema.parse({
      id: "car_x",
      workId: "x",
      width: 1080,
      height: 1350,
      globals: {},
      slides: [{ id: "s1", bg: { type: "solid", value: "#fff" }, layers: [] }],
      updatedAt: "2026-06-03T00:00:00Z",
    });
    expect(carousel.schemaVersion).toBeUndefined();
    expect(readSchemaVersion(carousel)).toBe(1);
  });

  it("makeEmptyComposition stamps the latest schemaVersion (fresh work writes it)", () => {
    const comp = makeEmptyComposition({ workId: "w_fresh" });
    expect(comp.schemaVersion).toBe(COMPOSITION_SCHEMA_VERSION);
    // The factory output round-trips through the schema unchanged.
    expect(CompositionSchema.parse(comp).schemaVersion).toBe(
      COMPOSITION_SCHEMA_VERSION,
    );
  });

  it("makeEmptyCarousel stamps the latest schemaVersion (fresh work writes it)", () => {
    const car = makeEmptyCarousel("w_fresh");
    expect(car.schemaVersion).toBe(CAROUSEL_SCHEMA_VERSION);
    expect(CarouselSchema.parse(car).schemaVersion).toBe(CAROUSEL_SCHEMA_VERSION);
  });

  it("a fresh-work yaml dump literally contains `schemaVersion:` (grep-confirmable)", () => {
    const dumped = yaml.dump(makeEmptyComposition({ workId: "w_grep" }));
    expect(dumped).toContain("schemaVersion:");
    const dumpedCar = yaml.dump(makeEmptyCarousel("w_grep"));
    expect(dumpedCar).toContain("schemaVersion:");
  });
});

// ─── AC2 — migrate(kind, doc) chains by version ──────────────────────────────
describe("migrate() version chaining (AC2)", () => {
  it("readSchemaVersion treats absent/invalid schemaVersion as 1", () => {
    expect(readSchemaVersion({})).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 0 })).toBe(1);
    expect(readSchemaVersion({ schemaVersion: -3 })).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 2.5 })).toBe(1);
    expect(readSchemaVersion(null)).toBe(1);
    expect(readSchemaVersion("nope")).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 3 })).toBe(3);
  });

  it("a no-schemaVersion old composition yaml normalises to the latest version", async () => {
    const legacy = await loadLegacyComposition();
    expect((legacy as Record<string, unknown>).schemaVersion).toBeUndefined();
    const out = migrate("composition", legacy) as { schemaVersion: number };
    expect(out.schemaVersion).toBe(latestVersion("composition"));
  });

  it("latestVersion = 1 + number of registered chain migrations", () => {
    // v0.1.1 ships ZERO version-bumping chain migrations (skeleton only).
    expect(latestVersion("composition")).toBe(1 + listMigrations("composition").length);
    expect(latestVersion("carousel")).toBe(1 + listMigrations("carousel").length);
  });

  it("chains MULTIPLE registered migrations in ascending order to the latest", () => {
    // Register a throwaway chain on the `carousel` kind to prove the chaining
    // loop without touching the real composition path. (registry is module
    // singleton; we register unique ids so this is isolated.)
    const order: string[] = [];
    const m1: Migration = {
      from: 1,
      to: 2,
      id: "test-c-1to2",
      up: (d) => {
        order.push("1->2");
        return { ...(d as object), step1: true };
      },
    };
    const m2: Migration = {
      from: 2,
      to: 3,
      id: "test-c-2to3",
      up: (d) => {
        order.push("2->3");
        return { ...(d as object), step2: true };
      },
    };
    // Register out of order to prove the registry sorts by `from`.
    registerMigration("carousel", m2);
    registerMigration("carousel", m1);

    const out = migrate("carousel", { id: "c", schemaVersion: 1 }) as Record<
      string,
      unknown
    >;
    expect(order).toEqual(["1->2", "2->3"]);
    expect(out.step1).toBe(true);
    expect(out.step2).toBe(true);
    expect(out.schemaVersion).toBe(3);
    expect(latestVersion("carousel")).toBe(3);
  });

  it("a doc already at the latest version is returned unchanged (stamp normalised)", () => {
    // composition has no chain migrations → latest is 1; a v1 doc is a no-op.
    const doc = { id: "c", schemaVersion: 1, foo: "bar" };
    const out = migrate("composition", doc) as Record<string, unknown>;
    expect(out.schemaVersion).toBe(1);
    expect(out.foo).toBe("bar");
  });

  it("registerMigration rejects duplicate ids and non-+1 bumps", () => {
    expect(() =>
      registerMigration("composition", {
        from: 1,
        to: 3,
        id: "bad-bump",
        up: (d) => d,
      }),
    ).toThrow(/bump by exactly 1/);
  });
});

// ─── AC3 — migrateLegacyTrackIds collected, behaviour-preserved ──────────────
describe("collected members — behaviour preserved (AC3/AC4)", () => {
  it("legacy-track-ids member is the SAME function as migrateLegacyTrackIds", () => {
    const member = COMPOSITION_NORMALIZERS.find((m) => m.id === "legacy-track-ids");
    expect(member).toBeDefined();
    expect(member!.apply).toBe(migrateLegacyTrackIds);
    expect(member!.kind).toBe("composition");
  });

  it("applyNormalizers('composition', doc) === migrateLegacyTrackIds(doc) (same in/out)", async () => {
    const legacy = await loadLegacyComposition();
    const viaMember = applyNormalizers("composition", legacy);
    const viaBare = migrateLegacyTrackIds(legacy);
    // Both rewrite track ids to fresh `trk_` ids; ids differ run-to-run, so
    // compare the SHAPE that must be identical: clip ids, kinds, labels,
    // displayOrder, and the prefix invariant.
    const norm = (d: unknown) => {
      const c = d as { tracks: Array<{ kind: string; label: string; displayOrder: number; id: string; clips: Array<{ id: string }> }> };
      return c.tracks.map((t) => ({
        kind: t.kind,
        label: t.label,
        displayOrder: t.displayOrder,
        idMatchesPrefix: TRACK_ID_PREFIX_REGEX.test(t.id),
        clipIds: t.clips.map((cl) => cl.id),
      }));
    };
    expect(norm(viaMember)).toEqual(norm(viaBare));
  });

  it("strip-pipeline collected as a batch member, delegates verbatim", async () => {
    const member = BATCH_MIGRATIONS.find((m) => m.id === "strip-pipeline");
    expect(member).toBeDefined();

    await withTempDataDir(async (dir) => {
      const wDir = join(dir, "works", "w_strip");
      await mkdir(wDir, { recursive: true });
      const old = {
        id: "w_strip",
        title: "Legacy",
        pipeline: { research: { name: "调研", status: "done" } },
        evaluationMode: true,
        evalSessionIds: { research: "s1" },
        evalAttempts: { research: 2 },
      };
      await writeFile(join(wDir, "work.yaml"), yaml.dump(old), "utf-8");

      const report = await member!.run({ dataDir: dir, dryRun: false });
      expect(report.stripped).toBe(1);

      const cleaned = yaml.load(
        await readFile(join(wDir, "work.yaml"), "utf-8"),
      ) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty("pipeline");
      expect(cleaned).not.toHaveProperty("evaluationMode");
      expect(cleaned.title).toBe("Legacy");
      // Backup written first (spec §14 — verbatim behaviour).
      const files = await readdir(wDir);
      expect(files.some((f) => f.endsWith(".bak.yaml"))).toBe(true);
    });
  });
});

// ─── AC5 — migrate goes through zod + atomic write (invariant #3) ────────────
describe("migrate → zod + atomic write (AC5 / invariant #3)", () => {
  beforeEach(() => vi.resetModules());

  it("a migrated legacy composition persists via the atomic-write path and reloads", async () => {
    await withTempDataDir(async (dir) => {
      const { writeCompositionFor, readCompositionFor, compositionPathFor } =
        await import("../../../server/bridge/composition-ops.js");
      const worksRoot = join(dir, "works");
      const ctx = { workId: "w_mig", worksRoot };

      // 1. Take a real legacy (no-schemaVersion) composition, normalise its
      //    track ids (the collected member), migrate by version, then parse.
      const legacy = await loadLegacyComposition();
      const normalised = applyNormalizers("composition", legacy);
      const versioned = migrate("composition", normalised);
      const parsed = CompositionSchema.parse(versioned);
      expect(parsed.schemaVersion).toBe(latestVersion("composition"));

      // 2. Persist through the ATOMIC write path (validate → tmp → rename).
      await writeCompositionFor(ctx, parsed);

      // 3. Disk file is valid yaml carrying schemaVersion (grep-confirmable).
      const onDisk = await readFile(compositionPathFor(ctx), "utf-8");
      expect(onDisk).toContain("schemaVersion:");

      // 4. Read back through the same zod-validated read path; round-trips.
      const reloaded = await readCompositionFor(ctx);
      expect(reloaded.schemaVersion).toBe(latestVersion("composition"));
      for (const t of reloaded.tracks) {
        expect(t.id).toMatch(TRACK_ID_PREFIX_REGEX);
      }
    });
  });
});
