import { describe, it, expect, vi, afterEach } from "vitest";
import { listProviders, getProvider } from "./registry.js";

afterEach(() => vi.unstubAllEnvs());

describe("registry", () => {
  it("listProviders returns all 4 providers", () => {
    const list = listProviders();
    expect(list.map((p) => p.id).sort()).toEqual(["kling", "runway", "seedance", "sora"]);
  });

  it("provider is stub when its API key is missing", () => {
    vi.stubEnv("RUNWAY_API_KEY", "");
    vi.stubEnv("SORA_API_KEY", "");
    vi.stubEnv("KLING_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const list = listProviders();
    expect(list.every((p) => p.stub)).toBe(true);
  });

  it("provider is non-stub when its API key is set", () => {
    vi.stubEnv("RUNWAY_API_KEY", "k");
    vi.stubEnv("SORA_API_KEY", "");
    vi.stubEnv("KLING_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const list = listProviders();
    const runway = list.find((p) => p.id === "runway");
    expect(runway?.stub).toBe(false);
  });

  it("seedance is non-stub when OPENROUTER_API_KEY is set", () => {
    vi.stubEnv("RUNWAY_API_KEY", "");
    vi.stubEnv("SORA_API_KEY", "");
    vi.stubEnv("KLING_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const list = listProviders();
    const seedance = list.find((p) => p.id === "seedance");
    expect(seedance?.stub).toBe(false);
    expect(seedance?.displayName).toContain("Seedance");
  });

  it("getProvider returns the adapter for known id", () => {
    expect(getProvider("runway")?.id).toBe("runway");
    expect(getProvider("sora")?.id).toBe("sora");
  });

  it("getProvider returns null for unknown id", () => {
    expect(getProvider("ghost")).toBeNull();
  });
});
