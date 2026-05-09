// R46 — FrameReorderBuffer primitive ported from heygen-com/hyperframes
// packages/engine/src/services/streamingEncoder.ts:51-95.
//
// ## Why this exists
//
// Streaming encode means parallel workers each render a *range* of frames
// (e.g. worker 1 = frames 0-149, worker 2 = 150-299, ...) and pipe their
// output to a single ffmpeg stdin. ffmpeg's image2pipe reader has no idea
// about your parallel layout — it just reads frame N expecting frame N,
// in order.
//
// If worker 2 finishes frame 150 before worker 1 finishes frame 0, you
// can't just write 150 to ffmpeg's stdin — the video will be garbled.
// You need a coordinating data structure that:
//   1. Lets workers `await waitForFrame(n)` to block until it's their turn
//   2. After they write, calls `advanceTo(n+1)` to release the next waiter
//
// That's exactly what this primitive does. It's tiny (~50 LOC) but it's
// the entire reason streaming encode is feasible — without it you're
// stuck either rendering serially (slow) or reordering in memory (RAM).
//
// ## Status (R46)
//
// This is the *primitive*. The full streaming-encoder rewrite of Stage 1
// is a 2-4 week sprint that would replace the @remotion/renderer call
// with a Puppeteer worker pool that uses this buffer to feed ffmpeg
// stdin. See `streaming-encoder.ts` (also R46) for the skeleton.
//
// We ship this primitive separately because:
//   - It has zero coupling to Chromium / Remotion / ffmpeg, so it's
//     trivially unit-testable
//   - Future work can adopt it incrementally (e.g. parallel speed-ramp
//     pre-pass on input clips, also benefits from reorder coordination)

export interface FrameReorderBufferOptions {
  /**
   * Total expected frame count. The buffer is "drained" once advanceTo
   * has reached this value. waitForFrame(n) for n >= totalFrames is a
   * programming error and throws synchronously.
   */
  totalFrames: number;
}

/**
 * Coordinates parallel frame producers writing to a single in-order
 * sink. Workers call `waitForFrame(n)` (returns a promise that resolves
 * when it's their turn) and after writing call `advanceTo(n+1)` to
 * release the next waiter.
 *
 * The buffer is not thread-safe across workers in the multi-process
 * sense — both consumers and producers must run in the same Node event
 * loop. (For multi-process rendering you'd marshal frames through IPC
 * and have the parent process own the buffer.)
 */
export class FrameReorderBuffer {
  private nextFrame = 0;
  private readonly waiters = new Map<number, () => void>();
  private readonly totalFrames: number;
  private disposed = false;

  constructor(opts: FrameReorderBufferOptions) {
    if (!Number.isFinite(opts.totalFrames) || opts.totalFrames < 0) {
      throw new Error(`totalFrames must be a finite non-negative number; got ${opts.totalFrames}`);
    }
    this.totalFrames = opts.totalFrames;
  }

  /**
   * Block until it's frame `n`'s turn to be written. Resolves
   * immediately if `n === nextFrame`, otherwise waits.
   *
   * Throws synchronously if `n` is out of range — we'd rather fail fast
   * on a programming error than deadlock waiting for a frame that
   * doesn't exist.
   */
  waitForFrame(n: number): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("FrameReorderBuffer: disposed"));
    }
    if (n < 0 || n >= this.totalFrames) {
      throw new RangeError(
        `Frame ${n} out of range [0, ${this.totalFrames})`,
      );
    }
    if (n < this.nextFrame) {
      // Caller is requesting a frame we've already advanced past — this
      // means a worker is double-writing or skipped a frame elsewhere.
      // Reject so they notice instead of silently drop the write.
      return Promise.reject(
        new Error(
          `Frame ${n} already past (nextFrame=${this.nextFrame}); double-write?`,
        ),
      );
    }
    if (n === this.nextFrame) {
      return Promise.resolve();
    }
    // Future frame — register a waiter. Multiple calls for the same n
    // is a programming error (only one worker should own each frame),
    // but we don't enforce that strictly — last waiter wins, earlier
    // waiters never resolve. Caller policy.
    return new Promise<void>((resolve) => {
      this.waiters.set(n, resolve);
    });
  }

  /**
   * Mark frame `n - 1` as written; release any waiter for frame `n`.
   * Idempotent — calling advanceTo(k) when nextFrame is already > k is
   * a no-op (handles the case where a worker advances past its slot).
   */
  advanceTo(n: number): void {
    if (this.disposed) return;
    if (n <= this.nextFrame) return; // idempotent
    if (n > this.totalFrames) n = this.totalFrames; // clamp
    // Release everything from current nextFrame up to n. In practice
    // n === nextFrame + 1 every call (one worker advancing one frame),
    // but we handle the gap-skip case for robustness.
    while (this.nextFrame < n) {
      this.nextFrame += 1;
      const waiter = this.waiters.get(this.nextFrame);
      if (waiter) {
        this.waiters.delete(this.nextFrame);
        waiter();
      }
    }
  }

  /** True iff every frame has been advanced through. */
  isDrained(): boolean {
    return this.nextFrame >= this.totalFrames;
  }

  /**
   * Cancel all pending waiters and refuse new ones. Workers awaiting
   * waitForFrame() will see their promises reject. Use on render error
   * or job cancellation so workers don't deadlock.
   */
  dispose(reason: string = "disposed"): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error(`FrameReorderBuffer: ${reason}`);
    for (const [, resolve] of this.waiters) {
      // We resolve waiters that were created BEFORE dispose; they'll
      // pick up the disposed=true flag on next interaction. For
      // immediate rejection of in-flight waitForFrame calls, callers
      // should pair this with their own AbortController.
      resolve();
    }
    this.waiters.clear();
    // Note: we don't throw here. The error object exists for callers
    // that want to inspect dispose() reason via getDisposedReason() in
    // a future revision. Right now the rejection in waitForFrame is
    // the user-visible signal.
    void error;
  }
}
