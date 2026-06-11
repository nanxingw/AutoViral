// C1.3 (PRD-0009) — registering a generated asset on a FRESH work (one with no
// composition.yaml yet) must NOT silently drop the registration. Before this,
// registerGenerated*Asset readFile-ENOENT'd and the catch{} swallowed it →
// assetId:null, no AssetEntry, no provenance — while the teaching/handoff
// promised the asset would be linkable. The fix bootstraps a minimal-but-valid
// composition (reusing the same seed logic the comp write-path uses for
// fresh works) before registering, so the on-disk shape is real.
//
// Swept across BGM + video so neither path keeps the silent-skip.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { readFile, access } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";
import type {
  MusicGenerateOptions,
  MusicGenerateResult,
} from "../../providers/audio/types.js";
import type { VideoGenerateResult, VideoGenerateOptions } from "../../providers/video/types.js";

async function configureKey(key: string): Promise<void> {
  const { loadConfig, saveConfig } = await import("../../infra/config.js");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, openrouter: { apiKey: key } });
}

describe("fresh-work asset registration bootstraps a composition (C1.3)", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  async function setupFakeMusicProvider(): Promise<MusicGenerateOptions[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const calls: MusicGenerateOptions[] = [];
    registerProvider({
      name: "lyria",
      capability: "music",
      displayName: "Fake Lyria",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateMusic: async (opts: MusicGenerateOptions): Promise<MusicGenerateResult> => {
        calls.push(opts);
        const assetUri = join(opts.outputAbsoluteDir!, opts.filename);
        await mkdir(opts.outputAbsoluteDir!, { recursive: true });
        await writeFile(assetUri, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]));
        return { assetUri, costUsd: 0.08, stub: false, audioBytes: Buffer.from([0x49, 0x44, 0x33]) };
      },
    });
    return calls;
  }

  async function setupFakeVideoProvider(): Promise<VideoGenerateOptions[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const calls: VideoGenerateOptions[] = [];
    registerProvider({
      name: "seedance",
      capability: "video",
      displayName: "Fake Seedance",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateVideo: async (opts: VideoGenerateOptions): Promise<VideoGenerateResult> => {
        calls.push(opts);
        const assetUri = join(opts.outputAbsoluteDir, "clip.mp4");
        await mkdir(opts.outputAbsoluteDir, { recursive: true });
        await writeFile(assetUri, Buffer.from([0x00, 0x00, 0x00, 0x18]));
        return { assetUri, costUsd: 0.5, stub: false, providerJobId: "job_1" };
      },
    });
    return calls;
  }

  it("BGM on a fresh work (no composition.yaml) → assetId non-null + AssetEntry + provenance", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeMusicProvider();
      const w = await createWork({ title: "fresh", type: "short-video", platforms: ["douyin"] });
      // NOTE: NO composition.yaml written — this is the regression条件.
      const compPath = join(dataDir, "works", w.id, "composition.yaml");
      await expect(access(compPath)).rejects.toThrow(); // confirm it really doesn't exist yet

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", { workId: w.id, prompt: "calm lofi" }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      // The whole point: assetId is NO LONGER null on a fresh work.
      expect(typeof json.assetId).toBe("string");
      expect(json.assetId).toBeTruthy();

      // And a real composition.yaml now exists with the asset + provenance.
      const comp = yaml.load(await readFile(compPath, "utf-8")) as Composition;
      const asset = (comp.assets ?? []).find((a) => a.id === json.assetId);
      expect(asset).toBeDefined();
      expect(asset?.kind).toBe("audio");
      const edge = (comp.provenance ?? []).find(
        (e) => e.toAssetId === json.assetId && e.operation.type === "generate",
      );
      expect(edge).toBeDefined();
      expect((edge!.operation.params as any).providerId).toBe("lyria");
      // The bootstrapped comp is schema-valid (workId matches, has tracks).
      expect(comp.workId).toBe(w.id);
    });
  });

  it("video on a fresh work (no composition.yaml) → assetId non-null + AssetEntry + provenance", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();
      const w = await createWork({ title: "freshv", type: "short-video", platforms: ["douyin"] });
      const compPath = join(dataDir, "works", w.id, "composition.yaml");
      await expect(access(compPath)).rejects.toThrow();

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "a shot",
          filename: "clip.mp4",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(typeof json.assetId).toBe("string");
      expect(json.assetId).toBeTruthy();

      const comp = yaml.load(await readFile(compPath, "utf-8")) as Composition;
      const asset = (comp.assets ?? []).find((a) => a.id === json.assetId);
      expect(asset).toBeDefined();
      expect(asset?.kind).toBe("video");
      const edge = (comp.provenance ?? []).find(
        (e) => e.toAssetId === json.assetId && e.operation.type === "generate",
      );
      expect(edge).toBeDefined();
    });
  });

  it("still returns null (no bootstrap) for a NONEXISTENT work — never pollutes disk", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      await setupFakeMusicProvider();
      // workId that passes SAFE_ID but isn't a real work.
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", { workId: "ghost-work-xyz", prompt: "x" }),
      );
      // The provider still runs (the route doesn't gate on work existence today),
      // but registration must NOT seed a composition for a non-work.
      const json: any = await res.json();
      expect(json.assetId).toBeNull();
      const compPath = join(dataDir, "works", "ghost-work-xyz", "composition.yaml");
      await expect(access(compPath)).rejects.toThrow();
    });
  });
});
