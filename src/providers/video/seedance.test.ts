import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSeedanceProvider,
  closestSupportedRatio,
  SUPPORTED_VIDEO_ASPECT_RATIOS,
  SUPPORTED_VIDEO_RESOLUTIONS,
  SUPPORTED_VIDEO_DURATIONS,
  POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS,
} from "./seedance.js";

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
      durationSec: 5,
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
      durationSec: 5,
      aspectRatio: "9:16",
      resolution: "1080p",
      generateAudio: false,
    });
    // Advance through both poll waits.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    const result = await promise;

    expect(result.stub).toBe(false);
    expect(result.providerJobId).toBe("job-1");
    expect(result.costUsd).toBe(0.76);
    expect(result.assetUri).toContain("seedance-");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Verify enqueue call shape — FLAT top-level fields (the OpenRouter videos
    // schema has no `input` wrapper; the old nesting silently dropped params).
    const enqueueCall = fetchMock.mock.calls[0];
    expect(enqueueCall[0]).toBe("https://openrouter.ai/api/v1/videos");
    expect(enqueueCall[1].method).toBe("POST");
    const body = JSON.parse(enqueueCall[1].body as string);
    expect(body.model).toBe("bytedance/seedance-2.0");
    expect(body.prompt).toBe("panda eating bamboo");
    expect(body.duration).toBe(5);
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.resolution).toBe("1080p");
    expect(body.generate_audio).toBe(false);
    // The legacy `input` wrapper must be gone entirely.
    expect(body.input).toBeUndefined();
  });

  it("omits aspect_ratio / resolution / generate_audio when not provided", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-min",
        polling_url: "https://openrouter.ai/api/v1/videos/job-min",
        status: "pending",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-min",
        status: "completed",
        unsigned_urls: ["https://cdn.openrouter.ai/seedance/job-min.mp4"],
        usage: { cost: 0.15 },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });

    const provider = createSeedanceProvider();
    const promise = provider.generateVideo({
      prompt: "minimal request",
      durationSec: 4,
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.duration).toBe(4);
    expect("aspect_ratio" in body).toBe(false);
    expect("resolution" in body).toBe(false);
    expect("generate_audio" in body).toBe(false);
    expect(body.input).toBeUndefined();
  });

  it("exposes the authoritative OpenRouter videos contract constants", () => {
    expect(SUPPORTED_VIDEO_ASPECT_RATIOS).toEqual([
      "1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21",
    ]);
    expect(SUPPORTED_VIDEO_RESOLUTIONS).toEqual(["480p", "720p", "1080p"]);
    // 4..15 integer seconds.
    expect(SUPPORTED_VIDEO_DURATIONS).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it("closestSupportedRatio maps to the nearest supported ratio (log distance)", () => {
    // Exact supported ratios round-trip.
    expect(closestSupportedRatio("9:16")).toBe("9:16");
    expect(closestSupportedRatio("16:9")).toBe("16:9");
    expect(closestSupportedRatio("1:1")).toBe("1:1");
    // 4:5 (0.8) is not supported → closest is 3:4 (0.75).
    expect(closestSupportedRatio("4:5")).toBe("3:4");
    // Garbage / malformed → undefined (gateway default applies).
    expect(closestSupportedRatio("not-a-ratio")).toBeUndefined();
    expect(closestSupportedRatio("16:0")).toBeUndefined();
    expect(closestSupportedRatio("")).toBeUndefined();
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
      provider.generateVideo({ prompt: "x", durationSec: 5, aspectRatio: "9:16" }),
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
      durationSec: 5,
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
    expect(enqueueBody.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.example.com/anchor.jpg" },
        frame_type: "first_frame",
      },
    ]);
    // Pure t2v fields still present, at top level (no `input` wrapper).
    expect(enqueueBody.duration).toBe(5);
    expect(enqueueBody.aspect_ratio).toBe("9:16");
    expect(enqueueBody.input).toBeUndefined();
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
      durationSec: 5,
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    const enqueueBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(enqueueBody.frame_images).toBeUndefined();
    expect("frame_images" in enqueueBody).toBe(false);
    expect(enqueueBody.input).toBeUndefined();
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
      durationSec: 5,
      aspectRatio: "9:16",
      firstFrameImage: "https://cdn.example.com/a.jpg",
      lastFrameImage: "https://cdn.example.com/b.jpg",
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    const enqueueBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(enqueueBody.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.example.com/a.jpg" },
        frame_type: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: "https://cdn.example.com/b.jpg" },
        frame_type: "last_frame",
      },
    ]);
    expect(enqueueBody.input).toBeUndefined();
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
      durationSec: 5,
      aspectRatio: "9:16",
    });
    const settled = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * (MAX_POLL_ATTEMPTS + 1));
    await settled;
  });
});
