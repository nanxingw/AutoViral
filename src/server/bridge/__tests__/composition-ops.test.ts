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
} from "../composition-ops.js";

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
});
