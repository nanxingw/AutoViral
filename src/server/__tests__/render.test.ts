import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

vi.mock("../remotion-renderer.js", () => ({
  renderCompositionToMp4: vi.fn(async () => "/tmp/fake.mp4"),
}));

describe("POST /api/works/:id/render", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 400 if composition missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/render`, {}),
      );
      expect(res.status).toBe(400);
    });
  });

  it("returns 404 if work missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/nope/render`, {}),
      );
      expect(res.status).toBe(404);
    });
  });

  it("returns 200 with output path when renderer mock resolves", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
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
        duration: 1,
        aspect: "9:16",
        tracks: [],
        updatedAt: "2026-04-25T00:00:00Z",
      };
      const put = await apiRoutes.fetch(
        jsonReq("PUT", `/api/works/${w.id}/composition`, comp),
      );
      expect(put.status).toBe(200);
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/render`, {}),
      );
      expect(res.status).toBe(200);
      const j: any = await res.json();
      expect(j.ok).toBe(true);
      expect(j.output).toContain("fake.mp4");
    });
  });
});
