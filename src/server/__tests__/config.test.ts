import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonReq, withTempDataDir } from "./_helpers.js";

const RETIRED_KEYS = [
  "research",
  "analytics",
  "interests",
  "douyinUrl",
  "researchEnabled",
  "researchCron",
  "analyticsLastCollectedAt",
] as const;

describe("/api/config — PRD-0013 retired config compatibility", () => {
  beforeEach(() => vi.resetModules());

  it("loads legacy YAML without exposing retired config or rewriting the file", async () => {
    await withTempDataDir(async (dir) => {
      const path = join(dir, "config.yaml");
      const legacy = [
        "port: 4411",
        "model: sonnet",
        "research:",
        "  enabled: true",
        "  schedule: not-a-valid-cron",
        "analytics:",
        "  douyinUrl: https://www.douyin.com/user/legacy",
        "  enabled: true",
        "  collectInterval: 60",
        "interests:",
        "  - video",
        "",
      ].join("\n");
      await writeFile(path, legacy, "utf-8");

      const { loadConfig } = await import("../../infra/config.js");
      const config = await loadConfig() as unknown as Record<string, unknown>;

      expect(config.port).toBe(4411);
      expect(config.model).toBe("sonnet");
      expect(config).not.toHaveProperty("research");
      expect(config).not.toHaveProperty("analytics");
      expect(config).not.toHaveProperty("interests");
      expect(await readFile(path, "utf-8")).toBe(legacy);
    });
  });

  it("GET omits every retired field", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(new Request("http://localhost/api/config"));
      const body = await res.json() as Record<string, unknown>;

      expect(res.status).toBe(200);
      for (const key of RETIRED_KEYS) expect(body).not.toHaveProperty(key);
    });
  });

  it("PUT silently ignores retired flat fields, including an invalid legacy cron", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("PUT", "/api/config", {
        model: "sonnet",
        douyinUrl: "https://www.douyin.com/user/ignored",
        researchEnabled: true,
        researchCron: "this is not a cron",
      }));
      const body = await res.json() as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.model).toBe("sonnet");
      for (const key of RETIRED_KEYS) expect(body).not.toHaveProperty(key);

      const persisted = await readFile(join(process.env.AUTOVIRAL_DATA_DIR!, "config.yaml"), "utf-8");
      expect(persisted).not.toMatch(/research|analytics|interests|douyinUrl/);
    });
  });
});
