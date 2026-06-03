import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("/api/works/:id/carousel", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET returns 404 when carousel not yet saved", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
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
      const { createWork } = await import("../../domain/work-store.js");
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

describe("GET /api/works/:id/carousel — legacy synthesise (SV.I)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("synthesises a carousel from output/*.png when no carousel.yaml exists", async () => {
    await withTempDataDir(async (dir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "Legacy",
        type: "image-text",
        platforms: ["xiaohongshu"],
      });
      const outDir = join(dir, "works", w.id, "output");
      await writeFile(join(outDir, "page-01.png"), Buffer.alloc(8));
      await writeFile(join(outDir, "page-02.png"), Buffer.alloc(8));

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/carousel`),
      );
      expect(res.status).toBe(200);
      const body: {
        workId?: string;
        slides?: { id: string; bg: { type: string; value: string } }[];
      } = await res.json();
      expect(body.workId).toBe(w.id);
      expect(body.slides).toHaveLength(2);
      expect(body.slides?.[0].bg.type).toBe("image");
      expect(body.slides?.[0].bg.value).toMatch(/output\/page-01\.png$/);
    });
  });

  it("returns 404 for a short-video work (synthesise is image-text only)", async () => {
    await withTempDataDir(async (dir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "SV",
        type: "short-video",
        platforms: ["douyin"],
      });
      // Even with output/*.png present, short-video should NOT synthesise.
      const outDir = join(dir, "works", w.id, "output");
      await writeFile(join(outDir, "page-01.png"), Buffer.alloc(8));

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/carousel`),
      );
      expect(res.status).toBe(404);
    });
  });
});
