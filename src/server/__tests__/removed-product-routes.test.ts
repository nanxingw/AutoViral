import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir } from "./_helpers.js";

const retiredRoutes: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/trends" },
  { method: "GET", path: "/api/trends/douyin" },
  { method: "GET", path: "/api/trends/douyin/report" },
  { method: "GET", path: "/api/trends/douyin/covers/missing" },
  { method: "POST", path: "/api/trends/refresh", body: {} },
  { method: "POST", path: "/api/trends/refresh-stream", body: { platform: "douyin" } },
  { method: "POST", path: "/api/trends/cancel/trends_douyin_1" },
  { method: "GET", path: "/api/analytics" },
  { method: "GET", path: "/api/analytics/creator" },
  { method: "GET", path: "/api/analytics/creator/history" },
  { method: "GET", path: "/api/analytics/insights" },
  { method: "POST", path: "/api/analytics/refresh" },
  { method: "POST", path: "/api/coach/message", body: { text: "hello" } },
  { method: "POST", path: "/api/coach/model", body: { model: "haiku" } },
  { method: "GET", path: "/api/coach/x" },
  { method: "GET", path: "/api/coach/angle-briefs/douyin" },
  {
    method: "GET",
    path: "/api/bridge/v1/trends",
  },
  { method: "GET", path: "/api/interests" },
  { method: "PUT", path: "/api/interests", body: { interests: ["video"] } },
  { method: "GET", path: "/api/zzz" },
];

function requestFor(route: (typeof retiredRoutes)[number]): Request {
  return new Request(`http://localhost${route.path}`, {
    method: route.method,
    headers: {
      "X-AutoViral-Work-Id": "removed-route-probe",
      ...(route.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  });
}

describe("PRD-0013 S4b retired server surface", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(retiredRoutes)("$method $path returns 404", async (route) => {
    await withTempDataDir(async (dir) => {
      await writeFile(join(dir, "index.html"), "<html>autoviral-spa</html>");
      const { createHttpApp } = await import("../index.js");
      const app = createHttpApp(dir);
      const res = await app.fetch(requestFor(route));
      expect(res.status).toBe(404);
      if (route.method === "GET") {
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    });
  });

  it("keeps non-API deep links on the SPA fallback", async () => {
    await withTempDataDir(async (dir) => {
      await writeFile(join(dir, "index.html"), "<html>autoviral-spa</html>");
      const { createHttpApp } = await import("../index.js");
      const app = createHttpApp(dir);
      const res = await app.fetch(new Request("http://localhost/explore"));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toBe("<html>autoviral-spa</html>");
    });
  });

  it("keeps works, per-work cost, and bridge profile routes available", async () => {
    await withTempDataDir(async (dir) => {
      await writeFile(join(dir, "index.html"), "<html>autoviral-spa</html>");
      const { createHttpApp } = await import("../index.js");
      const { CostLedger, setCostLedger } = await import("../cost-ledger/index.js");
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      const app = createHttpApp(dir);

      const works = await app.fetch(new Request("http://localhost/api/works"));
      const cost = await app.fetch(
        new Request("http://localhost/api/works/retained-work/cost"),
      );
      const profile = await app.fetch(
        new Request("http://localhost/api/bridge/v1/profile", {
          headers: { "X-AutoViral-Work-Id": "retained-work" },
        }),
      );

      expect(works.status).toBe(200);
      expect(cost.status).toBe(200);
      expect(profile.status).toBe(200);
      expect(await works.json()).toEqual({ works: [] });
      expect(await cost.json()).toMatchObject({ workId: "retained-work", totalUsd: 0 });
      expect(await profile.json()).toMatchObject({ ok: true });
    });
  });
});
