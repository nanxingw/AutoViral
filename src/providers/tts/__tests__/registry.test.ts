import { describe, it, expect, afterEach, vi } from "vitest";
import {
  generateWithFallback,
  pickProvider,
  ALL_TTS_PROVIDERS,
} from "../registry.js";
import { edgeTtsProvider } from "../edge-tts.js";
import { geminiTtsProvider } from "../gemini-tts.js";
import type { TtsProvider, TtsRequest, TtsResult } from "../types.js";

// PRD-0003 §2: the fallback chain flipped from edge→openai-direct to
// Gemini(OpenRouter)→edge; openai-direct is retired. The registry holds the
// concrete gemini/edge singletons, so we stub their isAvailable/generate
// in-place per test. No real binaries are spawned and no network is hit.
const REQ: TtsRequest = {
  text: "hello",
  voice: "zh-CN-XiaoxiaoNeural",
  outputPath: "/tmp/does-not-matter.mp3",
};

function fakeResult(): TtsResult {
  return { outputPath: REQ.outputPath, duration: 1.5, sampleRate: 24000, channels: 1 };
}

// isAvailable is optional on TtsProvider, so vi.spyOn(provider, "isAvailable")
// types to `never`. Narrow to a shape where the method is required for spying;
// both concrete providers always define it.
function stubAvailable(provider: TtsProvider, value: boolean) {
  const p = provider as Required<Pick<TtsProvider, "isAvailable">> & TtsProvider;
  vi.spyOn(p, "isAvailable").mockResolvedValue(value);
}

describe("pickProvider (primary single-shot provider)", () => {
  it("returns Gemini (OpenRouter), the new primary — NOT edge", () => {
    expect(pickProvider().id).toBe("gemini");
    expect(pickProvider({ language: "zh-CN" }).id).toBe("gemini");
    expect(pickProvider({ language: "en-US" }).id).toBe("gemini");
  });
});

describe("generateWithFallback (Gemini → edge)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provider:'gemini' only invokes Gemini (no fallback, no availability gate)", async () => {
    const geminiGen = vi.spyOn(geminiTtsProvider, "generate").mockResolvedValue(fakeResult());
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "gemini" });

    expect(res.providerId).toBe("gemini");
    expect(geminiGen).toHaveBeenCalledOnce();
    expect(edgeGen).not.toHaveBeenCalled();
  });

  it("provider:'edge-tts' only invokes edge-tts", async () => {
    const geminiGen = vi.spyOn(geminiTtsProvider, "generate").mockResolvedValue(fakeResult());
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "edge-tts" });

    expect(res.providerId).toBe("edge-tts");
    expect(edgeGen).toHaveBeenCalledOnce();
    expect(geminiGen).not.toHaveBeenCalled();
  });

  it("auto: uses Gemini when it is available (the new primary)", async () => {
    stubAvailable(geminiTtsProvider, true);
    const geminiGen = vi.spyOn(geminiTtsProvider, "generate").mockResolvedValue(fakeResult());
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "auto" });

    expect(res.providerId).toBe("gemini");
    expect(geminiGen).toHaveBeenCalledOnce();
    expect(edgeGen).not.toHaveBeenCalled();
  });

  it("auto: falls back to edge-tts when Gemini is unavailable (no OpenRouter key)", async () => {
    stubAvailable(geminiTtsProvider, false);
    const geminiGen = vi.spyOn(geminiTtsProvider, "generate").mockResolvedValue(fakeResult());
    stubAvailable(edgeTtsProvider, true);
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "auto" });

    expect(res.providerId).toBe("edge-tts");
    expect(geminiGen).not.toHaveBeenCalled();
    expect(edgeGen).toHaveBeenCalledOnce();
  });

  it("auto: falls back to edge-tts when Gemini is available but the OpenRouter call throws", async () => {
    stubAvailable(geminiTtsProvider, true);
    const geminiGen = vi
      .spyOn(geminiTtsProvider, "generate")
      .mockRejectedValue(new Error("Gemini TTS request failed: 500"));
    stubAvailable(edgeTtsProvider, true);
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "auto" });

    expect(res.providerId).toBe("edge-tts");
    expect(geminiGen).toHaveBeenCalledOnce();
    expect(edgeGen).toHaveBeenCalledOnce();
  });

  it("auto: throws an aggregated error naming both failures when both fail", async () => {
    stubAvailable(geminiTtsProvider, false);
    stubAvailable(edgeTtsProvider, false);

    await expect(generateWithFallback(REQ, { provider: "auto" })).rejects.toThrow(
      /gemini.*edge-tts/s,
    );
  });
});

describe("combined voice catalog (zh + en coverage guard)", () => {
  it("ALL_TTS_PROVIDERS expose at least one zh-CN voice", () => {
    const langs = ALL_TTS_PROVIDERS.flatMap((p) => p.voices.map((v) => v.lang));
    // Gemini reports its voices as "multi"; edge carries explicit zh-CN ids.
    expect(langs).toContain("zh-CN");
  });

  it("ALL_TTS_PROVIDERS expose at least one en-US voice", () => {
    const langs = ALL_TTS_PROVIDERS.flatMap((p) => p.voices.map((v) => v.lang));
    expect(langs).toContain("en-US");
  });

  it("ALL_TTS_PROVIDERS supportsLanguages cover zh-CN and en-US", () => {
    const supported = ALL_TTS_PROVIDERS.flatMap((p) => p.supportsLanguages);
    expect(supported).toContain("zh-CN");
    expect(supported).toContain("en-US");
  });
});
