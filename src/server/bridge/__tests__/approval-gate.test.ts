// Approval gate state machine — three paths:
//   1. createAsk → answerAsk → promise resolves with the answer
//   2. createAsk → (timeout elapses) → promise resolves "timeout"
//   3. answerAsk for an unknown id returns false (no throw)

import { describe, expect, it, beforeEach, vi } from "vitest";
import { createAsk, answerAsk, _clearPending } from "../approval-gate.js";

describe("approval-gate", () => {
  beforeEach(() => _clearPending());

  it("answerAsk resolves the pending promise with the given answer", async () => {
    const { askId, promise } = createAsk("w1", 30_000);
    expect(answerAsk(askId, "yes")).toBe(true);
    await expect(promise).resolves.toBe("yes");
  });

  it("answerAsk for an unknown id returns false (no throw)", () => {
    expect(answerAsk("ask_nonexistent_xx", "yes")).toBe(false);
  });

  it("timeout resolves with 'timeout' if no answer arrives", async () => {
    vi.useFakeTimers();
    const { promise } = createAsk("w1", 100);
    vi.advanceTimersByTime(150);
    await expect(promise).resolves.toBe("timeout");
    vi.useRealTimers();
  });

  it("answerAsk after timeout returns false (entry was cleared)", async () => {
    vi.useFakeTimers();
    const { askId, promise } = createAsk("w1", 100);
    vi.advanceTimersByTime(150);
    await promise; // ensure timeout fired
    expect(answerAsk(askId, "yes")).toBe(false);
    vi.useRealTimers();
  });

  it("supports 'no' and 'cancelled' answers", async () => {
    const a = createAsk("w1", 30_000);
    answerAsk(a.askId, "no");
    await expect(a.promise).resolves.toBe("no");

    const b = createAsk("w2", 30_000);
    answerAsk(b.askId, "cancelled");
    await expect(b.promise).resolves.toBe("cancelled");
  });
});
