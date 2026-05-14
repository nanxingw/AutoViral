// Bridge router smoke tests. Phase 0 only exercises whoami — the rest of
// the surface grows in Phase 2-3 with corresponding tests. See
// docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { bridgeRouter } from "../routes.js";

const app = new Hono().route("/api/bridge/v1", bridgeRouter);

describe("bridge router — Phase 0", () => {
  it("GET /whoami echoes the workId header + returns version", async () => {
    const res = await app.request("/api/bridge/v1/whoami", {
      headers: { "X-AutoViral-Work-Id": "w_test_001" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { workId: string; cwd: string; port: number; version: string };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.workId).toBe("w_test_001");
    expect(body.result?.cwd).toMatch(/\.autoviral\/works\/w_test_001$/);
    expect(typeof body.result?.port).toBe("number");
    expect(body.result?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("GET /whoami without header → 400 with code 4", async () => {
    const res = await app.request("/api/bridge/v1/whoami");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; code?: number };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/X-AutoViral-Work-Id/);
    expect(body.code).toBe(4);
  });
});
