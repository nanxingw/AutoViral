import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initProviders,
  getProvider,
  getDefaultProvider,
  listProviders,
  registerProvider,
  _resetProviders,
  type MediaProvider,
} from "./registry.js";

// ADR-007 isolation test: all three capabilities resolve through the single
// capability-tagged registry; defaults are correct; envKey mapping is declared;
// the dropped video stubs are gone; the old per-capability video registry +
// its aliased lookup no longer exist (their deletion is a compile-time
// guarantee — this file only imports the unified surface below).

describe("unified MediaProvider registry (ADR-007)", () => {
  beforeEach(async () => {
    _resetProviders();
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
    await initProviders({ openrouter: { apiKey: "or-test-key" } });
  });

  afterEach(() => {
    _resetProviders();
    vi.unstubAllEnvs();
  });

  describe("all three capabilities resolve via getProvider(capability, name)", () => {
    it("image → openrouter-image", () => {
      const p = getProvider("image", "openrouter-image");
      expect(p?.capability).toBe("image");
      expect(p?.name).toBe("openrouter-image");
      expect(typeof p?.generateImage).toBe("function");
    });

    it("historical alias 'nanobanana' resolves to the same image provider", () => {
      // Old docs / chat history / scripts say `--provider nanobanana`; the
      // lookup chokepoint normalizes the renamed id so they keep working.
      const aliased = getProvider("image", "nanobanana");
      expect(aliased).toBeDefined();
      expect(aliased).toBe(getProvider("image", "openrouter-image"));
      expect(aliased?.name).toBe("openrouter-image");
    });

    it("video → seedance", () => {
      const p = getProvider("video", "seedance");
      expect(p?.capability).toBe("video");
      expect(p?.name).toBe("seedance");
      expect(typeof p?.generateVideo).toBe("function");
    });

    it("tts → gemini (primary) and edge-tts (fallback)", () => {
      const gemini = getProvider("tts", "gemini");
      const edge = getProvider("tts", "edge-tts");
      expect(gemini?.capability).toBe("tts");
      expect(gemini?.tts.id).toBe("gemini");
      expect(edge?.capability).toBe("tts");
      expect(edge?.tts.id).toBe("edge-tts");
    });

    it("unknown name → undefined", () => {
      expect(getProvider("video", "runway")).toBeUndefined();
      expect(getProvider("image", "ghost")).toBeUndefined();
    });

    it("capability is namespaced — a name under the wrong capability misses", () => {
      // seedance is video-only; asking for it under "image" must not resolve.
      expect(getProvider("image", "seedance")).toBeUndefined();
    });
  });

  describe("getDefaultProvider(capability)", () => {
    it("image default is openrouter-image", () => {
      expect(getDefaultProvider("image")?.name).toBe("openrouter-image");
    });

    it("video default is seedance", () => {
      expect(getDefaultProvider("video")?.name).toBe("seedance");
    });

    it("tts default is gemini (PRD-0003 §2 flipped the chain; edge is fallback)", () => {
      const d = getDefaultProvider("tts");
      expect(d?.name).toBe("gemini");
      expect(d?.default).toBe(true);
    });

    it("falls back to first-registered when none is flagged default", () => {
      _resetProviders();
      const a: MediaProvider = {
        name: "a",
        capability: "tts",
        envKey: "X",
        tts: { id: "a", name: "A", supportsLanguages: [], voices: [], generate: async () => ({ outputPath: "", duration: 0, sampleRate: 0, channels: 0 }) },
      };
      const b: MediaProvider = {
        name: "b",
        capability: "tts",
        envKey: "Y",
        tts: { id: "b", name: "B", supportsLanguages: [], voices: [], generate: async () => ({ outputPath: "", duration: 0, sampleRate: 0, channels: 0 }) },
      };
      registerProvider(a);
      registerProvider(b);
      expect(getDefaultProvider("tts")?.name).toBe("a");
    });
  });

  describe("envKey mapping (declarative)", () => {
    it("image + video gate on OPENROUTER_API_KEY", () => {
      expect(getProvider("image", "openrouter-image")?.envKey).toBe("OPENROUTER_API_KEY");
      expect(getProvider("video", "seedance")?.envKey).toBe("OPENROUTER_API_KEY");
    });

    it("gemini tts gates on OPENROUTER_API_KEY; edge-tts on EDGE_TTS_PATH", () => {
      expect(getProvider("tts", "gemini")?.envKey).toBe("OPENROUTER_API_KEY");
      expect(getProvider("tts", "edge-tts")?.envKey).toBe("EDGE_TTS_PATH");
    });
  });

  describe("listProviders(capability?)", () => {
    it("video lists ONLY seedance — runway/sora/kling stubs are gone", () => {
      const ids = listProviders("video").map((p) => p.name);
      expect(ids).toEqual(["seedance"]);
      expect(ids).not.toContain("runway");
      expect(ids).not.toContain("sora");
      expect(ids).not.toContain("kling");
    });

    it("unfiltered lists every capability in one place", () => {
      const caps = new Set(listProviders().map((p) => p.capability));
      expect(caps).toEqual(new Set(["image", "video", "tts"]));
    });

    it("edge-tts is always available; gemini/seedance availability tracks env", () => {
      const edge = listProviders("tts").find((p) => p.name === "edge-tts");
      expect(edge?.available).toBe(true); // local binary, no env required

      const gemini = listProviders("tts").find((p) => p.name === "gemini");
      expect(gemini?.available).toBe(true); // OPENROUTER_API_KEY stubbed in beforeEach

      const seedance = listProviders("video").find((p) => p.name === "seedance");
      expect(seedance?.available).toBe(true); // OPENROUTER_API_KEY stubbed in beforeEach
    });

    it("provider with missing envKey reports available:false", () => {
      _resetProviders();
      vi.unstubAllEnvs();
      // no OPENROUTER_API_KEY → gemini reports unavailable. Register a fresh
      // keyed tts provider whose env is absent to exercise the branch directly.
      registerProvider({
        name: "keyed-fallback",
        capability: "tts",
        envKey: "SOME_ABSENT_KEY",
        tts: { id: "keyed-fallback", name: "K", supportsLanguages: [], voices: [], generate: async () => ({ outputPath: "", duration: 0, sampleRate: 0, channels: 0 }) },
      });
      expect(listProviders("tts").find((p) => p.name === "keyed-fallback")?.available).toBe(false);
    });
  });

  describe("initProviders assembly", () => {
    it("skips the image provider when no OpenRouter key is present", async () => {
      _resetProviders();
      vi.unstubAllEnvs();
      await initProviders({ openrouter: {} });
      expect(getDefaultProvider("image")).toBeUndefined();
      // video + tts still register (seedance always; gemini/edge-tts always —
      // registration is key-independent; the key only gates *availability*).
      expect(getDefaultProvider("video")?.name).toBe("seedance");
      expect(getDefaultProvider("tts")?.name).toBe("gemini");
    });
  });
});
