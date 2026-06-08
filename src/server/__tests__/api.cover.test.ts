import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

// The cover route resolves its dir from os.homedir() (NOT AUTOVIRAL_DATA_DIR),
// so withTempDataDir alone does NOT isolate it — this test used to writeFile a
// yt_test.jpg straight into the REAL ~/.autoviral/trends/youtube/covers/. Mock
// node:os at the module layer so homedir() resolves to a per-test temp dir.
// (Same fragility/fix as api.trends.test.ts — see its header note.)
let fakeHome = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome || actual.homedir() };
});

beforeEach(async () => {
  vi.resetModules();
  fakeHome = await mkdtemp(join(tmpdir(), "av-home-"));
});

afterEach(async () => {
  const used = fakeHome;
  fakeHome = "";
  await rm(used, { recursive: true, force: true });
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
