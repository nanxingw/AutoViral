// R46 #3 — Remotion bridge unit tests. We mock @remotion/bundler,
// @remotion/renderer, AND ./streaming-encoder so no real Chromium is
// launched and no ffmpeg is spawned. The test asserts wiring shape:
//   1. bundle + selectComposition + renderFrames are all called once
//   2. onProgress is called with the right fraction (5/10 → 0.5)
//   3. renderFrames throwing rejects the bridge
//
// We deliberately do NOT exercise the FrameReorderBuffer or ffmpeg
// pipe in this file — those are unit-tested separately
// (frame-reorder-buffer.test.ts, plus streaming-encoder is integration-
// only because it talks to ffmpeg).

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────
// Hoist via vi.mock so the mock factory runs before any import below.

const bundleMock = vi.fn(async (_args: unknown) => "/fake/bundle/url");
const selectCompositionMock = vi.fn(async (_args: unknown) => ({
  id: "main",
  width: 100,
  height: 100,
  fps: 30,
  durationInFrames: 10,
  defaultProps: {},
  props: {},
  defaultCodec: null,
  defaultOutName: null,
  defaultVideoImageFormat: null,
  defaultPixelFormat: null,
}));

// renderFramesMock is reassigned per-test below; we read it through a
// holder so the mocked module always picks up the latest impl.
const renderFramesHolder: { impl: (args: any) => Promise<unknown> } = {
  impl: async () => ({ frameCount: 0 }),
};
const renderFramesMock = vi.fn((args: any) => renderFramesHolder.impl(args));

// #44 — controllable makeCancelSignal: cancelSignal registers callbacks,
// cancel() fires them all (mirrors how Remotion's renderFrames registers an
// internal abort handler through cancelSignal). Lets tests assert the
// AbortSignal → cancel() bridge without a real Chromium render.
const cancelCallbacks: Array<() => void> = [];
const cancelMock = vi.fn(() => {
  for (const cb of cancelCallbacks) cb();
});
const makeCancelSignalMock = vi.fn(() => ({
  cancelSignal: (cb: () => void) => {
    cancelCallbacks.push(cb);
  },
  cancel: cancelMock,
}));

vi.mock("@remotion/bundler", () => ({
  bundle: (args: unknown) => bundleMock(args),
}));
vi.mock("@remotion/renderer", () => ({
  renderFrames: (args: unknown) => renderFramesMock(args),
  selectComposition: (args: unknown) => selectCompositionMock(args),
  makeCancelSignal: () => makeCancelSignalMock(),
}));

// Mock streamingEncode so we don't spawn ffmpeg. The bridge's job is
// just to wire renderFrames → producer; we verify by capturing the
// producer it hands us and feeding it the totalFrames count.
const streamingEncodeMock = vi.fn(
  async (_producer: unknown, opts: any) => opts.outputPath as string,
);
vi.mock("./streaming-encoder.js", () => ({
  streamingEncode: (producer: unknown, opts: unknown) =>
    streamingEncodeMock(producer, opts),
}));

// Import AFTER mocks are registered so the bridge picks up our shims.
const { renderViaStreamingBridge } = await import("./remotion-bridge.js");

// ── Helpers ────────────────────────────────────────────────────────────

const fakeComp = {
  duration: 1,
  fps: 10, // → 10 total frames, easy fractions
  width: 100,
  height: 100,
  title: "test",
};

