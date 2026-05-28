import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// History — this file used to assert the OPPOSITE invariant ("D3 cleanup":
// researchEnabled / researchCron should NOT appear on /api/config). That cleanup
// was only half-done: the server side dropped the flat keys, but the entire web
// frontend (SettingsPanel + queries/config + msw fixtures + SettingsPanel.test)
// kept reading/writing them. The "auto-research never fires" symptom that #64
// reported was the cleanup's collateral — Settings posted those keys, the server
// silently ignored them, no scheduler ran. #64 re-wired the flat keys to the
// nested config.research.{enabled,schedule} persistence + boot a scheduler that
// consumes them. These tests now assert the *post-#64* contract: the flat keys
// are part of the API surface, GET reflects defaults, PUT round-trips through
// the nested store.
describe("/api/config — researchEnabled / researchCron round-trip (post-#64)", () => {
  beforeEach(() => vi.resetModules());

  it("GET exposes researchEnabled (boolean) and researchCron (5-field expr)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(new Request("http://localhost/api/config"));
      const j = (await res.json()) as { researchEnabled: unknown; researchCron: unknown };
      expect(j).toHaveProperty("researchEnabled");
      expect(j).toHaveProperty("researchCron");
      // Whichever default the server seeds, the shape must hold so the
      // Settings form (and the scheduler) can bind to a typed value.
      expect(typeof j.researchEnabled).toBe("boolean");
      expect(typeof j.researchCron).toBe("string");
      expect((j.researchCron as string).trim().split(/\s+/).length).toBe(5);
    });
  });

  it("PUT persists researchEnabled / researchCron and a subsequent GET reflects them", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const put = await apiRoutes.fetch(jsonReq("PUT", "/api/config", {
        researchEnabled: true,
        researchCron: "0 9 * * *",
      }));
      expect(put.status).toBe(200);
      const after = (await (
        await apiRoutes.fetch(new Request("http://localhost/api/config"))
      ).json()) as { researchEnabled: boolean; researchCron: string };
      expect(after.researchEnabled).toBe(true);
      expect(after.researchCron).toBe("0 9 * * *");
    });
  });

  it("PUT with an invalid cron expression is rejected (400 invalid_cron) and state is unchanged", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      // First take a baseline.
      const before = (await (
        await apiRoutes.fetch(new Request("http://localhost/api/config"))
      ).json()) as { researchCron: string };

      const res = await apiRoutes.fetch(jsonReq("PUT", "/api/config", {
        researchCron: "this is not a cron",
      }));
      expect(res.status).toBe(400);

      const after = (await (
        await apiRoutes.fetch(new Request("http://localhost/api/config"))
      ).json()) as { researchCron: string };
      // Reject must not partially apply — the rejected value must NOT have
      // overwritten the previous schedule.
      expect(after.researchCron).toBe(before.researchCron);
    });
  });
});
