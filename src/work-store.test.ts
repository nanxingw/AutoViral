import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir } from "./server/__tests__/_helpers.js";

describe("work-store — D3 type cleanup", () => {
  beforeEach(() => vi.resetModules());

  it("createWork no longer attaches pipeline / evaluationMode / eval* fields", async () => {
    await withTempDataDir(async () => {
      const { createWork, getWork } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      expect(w).not.toHaveProperty("pipeline");
      expect(w).not.toHaveProperty("evaluationMode");
      expect(w).not.toHaveProperty("evalSessionIds");
      expect(w).not.toHaveProperty("evalAttempts");

      const reloaded = await getWork(w.id);
      expect(reloaded).not.toHaveProperty("pipeline");
    });
  });

  it("updateWork strips legacy pipeline if passed in", async () => {
    await withTempDataDir(async () => {
      const { createWork, updateWork } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      // Simulate old caller still sending pipeline — should be ignored, not stored
      const out = await updateWork(w.id, { pipeline: { research: { name: "x", status: "done" } } } as any);
      expect(out).not.toHaveProperty("pipeline");
    });
  });
});
