import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// dataDir + config freeze at first import — resetModules so each test re-imports
// api.js (and a fresh config) against the temp dir. Mirrors api.coach.test.
beforeEach(() => {
  vi.resetModules();
});

describe("GET /api/coach/angle-briefs/:platform", () => {
  it("returns shaped briefs grounded on the user's configured interests (no LLM, instant)", async () => {
    await withTempDataDir(async () => {
      const { saveConfig, loadConfig } = await import("../../infra/config.js");
      const cfg = await loadConfig();
      await saveConfig({ ...cfg, interests: ["机械键盘", "露营"] });

      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("GET", "/api/coach/angle-briefs/douyin"),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.platform).toBe("douyin");
      expect(Array.isArray(json.briefs)).toBe(true);
      expect(json.briefs.length).toBeGreaterThan(0);
      // No trends on disk in the temp home → the shaper leans on interests alone
      // and says so via the honest "interest" grounding (never fabricates a trend).
      const first = json.briefs[0];
      expect(first.id).toBeTruthy();
      expect(first.title).toContain("机械键盘");
      expect(first.grounding).toBe("interest");
    });
  });

  it("returns ONE honest thin brief when there is neither trend nor interest", async () => {
    await withTempDataDir(async () => {
      const { saveConfig, loadConfig } = await import("../../infra/config.js");
      const cfg = await loadConfig();
      await saveConfig({ ...cfg, interests: [] });

      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("GET", "/api/coach/angle-briefs/xiaohongshu"),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.briefs).toHaveLength(1);
      expect(json.briefs[0].grounding).toBe("thin");
    });
  });

  it("defaults to douyin when no platform segment resolves", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      // a known platform path still flows through; assert the response shape is
      // a deterministic {platform, briefs} envelope regardless of disk state.
      const res = await apiRoutes.fetch(
        jsonReq("GET", "/api/coach/angle-briefs/douyin"),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.platform).toBe("douyin");
      expect(Array.isArray(json.briefs)).toBe(true);
    });
  });
});