beforeEach(() => {
  bundleMock.mockClear();
  selectCompositionMock.mockClear();
  renderFramesMock.mockClear();
  streamingEncodeMock.mockClear();
  makeCancelSignalMock.mockClear();
  cancelMock.mockClear();
  cancelCallbacks.length = 0;
  renderFramesHolder.impl = async () => ({ frameCount: 0 });
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("renderViaStreamingBridge", () => {
  it("calls bundle, selectComposition, and renderFrames in sequence", async () => {
    // Stub renderFrames to immediately resolve without emitting frames;
    // our streamingEncode mock doesn't need them.
    renderFramesHolder.impl = async () => ({ frameCount: 10 });

    const out = await renderViaStreamingBridge(fakeComp, "/tmp/out", {});

    expect(bundleMock).toHaveBeenCalledTimes(1);
    expect(selectCompositionMock).toHaveBeenCalledTimes(1);
    expect(renderFramesMock).toHaveBeenCalledTimes(1);
    expect(streamingEncodeMock).toHaveBeenCalledTimes(1);
    // selectComposition is called with the bundle URL produced by bundle.
    expect(selectCompositionMock.mock.calls[0][0]).toMatchObject({
      serveUrl: "/fake/bundle/url",
      id: "main",
    });
    // renderFrames receives the same bundle URL + jpeg image format +
    // outputDir:null (the streaming-mode flag).
    const rfArgs = renderFramesMock.mock.calls[0][0];
    expect(rfArgs.serveUrl).toBe("/fake/bundle/url");
    expect(rfArgs.imageFormat).toBe("jpeg");
    expect(rfArgs.outputDir).toBeNull();
    // streamingEncode is called with mjpeg + the comp dimensions.
    expect(streamingEncodeMock.mock.calls[0][1]).toMatchObject({
      totalFrames: 10,
      fps: 10,
      width: 100,
      height: 100,
      inputCodec: "mjpeg",
    });
    // Returned path is the streamingEncode resolution.
    expect(typeof out).toBe("string");
    expect(out.endsWith(".mp4")).toBe(true);
  });

  it("forwards onFrameUpdate(5,...,...) to onProgress(0.5)", async () => {
    const progress = vi.fn();

    renderFramesHolder.impl = async (args: any) => {
      // Simulate Remotion's onFrameUpdate firing partway through.
      args.onFrameUpdate(5, 5, 12.3);
      args.onFrameUpdate(10, 9, 12.3);
      return { frameCount: 10 };
    };

    await renderViaStreamingBridge(fakeComp, "/tmp/out", { onProgress: progress });

    // First call from onFrameUpdate(5) → 5/10 = 0.5
    expect(progress).toHaveBeenCalledWith(0.5);
    // Last call from onFrameUpdate(10) → 1.0 (clamped to [0,1])
    expect(progress).toHaveBeenCalledWith(1);
  });

  it("rejects if renderFrames throws", async () => {
    renderFramesHolder.impl = async () => {
      throw new Error("render boom");
    };
    // streamingEncode resolves quickly with whatever path; the bridge
    // must still surface the renderFrames error via Promise.allSettled.
    streamingEncodeMock.mockImplementationOnce(
      async (_p, opts: any) => opts.outputPath,
    );

    await expect(
      renderViaStreamingBridge(fakeComp, "/tmp/out", {}),
    ).rejects.toThrow(/render boom/);
  });

  // ── #44 cancellation wiring ───────────────────────────────────────────

  it("throws before bundling when the signal is already aborted (#44)", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      renderViaStreamingBridge(fakeComp, "/tmp/out", { signal: ac.signal }),
    ).rejects.toThrow(/aborted before render/);
    // No expensive work kicked off for an already-cancelled job.
    expect(bundleMock).not.toHaveBeenCalled();
    expect(renderFramesMock).not.toHaveBeenCalled();
  });

  it("aborting mid-render bridges AbortSignal → Remotion cancel() and rejects (#44)", async () => {
    const ac = new AbortController();
    // renderFrames hangs until Remotion's cancelSignal callback fires, then
    // rejects exactly as the real renderFrames does on cancel.
    renderFramesHolder.impl = (args: any) =>
      new Promise((_res, rej) => {
        expect(args.cancelSignal).toBeTypeOf("function"); // signal forwarded
        args.cancelSignal(() => rej(new Error("Render was cancelled")));
      });
    // streamingEncode just waits on the (never-arriving) frames; resolve it so
    // the bridge's outcome is decided by the render rejection.
    streamingEncodeMock.mockImplementationOnce(
      async (_p, opts: any) => opts.outputPath,
    );

    const promise = renderViaStreamingBridge(fakeComp, "/tmp/out", { signal: ac.signal });
    // Abort on the next tick so renderFrames has registered its cancel cb.
    setTimeout(() => ac.abort(), 0);

    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(makeCancelSignalMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledTimes(1); // abort → cancel() fired
  });

  it("does NOT create a cancel signal when no AbortSignal is passed (#44)", async () => {
    renderFramesHolder.impl = async () => ({ frameCount: 10 });
    await renderViaStreamingBridge(fakeComp, "/tmp/out", {});
    expect(makeCancelSignalMock).not.toHaveBeenCalled();
    // cancelSignal forwarded to renderFrames is undefined (no bridge).
    expect(renderFramesMock.mock.calls[0][0].cancelSignal).toBeUndefined();
  });
});
