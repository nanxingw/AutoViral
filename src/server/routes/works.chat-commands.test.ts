import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempDataDir, jsonReq } from "../__tests__/_helpers.js";

beforeEach(() => vi.resetModules());

async function wireBridge() {
  const { apiRoutes, setWsBridge } = await import("../api.js");
  const { WsBridge } = await import("../../ws-bridge.js");
  const bridge = new WsBridge(0);
  setWsBridge(bridge);
  return { apiRoutes, bridge };
}

describe("GET /api/works/:id/chat-commands", () => {
  it("validates workId and the required sessionId", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const badWork = await apiRoutes.fetch(
        jsonReq("GET", "/api/works/evil.id/chat-commands?sessionId=s_1"),
      );
      expect(badWork.status).toBe(400);
      expect((await badWork.json()).errorCode).toBe("invalid_work_id");

      const missingSession = await apiRoutes.fetch(
        jsonReq("GET", "/api/works/w_ok/chat-commands"),
      );
      expect(missingSession.status).toBe(400);
      expect((await missingSession.json()).errorCode).toBe("invalid_session_id");
    });
  });

  it("returns local plus the requested session backend catalog without leaking another session's capabilities", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, bridge } = await wireBridge();
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });

      await bridge.createNewSession(work.id, "claude"); // s_2
      await bridge.createNewSession(work.id, "codex"); // s_3

      const claudeRes = await apiRoutes.fetch(
        jsonReq("GET", `/api/works/${work.id}/chat-commands?sessionId=s_2`),
      );
      const codexRes = await apiRoutes.fetch(
        jsonReq("GET", `/api/works/${work.id}/chat-commands?sessionId=s_3`),
      );
      expect(claudeRes.status).toBe(200);
      expect(codexRes.status).toBe(200);

      const claude = (await claudeRes.json()) as any;
      const codex = (await codexRes.json()) as any;
      expect(claude.backend).toBe("claude");
      expect(codex.backend).toBe("codex");
      expect(claude.commands.find((entry: any) => entry.name === "model")?.kind).toBe("local");
      expect(claude.commands.find((entry: any) => entry.name === "compact")?.backend).toBe("claude");
      expect(codex.commands.find((entry: any) => entry.name === "compact")?.availability)
        .toMatchObject({ available: false, reasonCode: "unsupported_by_backend" });
      expect(codex.commands.every((entry: any) => entry.backend === "codex")).toBe(true);
    });
  });

  it("404s an unknown session instead of falling back to the default backend", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await wireBridge();
      const res = await apiRoutes.fetch(
        jsonReq("GET", "/api/works/w_missing/chat-commands?sessionId=s_99"),
      );
      expect(res.status).toBe(404);
      expect((await res.json()).errorCode).toBe("session_not_found");
    });
  });
});
