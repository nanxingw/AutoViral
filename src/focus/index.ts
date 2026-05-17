/**
 * In-memory focus store keyed by workId.
 *
 * Public surface:
 *   read(workId)             → FocusSnapshot                  (current state)
 *   write(workId, patch)     → FocusSnapshot                  (returns merged)
 *   subscribe(workId, cb)    → () => void (unsubscribe)
 *   reset(workId)            → void                            (test helper)
 *
 * The store is process-local and not persisted. Studio re-establishes
 * focus state via the frontend store when the user reopens a work; the
 * backend's role is to broadcast changes to all bridge subscribers
 * (chat panel + terminal panel + any future agent surface).
 */

import { EMPTY_FOCUS, type FocusSnapshot } from "./types.js";

type Subscriber = (snapshot: FocusSnapshot) => void;

const snapshots = new Map<string, FocusSnapshot>();
const subscribers = new Map<string, Set<Subscriber>>();

export function read(workId: string): FocusSnapshot {
  return snapshots.get(workId) ?? { ...EMPTY_FOCUS };
}

export function write(
  workId: string,
  patch: Partial<FocusSnapshot>,
): FocusSnapshot {
  const current = read(workId);
  const next: FocusSnapshot = { ...current, ...patch };
  snapshots.set(workId, next);

  const subs = subscribers.get(workId);
  if (subs && subs.size > 0) {
    for (const cb of subs) {
      try {
        cb(next);
      } catch {
        // A misbehaving subscriber shouldn't take down the broadcast.
      }
    }
  }

  return next;
}

export function subscribe(workId: string, cb: Subscriber): () => void {
  let set = subscribers.get(workId);
  if (!set) {
    set = new Set();
    subscribers.set(workId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) {
      subscribers.delete(workId);
    }
  };
}

/** Test helper — clears state for a workId. */
export function reset(workId?: string): void {
  if (workId === undefined) {
    snapshots.clear();
    subscribers.clear();
  } else {
    snapshots.delete(workId);
    subscribers.delete(workId);
  }
}

export type { FocusSnapshot, FocusEvent } from "./types.js";
export { EMPTY_FOCUS } from "./types.js";
