import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("/api/config — D3 cleanup", () => {
  beforeEach(() => vi.resetModules());

  it("GET response does not contain researchEnabled / researchCron", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(new Request("http://localhost/api/config"));
      const j = await res.json();
      expect(j).not.toHaveProperty("researchEnabled");
      expect(j).not.toHaveProperty("researchCron");
    });
  });

  it("PUT silently ignores legacy researchEnabled / researchCron fields", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("PUT", "/api/config", {
        researchEnabled: true,
        researchCron: "0 9 * * *",
      }));
      expect(res.status).toBe(200);
      const after = await (await apiRoutes.fetch(new Request("http://localhost/api/config"))).json();
      expect(after).not.toHaveProperty("researchEnabled");
      expect(after).not.toHaveProperty("researchCron");
    });
  });
});
