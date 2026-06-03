import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";

// Mock the python bridge so the endpoint never spawns real Python during tests.
// The mock factory is hoisted; mockResolvedValueOnce / mockReset / mock.calls
// are accessed via the imported binding inside individual tests.
vi.mock("../python-bridge.js", () => ({
  runPythonScript: vi.fn(),
}));

// #45 — the smart-crop scripts were deleted in the skill refactor, so the
// endpoint's existsSync guard now short-circuits to 501 in production. The
// orchestration tests below assume the scripts ARE present (a counterfactual
// kept as a contract for if/when reframe is re-wired), so we mock existsSync to
// true by default; the dedicated guard test flips it to false.
const _existsSync = vi.fn(() => true);
vi.mock("node:fs", async (orig) => ({
  ...(await orig<typeof import("node:fs")>()),
  existsSync: (...args: unknown[]) => _existsSync(...(args as [])),
}));

import { runPythonScript } from "../python-bridge.js";

const _runPython = runPythonScript as unknown as ReturnType<typeof vi.fn>;

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
  // The endpoint resolves the source file via the asset's uri →
  // …/<workId>/assets/<filename>. We just need a placeholder file there.
  await writeFile(join(wDir, "assets", "source.mp4"), "fake-bytes");
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(SAMPLE_COMP(workId)),
    "utf-8",
  );
}

describe("POST /api/video/reframe", () => {
  beforeEach(() => {
    _runPython.mockReset();
    _existsSync.mockReset();
    _existsSync.mockReturnValue(true); // assume scripts present unless a test says otherwise
    vi.resetModules();
  });

  it("returns a structured 501 (not a bare 500) when the smart-crop script is missing (#45)", async () => {
    await withTempDataDir(async (dataDir) => {
      _existsSync.mockReturnValue(false); // scripts deleted in the refactor
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Demo",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", {
          workId: w.id,
          videoId: "vid1",
          fromAspect: "16:9",
          toAspect: "9:16",
        }),
      );
      expect(res.status).toBe(501);
      const json: any = await res.json();
      expect(json.errorCode).toBe("reframe_script_missing");
      // Python must never be spawned when the script is absent.
      expect(_runPython).not.toHaveBeenCalled();
      // Composition must be untouched — no asset / edge appended.
      const { readFile } = await import("node:fs/promises");
      const persisted = yaml.load(
        await readFile(`${dataDir}/works/${w.id}/composition.yaml`, "utf-8"),
      ) as Composition;
      expect(persisted.assets).toHaveLength(1);
      expect(persisted.provenance).toHaveLength(1);
    });
  });

  it("happy path: runs saliency + crop, registers asset + reframe edge, persists composition", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Demo Clip",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);

      _runPython.mockResolvedValueOnce({
        video: `${dataDir}/works/${w.id}/assets/source.mp4`,
        width: 1920,
        height: 1080,
        fps: 30,
        strategy_requested: "auto",
        strategy_used: "face",
        rois: [{ t: 0, x: 656, y: 0, w: 607, h: 1080 }],
      });
      _runPython.mockResolvedValueOnce({
        output: `${dataDir}/works/${w.id}/assets/reframed/demo.mp4`,
        width: 1080,
        height: 1920,
        strategy_used: "face",
      });

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", {
          workId: w.id,
          videoId: "vid1",
          fromAspect: "16:9",
          toAspect: "9:16",
          strategy: "auto",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.strategyUsed).toBe("face");
      expect(json.asset.kind).toBe("video");
      expect(json.asset.id).toMatch(/^reframe_/);
      expect(json.edge.operation.type).toBe("reframe");
      expect(json.edge.fromAssetId).toBe("vid1");
      expect(json.edge.toAssetId).toBe(json.asset.id);
      expect(json.edge.operation.params.fromAspect).toBe("16:9");
      expect(json.edge.operation.params.toAspect).toBe("9:16");
      expect(json.edge.operation.params.strategyRequested).toBe("auto");
      expect(json.edge.operation.params.strategyUsed).toBe("face");

      // Bridge invoked twice: saliency then crop.
      expect(_runPython).toHaveBeenCalledTimes(2);
      const [salScript, salArgs] = _runPython.mock.calls[0];
      expect(salScript).toMatch(/saliency\.py$/);
      expect(salArgs).toContain("--strategy");
      expect(salArgs).toContain("auto");
      const [cropScript, cropArgs] = _runPython.mock.calls[1];
      expect(cropScript).toMatch(/crop_9_16\.py$/);
      expect(cropArgs).toContain("--target-resolution");
      expect(cropArgs).toContain("1080x1920");

      // composition.yaml updated with the new asset + edge.
      const { readFile } = await import("node:fs/promises");
      const persisted = yaml.load(
        await readFile(`${dataDir}/works/${w.id}/composition.yaml`, "utf-8"),
      ) as Composition;
      expect(persisted.assets).toHaveLength(2);
      expect(persisted.assets[1].id).toBe(json.asset.id);
      expect(persisted.provenance).toHaveLength(2);
      expect(persisted.provenance[1].operation.type).toBe("reframe");
    });
  });

  it("returns 400 when body fails Zod validation", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", { workId: "w1" }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("returns 404 when the work does not exist", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", {
          workId: "missing",
          videoId: "vid1",
          fromAspect: "16:9",
          toAspect: "9:16",
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("returns 404 when the videoId is not in the composition", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Demo",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", {
          workId: w.id,
          videoId: "no-such-asset",
          fromAspect: "16:9",
          toAspect: "9:16",
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("returns 500 propagating Python bridge errors with the stderr cause", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Demo",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);
      _runPython.mockRejectedValueOnce(
        new Error("runPythonScript: saliency.py exit 2\nboom"),
      );
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", {
          workId: w.id,
          videoId: "vid1",
          fromAspect: "16:9",
          toAspect: "9:16",
        }),
      );
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toMatch(/saliency\.py/);
      expect(text).toMatch(/boom/);
    });
  });

  it("uses the strategy_used reported by saliency.py (after fallbacks) on the edge", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Demo",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupWorkWithVideo(dataDir, w.id);

      _runPython.mockResolvedValueOnce({
        video: `${dataDir}/works/${w.id}/assets/source.mp4`,
        width: 1920,
        height: 1080,
        fps: 30,
        strategy_requested: "auto",
        strategy_used: "saliency",
        rois: [{ t: 0, x: 656, y: 0, w: 607, h: 1080 }],
      });
      _runPython.mockResolvedValueOnce({
        output: `${dataDir}/works/${w.id}/assets/reframed/demo.mp4`,
        width: 1080,
        height: 1920,
        strategy_used: "saliency",
      });

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/video/reframe", {
          workId: w.id,
          videoId: "vid1",
          fromAspect: "16:9",
          toAspect: "9:16",
          strategy: "auto",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.strategyUsed).toBe("saliency");
      expect(json.edge.operation.params.strategyUsed).toBe("saliency");
      expect(json.edge.operation.params.strategyRequested).toBe("auto");
      // Output filename embeds the strategy used (D4).
      expect(json.asset.uri).toMatch(/__9x16__saliency__/);
    });
  });
});
