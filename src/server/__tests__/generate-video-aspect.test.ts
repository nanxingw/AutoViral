// POST /api/generate/video — flat OpenRouter params + canvas-follow aspect +
// validation + AssetEntry registration. Root cause behind the old "portrait
// request returns 16:9" / "i2v fixed 720×1280" was the provider nesting params
// in `input:{}` (gateway dropped them); these tests pin the route's NEW
// contract: explicit params reach the provider, no-explicit follows the canvas,
// invalid values 400, success registers an asset. Mirrors the mock/seed pattern
// of generate-image-aspect.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";
import type { VideoGenerateOptions } from "../../providers/video/types.js";

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

describe("POST /api/generate/video · flat params + canvas-follow + validation", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  /** Register a capturing fake as the default video provider; returns the
   *  captured opts list. We reuse the "seedance" key so it OVERWRITES the
   *  statically-registered default (getDefaultProvider returns the first
   *  default:true, which would otherwise be the real seedance). The fake
   *  returns a stub-style success so the route's registration + response path
   *  runs without disk/network. Must run AFTER vi.resetModules(). */
  async function setupFakeVideoProvider(): Promise<VideoGenerateOptions[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const calls: VideoGenerateOptions[] = [];
    registerProvider({
      name: "seedance",
      capability: "video",
      displayName: "Fake Seedance (capture)",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateVideo: async (opts: VideoGenerateOptions) => {
        calls.push(opts);
        // Return a work-relative-ish asset uri; route converts/registers it.
        return {
          assetUri: `${opts.outputAbsoluteDir}/clip.mp4`,
          stub: true,
          costUsd: 0,
        };
      },
    });
    return calls;
  }

  it("forwards aspectRatio / resolution / durationSec to the provider", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "the camera pushes in",
          filename: "shot.mp4",
          aspectRatio: "16:9",
          resolution: "1080p",
          durationSec: 8,
        }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].aspectRatio).toBe("16:9");
      expect(calls[0].resolution).toBe("1080p");
      expect(calls[0].durationSec).toBe(8);
    });
  });

  it("no explicit aspect → canvas-follow: comp 16:9 → '16:9'", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "16:9");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "x.mp4",
        }),
      );
      expect(calls[0].aspectRatio).toBe("16:9");
      // default durationSec 5 when not supplied.
      expect(calls[0].durationSec).toBe(5);
    });
  });

  it("no explicit aspect → canvas-follow: comp 4:5 → closest supported '3:4'", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "4:5");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "x.mp4",
        }),
      );
      expect(calls[0].aspectRatio).toBe("3:4");
    });
  });

  it("legacy usage: resolution '16:9' is treated as aspectRatio", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "x.mp4",
          resolution: "16:9",
        }),
      );
      expect(calls[0].aspectRatio).toBe("16:9");
      // The "16:9" must NOT leak through as a resolution.
      expect(calls[0].resolution).toBeUndefined();
    });
  });

  it("durationSec 3 → 400 with a message listing the 4-15 range", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "x.mp4",
          durationSec: 3,
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(String(json.error)).toMatch(/4.*15|4-15|4–15/);
    });
  });

  it("success response includes assetId and registers AssetEntry + provenance edge", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "a sunny beach",
          filename: "x.mp4",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(typeof json.assetId).toBe("string");
      expect(json.assetId).toBeTruthy();

      const compRaw = await readFile(
        join(dataDir, "works", w.id, "composition.yaml"),
        "utf-8",
      );
      const comp = yaml.load(compRaw) as Composition;
      expect((comp.assets ?? []).some((a) => a.id === json.assetId)).toBe(true);
      expect(
        (comp.provenance ?? []).some(
          (e) => e.toAssetId === json.assetId && e.operation.type === "generate",
        ),
      ).toBe(true);
    });
  });

  it("firstFrame local assets path → provider receives a data: URI", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");
      // seed a real image under the work's assets/ tree.
      const imgDir = join(dataDir, "works", w.id, "assets", "images");
      await mkdir(imgDir, { recursive: true });
      // minimal PNG header bytes — content doesn't matter, just that it reads.
      await writeFile(join(imgDir, "anchor.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "she turns to camera",
          filename: "x.mp4",
          firstFrame: "assets/images/anchor.png",
        }),
      );
      expect(calls[0].firstFrameImage).toBeDefined();
      expect(calls[0].firstFrameImage!.startsWith("data:image/png;base64,")).toBe(true);
    });
  });
});
