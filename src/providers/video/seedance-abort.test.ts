// S10 (PRD-0014) — the real Seedance provider must honour a request AbortSignal.
// A pre-aborted signal must short-circuit BEFORE the (paid) enqueue fetch — no
// job is dispatched, so nothing is billed and nothing is orphaned. This proves
// the signal is threaded into the provider (the route passes c.req.raw.signal).

import { describe, it, expect, afterEach, vi } from "vitest";

describe("createSeedanceProvider — AbortSignal honoured before enqueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    vi.resetModules();
  });

  it("a pre-aborted signal throws GenerationAbortedError and never calls fetch", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { createSeedanceProvider } = await import("./seedance.js");
    const { GenerationAbortedError } = await import("../../server/generation-resilience.js");

    const provider = createSeedanceProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateVideo({
        prompt: "she turns to camera",
        durationSec: 4,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(GenerationAbortedError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
