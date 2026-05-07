import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
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
  updatedAt: "2026-05-07T00:00:00Z",
  assets: [
    {
      id: "vid1",
      uri: `/api/works/${workId}/assets/source.mp4`,
      kind: "video",
      metadata: {},
      status: "ready",
    },
    {
      id: "aud1",
      uri: `/api/works/${workId}/assets/voice.wav`,
      kind: "audio",
      metadata: {},
      status: "ready",
    },
  ],
  provenance: [],
  exportPresets: [],
});

async function setupWork(dataDir: string, workId: string): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(join(wDir, "assets"), { recursive: true });
  await writeFile(join(wDir, "assets", "source.mp4"), "fake-video");
  await writeFile(join(wDir, "assets", "voice.wav"), "fake-audio");
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(SAMPLE_COMP(workId)),
    "utf-8",
  );
}

describe("POST /api/post-process/lip-sync (Phase 8.6)", () => {
  const savedWav2lip = process.env.WAV2LIP_MODEL_PATH;

  beforeEach(() => {
    delete process.env.WAV2LIP_MODEL_PATH;
    vi.resetModules();
  });
  afterEach(() => {
    if (savedWav2lip === undefined) delete process.env.WAV2LIP_MODEL_PATH;
    else process.env.WAV2LIP_MODEL_PATH = savedWav2lip;
  });

  it("returns 400 when audioAssetId is missing", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "LS",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWork(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/post-process/lip-sync", {
          workId: w.id,
          assetId: "vid1",
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(String(json.error)).toMatch(/audioAssetId/i);
    });
  });

  it("runs lip-sync (stub mode), returns assetUri + stub flag", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "Demo Clip",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWork(dataDir, w.id);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/post-process/lip-sync", {
          workId: w.id,
          assetId: "vid1",
          audioAssetId: "aud1",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.stub).toBe(true);
      expect(json.assetUri).toMatch(/\/api\/works\/.+\/assets\/post-process\//);
      expect(json.asset.id).toMatch(/^pp_lip-sync_/);
      expect(json.edge.operation.params.operation).toBe("lip-sync");
      expect(json.edge.operation.params.stub).toBe(true);
    });
  });
});
