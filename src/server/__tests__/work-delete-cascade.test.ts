import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// Hoisted mocks — only mock what we need to intercept. api.ts has many
// top-level imports; we only override work-store (the unit under test) and
// config (to avoid filesystem touches).
vi.mock("../../domain/work-store.js", () => ({
  listWorks: vi.fn(),
  getWork: vi.fn(),
  createWork: vi.fn(),
  updateWork: vi.fn(),
  deleteWork: vi.fn(),
  listAssets: vi.fn(),
  getAssetPath: vi.fn(),
  saveWorkChat: vi.fn(),
}));
vi.mock("../../infra/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({ analytics: { douyinUrl: "" } }),
  saveConfig: vi.fn(),
  dataDir: "/tmp/autoviral-test",
  repoRoot: "/tmp/autoviral-test-repo",
}));

describe("DELETE /api/works/:id — in-flight protection", () => {
  let app: Hono;
  // PRD-0015 W3.5 H3 — the delete cascade now kills ALL of a work's chat sessions
  // (killAllSessions), not just the default one keyed off work.cliSessionId.
  const killAllSessionsMock = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    killAllSessionsMock.mockReset();
    const { apiRoutes, setWsBridge } = await import("../api.js");
    setWsBridge({
      killSession: vi.fn(),
      killAllSessions: killAllSessionsMock,
      getSession: vi.fn(),
      createSession: vi.fn(),
      sendMessage: vi.fn(),
    } as any);
    app = new Hono().route("/", apiRoutes);
  });

  afterEach(async () => {
    // Reset module-level wsBridge so other tests in the same worker
    // don't inherit our mock (vitest reuses workers with maxForks=2).
    const { setWsBridge } = await import("../api.js");
    setWsBridge(null as any);
  });

  it("kills ALL sessions before deleting a creating work", async () => {
    const { getWork, deleteWork } = await import("../../domain/work-store.js");
    const callOrder: string[] = [];
    (getWork as any).mockResolvedValue({
      id: "w_test_creating",
      status: "creating",
      cliSessionId: "sess_abc",
    });
    killAllSessionsMock.mockImplementation(() => {
      callOrder.push("kill");
      return 2;
    });
    (deleteWork as any).mockImplementation(() => {
      callOrder.push("delete");
      return Promise.resolve(true);
    });

    const res = await app.request("/api/works/w_test_creating", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["kill", "delete"]);
    // H3 — kills EVERY session (not just work.cliSessionId's default), before delete.
    expect(killAllSessionsMock).toHaveBeenCalledWith("w_test_creating", "work_delete");
  });

  it("calls killAllSessions even when work has no cliSessionId (no-op returns 0)", async () => {
    const { getWork, deleteWork } = await import("../../domain/work-store.js");
    (getWork as any).mockResolvedValue({ id: "w_done", status: "ready" });
    killAllSessionsMock.mockReturnValue(0);
    (deleteWork as any).mockResolvedValue(true);

    const res = await app.request("/api/works/w_done", { method: "DELETE" });
    expect(res.status).toBe(200);
    // Always routed through killAllSessions (safe no-op when no in-memory sessions).
    expect(killAllSessionsMock).toHaveBeenCalledWith("w_done", "work_delete");
  });

  it("returns 404 when work does not exist", async () => {
    const { getWork } = await import("../../domain/work-store.js");
    (getWork as any).mockResolvedValue(null);

    const res = await app.request("/api/works/w_missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errorCode).toBe("work_not_found");
  });
});
