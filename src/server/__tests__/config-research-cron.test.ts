import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// #64 — PUT /api/config must validate research cron BEFORE persisting, so an
// invalid expression can't be saved (it would later throw in cron.schedule and
// silently kill the research scheduler). node-cron runs for real here; config +
// scheduler are mocked.
const { loadConfig, saveConfig, restartResearchScheduler } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  restartResearchScheduler: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  loadConfig,
  saveConfig,
  dataDir: "/tmp/autoviral-test",
  repoRoot: "/tmp/autoviral-test-repo",
}));
vi.mock("../../research-scheduler.js", () => ({ restartResearchScheduler }));

describe("PUT /api/config research cron validation (#64)", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    loadConfig.mockResolvedValue({
      research: { enabled: true, schedule: "7 9,21 * * *", platforms: ["douyin"] },
    });
    saveConfig.mockResolvedValue(undefined);
    const { apiRoutes } = await import("../api.js");
    app = new Hono().route("/", apiRoutes);
  });

  it("rejects an invalid cron with 400 + invalid_cron and never persists it", async () => {
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ researchCron: "every tuesday-ish" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe("invalid_cron");
    expect(saveConfig).not.toHaveBeenCalled();
    expect(restartResearchScheduler).not.toHaveBeenCalled();
  });

  it("accepts a valid cron, persists it, and restarts the scheduler live", async () => {
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ researchCron: "0 9 * * *" }),
    });
    expect(res.status).toBe(200);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const saved = saveConfig.mock.calls[0][0] as { research: { schedule: string } };
    expect(saved.research.schedule).toBe("0 9 * * *");
    expect(restartResearchScheduler).toHaveBeenCalledTimes(1);
  });

  it("restarts the scheduler when only the enabled flag is toggled", async () => {
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ researchEnabled: false }),
    });
    expect(res.status).toBe(200);
    expect(restartResearchScheduler).toHaveBeenCalledTimes(1);
  });
});
