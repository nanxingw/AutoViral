import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";

const SAMPLE_COMP = (workId: string): Composition => ({
  id: `c_${workId}`,
  workId,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 5,
  aspect: "16:9",
  tracks: [],
  updatedAt: "2026-05-06T00:00:00Z",
  assets: [
    {
      id: "vid1",
      uri: `/api/works/${workId}/assets/source.mp4`,
      kind: "video",
      metadata: {},
      status: "ready",
    },
  ],
  provenance: [
    {
      fromAssetId: null,
      toAssetId: "vid1",
      operation: {
        type: "upload",
        actor: "user",
        timestamp: "2026-05-06T00:00:00Z",
        params: {},
      },
    },
  ],
  exportPresets: [],
});

async function setupWorkWithVideo(dataDir: string, workId: string): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(join(wDir, "assets"), { recursive: true });
  await writeFile(join(wDir, "assets", "source.mp4"), "fake-bytes");
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(SAMPLE_COMP(workId)),
    "utf-8",
  );
}

describe("POST /api/post-process/:operation (Phase 8.5)", () => {
  const savedRife = process.env.RIFE_MODEL_PATH;
  const savedEsrgan = process.env.ESRGAN_MODEL_PATH;

  beforeEach(() => {
    delete process.env.RIFE_MODEL_PATH;
    delete process.env.ESRGAN_MODEL_PATH;
    vi.resetModules();
  });
  afterEach(() => {
    if (savedRife === undefined) delete process.env.RIFE_MODEL_PATH;
    else process.env.RIFE_MODEL_PATH = savedRife;
    if (savedEsrgan === undefined) delete process.env.ESRGAN_MODEL_PATH;
    else process.env.ESRGAN_MODEL_PATH = savedEsrgan;
  });

  it("returns 400 for unknown operation", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "PP",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/post-process/bogus-op", {
          workId: w.id,
          assetId: "vid1",
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(String(json.error)).toMatch(/unknown operation/i);
    });
  });

  it("frame-interpolate runs adapter (stub mode), returns new assetUri + stub flag", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "Demo Clip",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/post-process/frame-interpolate", {
          workId: w.id,
          assetId: "vid1",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.stub).toBe(true);
      expect(json.assetUri).toMatch(/\/api\/works\/.+\/assets\/post-process\//);
      expect(json.asset.kind).toBe("video");
      expect(json.asset.id).toMatch(/^pp_frame-interpolate_/);
      expect(typeof json.durationMs).toBe("number");
    });
  });

  it("super-resolve adds provenance edge with operation+stub params", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "Demo Clip",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/post-process/super-resolve", {
          workId: w.id,
          assetId: "vid1",
          options: { scale: 4 },
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();

      expect(json.edge.fromAssetId).toBe("vid1");
      expect(json.edge.toAssetId).toBe(json.asset.id);
      expect(json.edge.operation.type).toBe("grade");
      expect(json.edge.operation.actor).toBe("user");
      expect(json.edge.operation.params.operation).toBe("super-resolve");
      expect(json.edge.operation.params.stub).toBe(true);
      expect(json.edge.operation.params.scale).toBe(4);

      // Persisted on disk too.
      const compRaw = await readFile(
        join(dataDir, "works", w.id, "composition.yaml"),
        "utf-8",
      );
      const compDoc = yaml.load(compRaw) as Composition;
      const edges = compDoc.provenance ?? [];
      const ppEdge = edges.find(
        (e) =>
          e.operation.type === "grade" &&
          (e.operation.params as Record<string, unknown>).operation ===
            "super-resolve",
      );
      expect(ppEdge).toBeDefined();
    });
  });
});
