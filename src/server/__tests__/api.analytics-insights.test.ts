import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// PRD-0006 S12 — GET /api/analytics/insights runs the local insight agent,
// filters its output through D3 (insight-guardrail), and returns ONLY honest
// insights. The agent runner + works loader are injected through the domain
// orchestrator, mocked here so the route test never spawns a real CLI.

vi.mock("../../domain/generate-insights.js", () => ({
  generateHonestInsights: vi.fn(),
}));
vi.mock("../../infra/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  dataDir: "/tmp/autoviral-test",
  repoRoot: "/tmp/autoviral-test-repo",
}));

describe("GET /api/analytics/insights", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiRoutes } = await import("../api.js");
    app = new Hono().route("/", apiRoutes);
  });

  it("returns the D3-filtered insights from the orchestrator", async () => {
    const { generateHonestInsights } = await import("../../domain/generate-insights.js");
    (generateHonestInsights as any).mockResolvedValue([
      { date: "2026-03-20", body: "埃及奇遇播放 2705 最高，互动偏低。", tag: "互动" },
    ]);

    const res = await app.request("/api/analytics/insights");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toHaveLength(1);
    expect(body.insights[0].body).toContain("2705");
    expect(body.insights[0].tag).toBe("互动");
  });

  it("returns an empty list (200) when the agent yields nothing honest — never errors the page", async () => {
    const { generateHonestInsights } = await import("../../domain/generate-insights.js");
    (generateHonestInsights as any).mockResolvedValue([]);

    const res = await app.request("/api/analytics/insights");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toEqual([]);
  });

  it("degrades to an empty list (200) when the agent throws — honest, not a 500 page", async () => {
    const { generateHonestInsights } = await import("../../domain/generate-insights.js");
    (generateHonestInsights as any).mockRejectedValue(new Error("claude CLI not found"));

    const res = await app.request("/api/analytics/insights");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toEqual([]);
  });
});
