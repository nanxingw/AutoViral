import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSeedanceProvider } from "./seedance.js";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60;

describe("seedanceProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns stub asset when OPENROUTER_API_KEY missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = createSeedanceProvider();
    const result = await provider.generateVideo({
      prompt: "panda eating bamboo",
      durationSec: 3,
      aspectRatio: "9:16",
    });

    expect(result.stub).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.assetUri).toContain("seedance-");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enqueues, polls, and downloads on happy path", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-1",
        polling_url: "https://openrouter.ai/api/v1/videos/job-1",
        status: "pending",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "job-1", status: "pending" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-1",
        status: "completed",
        unsigned_urls: ["https://cdn.openrouter.ai/seedance/job-1.mp4"],
        usage: { cost: 0.76, is_byok: false },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1024),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "panda eating bamboo",
      durationSec: 3,
      aspectRatio: "9:16",
    });
    // Advance through both poll waits.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    const result = await promise;

    expect(result.stub).toBe(false);
    expect(result.providerJobId).toBe("job-1");
    expect(result.costUsd).toBe(0.76);
    expect(result.assetUri).toContain("seedance-");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Verify enqueue call shape.
    const enqueueCall = fetchMock.mock.calls[0];
    expect(enqueueCall[0]).toBe("https://openrouter.ai/api/v1/videos");
    expect(enqueueCall[1].method).toBe("POST");
    const body = JSON.parse(enqueueCall[1].body as string);
    expect(body.model).toBe("bytedance/seedance-2.0");
    expect(body.prompt).toBe("panda eating bamboo");
    expect(body.input.duration).toBe(3);
    expect(body.input.aspect_ratio).toBe("9:16");
  });

  it("throws when enqueue returns non-OK", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    });

    const provider = createSeedanceProvider();
    await expect(
      provider.generateVideo({ prompt: "x", durationSec: 3, aspectRatio: "9:16" }),
    ).rejects.toThrow(/Seedance enqueue failed: 500/);
  });

  it("throws when poll returns failed status", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-2",
        polling_url: "https://openrouter.ai/api/v1/videos/job-2",
        status: "pending",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "job-2", status: "failed" }),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "x",
      durationSec: 3,
      aspectRatio: "9:16",
    });
    // Attach a rejection handler synchronously so the unhandled-rejection
    // sniffer doesn't fire when the promise rejects mid-timer-advance.
    const settled = expect(promise).rejects.toThrow(/Seedance job job-2 failed/);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await settled;
  });

  it("R44: forwards firstFrameImage as frame_images array (image-to-video)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "i2v-1",
        polling_url: "https://openrouter.ai/api/v1/videos/i2v-1",
        status: "pending",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "i2v-1",
        status: "completed",
        unsigned_urls: ["https://cdn.openrouter.ai/seedance/i2v-1.mp4"],
        usage: { cost: 0.76 },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(512),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "the woman turns slowly to face the camera",
      durationSec: 5,
      aspectRatio: "9:16",
      firstFrameImage: "https://cdn.example.com/anchor.jpg",
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const result = await promise;
    expect(result.stub).toBe(false);

    const enqueueBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(enqueueBody.input.frame_images).toEqual([
      { frame_type: "first", image: "https://cdn.example.com/anchor.jpg" },
    ]);
    // Pure t2v fields still present, untouched.
    expect(enqueueBody.input.duration).toBe(5);
    expect(enqueueBody.input.aspect_ratio).toBe("9:16");
  });

  it("R44: omits frame_images entirely when no anchors provided (pure t2v unchanged)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "t2v-1",
        polling_url: "https://openrouter.ai/api/v1/videos/t2v-1",
        status: "pending",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "t2v-1",
        status: "completed",
        unsigned_urls: ["https://cdn.openrouter.ai/seedance/t2v-1.mp4"],
        usage: { cost: 0.76 },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(512),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "panda eating bamboo",
      durationSec: 3,
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    const enqueueBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(enqueueBody.input.frame_images).toBeUndefined();
    expect("frame_images" in enqueueBody.input).toBe(false);
  });

  it("R44: forwards both firstFrameImage and lastFrameImage when provided", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "morph-1",
        polling_url: "https://openrouter.ai/api/v1/videos/morph-1",
        status: "pending",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "morph-1",
        status: "completed",
        unsigned_urls: ["https://cdn.openrouter.ai/seedance/morph-1.mp4"],
        usage: { cost: 0.76 },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(512),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "morph A to B",
      durationSec: 3,
      aspectRatio: "9:16",
      firstFrameImage: "https://cdn.example.com/a.jpg",
      lastFrameImage: "https://cdn.example.com/b.jpg",
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    const enqueueBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(enqueueBody.input.frame_images).toEqual([
      { frame_type: "first", image: "https://cdn.example.com/a.jpg" },
      { frame_type: "last", image: "https://cdn.example.com/b.jpg" },
    ]);
  });

  it("throws when polling exceeds MAX_POLL_ATTEMPTS", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-3",
        polling_url: "https://openrouter.ai/api/v1/videos/job-3",
        status: "pending",
      }),
    });
    // All subsequent polls return pending.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "job-3", status: "pending" }),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "x",
      durationSec: 3,
      aspectRatio: "9:16",
    });
    const settled = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * (MAX_POLL_ATTEMPTS + 1));
    await settled;
  });
});
