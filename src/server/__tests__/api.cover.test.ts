import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

beforeEach(() => {
  vi.resetModules();
});

describe("GET /api/trends/:platform/covers/:id", () => {
  it("returns 404 when cover file does not exist", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/youtube/covers/missing"));
      expect(res.status).toBe(404);
    });
  });

  it("returns 200 + image/jpeg when file exists", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const dir = join(homedir(), ".autoviral", "trends", "youtube", "covers");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "yt_test.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/youtube/covers/yt_test"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/image\/jpeg/);
    });
  });

  it("returns 400 when id contains traversal characters", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/youtube/covers/..%2Fpasswd"));
      expect([400, 404]).toContain(res.status);
    });
  });
});
