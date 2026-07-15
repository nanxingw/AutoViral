import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// CRITICAL isolation: config.ts freezes `dataDir` (= AUTOVIRAL_DATA_DIR) into a
// module-level const at first import. Without resetModules, a cached api.js
// imported by an earlier test file keeps dataDir pointed at the REAL
// ~/.autoviral, and this endpoint's saveConfig would clobber the user's actual
// config.yaml. resetModules forces a fresh import inside withTempDataDir (env
// already set) so dataDir re-freezes to the temp dir. Mirrors api.works-tts.test.
beforeEach(() => {
  vi.resetModules();
});

// POST /api/agent/model — switch the creative agent's model TIER (alias).
// The endpoint persists the bare alias (opus/sonnet/haiku) to config.model; the
// CLI resolves the alias to the latest version of that family at spawn time.
describe("POST /api/agent/model", () => {
  it("400 rejects a non-alias value (only fable/opus/sonnet/haiku allowed)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/agent/model", { model: "claude-opus-4-7" }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.errorCode).toBe("invalid_model_alias");
      expect(json.allowed).toEqual(["fable", "opus", "sonnet", "haiku"]);
    });
  });

  it("400 rejects a missing model field", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("POST", "/api/agent/model", {}));
      expect(res.status).toBe(400);
    });
  });

  it("200 persists a valid alias to config.model (visible via /api/status)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      // switch to sonnet
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/agent/model", { model: "sonnet" }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ok).toBe(true);
      expect(json.model).toBe("sonnet");

      // /api/status reflects the persisted alias (loadConfig reads fresh).
      const status: any = await (await apiRoutes.fetch(jsonReq("GET", "/api/status"))).json();
      expect(status.model).toBe("sonnet");
    });
  });

  it("round-trips opus → haiku → opus, each persisting", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      for (const alias of ["opus", "fable", "haiku", "opus"]) {
        const res = await apiRoutes.fetch(
          jsonReq("POST", "/api/agent/model", { model: alias }),
        );
        expect(res.status).toBe(200);
        const status: any = await (await apiRoutes.fetch(jsonReq("GET", "/api/status"))).json();
        expect(status.model).toBe(alias);
      }
    });
  });

  it("reports respawned:false when no workId / no live session to kill", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/agent/model", { model: "opus" }),
      );
      const json: any = await res.json();
      expect(json.respawned).toBe(false);
    });
  });

  // PRD-0015 W3.5 H2 — model_switch semantics: a live background task must NOT be
  // aborted by a tier switch. The route GATES with a real 409 (HTTP-reachable) when
  // the work's session has an active bg task — config unchanged, session untouched.
  it("409 rejects a tier switch while the work's session has an active bg task", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const killSession = vi.fn();
      setWsBridge({
        sessionHasActiveTasks: (id: string) => id === "w_busy",
        killSession,
      } as any);
      try {
        const res = await apiRoutes.fetch(
          jsonReq("POST", "/api/agent/model", { model: "sonnet", workId: "w_busy" }),
        );
        expect(res.status).toBe(409);
        const json: any = await res.json();
        expect(json.errorCode).toBe("busy_background_task");
        expect(typeof json.error).toBe("string");
        expect(json.error.length).toBeGreaterThan(0);
        // Session was NOT killed and config was NOT changed (still the default).
        expect(killSession).not.toHaveBeenCalled();
        const status: any = await (await apiRoutes.fetch(jsonReq("GET", "/api/status"))).json();
        expect(status.model).not.toBe("sonnet");
      } finally {
        setWsBridge(null as any);
      }
    });
  });

  // W4.5 M8 — the gate + respawn must target the SESSION the user is on. A named
  // session (s_2) with a live bg task 409s just like the default; the sessionId is
  // threaded to sessionHasActiveTasks + killSession.
  it("409 rejects a tier switch when a NAMED session has an active bg task (sessionId threaded)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const seen: Array<string | undefined> = [];
      const killSession = vi.fn();
      setWsBridge({
        // Busy ONLY for (w1, s_2) — a default-session check must NOT 409.
        sessionHasActiveTasks: (id: string, sid?: string) => {
          seen.push(sid);
          return id === "w1" && sid === "s_2";
        },
        killSession,
      } as any);
      try {
        const res = await apiRoutes.fetch(
          jsonReq("POST", "/api/agent/model", { model: "sonnet", workId: "w1", sessionId: "s_2" }),
        );
        expect(res.status).toBe(409);
        const json: any = await res.json();
        expect(json.errorCode).toBe("busy_background_task");
        // The named session id reached the bridge (not swallowed → default).
        expect(seen).toContain("s_2");
        expect(killSession).not.toHaveBeenCalled();
      } finally {
        setWsBridge(null as any);
      }
    });
  });

  it("200 threads the sessionId into killSession on respawn", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const killSession = vi.fn().mockReturnValue(true);
      setWsBridge({
        sessionHasActiveTasks: () => false,
        killSession,
      } as any);
      try {
        const res = await apiRoutes.fetch(
          jsonReq("POST", "/api/agent/model", { model: "haiku", workId: "w1", sessionId: "s_2" }),
        );
        expect(res.status).toBe(200);
        expect(killSession).toHaveBeenCalledWith("w1", "s_2");
      } finally {
        setWsBridge(null as any);
      }
    });
  });

  it("200 respawns the session when workId given and NO active bg task", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const killSession = vi.fn().mockReturnValue(true);
      setWsBridge({
        sessionHasActiveTasks: () => false,
        killSession,
      } as any);
      try {
        const res = await apiRoutes.fetch(
          jsonReq("POST", "/api/agent/model", { model: "haiku", workId: "w_idle" }),
        );
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.respawned).toBe(true);
        expect(killSession).toHaveBeenCalledWith("w_idle", undefined);
      } finally {
        setWsBridge(null as any);
      }
    });
  });
});
