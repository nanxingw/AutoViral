import { describe, it, expect } from "vitest";
import { FrameReorderBuffer } from "./frame-reorder-buffer.js";

describe("FrameReorderBuffer", () => {
  it("frame 0 resolves immediately on a fresh buffer", async () => {
    const buf = new FrameReorderBuffer({ totalFrames: 10 });
    await expect(buf.waitForFrame(0)).resolves.toBeUndefined();
  });

  it("future frame waits until advanceTo releases it", async () => {
    const buf = new FrameReorderBuffer({ totalFrames: 10 });
    let frame3Resolved = false;
    const frame3Promise = buf.waitForFrame(3).then(() => {
      frame3Resolved = true;
    });
    // Microtask flush to ensure the promise has registered the waiter.
    await new Promise<void>((r) => setImmediate(r));
    expect(frame3Resolved).toBe(false);
    buf.advanceTo(3);
    await frame3Promise;
    expect(frame3Resolved).toBe(true);
  });

  it("releases waiters in order across multiple advanceTo calls", async () => {
    const buf = new FrameReorderBuffer({ totalFrames: 10 });
    const log: number[] = [];
    const promises = [1, 2, 3, 4].map((n) =>
      buf.waitForFrame(n).then(() => log.push(n)),
    );
    await new Promise<void>((r) => setImmediate(r));
    expect(log).toEqual([]);

    buf.advanceTo(2); // releases waiter for frame 1 AND 2 (current → 2)
    await Promise.race([
      Promise.all(promises.slice(0, 2)),
      new Promise<void>((r) => setTimeout(r, 50)),
    ]);
    expect(log).toEqual([1, 2]);

    buf.advanceTo(4); // releases 3 and 4
    await Promise.all(promises);
    expect(log).toEqual([1, 2, 3, 4]);
  });

  it("simulates the canonical streaming-encoder use case (parallel workers, ordered sink)", async () => {
    // 3 workers, 6 frames total. Each worker is assigned alternating
    // frames so they finish out of order; the buffer must serialize
    // writes back in 0..5 order.
    const buf = new FrameReorderBuffer({ totalFrames: 6 });
    const sink: number[] = [];

    async function workerA() {
      // owns frames 0, 3
      for (const n of [0, 3]) {
        await buf.waitForFrame(n);
        sink.push(n);
        buf.advanceTo(n + 1);
      }
    }
    async function workerB() {
      // owns frames 1, 4
      for (const n of [1, 4]) {
        await buf.waitForFrame(n);
        sink.push(n);
        buf.advanceTo(n + 1);
      }
    }
    async function workerC() {
      // owns frames 2, 5
      for (const n of [2, 5]) {
        await buf.waitForFrame(n);
        sink.push(n);
        buf.advanceTo(n + 1);
      }
    }

    await Promise.all([workerC(), workerB(), workerA()]); // launch in reverse
    expect(sink).toEqual([0, 1, 2, 3, 4, 5]);
    expect(buf.isDrained()).toBe(true);
  });

  it("rejects waitForFrame for already-past frame (double write detection)", async () => {
    const buf = new FrameReorderBuffer({ totalFrames: 5 });
    buf.advanceTo(3);
    await expect(buf.waitForFrame(1)).rejects.toThrow(/already past/);
  });

  it("throws RangeError for frame >= totalFrames", () => {
    const buf = new FrameReorderBuffer({ totalFrames: 5 });
    expect(() => buf.waitForFrame(10)).toThrow(RangeError);
  });

  it("throws RangeError for negative frame index", () => {
    const buf = new FrameReorderBuffer({ totalFrames: 5 });
    expect(() => buf.waitForFrame(-1)).toThrow(RangeError);
  });

  it("idempotent advanceTo (calling with same n twice is harmless)", () => {
    const buf = new FrameReorderBuffer({ totalFrames: 5 });
    buf.advanceTo(2);
    buf.advanceTo(2); // no-op
    buf.advanceTo(1); // no-op (already past)
    // Drain should still work normally
    buf.advanceTo(5);
    expect(buf.isDrained()).toBe(true);
  });

  it("constructor rejects invalid totalFrames", () => {
    expect(() => new FrameReorderBuffer({ totalFrames: -1 })).toThrow();
    expect(() => new FrameReorderBuffer({ totalFrames: NaN })).toThrow();
    expect(() => new FrameReorderBuffer({ totalFrames: Infinity })).toThrow();
  });

  it("isDrained reports correctly during partial advance", () => {
    const buf = new FrameReorderBuffer({ totalFrames: 4 });
    expect(buf.isDrained()).toBe(false);
    buf.advanceTo(3);
    expect(buf.isDrained()).toBe(false);
    buf.advanceTo(4);
    expect(buf.isDrained()).toBe(true);
  });
});
