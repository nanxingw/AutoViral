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

/** Register a capturing fake as the default video provider (reusing the
 *  "seedance" key so it OVERWRITES the real one) to inspect the opts the route
 *  forwards. Must run AFTER vi.resetModules(). */
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
      return { assetUri: `${opts.outputAbsoluteDir}/clip.mp4`, stub: true, costUsd: 0 };
    },
  });
  return calls;
}

const EMPTY_COMP = (workId: string): Composition => ({
  id: `c_${workId}`,
  workId,
  fps: 30,
  width: 1080,
  height: 1920,
  duration: 0,
  aspect: "9:16",
  tracks: [],
  updatedAt: "2026-05-06T00:00:00Z",
  assets: [],
  provenance: [],
  exportPresets: [],
});

async function setupEmptyComposition(
  dataDir: string,
  workId: string,
): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(wDir, { recursive: true });
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(EMPTY_COMP(workId)),
    "utf-8",
  );
}

// ADR-007 — video is honestly seedance-only (OpenRouter). The runway/sora/kling
// stubs were dropped: they produced nothing and implied direct vendor calls.
// These tests assert the seedance-only contract and that dispatch still writes
// the asset + provenance edge. With no OPENROUTER_API_KEY the seedance adapter
// returns a stub assetUri (no network), which keeps these tests offline.
describe("Phase 8.4 provider endpoints (ADR-007 seedance-only)", () => {
  beforeEach(() => {
    // Force seedance into stub mode (no real OpenRouter call). config.ts runs
    // dotenv.config() on import, which would re-populate a real key from .env
    // and overwrite a `delete` — but dotenv never OVERWRITES an already-set var,
    // so pinning it to "" here keeps the adapter offline across vi.resetModules.
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("GET /api/providers returns only seedance", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/providers"),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.providers).toHaveLength(1);
      expect(json.providers[0].id).toBe("seedance");
      // No OPENROUTER_API_KEY → reported as a disabled (stub) option.
      expect(json.providers[0].stub).toBe(true);
      expect(json.providers[0].available).toBe(false);
    });
  });

  it("the dropped stubs are no longer listed", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/providers"),
      );
      const json: any = await res.json();
      const ids = json.providers.map((p: any) => p.id);
      expect(ids).not.toContain("runway");
      expect(ids).not.toContain("sora");
      expect(ids).not.toContain("kling");
    });
  });

  it("POST without prompt returns 400", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: "w1",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("POST with unknown provider returns 404", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/runway/generate-video", {
          workId: "w1",
          prompt: "hi",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("POST with valid seedance returns 200 with stub assetUri (no key)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: "w1",
          prompt: "a sunny beach",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetUri).toMatch(/seedance-/);
      expect(json.stub).toBe(true);
    });
  });

  it("registers new asset on composition.yaml after successful POST", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Provider Demo",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupEmptyComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "a sunny beach at golden hour",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toMatch(/^gen_/);
      expect(json.assetUri).toBeDefined();

      const compRaw = await readFile(
        join(dataDir, "works", w.id, "composition.yaml"),
        "utf-8",
      );
      const compDoc = yaml.load(compRaw) as Composition;
      expect((compDoc.assets ?? []).length).toBe(1);
      const newAsset = (compDoc.assets ?? [])[0];
      expect(newAsset.id).toBe(json.assetId);
      expect(newAsset.kind).toBe("video");
      expect(newAsset.uri).toBe(json.assetUri);
      expect((newAsset.metadata as Record<string, unknown>).duration).toBe(4);
    });
  });

  it("appends a generate provenance edge with provider+prompt params", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Provider Demo 2",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupEmptyComposition(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "a calm lake at dawn",
          durationSec: 6,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();

      const compRaw = await readFile(
        join(dataDir, "works", w.id, "composition.yaml"),
        "utf-8",
      );
      const compDoc = yaml.load(compRaw) as Composition;
      const edges = compDoc.provenance ?? [];
      const genEdge = edges.find((e) => e.operation.type === "generate");
      expect(genEdge).toBeDefined();
      expect(genEdge!.fromAssetId).toBeNull();
      expect(genEdge!.toAssetId).toBe(json.assetId);
      const params = genEdge!.operation.params as Record<string, unknown>;
      expect(params.providerId).toBe("seedance");
      expect(params.prompt).toBe("a calm lake at dawn");
      expect(params).toHaveProperty("costUsd");
      expect(params).toHaveProperty("stub");
    });
  });

  it("costUsd field present in 200 response", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: "w1",
          prompt: "a calm lake",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json).toHaveProperty("costUsd");
    });
  });

  // Canvas-follow + enum validation — the human-UI dispatch path must produce
  // the SAME orientation as the agent /api/generate/video path.
  it("no explicit aspect → canvas-follow: comp 16:9 → provider gets '16:9'", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "16:9");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "p",
          durationSec: 4,
        }),
      );
      expect(calls[0].aspectRatio).toBe("16:9");
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
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "p",
          durationSec: 4,
        }),
      );
      expect(calls[0].aspectRatio).toBe("3:4");
    });
  });

  it("explicit aspect always wins over the canvas (provider gets '21:9')", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "p",
          durationSec: 4,
          aspectRatio: "21:9",
        }),
      );
      expect(calls[0].aspectRatio).toBe("21:9");
    });
  });

  it("off-enum aspect (stale 4:5 from image tab) → 400, never reaches provider", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, "9:16");

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "p",
          durationSec: 4,
          aspectRatio: "4:5",
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(String(json.error)).toContain("4:5");
      expect(calls).toHaveLength(0);
    });
  });
});
