import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("POST /api/works/:id/invoke", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 202 and triggers a session for a valid module", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      // Stub WsBridge — invoke endpoint only needs createSession/getSession/sendMessage shape.
      const stub: any = {
        getSession: vi.fn().mockReturnValue(undefined),
        createSession: vi.fn().mockResolvedValue({ workId: "x" }),
        sendMessage: vi.fn().mockResolvedValue(true),
      };
      setWsBridge(stub);

      const work = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${work.id}/invoke`, { module: "research", input: "topic X" }),
      );
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toMatchObject({ triggered: true, workId: work.id, module: "research" });
    });
  });

  it("rejects unknown module with 400", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const stub: any = { getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() };
      setWsBridge(stub);

      const work = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${work.id}/invoke`, { module: "publish" }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("rejects missing work with 404", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const stub: any = { getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() };
      setWsBridge(stub);

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/nope/invoke`, { module: "research" }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("does NOT enforce ordering — assembly module callable first", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const stub: any = {
        getSession: vi.fn().mockReturnValue(undefined),
        createSession: vi.fn().mockResolvedValue({ workId: "x" }),
        sendMessage: vi.fn().mockResolvedValue(true),
      };
      setWsBridge(stub);

      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${work.id}/invoke`, { module: "assembly", input: "render now" }),
      );
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.module).toBe("assembly");
    });
  });
});
