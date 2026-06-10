// Canvas-follow default for /api/generate/image (user decision 2026-06-10):
// priority is explicit params (aspectRatio / width / height) > the work's OWN
// composition aspect (the canvas the user picked) > model default. No platform
// hard-coding — a 抖音 work with a 16:9 canvas generates 16:9.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";
import type { ImageOpts } from "../../providers/base.js";

const COMP = (workId: string, aspect: Composition["aspect"]): Composition => ({
  id: `c_${workId}`,
  workId,
  fps: 30,
  width: 1080,
  height: 1920,
  duration: 0,
  aspect,
  tracks: [],
  updatedAt: "2026-06-10T00:00:00Z",
  assets: [],
  provenance: [],
  exportPresets: [],
});

async function writeComposition(
  dataDir: string,
  workId: string,
  aspect: Composition["aspect"],
): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(wDir, { recursive: true });
  await writeFile(join(wDir, "composition.yaml"), yaml.dump(COMP(workId, aspect)), "utf-8");
}

describe("POST /api/generate/image · canvas-follow aspect default", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  /** Register a capturing fake as the default image provider and return the
   *  captured opts list. Must run AFTER vi.resetModules() so the fake lands in
   *  the same registry instance api.js resolves. */
  async function setupFakeImageProvider(): Promise<ImageOpts[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const calls: ImageOpts[] = [];
    registerProvider({
      name: "fake-image",
      capability: "image",
      envKey: "FAKE_IMAGE",
      default: true,
      generateImage: async (opts) => {
        calls.push(opts);
        // Fail fast — these tests assert the REQUEST, not the success path
        // (asset-added emission is covered by generate-asset-added.test.ts).
        return { success: false, error: "capture-only fake" };
      },
    });
    return calls;
  }

  it("no explicit sizing → inherits the work's composition aspect", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeImageProvider();

      const w = await createWork({ title: "横屏抖音", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "16:9"); // 用户自己把画布定成横屏

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "opening shot",
          filename: "x.png",
        }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].aspectRatio).toBe("16:9");
    });
  });

  it("explicit aspectRatio wins over the canvas", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeImageProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "x.png",
          aspectRatio: "1:1",
        }),
      );
      expect(calls[0].aspectRatio).toBe("1:1");
    });
  });

  it("explicit width/height suppress the canvas default (provider derives from them)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeImageProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "x.png",
          width: 1920,
          height: 1080,
        }),
      );
      // Route passes width/height through untouched; aspectRatio stays unset so
      // the provider's deriveAspectRatio(width, height) owns the mapping.
      expect(calls[0].aspectRatio).toBeUndefined();
      expect(calls[0].width).toBe(1920);
      expect(calls[0].height).toBe(1080);
    });
  });

  it("work without composition.yaml → no aspect (model default), no throw", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeImageProvider();

      const w = await createWork({ title: "carousel-ish", type: "image-text", platforms: ["xiaohongshu"] });
      // no composition.yaml written

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "x.png",
        }),
      );
      expect(res.status).toBeLessThan(500);
      expect(calls[0].aspectRatio).toBeUndefined();
    });
  });
});
