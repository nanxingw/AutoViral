import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("/api/works/:id/carousel", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET returns 404 when carousel not yet saved", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "T",
        type: "image-text",
        platforms: ["xiaohongshu"],
      });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/carousel`),
      );
      expect(res.status).toBe(404);
    });
  });

  it("PUT saves and GET returns same payload", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "T",
        type: "image-text",
        platforms: ["xiaohongshu"],
      });
      const car = {
        id: "car1",
        workId: w.id,
        width: 1080,
        height: 1350,
        globals: {
          headlineFont: "serif",
          palette: "mono",
          layout: "centered",
          effects: { grain: 0.03, gradient: 0.5, sharpen: 0 },
        },
        slides: [
          {
            id: "s1",
            bg: { type: "solid", value: "#fff" },
            layers: [],
          },
        ],
        updatedAt: "2026-04-25T00:00:00Z",
      };
      const put = await apiRoutes.fetch(
        jsonReq("PUT", `/api/works/${w.id}/carousel`, car),
      );
      expect(put.status).toBe(200);
      const get = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/carousel`),
      );
      expect(get.status).toBe(200);
      const j: { id?: string; slides?: unknown[] } = await get.json();
      expect(j.id).toBe("car1");
      expect(Array.isArray(j.slides)).toBe(true);
    });
  });

  it("PUT on missing work returns 404", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("PUT", `/api/works/nope/carousel`, { id: "c" }),
      );
      expect(res.status).toBe(404);
    });
  });
});
