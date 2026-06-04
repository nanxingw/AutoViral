// I21 — unit tests for the single-frame Remotion still path. We mock
// remotion-paths (serveUrl + browserExecutable) + @remotion/renderer so no real
// Chromium launches; the tests assert that:
//   1. the resolved serveUrl flows into BOTH selectComposition + renderStill
//      (same source as the mp4 path → still is faithful to the deliverable)
//   2. inputProps {comp}, png imageFormat, overwrite, and dimension overrides
//      are forwarded
//   3. the requested frame is clamped into [0, totalFrames-1]

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const renderStillMock = vi.fn(async (_args: unknown) => ({
  buffer: null,
  contentType: "image/png",
}));

vi.mock("./remotion-paths.js", () => ({
  resolveRemotionServeUrl: () => resolveServeUrlMock(),
  remotionBrowserExecutable: () => browserExecutableMock(),
}));
vi.mock("@remotion/renderer", () => ({
  renderStill: (args: unknown) => renderStillMock(args),
  selectComposition: (args: unknown) => selectCompositionMock(args),
}));

const { renderCompositionStill } = await import("./remotion-still.js");

const fakeComp = {
  duration: 2, // 2s
  fps: 10, // → 20 total frames
  width: 1080,
  height: 1920,
  title: "test",
};

beforeEach(() => {
  resolveServeUrlMock.mockClear();
  browserExecutableMock.mockClear();
  selectCompositionMock.mockClear();
  renderStillMock.mockClear();
});

describe("renderCompositionStill", () => {
  it("forwards the resolved serveUrl + inputProps + png format into renderStill", async () => {
    const out = await renderCompositionStill(fakeComp, {
      outFile: "/tmp/out/snap.png",
      frame: 5,
    });
    expect(out).toBe("/tmp/out/snap.png");
    expect(resolveServeUrlMock).toHaveBeenCalledTimes(1);
    // serveUrl flows into BOTH Remotion calls — same source as the mp4 path.
    expect(selectCompositionMock.mock.calls[0][0]).toMatchObject({
      serveUrl: "/fake/bundle/url",
      id: "main",
      inputProps: { comp: fakeComp },
    });
    const stillArgs = renderStillMock.mock.calls[0][0] as Record<string, unknown>;
    expect(stillArgs.serveUrl).toBe("/fake/bundle/url");
    expect(stillArgs.imageFormat).toBe("png");
    expect(stillArgs.output).toBe("/tmp/out/snap.png");
    expect(stillArgs.overwrite).toBe(true);
    expect(stillArgs.inputProps).toEqual({ comp: fakeComp });
    // Dimension overrides mirror the mp4 path so non-default aspect ratios
    // snapshot at the right size.
    expect(stillArgs.composition).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 10,
      durationInFrames: 20,
    });
  });

  it("captures the requested frame when in range", async () => {
    await renderCompositionStill(fakeComp, { outFile: "/tmp/a.png", frame: 7 });
    expect((renderStillMock.mock.calls[0][0] as { frame: number }).frame).toBe(7);
  });

  it("clamps a frame past the end to the last real frame", async () => {
    await renderCompositionStill(fakeComp, { outFile: "/tmp/b.png", frame: 999 });
    // 20 total frames → last index 19.
    expect((renderStillMock.mock.calls[0][0] as { frame: number }).frame).toBe(19);
  });

  it("clamps a negative frame to 0", async () => {
    await renderCompositionStill(fakeComp, { outFile: "/tmp/c.png", frame: -5 });
    expect((renderStillMock.mock.calls[0][0] as { frame: number }).frame).toBe(0);
  });
});
