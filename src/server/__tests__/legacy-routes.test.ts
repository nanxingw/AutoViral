import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("legacy stage routes are gone", () => {
  beforeEach(() => vi.resetModules());

  it("POST /api/works/:id/step/:key returns 410", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      setWsBridge({ getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() } as any);
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(jsonReq("POST", `/api/works/${w.id}/step/research`, {}));
      expect(res.status).toBe(410);
      const j = await res.json();
      expect(j.error).toMatch(/invoke/i);
    });
  });

  it("POST /api/works/:id/pipeline/advance returns 410", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      setWsBridge({ getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() } as any);
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(jsonReq("POST", `/api/works/${w.id}/pipeline/advance`, {
        completedStep: "research", nextStep: "planning",
      }));
      expect(res.status).toBe(410);
    });
  });

  it("PATCH /api/works/:id/evaluation-mode returns 410 (eval gate gone)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      setWsBridge({ getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() } as any);
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(jsonReq("PATCH", `/api/works/${w.id}/evaluation-mode`, {}));
      expect(res.status).toBe(410);
    });
  });
});
