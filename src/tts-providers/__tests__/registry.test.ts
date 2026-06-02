import { describe, it, expect, afterEach, vi } from "vitest";
import { generateWithFallback, ALL_TTS_PROVIDERS } from "../registry.js";
import { edgeTtsProvider } from "../edge-tts.js";
import { openaiTtsProvider } from "../openai-tts.js";
import type { TtsProvider, TtsRequest, TtsResult } from "../types.js";

// The registry holds the concrete edge/openai singletons, so we stub their
// isAvailable/generate in-place per test. No real binaries are spawned.
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

describe("generateWithFallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provider:'edge-tts' only invokes edge-tts (no fallback, no availability gate)", async () => {
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());
    const openaiGen = vi.spyOn(openaiTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "edge-tts" });

    expect(res.providerId).toBe("edge-tts");
    expect(edgeGen).toHaveBeenCalledOnce();
    expect(openaiGen).not.toHaveBeenCalled();
  });

  it("provider:'openai' only invokes openai", async () => {
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());
    const openaiGen = vi.spyOn(openaiTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "openai" });

    expect(res.providerId).toBe("openai");
    expect(openaiGen).toHaveBeenCalledOnce();
    expect(edgeGen).not.toHaveBeenCalled();
  });

  it("auto: uses edge-tts when it is available", async () => {
    stubAvailable(edgeTtsProvider, true);
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());
    const openaiGen = vi.spyOn(openaiTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "auto" });

    expect(res.providerId).toBe("edge-tts");
    expect(edgeGen).toHaveBeenCalledOnce();
    expect(openaiGen).not.toHaveBeenCalled();
  });

  it("auto: falls back to openai when edge-tts is unavailable", async () => {
    stubAvailable(edgeTtsProvider, false);
    const edgeGen = vi.spyOn(edgeTtsProvider, "generate").mockResolvedValue(fakeResult());
    stubAvailable(openaiTtsProvider, true);
    const openaiGen = vi.spyOn(openaiTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "auto" });

    expect(res.providerId).toBe("openai");
    expect(edgeGen).not.toHaveBeenCalled();
    expect(openaiGen).toHaveBeenCalledOnce();
  });

  it("auto: falls back to openai when edge-tts is available but throws", async () => {
    stubAvailable(edgeTtsProvider, true);
    const edgeGen = vi
      .spyOn(edgeTtsProvider, "generate")
      .mockRejectedValue(new Error("edge-tts CLI exited 1"));
    stubAvailable(openaiTtsProvider, true);
    const openaiGen = vi.spyOn(openaiTtsProvider, "generate").mockResolvedValue(fakeResult());

    const res = await generateWithFallback(REQ, { provider: "auto" });

    expect(res.providerId).toBe("openai");
    expect(edgeGen).toHaveBeenCalledOnce();
    expect(openaiGen).toHaveBeenCalledOnce();
  });

  it("auto: throws an aggregated error naming both failures when both fail", async () => {
    stubAvailable(edgeTtsProvider, false);
    stubAvailable(openaiTtsProvider, false);

    await expect(generateWithFallback(REQ, { provider: "auto" })).rejects.toThrow(
      /edge-tts.*openai/s,
    );
  });
});

describe("combined voice catalog (zh + en coverage guard)", () => {
  it("ALL_TTS_PROVIDERS expose at least one zh-CN voice", () => {
    const langs = ALL_TTS_PROVIDERS.flatMap((p) => p.voices.map((v) => v.lang));
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
