import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// dataDir freezes at first import — resetModules so each test re-imports api.js
// against the temp dir (and a fresh _shared WsBridge singleton). Mirrors
// api.agent-model.test isolation.
beforeEach(() => {
  vi.resetModules();
});

/** A minimal fake WsBridge recording the coach-relevant calls. */
function makeFakeBridge() {
  const calls = {
    createCoachSession: [] as Array<{ key: string; text: string; opts: unknown }>,
    setSessionModel: [] as Array<{ key: string; model: string }>,
    recordUserMessage: [] as string[],
    sendMessage: [] as string[],
  };
  let session: { cliSessionId?: string } | undefined;
  const bridge = {
    getSession: () => session,
    createCoachSession: async (key: string, text: string, opts: unknown) => {
      calls.createCoachSession.push({ key, text, opts });
      session = { cliSessionId: "uuid-coach-1" };
      return {};
    },
    sendMessage: async (key: string, text: string) => {
      calls.sendMessage.push(text);
      return true;
    },
    recordUserMessage: (_key: string, text: string) => {
      calls.recordUserMessage.push(text);
    },
    setSessionModel: (key: string, model: string) => {
      calls.setSessionModel.push({ key, model });
      return true;
    },
  };
  return { bridge, calls };
}

describe("POST /api/coach/message", () => {
  it("400 when text is empty", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { setWsBridge } = await import("../routes/_shared.js");
      const { bridge } = makeFakeBridge();
      setWsBridge(bridge as never);
      const res = await apiRoutes.fetch(jsonReq("POST", "/api/coach/message", { text: "  " }));
      expect(res.status).toBe(400);
    });
  });

  it("503 when WsBridge not initialized", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { setWsBridge } = await import("../routes/_shared.js");
      setWsBridge(null as never);
      const res = await apiRoutes.fetch(jsonReq("POST", "/api/coach/message", { text: "hi" }));
      expect(res.status).toBe(503);
    });
  });

  it("first turn creates the PERSISTED coach session keyed coach_main (not trends_)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { setWsBridge } = await import("../routes/_shared.js");
      const { bridge, calls } = makeFakeBridge();
      setWsBridge(bridge as never);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/coach/message", { text: "下一个该做什么选题", platform: "douyin" }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.sessionCreated).toBe(true);
      expect(json.coachKey).toBe("coach_main");

      expect(calls.createCoachSession).toHaveLength(1);
      expect(calls.createCoachSession[0].key).toBe("coach_main");
      expect(calls.createCoachSession[0].key.startsWith("coach_")).toBe(true);
      expect(calls.createCoachSession[0].key.startsWith("trends_")).toBe(false);
      // user opening line echoed into the persisted history
      expect(calls.recordUserMessage).toContain("下一个该做什么选题");
    });
  });

  it("subsequent turn resumes (sendMessage) rather than recreating the session", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { setWsBridge } = await import("../routes/_shared.js");
      const { bridge, calls } = makeFakeBridge();
      setWsBridge(bridge as never);

      // first turn → creates
      await apiRoutes.fetch(jsonReq("POST", "/api/coach/message", { text: "first" }));
      // second turn → resumes
      const res2 = await apiRoutes.fetch(jsonReq("POST", "/api/coach/message", { text: "second" }));
      expect(res2.status).toBe(200);
      const json: any = await res2.json();
      expect(json.sessionCreated).toBeUndefined();
      expect(calls.createCoachSession).toHaveLength(1); // not recreated
      expect(calls.sendMessage).toContain("second");
    });
  });
});

describe("POST /api/coach/model (session-scoped, NOT global)", () => {
  it("400 rejects a non-alias value", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { setWsBridge } = await import("../routes/_shared.js");
      const { bridge } = makeFakeBridge();
      setWsBridge(bridge as never);
      const res = await apiRoutes.fetch(jsonReq("POST", "/api/coach/model", { model: "gpt-4" }));
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.errorCode).toBe("invalid_model_alias");
    });
  });

  it("scopes the switch to the coach session and does NOT mutate global config.model", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { setWsBridge } = await import("../routes/_shared.js");
      const { loadConfig } = await import("../../infra/config.js");
      const { bridge, calls } = makeFakeBridge();
      setWsBridge(bridge as never);

      const globalBefore = (await loadConfig()).model;
      const res = await apiRoutes.fetch(jsonReq("POST", "/api/coach/model", { model: "haiku" }));
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ok).toBe(true);
      expect(json.model).toBe("haiku");

      // routed through the session-scoped setter on the coach key
      expect(calls.setSessionModel).toEqual([{ key: "coach_main", model: "haiku" }]);
      // global config untouched (the bug S6 fixes) — /api/status still shows the old tier
      const status: any = await (await apiRoutes.fetch(jsonReq("GET", "/api/status"))).json();
      expect(status.model).toBe(globalBefore);
    });
  });
});
