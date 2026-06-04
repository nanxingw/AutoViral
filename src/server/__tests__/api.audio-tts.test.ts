import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonReq } from "./_helpers.js";

// Endpoint contract for POST /api/audio/tts (the AGENT path).
//
// PRD-0003 §2: this path used to call pickProvider().generate() directly —
// edge-only with NO fallback, asymmetric with /api/works/:id/tts. It now routes
// through generateWithFallback so the agent shares the Gemini(OpenRouter)→edge
// auto-fallback. We exercise the deterministic, no-binary paths here (400
// validation + all-providers-fail → 500 tts_provider_error); the happy-path
// synthesis is covered by the gemini/edge provider unit tests (which inject
// fetch and never spawn real binaries / hit OpenRouter).
describe("POST /api/audio/tts (agent path now has Gemini→edge fallback)", () => {
  let outDir: string;

  beforeEach(async () => {
    delete process.env.OPENROUTER_API_KEY; // gemini unavailable
    delete process.env.OPENAI_API_KEY;
    delete process.env.EDGE_TTS_PATH;
    outDir = await mkdtemp(join(tmpdir(), "audio-tts-test-"));
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("400 when required fields are missing", async () => {
    const { apiRoutes } = await import("../api.js");
    const res = await apiRoutes.fetch(
      jsonReq("POST", "/api/audio/tts", { text: "你好" }), // no voice / output_path
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toMatch(/required/i);
  });

  it("500 tts_provider_error when BOTH providers are unavailable — proving fallback (not edge-only)", async () => {
    // Deterministically simulate "all providers failed". Env-based disabling
    // (EDGE_TTS_PATH=nonexistent + no OPENROUTER_API_KEY) is NOT reliable:
    // edge-tts falls back to the ~/.autoviral/tts-venv binary, and now that the
    // I13 dependency-manager resolves ffmpeg/ffprobe from a vendored absolute
    // path, edge-tts can actually succeed on a host with the venv + network →
    // 200, not the 500 this test asserts. Mock generateWithFallback to throw so
    // we exercise the agent endpoint's aggregated-failure contract (the proof it
    // routes through the fallback chain, not edge-only) regardless of host.
    vi.doMock("../../providers/tts/registry.js", async (orig) => {
      const actual = await orig<typeof import("../../providers/tts/registry.js")>();
      return {
        ...actual,
        generateWithFallback: vi.fn(async () => {
          throw new Error("All TTS providers failed (test)");
        }),
      };
    });
    const { apiRoutes } = await import("../api.js");
    const res = await apiRoutes.fetch(
      jsonReq("POST", "/api/audio/tts", {
        text: "你好，世界",
        voice: "zh-CN-XiaoxiaoNeural",
        output_path: join(outDir, "out.mp3"),
      }),
    );
    expect(res.status).toBe(500);
    const json: any = await res.json();
    expect(json.errorCode).toBe("tts_provider_error");
    expect(typeof json.detail).toBe("string");
  });
});
