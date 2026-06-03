import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("/api/works/:id/composition", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET returns 404 when composition not yet saved", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/composition`),
      );
      expect(res.status).toBe(404);
    });
  });

  it("PUT saves and GET returns same payload", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const comp = {
        id: "c1",
        workId: w.id,
        fps: 30,
        width: 1080,
        height: 1920,
        duration: 0,
        aspect: "9:16",
        tracks: [],
        updatedAt: "2026-04-25T00:00:00Z",
      };
      const put = await apiRoutes.fetch(
        jsonReq("PUT", `/api/works/${w.id}/composition`, comp),
      );
      expect(put.status).toBe(200);
      const get = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/composition`),
      );
      expect(get.status).toBe(200);
      const j: any = await get.json();
      expect(j.id).toBe("c1");
      expect(j.fps).toBe(30);
    });
  });

  it("PUT on missing work returns 404", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("PUT", `/api/works/nope/composition`, { id: "c" }),
      );
      expect(res.status).toBe(404);
    });
  });
});
