import { describe, it, expect, beforeEach } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("Phase 8.4 provider endpoints", () => {
  beforeEach(() => {
    delete process.env.RUNWAY_API_KEY;
    delete process.env.SORA_API_KEY;
    delete process.env.KLING_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
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
