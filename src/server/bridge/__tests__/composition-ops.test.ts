// Unit test for readCompositionFor — exercises the on-disk shape via a
// stable fixture under tests/fixtures/sample-work/. If the schema drifts,
// this test (and the fixture) are the first thing that must move.

import { describe, expect, it, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import {
  readCompositionFor,
  writeCompositionFor,
  mutateCompositionFor,
  dryRunMutate,
  diffCompositionFor,
  unifiedDiff,
  compositionPreviousPathFor,
} from "../composition-ops.js";
import type { Composition } from "../../../shared/composition.js";
import { access } from "node:fs/promises";
import { addScene } from "../../../shared/composition/ops/scene.js";
import { addTrack } from "../../../shared/composition/ops/track.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("readCompositionFor", () => {
  it("parses & returns Composition from disk", async () => {
    const comp = await readCompositionFor({
      workId: "sample-work",
      worksRoot: join(__dirname, "../../../../tests/fixtures"),
    });
    expect(comp.workId).toBe("sample-work");
    expect(comp.tracks.length).toBeGreaterThan(0);
    expect(comp.tracks.some((t) => t.kind === "video")).toBe(true);
    expect(comp.tracks.some((t) => t.kind === "audio")).toBe(true);
    expect(comp.tracks.some((t) => t.kind === "text")).toBe(true);
    expect(comp.assets.length).toBeGreaterThan(0);
  });
});

