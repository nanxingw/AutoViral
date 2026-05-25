export interface CaptureWhenChangedOptions {
  /** Max time to wait for the frame to differ from `baseline`. Default 3000ms. */
  timeoutMs?: number;
  /** Poll interval. Default 100ms. */
  pollMs?: number;
}

export interface CaptureResult {
  /** The latest non-empty capture (or "" if capture never produced one). */
  dataUrl: string;
  /** true if the capture differed from `baseline` before the timeout. */
  changed: boolean;
}

/**
 * Poll `capture()` until it returns a non-empty frame that differs from
 * `baseline`, or until `timeoutMs` elapses (#47).
 *
 * The batch "All slides as PNGs" export swaps the on-screen Konva stage via
 * `setCurrentSlide` then reads `toDataURL`. The stage can take >2s to actually
 * repaint the swapped slide (its background `<Img>` loads async + react-konva
 * lag), so a blind fixed `setTimeout(250)` raced the repaint and captured the
 * STALE pre-swap frame — every PNG came out bit-identical. Four prior rounds
 * tried other fixed waits / polling Konva nodes and all failed.
 *
 * Instead of guessing a delay, wait for a deterministic signal: the captured
 * bytes actually changed from the previous slide's frame. The caller chains
 * `baseline` = the last emitted frame, so two consecutive emitted frames can
 * never be identical (the bug's signature) unless the slides genuinely render
 * the same pixels, in which case we time out and emit the (correct) frame with
 * `changed: false` rather than hanging forever.
 *
 * Pure except for the injected `capture` + timers, so it unit-tests with fake
 * timers — no real Konva/canvas needed.
 */
export async function captureWhenChanged(
  capture: () => string,
  baseline: string | null,
  opts: CaptureWhenChangedOptions = {},
): Promise<CaptureResult> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  let last = capture();
  if (last && last !== baseline) return { dataUrl: last, changed: true };

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    last = capture();
    if (last && last !== baseline) return { dataUrl: last, changed: true };
  }
  return { dataUrl: last, changed: false };
}
