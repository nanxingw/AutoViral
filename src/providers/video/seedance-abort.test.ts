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

  // F2 — abort DURING the enqueue POST (connection dropped mid-dispatch) leaves
  // the upstream job's fate UNKNOWN: the gateway may have created a billed job
  // before the socket closed. This is NOT a clean cancel — it must orphan so the
  // route locks the key + books a note, never re-下单 on retry.
  it("abort during the enqueue fetch → OrphanedGenerationError (dispatch uncertain), NOT clean", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const controller = new AbortController();
    const fetchSpy = vi.fn(async () => {
      // The socket drops while the POST is in flight.
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { createSeedanceProvider } = await import("./seedance.js");
    const { OrphanedGenerationError } = await import("../../server/generation-resilience.js");

    const provider = createSeedanceProvider();
    await expect(
      provider.generateVideo({
        prompt: "a long push-in",
        durationSec: 4,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(OrphanedGenerationError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // F1/F2/F7 — enqueue SUCCEEDS (job created + billed), then the client
  // disconnects. The provider must STOP polling and surface an orphan carrying
  // the real providerJobId — proving the stop-poll logic exists (delete it and
  // this hangs → red) and that orphan accounting is wired to the job id.
  it("abort after a successful enqueue → stops polling + OrphanedGenerationError with providerJobId", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const controller = new AbortController();
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      // First call = the enqueue POST. Reading the job body aborts the request
      // (client disconnected), so the poll loop's next signal check must orphan.
      return {
        ok: true,
        json: async () => {
          controller.abort();
          return { id: "job_seed_42", polling_url: "https://poll.example/job_seed_42", status: "pending" };
        },
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { createSeedanceProvider } = await import("./seedance.js");
    const { OrphanedGenerationError } = await import("../../server/generation-resilience.js");

    const provider = createSeedanceProvider();
    let caught: unknown;
    await provider
      .generateVideo({ prompt: "a shot", durationSec: 4, signal: controller.signal })
      .catch((e) => {
        caught = e;
      });
    expect(caught).toBeInstanceOf(OrphanedGenerationError);
    expect((caught as InstanceType<typeof OrphanedGenerationError>).providerJobId).toBe("job_seed_42");
    // Only the enqueue POST ran; polling never proceeded past the abort check.
    expect(calls).toBe(1);
  });
});