describe("writeCompositionFor — atomic + validated", () => {
  let workRoot: string;
  let workId: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-comp-test-"));
    workId = "w_test";
    // Seed the work dir with the sample composition so mutate/read have
    // something to consume.
    const fixture = await readFile(
      join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
      "utf8",
    );
    const seeded = fixture.replace(/workId: sample-work/, `workId: ${workId}`);
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(join(workRoot, workId, "composition.yaml"), seeded, "utf8");
  });

  it("round-trips through validate → write → read", async () => {
    const before = await readCompositionFor({ workId, worksRoot: workRoot });
    await writeCompositionFor({ workId, worksRoot: workRoot }, before);
    const after = await readCompositionFor({ workId, worksRoot: workRoot });
    expect(after.workId).toBe(workId);
    expect(after.tracks.length).toBe(before.tracks.length);
  });

  it("rejects an invalid composition WITHOUT touching disk", async () => {
    const before = await readFile(
      join(workRoot, workId, "composition.yaml"),
      "utf8",
    );
    const bogus = {
      // missing required fields (no tracks, no workId etc.)
      foo: "bar",
    } as any;
    await expect(
      writeCompositionFor({ workId, worksRoot: workRoot }, bogus),
    ).rejects.toThrow();
    const after = await readFile(
      join(workRoot, workId, "composition.yaml"),
      "utf8",
    );
    // Disk is untouched — old YAML still on file byte-for-byte.
    expect(after).toBe(before);
  });

  // S4 — the write path must REJECT unknown keys, not silently strip them.
  // CompositionSchema (read path) is a lenient z.object: a typo'd top-level key
  // (`tracts`) or a typo'd clip field would be dropped to disk with no feedback
  // = silent data loss. writeCompositionFor now validates via the STRICT
  // CompositionWriteSchema so the mistake fails loud and disk is untouched.
  it("rejects an unknown TOP-LEVEL key (typo) WITHOUT touching disk", async () => {
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const valid = await readCompositionFor({ workId, worksRoot: workRoot });
    // `tracts` is the classic typo for `tracks`; the lenient schema would have
    // silently stripped it (200, but the field never lands).
    const typo = { ...valid, tracts: [] } as any;
    await expect(
      writeCompositionFor({ workId, worksRoot: workRoot }, typo),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("rejects an unknown CLIP-LEVEL key (typo) WITHOUT touching disk", async () => {
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const valid = await readCompositionFor({ workId, worksRoot: workRoot });
    // Inject a bogus field on the first clip of the first track — the exact
    // silent-strip vector S11 closed for `clip set`, now closed for whole-comp
    // writes too.
    const tracks = valid.tracks.map((t, ti) =>
      ti === 0
        ? {
            ...t,
            clips: t.clips.map((cl, ci) =>
              ci === 0 ? { ...cl, bogusClipField: 1 } : cl,
            ),
          }
        : t,
    );
    const tampered = { ...valid, tracks } as any;
    await expect(
      writeCompositionFor({ workId, worksRoot: workRoot }, tampered),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("mutateCompositionFor applies the mutator and re-reads the result", async () => {
    const next = await mutateCompositionFor(
      { workId, worksRoot: workRoot },
      (comp) => ({
        ...comp,
        duration: 99,
      }),
    );
    expect(next.duration).toBe(99);
    const raw = await readFile(
      join(workRoot, workId, "composition.yaml"),
      "utf8",
    );
    const parsed = yaml.load(raw) as any;
    expect(parsed.duration).toBe(99);
  });

  // S2 — write-path broadcast. The single write chokepoint fires onCommitted
  // ONLY after the atomic write succeeds, so routes can broadcast
  // "composition-changed" the instant disk is consistent (replaces fs.watch).
  it("mutateCompositionFor calls onCommitted exactly once with the new composition on success", async () => {
    const seen: Composition[] = [];
    const next = await mutateCompositionFor(
      { workId, worksRoot: workRoot },
      (comp) => ({ ...comp, duration: 77 }),
      (committed) => {
        seen.push(committed);
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(next);
    expect(seen[0].duration).toBe(77);
  });

  it("mutateCompositionFor does NOT call onCommitted when validation fails (disk untouched)", async () => {
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    let called = false;
    await expect(
      mutateCompositionFor(
        { workId, worksRoot: workRoot },
        // Drop the required tracks/workId so CompositionSchema.parse throws
        // inside writeCompositionFor — onCommitted must never fire.
        () => ({ foo: "bar" }) as any,
        () => {
          called = true;
        },
      ),
    ).rejects.toThrow();
    expect(called).toBe(false);
    // Disk untouched — broadcast would have been a lie.
    expect(await readFile(target, "utf8")).toBe(before);
  });

  // S2 fix-up — a throwing onCommitted (e.g. a future broadcast that fails)
  // must NOT invalidate a write that already landed on disk. Pre-hardening the
  // exception propagated out of mutateCompositionFor and surfaced at the route
  // as a 400/500 — i.e. the response lied about a write that actually succeeded.
  it("mutateCompositionFor tolerates a throwing onCommitted: the write still lands and it does NOT reject", async () => {
    const target = join(workRoot, workId, "composition.yaml");
    const next = await mutateCompositionFor(
      { workId, worksRoot: workRoot },
      (comp) => ({ ...comp, duration: 123 }),
      () => {
        throw new Error("broadcast blew up");
      },
    );
    // Resolves with the committed composition (no rejection bubbling the
    // broadcast failure up as a write failure).
    expect(next.duration).toBe(123);
    // And the write genuinely landed on disk.
    expect(await readFile(target, "utf8")).toContain("duration: 123");
  });

  // S13 (US 11/12) — dry-run preview. The write chokepoint runs the mutator +
  // validates + preflights but MUST NOT write disk or fire onCommitted.
  it("dryRunMutate runs the mutator + preflight WITHOUT writing disk or broadcasting", async () => {
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    let broadcastCalled = false;
    const result = await dryRunMutate(
      { workId, worksRoot: workRoot },
      (comp) => ({ ...comp, duration: 555 }),
      () => {
        broadcastCalled = true;
      },
    );
    // Verdict reflects the (valid) preview.
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    // No broadcast fired.
    expect(broadcastCalled).toBe(false);
    // Disk byte-for-byte unchanged (no write, no .previous snapshot churn).
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("dryRunMutate reports schema errors WITHOUT throwing and WITHOUT touching disk", async () => {
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    let broadcastCalled = false;
    const result = await dryRunMutate(
      { workId, worksRoot: workRoot },
      // Drop required fields → CompositionSchema rejects.
      () => ({ foo: "bar" }) as any,
      () => {
        broadcastCalled = true;
      },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(broadcastCalled).toBe(false);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  // Phase 5 Task 5.4 — composition.yaml.previous + diffCompositionFor
  it("writeCompositionFor snapshots composition.yaml.previous before each write", async () => {
    // No baseline exists yet — first write must NOT fail (ENOENT swallowed).
    const before = await readCompositionFor({ workId, worksRoot: workRoot });
    await writeCompositionFor(
      { workId, worksRoot: workRoot },
      { ...before, duration: 42 },
    );
    // Now a baseline exists.
    await access(compositionPreviousPathFor({ workId, worksRoot: workRoot }));
    // Second write — baseline should reflect the FIRST write (duration:42),
    // not the original fixture.
    await writeCompositionFor(
      { workId, worksRoot: workRoot },
      { ...before, duration: 99 },
    );
    const baselineRaw = await readFile(
      compositionPreviousPathFor({ workId, worksRoot: workRoot }),
      "utf8",
    );
    expect(baselineRaw).toContain("duration: 42");
  });

  it("diffCompositionFor returns hasBaseline=false on first read", async () => {
    // Fresh workspace — only the seeded composition.yaml, no .previous.
    const { diff, hasBaseline } = await diffCompositionFor({
      workId,
      worksRoot: workRoot,
    });
    expect(hasBaseline).toBe(false);
    expect(diff).toBe("");
  });

  it("diffCompositionFor returns a unified diff after a write", async () => {
    const before = await readCompositionFor({ workId, worksRoot: workRoot });
    await writeCompositionFor(
      { workId, worksRoot: workRoot },
      { ...before, duration: 42 },
    );
    const result = await diffCompositionFor({ workId, worksRoot: workRoot });
    expect(result.hasBaseline).toBe(true);
    // The diff is generated from raw YAML strings — the value of
    // `duration` changes from 0 (fixture) to 42, so the unified diff
    // must surface `+duration: 42` and a removal of the prior value.
    expect(result.diff).toContain("--- composition.yaml.previous");
    expect(result.diff).toContain("+++ composition.yaml");
    expect(result.diff).toContain("+duration: 42");
  });

  it("diffCompositionFor returns empty diff when files match byte-for-byte", async () => {
    // Write the exact current composition back to disk — content is
    // serialized through yaml.dump so the .previous snapshot WILL match
    // the new target.
    const current = await readCompositionFor({ workId, worksRoot: workRoot });
    // First write: produces .previous (fixture-original) + new target
    // (yaml.dump round-trip). Snapshot may differ from the dumped target.
    await writeCompositionFor({ workId, worksRoot: workRoot }, current);
    // Second write of the exact same composition — now both files were
    // produced by yaml.dump and are byte-identical.
    await writeCompositionFor({ workId, worksRoot: workRoot }, current);
    const result = await diffCompositionFor({ workId, worksRoot: workRoot });
    expect(result.hasBaseline).toBe(true);
    expect(result.diff).toBe("");
  });
});

// S6 (PRD-0007 §4.4) — per-work write serialization. mutateCompositionFor is an
// async read-modify-write: WITHOUT a lock, two concurrent writes both
// `await readCompositionFor` the SAME baseline, each mutate their private copy,
// then race to write — the last writer clobbers the first (lost update). The
// fix is a per-work async mutex so same-work writes run FIFO (read sees the
// predecessor's committed state) while different works stay parallel.
describe("mutateCompositionFor — per-work write serialization (S6)", () => {
  let workRoot: string;
  let workId: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-comp-lock-"));
    workId = "w_lock";
    const fixture = await readFile(
      join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
      "utf8",
    );
    const seeded = fixture.replace(/workId: sample-work/, `workId: ${workId}`);
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(join(workRoot, workId, "composition.yaml"), seeded, "utf8");
  });

  it("serializes two concurrent scene writes — BOTH land, no silent lost-update", async () => {
    const ctx = { workId, worksRoot: workRoot };
    // Sanity: fixture starts with zero scenes so the race is observable.
    const seed = await readCompositionFor(ctx);
    expect(seed.scenes ?? []).toHaveLength(0);

    // Two concurrent intent writes, both adding a scene. WITHOUT the lock both
    // read 0 scenes and the second write overwrites the first → only 1 scene
    // survives. WITH the lock the second runs after the first commits → 2.
    await Promise.all([
      mutateCompositionFor(ctx, (c) => {
        addScene(c, { title: "A" });
        return c;
      }),
      mutateCompositionFor(ctx, (c) => {
        addScene(c, { title: "B" });
        return c;
      }),
    ]);

    const after = await readCompositionFor(ctx);
    expect(after.scenes ?? []).toHaveLength(2);
    const titles = (after.scenes ?? []).map((s) => s.title).sort();
    expect(titles).toEqual(["A", "B"]);
    // order must stay contiguous 0..N-1 after both scene ops settle.
    const orders = (after.scenes ?? []).map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1]);
  });

  it("serializes a scene write interleaved with a NON-scene write — both survive", async () => {
    const ctx = { workId, worksRoot: workRoot };
    const seedTracks = (await readCompositionFor(ctx)).tracks.length;

    await Promise.all([
      mutateCompositionFor(ctx, (c) => {
        addScene(c, { title: "scene-write" });
        return c;
      }),
      mutateCompositionFor(ctx, (c) => {
        addTrack(c, { kind: "audio" });
        return c;
      }),
    ]);

    const after = await readCompositionFor(ctx);
    // The scene write landed.
    expect((after.scenes ?? []).map((s) => s.title)).toContain("scene-write");
    // The non-scene write landed too (one extra audio track).
    expect(after.tracks.length).toBe(seedTracks + 1);
  });

  it("serializes N concurrent scene writes — all N land (deeper interleave)", async () => {
    const ctx = { workId, worksRoot: workRoot };
    const N = 6;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        mutateCompositionFor(ctx, (c) => {
          addScene(c, { title: `S${i}` });
          return c;
        }),
      ),
    );
    const after = await readCompositionFor(ctx);
    expect(after.scenes ?? []).toHaveLength(N);
    // Contiguous order invariant holds across all N interleaved appends.
    const orders = (after.scenes ?? []).map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it("does NOT serialize across different workIds (independent works stay parallel)", async () => {
    // Seed a second independent work.
    const workIdB = "w_lock_b";
    const fixture = await readFile(
      join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
      "utf8",
    );
    await mkdir(join(workRoot, workIdB), { recursive: true });
    await writeFile(
      join(workRoot, workIdB, "composition.yaml"),
      fixture.replace(/workId: sample-work/, `workId: ${workIdB}`),
      "utf8",
    );

    const ctxA = { workId, worksRoot: workRoot };
    const ctxB = { workId: workIdB, worksRoot: workRoot };

    // Both works mutate concurrently; each is independent so both must succeed
    // without one blocking the other's correctness.
    await Promise.all([
      mutateCompositionFor(ctxA, (c) => {
        addScene(c, { title: "in-A" });
        return c;
      }),
      mutateCompositionFor(ctxB, (c) => {
        addScene(c, { title: "in-B" });
        return c;
      }),
    ]);

    const afterA = await readCompositionFor(ctxA);
    const afterB = await readCompositionFor(ctxB);
    expect((afterA.scenes ?? []).map((s) => s.title)).toEqual(["in-A"]);
    expect((afterB.scenes ?? []).map((s) => s.title)).toEqual(["in-B"]);
  });

  it("releases the lock after a mutator throws — subsequent writes proceed", async () => {
    const ctx = { workId, worksRoot: workRoot };
    // A write whose mutator throws must not deadlock the queue: the next write
    // for the same work must still run (lock released in finally).
    await expect(
      mutateCompositionFor(ctx, () => {
        throw new Error("mutator blew up");
      }),
    ).rejects.toThrow("mutator blew up");

    // The queue is not wedged — this write completes.
    await mutateCompositionFor(ctx, (c) => {
      addScene(c, { title: "after-throw" });
      return c;
    });
    const after = await readCompositionFor(ctx);
    expect((after.scenes ?? []).map((s) => s.title)).toEqual(["after-throw"]);
  });
});

describe("unifiedDiff", () => {
  it("returns empty string for identical inputs", () => {
    expect(unifiedDiff("a\nb\nc", "a\nb\nc", "x", "y")).toBe("");
  });

  it("emits +/- lines for changed middle and surrounds with context", () => {
    const before = ["a", "b", "old", "d", "e"].join("\n");
    const after = ["a", "b", "new", "d", "e"].join("\n");
    const out = unifiedDiff(before, after, "before", "after");
    expect(out).toContain("--- before");
    expect(out).toContain("+++ after");
    expect(out).toContain("-old");
    expect(out).toContain("+new");
    expect(out).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });
});
