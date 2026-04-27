import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { withTempDataDir } from "../src/server/__tests__/_helpers.js";

describe("strip-pipeline migration", () => {
  beforeEach(() => vi.resetModules());

  it("strips pipeline + evaluationMode + eval* and dumps a backup .bak.yaml first", async () => {
    await withTempDataDir(async (dir) => {
      const wDir = join(dir, "works", "w_old");
      await mkdir(wDir, { recursive: true });
      const old = {
        id: "w_old", title: "Legacy", type: "short-video", status: "draft", platforms: ["douyin"],
        pipeline: { research: { name: "调研", status: "done" } },
        evaluationMode: true, evalSessionIds: { research: "s1" }, evalAttempts: { research: 2 },
        createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z",
      };
      await writeFile(join(wDir, "work.yaml"), yaml.dump(old), "utf-8");

      const { run } = await import("./strip-pipeline.js");
      await run({ dataDir: dir, dryRun: false });

      const cleaned = yaml.load(await readFile(join(wDir, "work.yaml"), "utf-8")) as any;
      expect(cleaned).not.toHaveProperty("pipeline");
      expect(cleaned).not.toHaveProperty("evaluationMode");
      expect(cleaned).not.toHaveProperty("evalSessionIds");
      expect(cleaned).not.toHaveProperty("evalAttempts");
      expect(cleaned.title).toBe("Legacy");

      const files = await readdir(wDir);
      expect(files.some((f) => f.endsWith(".bak.yaml"))).toBe(true);
    });
  });

  it("dryRun=true does not modify files", async () => {
    await withTempDataDir(async (dir) => {
      const wDir = join(dir, "works", "w_dry");
      await mkdir(wDir, { recursive: true });
      const old = { id: "w_dry", title: "D", pipeline: { x: { name: "x", status: "done" } } } as any;
      await writeFile(join(wDir, "work.yaml"), yaml.dump(old), "utf-8");

      const { run } = await import("./strip-pipeline.js");
      const report = await run({ dataDir: dir, dryRun: true });

      const after = yaml.load(await readFile(join(wDir, "work.yaml"), "utf-8")) as any;
      expect(after).toHaveProperty("pipeline");
      expect(report.wouldStrip).toBe(1);
    });
  });
});
