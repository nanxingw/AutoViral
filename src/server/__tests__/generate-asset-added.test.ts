import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";
import type { UiEvent } from "../bridge/ui-events.js";

const EMPTY_COMP = (workId: string): Composition => ({
  id: `c_${workId}`,
  workId,
  fps: 30,
  width: 1080,
  height: 1920,
  duration: 0,
  aspect: "9:16",
  tracks: [],
  updatedAt: "2026-06-04T00:00:00Z",
  assets: [],
  provenance: [],
  exportPresets: [],
});

async function setupEmptyComposition(dataDir: string, workId: string): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(wDir, { recursive: true });
  await writeFile(join(wDir, "composition.yaml"), yaml.dump(EMPTY_COMP(workId)), "utf-8");
}

// I17 — generated image/video assets must auto-appear in the Studio library
// without a page reload. The mechanism is a uiEventBus "asset-added" broadcast
// (mirroring audio.ts) that the frontend's useBridgeEvents picks up. These
// tests assert the server half: the generate handlers publish asset-added on
// success. seedance runs offline (stub assetUri) with no OPENROUTER_API_KEY, so
// these stay network-free.
describe("I17 · generate publishes asset-added on success", () => {
  beforeEach(() => {
    // Pin seedance into stub mode (no real OpenRouter call). dotenv never
    // overwrites an already-set var, so "" survives vi.resetModules.
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("POST /api/providers/:id/generate-video publishes asset-added with the new clip uri", async () => {
    await withTempDataDir(async (dataDir) => {
      // Import api.js AND the bus inside the test so both resolve to the SAME
      // module instance after the beforeEach vi.resetModules() — otherwise the
      // router would publish to a different singleton than the one we subscribe.
      const { apiRoutes } = await import("../api.js");
      const { uiEventBus } = await import("../bridge/ui-events.js");
      const { createWork } = await import("../../domain/work-store.js");

      const w = await createWork({
        title: "I17 Demo",
        type: "short-video",
        platforms: ["douyin"],
      });
      await setupEmptyComposition(dataDir, w.id);

      const events: UiEvent[] = [];
      const off = uiEventBus.subscribe(w.id, (e) => events.push(e));

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/providers/seedance/generate-video`, {
          workId: w.id,
          prompt: "a sunny beach at golden hour",
          durationSec: 4,
          aspectRatio: "9:16",
        }),
      );
      off();

      expect(res.status).toBe(200);
      const json: any = await res.json();

      const added = events.find((e) => e.type === "asset-added");
      expect(added).toBeDefined();
      expect(added!.workId).toBe(w.id);
      expect(typeof added!.ts).toBe("number");
      const payload = added!.payload as Record<string, unknown>;
      expect(payload.kind).toBe("video");
      // uri matches the work-relative assetUri returned to the client.
      expect(payload.uri).toBe(json.assetUri);
      expect(payload.origin).toBe("generate");
    });
  });
});
