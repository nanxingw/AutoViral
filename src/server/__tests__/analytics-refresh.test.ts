import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Hoisted mocks
vi.mock("../../analytics-collector.js", () => ({
  collectData: vi.fn(),
  getLatestCreatorData: vi.fn(),
  getCreatorHistory: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  dataDir: "/tmp/autoviral-test",
  repoRoot: "/tmp/autoviral-test-repo",
}));

describe("POST /api/analytics/refresh", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiRoutes } = await import("../api.js");
    app = new Hono().route("/", apiRoutes);
  });

  it("returns 400 when douyinUrl is not configured", async () => {
    const { loadConfig } = await import("../../config.js");
    (loadConfig as any).mockResolvedValue({ analytics: { douyinUrl: "" } });

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("douyin_url_missing");
  });

  it("returns 200 + collectedAt/worksCount on success", async () => {
    const { loadConfig } = await import("../../config.js");
    const { collectData } = await import("../../analytics-collector.js");
    (loadConfig as any).mockResolvedValue({
      analytics: { douyinUrl: "https://www.douyin.com/user/abc" },
    });
    (collectData as any).mockResolvedValue({
      collected_at: "2026-05-11T08:00:00Z",
      works: [{ aweme_id: "1" }, { aweme_id: "2" }],
    });

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collectedAt).toBe("2026-05-11T08:00:00Z");
    expect(body.worksCount).toBe(2);
  });

  it("returns 500 when collectData fails", async () => {
    const { loadConfig } = await import("../../config.js");
    const { collectData } = await import("../../analytics-collector.js");
    (loadConfig as any).mockResolvedValue({
      analytics: { douyinUrl: "https://www.douyin.com/user/abc" },
    });
    (collectData as any).mockRejectedValue(new Error("python script crashed"));

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.errorCode).toBe("collect_failed");
  });
});
