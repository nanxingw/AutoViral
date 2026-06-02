import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// Endpoint contract for POST /api/works/:id/tts (#3).
//
// We exercise the deterministic, no-binary paths here (400 validation +
// all-providers-fail → 500 tts_provider_error). The happy-path synthesis is
// covered by the registry + provider unit tests (which inject fetch and avoid
// spawning real edge-tts/ffprobe binaries — neither is guaranteed on CI).
describe("POST /api/works/:id/tts", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.EDGE_TTS_PATH;
    vi.resetModules();
  });

  it("400 when text is missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/works/w1/tts", { voice: "zh-CN-XiaoxiaoNeural" }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toMatch(/text/);
    });
  });

  it("400 when text is empty/whitespace", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/works/w1/tts", {
          text: "   ",
          voice: "zh-CN-XiaoxiaoNeural",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  it("400 when voice is missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/works/w1/tts", { text: "你好" }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toMatch(/voice/);
    });
  });

  it("400 rejects a work id that fails SAFE_ID before touching the filesystem", async () => {
    // This endpoint mkdir-creates + writes a file, so an unsanitized id is a
    // WRITE-side path traversal. The SAFE_ID guard must run before any FS op.
    // A dotted id is a clean single path segment SAFE_ID (^[A-Za-z0-9_-]+$)
    // rejects — verifying the guard fires regardless of provider availability.
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/works/evil.id/tts", {
          text: "你好",
          voice: "zh-CN-XiaoxiaoNeural",
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toMatch(/workId|Invalid/i);
    });
  });

  it("400 rejects a percent-encoded traversal id (../../etc)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq(
          "POST",
          `/api/works/${encodeURIComponent("../../etc")}/tts`,
          { text: "x", voice: "zh-CN-XiaoxiaoNeural" },
        ),
      );
      expect(res.status).toBe(400);
    });
  });

  it("500 tts_provider_error when all providers are unavailable (auto)", async () => {
    await withTempDataDir(async () => {
      // edge-tts unavailable: point at a path that does not exist.
      process.env.EDGE_TTS_PATH = "/nonexistent/path/to/edge-tts";
      // openai unavailable: no key in env (cleared in beforeEach).
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/works/w1/tts", {
          text: "你好，世界",
          voice: "zh-CN-XiaoxiaoNeural",
        }),
      );
      expect(res.status).toBe(500);
      const json: any = await res.json();
      expect(json.errorCode).toBe("tts_provider_error");
      expect(typeof json.detail).toBe("string");
    });
  });
});
