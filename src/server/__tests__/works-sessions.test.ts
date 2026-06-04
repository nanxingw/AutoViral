import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// I24 — HTTP surface for ADR-008 multi-session chat:
//   GET    /api/works/:id/sessions          → wsBridge.listSessions
//   POST   /api/works/:id/sessions          → wsBridge.createNewSession
//   DELETE /api/works/:id/sessions/:sid      → wsBridge.deleteSession
//
// These reuse the SAME WsBridge singleton the server constructs (via
// setWsBridge), so the in-memory session map and the `.sessions.jsonl` sidecar
// stay consistent. We construct one real WsBridge against the temp dataDir
// (noServer WebSocketServer — no port bind) and exercise the routes through
// apiRoutes.fetch.

// config.ts freezes dataDir at first import; resetModules + withTempDataDir
// re-freezes it to the temp dir so the sidecar writes there, not ~/.autoviral.
beforeEach(() => vi.resetModules());

/** Wire a real WsBridge into the api singleton and return it. */
async function wireBridge() {
  const { apiRoutes, setWsBridge } = await import("../api.js");
  const { WsBridge } = await import("../../ws-bridge.js");
  const bridge = new WsBridge(0);
  setWsBridge(bridge);
  return { apiRoutes, setWsBridge, bridge };
}

describe("works session HTTP endpoints (I24)", () => {
  it("GET returns [] for a fresh never-chatted work", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });

      const res = await apiRoutes.fetch(jsonReq("GET", `/api/works/${work.id}/sessions`));
      expect(res.status).toBe(200);
      const json: any = await res.json();
      // A work with no chat history and no cliSessionId migrates to nothing yet.
      expect(json.sessions).toEqual([]);
    });
  });

  it("POST creates a new session and GET then lists it (round-trip)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });

      // First "new chat" seeds the default s_1 AND mints s_2.
      const createRes = await apiRoutes.fetch(jsonReq("POST", `/api/works/${work.id}/sessions`));
      expect(createRes.status).toBe(201);
      const created: any = await createRes.json();
      expect(created.session.id).toBe("s_2");
      expect(created.session.surface).toBe("chat");
      expect(created.session.archived).toBe(false);

      const listRes = await apiRoutes.fetch(jsonReq("GET", `/api/works/${work.id}/sessions`));
      const listed: any = await listRes.json();
      const ids = listed.sessions.map((s: any) => s.id);
      // Both the migrated default and the new session are present.
      expect(ids).toEqual(["s_1", "s_2"]);
    });
  });

  it("DELETE removes a non-default session (round-trip with GET)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });

      // Create s_2 then s_3.
      await apiRoutes.fetch(jsonReq("POST", `/api/works/${work.id}/sessions`));
      const r3: any = await (await apiRoutes.fetch(jsonReq("POST", `/api/works/${work.id}/sessions`))).json();
      expect(r3.session.id).toBe("s_3");

      const delRes = await apiRoutes.fetch(
        jsonReq("DELETE", `/api/works/${work.id}/sessions/s_2`),
      );
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ deleted: true });

      const listed: any = await (await apiRoutes.fetch(jsonReq("GET", `/api/works/${work.id}/sessions`))).json();
      const ids = listed.sessions.map((s: any) => s.id);
      expect(ids).toEqual(["s_1", "s_3"]); // s_2 gone, s_1 + s_3 remain
    });
  });

  it("DELETE 404s on an unknown session id", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      // Seed s_1 so the work has a sidecar but s_99 still doesn't exist.
      await apiRoutes.fetch(jsonReq("POST", `/api/works/${work.id}/sessions`));

      const res = await apiRoutes.fetch(
        jsonReq("DELETE", `/api/works/${work.id}/sessions/s_99`),
      );
      expect(res.status).toBe(404);
      expect((await res.json()).errorCode).toBe("session_not_found");
    });
  });

  it("DELETE refuses to remove the default session s_1", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      await apiRoutes.fetch(jsonReq("POST", `/api/works/${work.id}/sessions`));

      const res = await apiRoutes.fetch(
        jsonReq("DELETE", `/api/works/${work.id}/sessions/s_1`),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).errorCode).toBe("session_delete_default");
    });
  });

  it("rejects ids that fail SAFE_ID (a dotted id is a clean segment SAFE_ID rejects)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();

      // Bad workId on GET — a dotted id passes URL parsing but fails SAFE_ID
      // (^[A-Za-z0-9_-]+$), so the guard 400s before touching the bridge/FS.
      const badWork = await apiRoutes.fetch(jsonReq("GET", `/api/works/evil.id/sessions`));
      expect(badWork.status).toBe(400);
      expect((await badWork.json()).errorCode).toBe("invalid_work_id");

      // Bad sessionId on DELETE (contains a dot — fails SAFE_ID).
      const badSid = await apiRoutes.fetch(
        jsonReq("DELETE", `/api/works/w_ok/sessions/s.1`),
      );
      expect(badSid.status).toBe(400);
      expect((await badSid.json()).errorCode).toBe("invalid_session_id");
    });
  });

  it("503s when no WsBridge is wired", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      // Explicitly clear any bridge left by a prior test in this module.
      setWsBridge(null as any);
      const res = await apiRoutes.fetch(jsonReq("GET", `/api/works/w_x/sessions`));
      expect(res.status).toBe(503);
    });
  });
});
