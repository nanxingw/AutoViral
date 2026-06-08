import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import { mkdir, mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

// The trends routes resolve their data dir from os.homedir() (production puts
// trends under ~/.autoviral/trends/<platform>). Earlier this test only set
// process.env.HOME = fakeHome to redirect homedir(), but that was FRAGILE: the
// routes `import { homedir } from "node:os"` and call it, and depending on
// platform/module-cache timing homedir() could return the startup-cached real
// home rather than re-reading $HOME — so a fresh-dated write (new Date()) once
// escaped isolation and CLOBBERED the real ~/.autoviral/trends/douyin/<today>.yaml
// with the fixture (title:'t', hook:'hook'). Fix: mock node:os at the module
// layer so EVERY caller (routes + this file's writeTrendsFile) deterministically
// gets the per-test fakeHome, regardless of env/cache/timing. (vi.spyOn fails on
// ESM — node:os named exports are non-configurable getters: "Cannot redefine
// property". vi.mock with a passthrough factory is the correct mechanism.)
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

const ITEM = (over: Record<string, unknown>) => ({
  id: String(over.id),
  platform: "douyin",
  title: over.title ?? "t",
  sourceUrl: "https://example.com/x",
  source: "agent_websearch",
  scrapedAt: "2026-05-01T00:00:00.000Z",
  cover: { url: "", aspect: "9:16" },
  metrics: null,
  analysis: {
    heat: over.heat ?? 3,
    competition: "中",
    opportunity: "蓝海",
    description: "a sufficiently long description",
    tags: over.tags ?? [],
    contentAngles: ["x", "y"],
    exampleHook: "hook",
    category: over.category ?? "其他",
  },
});

async function writeTrendsFile(platform: string, items: unknown[], dateStr: string) {
  // homedir() now resolves to the isolated fakeHome set in beforeEach.
  const dir = join(homedir(), ".autoviral", "trends", platform);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${dateStr}.yaml`),
    yaml.dump({ platform, items, collectedAt: `${dateStr}T00:00:00.000Z`, pipelineStatus: "ok" }),
  );
}

describe("GET /api/trends/:platform — B2 freshness", () => {
  it("flags month-old data as stale with ageDays, not pretending it is live", async () => {
    await withTempDataDir(async () => {
      await writeTrendsFile(
        "douyin",
        [ITEM({ id: "1" }), ITEM({ id: "2" }), ITEM({ id: "3" }), ITEM({ id: "4" }), ITEM({ id: "5" })],
        "2026-01-01",
      );
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/douyin"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { stale: boolean; ageDays: number; collectedAt: string };
      expect(body.collectedAt).toContain("2026-01-01");
      expect(body.ageDays).toBeGreaterThan(14);
      expect(body.stale).toBe(true);
    });
  });

  it("does not flag fresh data as stale", async () => {
    await withTempDataDir(async () => {
      const today = new Date().toISOString().slice(0, 10);
      await writeTrendsFile(
        "douyin",
        [ITEM({ id: "1" }), ITEM({ id: "2" }), ITEM({ id: "3" }), ITEM({ id: "4" }), ITEM({ id: "5" })],
        today,
      );
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/douyin"));
      const body = (await res.json()) as { stale: boolean; ageDays: number };
      expect(body.ageDays).toBeLessThanOrEqual(1);
      expect(body.stale).toBe(false);
    });
  });
});

describe("GET /api/trends/:platform — B6 platform allow-list guard", () => {
  it("404s an unknown platform without touching disk", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/bogusplatform"));
      expect(res.status).toBe(404);
    });
  });

  it("404s a path-traversal platform segment", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/..%2F..%2Fetc"));
      expect(res.status).toBe(404);
    });
  });
});

describe("GET /api/trends/:platform — interest-aware ranking", () => {
  it("ranks interest-matching trends above hotter off-topic ones", async () => {
    await withTempDataDir(async () => {
      await writeTrendsFile(
        "douyin",
        [
          ITEM({ id: "hot-food", heat: 5, category: "美食" }),
          ITEM({ id: "warm-fashion", heat: 3, category: "穿搭" }),
          ITEM({ id: "c", heat: 2 }),
          ITEM({ id: "d", heat: 2 }),
          ITEM({ id: "e", heat: 2 }),
        ],
        "2026-05-01",
      );
      const { saveConfig, loadConfig } = await import("../../infra/config.js");
      await saveConfig({ ...(await loadConfig()), interests: ["穿搭"] });

      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/douyin"));
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items[0].id).toBe("warm-fashion");
    });
  });
});

describe("POST /api/trends/refresh-stream — B6 guard (illegal platform not written)", () => {
  it("rejects an unknown platform with 400 and writes nothing to disk", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/trends/refresh-stream", { platform: "youtube/../../evil" }),
      );
      expect(res.status).toBe(400);
      // The illegal segment must never have created a directory under trends/.
      let names: string[] = [];
      try {
        names = await readdir(join(homedir(), ".autoviral", "trends"));
      } catch {
        names = [];
      }
      expect(names.some((n) => n.includes("evil"))).toBe(false);
    });
  });

  it("rejects a non-allow-list platform with 400", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/trends/refresh-stream", { platform: "bilibili" }),
      );
      expect(res.status).toBe(400);
    });
  });
});
