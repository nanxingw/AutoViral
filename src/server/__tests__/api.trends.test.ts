import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import { mkdir, mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

// The trends routes resolve their data dir from os.homedir() (production puts
// trends under ~/.autoviral/trends/<platform>), NOT AUTOVIRAL_DATA_DIR. Override
// HOME to an isolated tmp dir so tests never read or pollute the real user dir.
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let fakeHome: string;

beforeEach(async () => {
  vi.resetModules();
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  fakeHome = await mkdtemp(join(tmpdir(), "av-home-"));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(fakeHome, { recursive: true, force: true });
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
