import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { klingProvider } from "./kling.js";

describe("klingProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns stub asset when KLING_API_KEY missing", async () => {
    vi.stubEnv("KLING_API_KEY", "");
    const promise = klingProvider.generateVideo({
      prompt: "panda",
      durationSec: 4,
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.stub).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.assetUri).toContain("kling-");
  });

  it("returns non-stub when KLING_API_KEY present", async () => {
    vi.stubEnv("KLING_API_KEY", "test-key");
    const promise = klingProvider.generateVideo({
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
    vi.stubEnv("KLING_API_KEY", "");
    const opts = { prompt: "same prompt", durationSec: 4, aspectRatio: "9:16" };
    const p1 = klingProvider.generateVideo(opts);
    const p2 = klingProvider.generateVideo(opts);
    await vi.advanceTimersByTimeAsync(150);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.assetUri).toBe(r2.assetUri);
  });
});
