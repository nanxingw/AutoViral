import { describe, it, expect } from "vitest";
import { writeValidatedTrendsYaml } from "../trends-write.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("writeValidatedTrendsYaml", () => {
  it("refuses to write when collection fails validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trends-"));
    try {
      const bad = { platform: "youtube", items: [] };
      const r = await writeValidatedTrendsYaml(dir, "2026-05-12", bad);
      expect(r.written).toBe(false);
      expect(r.issues.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
