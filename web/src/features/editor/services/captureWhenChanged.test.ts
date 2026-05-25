import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureWhenChanged } from "./captureWhenChanged";

// #47 — the deterministic "frame changed" wait that replaced the blind
// setTimeout(250) which captured stale pre-swap frames (bit-identical PNGs).
describe("captureWhenChanged", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns immediately when the first capture already differs from baseline", async () => {
    const capture = vi.fn(() => "FRAME_B");
    const p = captureWhenChanged(capture, "FRAME_A", { timeoutMs: 3000, pollMs: 100 });
    await expect(p).resolves.toEqual({ dataUrl: "FRAME_B", changed: true });
    expect(capture).toHaveBeenCalledTimes(1); // no polling needed
  });

  it("polls past stale frames and returns once the bytes actually change", async () => {
    let frame = "STALE"; // equals baseline → the pre-swap frame still on canvas
    const capture = vi.fn(() => frame);
    const p = captureWhenChanged(capture, "STALE", { timeoutMs: 3000, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(250); // a couple polls, still stale
    frame = "FRESH"; // the swapped slide finally painted
    await vi.advanceTimersByTimeAsync(100); // next poll observes it
    await expect(p).resolves.toEqual({ dataUrl: "FRESH", changed: true });
  });

  it("times out and returns the last frame with changed:false when it never differs", async () => {
    const capture = vi.fn(() => "STALE");
    const p = captureWhenChanged(capture, "STALE", { timeoutMs: 500, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toEqual({ dataUrl: "STALE", changed: false });
  });

  it("treats a null baseline as 'any non-empty frame is acceptable'", async () => {
    const capture = vi.fn(() => "ANY");
    const p = captureWhenChanged(capture, null, {});
    await expect(p).resolves.toEqual({ dataUrl: "ANY", changed: true });
  });

  it("ignores empty captures and keeps polling for a non-empty frame", async () => {
    let frame = ""; // stage not ready yet
    const capture = vi.fn(() => frame);
    const p = captureWhenChanged(capture, null, { timeoutMs: 3000, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    frame = "REAL";
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toEqual({ dataUrl: "REAL", changed: true });
  });
});
