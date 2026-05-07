import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runwayProvider } from "./runway.js";

describe("runwayProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns stub asset when RUNWAY_API_KEY missing", async () => {
    vi.stubEnv("RUNWAY_API_KEY", "");
    const promise = runwayProvider.generateVideo({
      prompt: "panda",
      durationSec: 4,
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.stub).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.assetUri).toContain("runway-");
  });

  it("returns non-stub when RUNWAY_API_KEY present", async () => {
    vi.stubEnv("RUNWAY_API_KEY", "test-key");
    const promise = runwayProvider.generateVideo({
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
    vi.stubEnv("RUNWAY_API_KEY", "");
    const opts = { prompt: "same prompt", durationSec: 4, aspectRatio: "9:16" };
    const p1 = runwayProvider.generateVideo(opts);
    const p2 = runwayProvider.generateVideo(opts);
    await vi.advanceTimersByTimeAsync(150);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.assetUri).toBe(r2.assetUri);
  });
});
