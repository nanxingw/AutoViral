// Approval gate — synchronous request/response over an asynchronous bus.
//
// `POST /ask` creates a pending promise keyed by an opaque askId, then
// broadcasts a "ui-ask" UiEvent so the Studio's ApprovalPrompt modal
// shows. When the user clicks YES/NO the ApprovalPrompt sends an
// `approval-response` frame on /ws/bridge/:workId; the inbound handler
// in bridge-ws.ts calls answerAsk(askId, answer) which resolves the
// pending promise, and /ask's HTTP response unblocks.
//
// Timeout: each ask carries its own timeoutMs. If it elapses we
// resolve with "timeout" and the route returns exit code 124 to the
// CLI caller.

import { randomBytes } from "node:crypto";

export type AskAnswer = "yes" | "no" | "cancelled" | "timeout";

interface Pending {
  resolve: (answer: AskAnswer) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();

export function createAsk(
  workId: string,
  timeoutMs: number,
): { askId: string; promise: Promise<AskAnswer> } {
  const askId = `ask_${workId}_${randomBytes(4).toString("hex")}`;
  const promise = new Promise<AskAnswer>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(askId);
      resolve("timeout");
    }, timeoutMs);
    pending.set(askId, { resolve, timer });
  });
  return { askId, promise };
}

export function answerAsk(
  askId: string,
  answer: "yes" | "no" | "cancelled",
): boolean {
  const p = pending.get(askId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(askId);
  p.resolve(answer);
  return true;
}

/** Test helper — clear any in-flight asks. Production code should never call this. */
export function _clearPending(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
}
