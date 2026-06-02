import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// CRITICAL isolation: config.ts freezes `dataDir` (= AUTOVIRAL_DATA_DIR) into a
// module-level const at first import. Without resetModules, a cached api.js
// imported by an earlier test file keeps dataDir pointed at the REAL
// ~/.autoviral, and this endpoint's saveConfig would clobber the user's actual
// config.yaml. resetModules forces a fresh import inside withTempDataDir (env
// already set) so dataDir re-freezes to the temp dir. Mirrors api.works-tts.test.
beforeEach(() => {
  vi.resetModules();
});

// POST /api/agent/model — switch the creative agent's model TIER (alias).
// The endpoint persists the bare alias (opus/sonnet/haiku) to config.model; the
// CLI resolves the alias to the latest version of that family at spawn time.
describe("POST /api/agent/model", () => {
  it("400 rejects a non-alias value (only opus/sonnet/haiku allowed)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/agent/model", { model: "claude-opus-4-7" }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.errorCode).toBe("invalid_model_alias");
      expect(json.allowed).toEqual(["opus", "sonnet", "haiku"]);
    });
  });

  it("400 rejects a missing model field", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("POST", "/api/agent/model", {}));
      expect(res.status).toBe(400);
    });
  });

  it("200 persists a valid alias to config.model (visible via /api/status)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      // switch to sonnet
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/agent/model", { model: "sonnet" }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ok).toBe(true);
      expect(json.model).toBe("sonnet");

      // /api/status reflects the persisted alias (loadConfig reads fresh).
      const status: any = await (await apiRoutes.fetch(jsonReq("GET", "/api/status"))).json();
      expect(status.model).toBe("sonnet");
    });
  });

  it("round-trips opus → haiku → opus, each persisting", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      for (const alias of ["opus", "haiku", "opus"]) {
        const res = await apiRoutes.fetch(
          jsonReq("POST", "/api/agent/model", { model: alias }),
        );
        expect(res.status).toBe(200);
        const status: any = await (await apiRoutes.fetch(jsonReq("GET", "/api/status"))).json();
        expect(status.model).toBe(alias);
      }
    });
  });

  it("reports respawned:false when no workId / no live session to kill", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/agent/model", { model: "opus" }),
      );
      const json: any = await res.json();
      expect(json.respawned).toBe(false);
    });
  });
});
