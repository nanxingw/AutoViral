// Unit test for readCompositionFor — exercises the on-disk shape via a
// stable fixture under tests/fixtures/sample-work/. If the schema drifts,
// this test (and the fixture) are the first thing that must move.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readCompositionFor } from "../composition-ops.js";

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
