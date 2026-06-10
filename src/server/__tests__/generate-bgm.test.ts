// POST /api/generate/bgm — B2 (PRD-0009): Lyria 3 Pro music/BGM generation.
// Pins the route contract: required-field + workId validation, no-key 503,
// durationSeconds server-side clamp (5-180; HTML min/max is untrusted, #75),
// success registers an AssetEntry + provenance edge + asset-added broadcast.
// The Lyria provider is faked (capture) so no network/ffmpeg runs.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";
import type {
  MusicGenerateOptions,
  MusicGenerateResult,
} from "../../providers/audio/types.js";

const COMP = (workId: string): Composition => ({
  id: `c_${workId}`,
  workId,
  fps: 30,
  width: 1080,
  height: 1920,
  duration: 0,
  aspect: "9:16",
  tracks: [],
  updatedAt: "2026-06-10T00:00:00Z",
  assets: [],
  provenance: [],
  exportPresets: [],
});

async function writeComposition(dataDir: string, workId: string): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(wDir, { recursive: true });
  await writeFile(join(wDir, "composition.yaml"), yaml.dump(COMP(workId)), "utf-8");
}

/** Persist an openrouter key into the temp dir's config.yaml — mirrors what
 *  Settings does. The route reads config.openrouter.apiKey, not process.env. */
async function configureKey(key: string): Promise<void> {
  const { loadConfig, saveConfig } = await import("../../infra/config.js");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, openrouter: { apiKey: key } });
}

describe("POST /api/generate/bgm · Lyria music generation", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  /** Override the static lyria entry with a capturing fake; returns the
   *  captured opts list. Must run AFTER vi.resetModules(). The fake returns a
   *  success with audioBytes so the route's truncate/register/broadcast path
   *  runs without network/ffmpeg. */
  async function setupFakeMusicProvider(): Promise<MusicGenerateOptions[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const calls: MusicGenerateOptions[] = [];
    registerProvider({
      name: "lyria",
      capability: "music",
      displayName: "Fake Lyria (capture)",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateMusic: async (opts: MusicGenerateOptions): Promise<MusicGenerateResult> => {
        calls.push(opts);
        const assetUri = opts.outputAbsoluteDir
          ? join(opts.outputAbsoluteDir, opts.filename)
          : `assets/lyria/${opts.filename}`;
        if (opts.outputAbsoluteDir) {
          await mkdir(opts.outputAbsoluteDir, { recursive: true });
          // ID3 magic so the file isn't 0-byte (route may probe/truncate).
          await writeFile(assetUri, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]));
        }
        return { assetUri, costUsd: 0.08, stub: false, audioBytes: Buffer.from([0x49, 0x44, 0x33]) };
      },
    });
    return calls;
  }

  it("400 when workId or prompt is missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      await setupFakeMusicProvider();

      const r1 = await apiRoutes.fetch(jsonReq("POST", "/api/generate/bgm", { prompt: "x" }));
      expect(r1.status).toBe(400);
      const r2 = await apiRoutes.fetch(jsonReq("POST", "/api/generate/bgm", { workId: "w" }));
      expect(r2.status).toBe(400);
    });
  });

  it("400 on an unsafe workId", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      await setupFakeMusicProvider();
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", { workId: "../../etc", prompt: "x" }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("503 when no openrouter.apiKey is configured", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", { workId: w.id, prompt: "calm piano" }),
      );
      expect(res.status).toBe(503);
      const json: any = await res.json();
      expect(String(json.error)).toMatch(/openrouter|apiKey|not configured/i);
    });
  });

  it("forwards prompt + vocal + seed + temperature to the provider on success", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", {
          workId: w.id,
          prompt: "a gentle folk song",
          vocal: true,
          seed: 42,
          temperature: 1.1,
        }),
      );
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].prompt).toBe("a gentle folk song");
      expect(calls[0].vocal).toBe(true);
      expect(calls[0].seed).toBe(42);
      expect(calls[0].temperature).toBe(1.1);
      // Default filename is bgm_<ts>.mp3 when none given.
      expect(calls[0].filename).toMatch(/^bgm_\d+\.mp3$/);
    });
  });

  it("uses the caller's filename when provided", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", {
          workId: w.id,
          prompt: "x",
          filename: "my_theme.mp3",
        }),
      );
      expect(calls[0].filename).toBe("my_theme.mp3");
    });
  });

  it("sanitizes a traversal filename", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", {
          workId: w.id,
          prompt: "x",
          filename: "../../evil.mp3",
        }),
      );
      // Security property (mirrors the video/image routes): no path separators
      // and no leading dots → the filename can't escape the work's audio dir. A
      // mid-string ".." with no separator is inert.
      expect(calls[0].filename).not.toContain("/");
      expect(calls[0].filename).not.toContain("\\");
      expect(calls[0].filename.startsWith(".")).toBe(false);
    });
  });

  it("clamps durationSeconds below 5 → 400 (untrusted client min/max, #75)", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", {
          workId: w.id,
          prompt: "x",
          durationSeconds: -5,
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(String(json.error)).toMatch(/5.*180|5-180|5–180/);
    });
  });

  it("rejects durationSeconds above 180 → 400", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", {
          workId: w.id,
          prompt: "x",
          durationSeconds: 9999,
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("success registers an AssetEntry (kind audio) + a generate provenance edge", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", { workId: w.id, prompt: "calm lofi piano" }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(typeof json.assetId).toBe("string");
      expect(json.assetId).toBeTruthy();
      expect(typeof json.relativeUri).toBe("string");

      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      const asset = (comp.assets ?? []).find((a) => a.id === json.assetId);
      expect(asset).toBeDefined();
      expect(asset?.kind).toBe("audio");
      expect(
        (comp.provenance ?? []).some(
          (e) => e.toAssetId === json.assetId && e.operation.type === "generate",
        ),
      ).toBe(true);
    });
  });

  it("success publishes an asset-added event (kind audio)", async () => {
    await withTempDataDir(async (dataDir) => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { uiEventBus } = await import("../bridge/ui-events.js");
      await setupFakeMusicProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id);

      const events: any[] = [];
      const unsub = uiEventBus.subscribe(w.id, (e: any) => events.push(e));
      try {
        await apiRoutes.fetch(
          jsonReq("POST", "/api/generate/bgm", { workId: w.id, prompt: "x" }),
        );
      } finally {
        unsub();
      }
      const added = events.find((e) => e.type === "asset-added");
      expect(added).toBeDefined();
      expect(added.payload.kind).toBe("audio");
      expect(added.payload.uri).toMatch(/\.mp3$/);
    });
  });
});
