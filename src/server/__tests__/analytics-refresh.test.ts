import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Hoisted mocks. isCollectorAvailable defaults true so the existing
// happy/error paths run; the #72 test flips it to false.
vi.mock("../../domain/analytics-collector.js", () => ({
  collectData: vi.fn(),
  getLatestCreatorData: vi.fn(),
  getCreatorHistory: vi.fn(),
  isCollectorAvailable: vi.fn(() => true),
}));
vi.mock("../../infra/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  dataDir: "/tmp/autoviral-test",
  repoRoot: "/tmp/autoviral-test-repo",
}));

describe("POST /api/analytics/refresh", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks resets calls but NOT mockReturnValue, so re-assert the
    // default (available) here — otherwise the #72 test's false leaks into
    // the happy/error-path tests.
    const { isCollectorAvailable } = await import("../../domain/analytics-collector.js");
    (isCollectorAvailable as any).mockReturnValue(true);
    const { apiRoutes } = await import("../api.js");
    app = new Hono().route("/", apiRoutes);
  });

  it("returns 400 when douyinUrl is not configured", async () => {
    const { loadConfig } = await import("../../infra/config.js");
    (loadConfig as any).mockResolvedValue({ analytics: { douyinUrl: "" } });

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("douyin_url_missing");
  });

  // #72 — collector script removed in the refactor → honest 501 BEFORE any
  // douyinUrl / spawn logic, so the UI can explain instead of silent no-op.
  it("returns 501 analytics_collection_retired when the collector script is gone", async () => {
    const { isCollectorAvailable, collectData } = await import("../../domain/analytics-collector.js");
    (isCollectorAvailable as any).mockReturnValue(false);

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.errorCode).toBe("analytics_collection_retired");
    // The retired guard short-circuits before collectData is ever called.
    expect(collectData).not.toHaveBeenCalled();
  });

  it("returns 200 + collectedAt/worksCount on success", async () => {
    const { loadConfig } = await import("../../infra/config.js");
    const { collectData } = await import("../../domain/analytics-collector.js");
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
    const { loadConfig } = await import("../../infra/config.js");
    const { collectData } = await import("../../domain/analytics-collector.js");
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
