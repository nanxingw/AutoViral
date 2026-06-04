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
  diffCompositionFor,
  unifiedDiff,
  compositionPreviousPathFor,
} from "../composition-ops.js";
import type { Composition } from "../../../shared/composition.js";
import { access } from "node:fs/promises";

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
