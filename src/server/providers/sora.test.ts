import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { soraProvider } from "./sora.js";

describe("soraProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns stub asset when SORA_API_KEY missing", async () => {
    vi.stubEnv("SORA_API_KEY", "");
    const promise = soraProvider.generateVideo({
      prompt: "panda",
      durationSec: 4,
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.stub).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.assetUri).toContain("sora-");
  });

  it("returns non-stub when SORA_API_KEY present", async () => {
    vi.stubEnv("SORA_API_KEY", "test-key");
    const promise = soraProvider.generateVideo({
      prompt: "panda",
      durationSec: 4,
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.stub).toBe(false);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.providerJobId).toBeDefined();
  });

  it("deterministic asset path for same prompt", async () => {
    vi.stubEnv("SORA_API_KEY", "");
    const opts = { prompt: "same prompt", durationSec: 4, aspectRatio: "9:16" };
    const p1 = soraProvider.generateVideo(opts);
    const p2 = soraProvider.generateVideo(opts);
    await vi.advanceTimersByTimeAsync(150);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.assetUri).toBe(r2.assetUri);
  });
});
