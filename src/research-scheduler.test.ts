import { describe, it, expect, vi, beforeEach } from "vitest";

// #64 — the scheduler must read config.research and decide whether/how to fire.
// node-cron + config are mocked so we assert the scheduling DECISION without
// real timers or a real config file.
const { validate, schedule, stop, loadConfig } = vi.hoisted(() => ({
  validate: vi.fn((_expr: string) => true),
  schedule: vi.fn((_expr: string, _cb: () => void) => ({ stop: vi.fn() })),
  stop: vi.fn(),
  loadConfig: vi.fn(),
}));
vi.mock("node-cron", () => ({ default: { validate, schedule, getTasks: vi.fn() } }));
vi.mock("./config.js", () => ({ loadConfig }));

async function start() {
  vi.resetModules();
  const { startResearchScheduler } = await import("./research-scheduler.js");
  await startResearchScheduler();
}

describe("research scheduler (#64)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validate.mockReturnValue(true);
    schedule.mockReturnValue({ stop });
  });

  it("does not schedule when auto-research is disabled", async () => {
    loadConfig.mockResolvedValue({ research: { enabled: false, schedule: "0 9 * * *", platforms: [] } });
    await start();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not schedule when research config is entirely absent", async () => {
    loadConfig.mockResolvedValue({});
    await start();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("refuses an invalid cron instead of throwing inside cron.schedule", async () => {
    validate.mockReturnValue(false);
    loadConfig.mockResolvedValue({ research: { enabled: true, schedule: "not a cron", platforms: ["douyin"] } });
    await expect(start()).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("schedules with the configured cron when enabled + valid", async () => {
    loadConfig.mockResolvedValue({ research: { enabled: true, schedule: "7 9,21 * * *", platforms: ["douyin"] } });
    await start();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0][0]).toBe("7 9,21 * * *");
  });

  it("falls back to the default cron when schedule is blank", async () => {
    loadConfig.mockResolvedValue({ research: { enabled: true, schedule: "   ", platforms: [] } });
    await start();
    expect(schedule.mock.calls[0][0]).toBe("7 9,21 * * *");
  });
});
