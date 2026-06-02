// #44 — unit tests for the canonical Remotion render path's cancellation
// wiring. We mock @remotion/bundler + @remotion/renderer so no real Chromium
// launches; the tests assert the AbortSignal → Remotion cancelSignal bridge:
//   1. an already-aborted signal throws before the expensive bundle()
//   2. aborting mid-render fires Remotion's cancel() (which makes renderMedia
//      reject) and forwards cancelSignal into renderMedia
//   3. with no signal, no cancel signal is created and a path is returned
//
// buildSafeOutputFilename is also covered (pure, no mock needed).

import { describe, it, expect, vi, beforeEach } from "vitest";

// After the packaging refactor the bundle() call moved into remotion-paths.ts
// (resolveRemotionServeUrl). We mock that module directly so the unit test stays
// isolated from src/paths.ts + real webpack, while still asserting the exact
// external behavior: the resolved serveUrl flows into selectComposition +
// renderMedia, and browserExecutable defaults to undefined in this env.
const resolveServeUrlMock = vi.fn(async () => "/fake/bundle/url");
const browserExecutableMock = vi.fn((): string | undefined => undefined);

const selectCompositionMock = vi.fn(async (_args: unknown) => ({
  id: "main",
  width: 100,
  height: 100,
  fps: 30,
  durationInFrames: 10,
  defaultProps: {},
  props: {},
  defaultCodec: null,
}));

const renderMediaHolder: { impl: (args: any) => Promise<unknown> } = {
  impl: async () => undefined,
};
const renderMediaMock = vi.fn((args: any) => renderMediaHolder.impl(args));

// Controllable makeCancelSignal — cancelSignal registers callbacks, cancel()
// fires them (mirrors how renderMedia registers an internal abort handler).
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

vi.mock("./remotion-paths.js", () => ({
  resolveRemotionServeUrl: () => resolveServeUrlMock(),
  remotionBrowserExecutable: () => browserExecutableMock(),
}));
vi.mock("@remotion/renderer", () => ({
  renderMedia: (args: unknown) => renderMediaMock(args),
  selectComposition: (args: unknown) => selectCompositionMock(args),
  makeCancelSignal: () => makeCancelSignalMock(),
}));

const { renderCompositionToMp4, buildSafeOutputFilename } = await import(
  "./remotion-renderer.js"
);

const fakeComp = {
  duration: 1,
  fps: 10,
  width: 100,
  height: 100,
  title: "test",
};

beforeEach(() => {
  resolveServeUrlMock.mockClear();
  browserExecutableMock.mockClear();
  selectCompositionMock.mockClear();
  renderMediaMock.mockClear();
  makeCancelSignalMock.mockClear();
  cancelMock.mockClear();
  cancelCallbacks.length = 0;
  renderMediaHolder.impl = async () => undefined;
});

describe("buildSafeOutputFilename", () => {
  it("slugifies the title and appends a timestamp + .mp4", () => {
    const out = buildSafeOutputFilename("My Cool Title!", new Date("2026-05-26T01:02:03Z"));
    expect(out).toBe("my-cool-title-2026-05-26-01-02-03.mp4");
  });
  it("falls back to a default slug for an empty title", () => {
    const out = buildSafeOutputFilename(undefined, new Date("2026-05-26T01:02:03Z"));
    expect(out).toBe("autoviral-export-2026-05-26-01-02-03.mp4");
  });
});

describe("renderCompositionToMp4 — happy path", () => {
  it("resolves the serveUrl, selects, renders, and returns an .mp4 path", async () => {
    const out = await renderCompositionToMp4(fakeComp, "/tmp/out", {});
    expect(resolveServeUrlMock).toHaveBeenCalledTimes(1);
    expect(selectCompositionMock).toHaveBeenCalledTimes(1);
    expect(renderMediaMock).toHaveBeenCalledTimes(1);
    expect(out.endsWith(".mp4")).toBe(true);
    // serveUrl from resolveRemotionServeUrl flows into both Remotion calls.
    expect(selectCompositionMock.mock.calls[0][0]).toMatchObject({
      serveUrl: "/fake/bundle/url",
      id: "main",
    });
    expect(renderMediaMock.mock.calls[0][0].serveUrl).toBe("/fake/bundle/url");
    // browserExecutable defaults to undefined in this env (auto-download in dev).
    expect((selectCompositionMock.mock.calls[0][0] as any).browserExecutable).toBeUndefined();
    expect(renderMediaMock.mock.calls[0][0].browserExecutable).toBeUndefined();
  });

  it("forwards Remotion onProgress(renderedFrames) as a 0..1 fraction", async () => {
    const progress = vi.fn();
    renderMediaHolder.impl = async (args: any) => {
      args.onProgress({ renderedFrames: 5 }); // 5/10 = 0.5
      args.onProgress({ renderedFrames: 10 }); // clamped to 1
      return undefined;
    };
    await renderCompositionToMp4(fakeComp, "/tmp/out", { onProgress: progress });
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(progress).toHaveBeenCalledWith(1);
  });
});

describe("renderCompositionToMp4 — #44 cancellation wiring", () => {
  it("throws before resolving the serveUrl when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      renderCompositionToMp4(fakeComp, "/tmp/out", { signal: ac.signal }),
    ).rejects.toThrow(/aborted before render/);
    expect(resolveServeUrlMock).not.toHaveBeenCalled();
    expect(renderMediaMock).not.toHaveBeenCalled();
  });

  it("aborting mid-render bridges AbortSignal → Remotion cancel() and rejects", async () => {
    const ac = new AbortController();
    renderMediaHolder.impl = (args: any) =>
      new Promise((_res, rej) => {
        expect(args.cancelSignal).toBeTypeOf("function"); // forwarded
        args.cancelSignal(() => rej(new Error("Render was cancelled")));
      });

    const promise = renderCompositionToMp4(fakeComp, "/tmp/out", { signal: ac.signal });
    setTimeout(() => ac.abort(), 0);

    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(makeCancelSignalMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT create a cancel signal when no AbortSignal is passed", async () => {
    await renderCompositionToMp4(fakeComp, "/tmp/out", {});
    expect(makeCancelSignalMock).not.toHaveBeenCalled();
    expect(renderMediaMock.mock.calls[0][0].cancelSignal).toBeUndefined();
  });
});
