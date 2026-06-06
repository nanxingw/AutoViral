import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { CollectorRunError } from "../../domain/analytics-collector.js";

// Hoisted mocks. isCollectorAvailable defaults true so the existing
// happy/error paths run; the not-ready test flips it to false.
// CollectorRunError is re-exported by the real module above so the route's
// `instanceof CollectorRunError` branch works under the mock too.
vi.mock("../../domain/analytics-collector.js", async () => {
  const actual = await vi.importActual<typeof import("../../domain/analytics-collector.js")>(
    "../../domain/analytics-collector.js",
  );
  return {
    collectData: vi.fn(),
    getLatestCreatorData: vi.fn(),
    getCreatorHistory: vi.fn(),
    isCollectorAvailable: vi.fn(() => true),
    CollectorRunError: actual.CollectorRunError,
    isCollectorError: actual.isCollectorError,
  };
});
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

  // S5 — un-501. The collector is restored, but its managed venv may not be
  // provisioned yet → honest 503 collector_not_ready BEFORE any spawn, so the
  // UI points at `autoviral setup` instead of a silent no-op.
  it("returns 503 collector_not_ready when the managed venv isn't provisioned", async () => {
    const { isCollectorAvailable, collectData } = await import("../../domain/analytics-collector.js");
    (isCollectorAvailable as any).mockReturnValue(false);

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.errorCode).toBe("collector_not_ready");
    // The not-ready guard short-circuits before collectData is ever called.
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

  // S5 — an expired / missing cookie is an actionable re-login, not an opaque
  // 500. The route maps a needsRelogin CollectorError → 401 collector_relogin.
  it("returns 401 collector_relogin for an expired-cookie CollectorError", async () => {
    const { loadConfig } = await import("../../infra/config.js");
    const { collectData } = await import("../../domain/analytics-collector.js");
    (loadConfig as any).mockResolvedValue({
      analytics: { douyinUrl: "https://www.douyin.com/user/abc" },
    });
    (collectData as any).mockRejectedValue(
      new CollectorRunError({
        kind: "collector_error",
        code: "NOT_LOGGED_IN",
        message: "Log in to douyin.com first, then close the browser and retry.",
        needsRelogin: true,
      }),
    );

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.errorCode).toBe("collector_relogin");
    expect(body.collectorCode).toBe("NOT_LOGGED_IN");
  });

  // S5 — a missing managed dep surfaced mid-run → 503, not 500.
  it("returns 503 collect_failed for a DEPENDENCY_ERROR CollectorError", async () => {
    const { loadConfig } = await import("../../infra/config.js");
    const { collectData } = await import("../../domain/analytics-collector.js");
    (loadConfig as any).mockResolvedValue({
      analytics: { douyinUrl: "https://www.douyin.com/user/abc" },
    });
    (collectData as any).mockRejectedValue(
      new CollectorRunError({
        kind: "collector_error",
        code: "DEPENDENCY_ERROR",
        message: "f2 not installed. Run `autoviral setup`.",
        needsRelogin: false,
      }),
    );

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.errorCode).toBe("collect_failed");
    expect(body.collectorCode).toBe("DEPENDENCY_ERROR");
  });

  it("returns 500 collect_failed when collectData throws a plain Error", async () => {
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
