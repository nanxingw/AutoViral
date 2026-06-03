import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";

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

describe("Phase 8.4 provider endpoints", () => {
  beforeEach(() => {
    delete process.env.RUNWAY_API_KEY;
    delete process.env.SORA_API_KEY;
    delete process.env.KLING_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    vi.resetModules();
  });

  it("GET /api/providers returns 4 providers", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/providers"),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.providers).toHaveLength(4);
      expect(json.providers.map((p: any) => p.id).sort()).toEqual([
        "kling",
        "runway",
        "seedance",
        "sora",
      ]);
    });
  });

  it("POST without prompt returns 400", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/runway/generate-video", {
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
        jsonReq("POST", "/api/providers/ghost/generate-video", {
          workId: "w1",
          prompt: "hi",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("POST with valid runway returns 200 with stub assetUri", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/runway/generate-video", {
          workId: "w1",
          prompt: "a sunny beach",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetUri).toMatch(/runway-/);
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
        jsonReq("POST", "/api/providers/runway/generate-video", {
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
        jsonReq("POST", "/api/providers/sora/generate-video", {
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
      expect(params.providerId).toBe("sora");
      expect(params.prompt).toBe("a calm lake at dawn");
      expect(params).toHaveProperty("costUsd");
      expect(params).toHaveProperty("stub");
    });
  });

  it("costUsd field present in 200 response", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/sora/generate-video", {
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
});
