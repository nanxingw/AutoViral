// Global media-load concurrency gate (issue #37).
//
// Problem: a heavy-asset work mounts dozens of <video> elements at once —
// LibraryTab poster frames + every Filmstrip's per-timestamp frame extractor +
// the Remotion preview Player. Each <video> with a `src` opens an HTTP
// connection that video streams hold open. Chrome caps concurrent connections
// at ~6 per host, so once ~6+ thumbnail videos are loading, the rest — and
// crucially the PREVIEW — starve at readyState 0 forever. The editor looks
// frozen with no feedback.
//
// Fix: route every *thumbnail* video load through this FIFO semaphore so at
// most MAX_CONCURRENT_MEDIA_LOADS are in flight at once. Each load releases its
// slot as soon as it has the data it needs (metadata frame / extracted frame),
// freeing the connection for the next queued load — and leaving headroom in the
// per-host budget for the ungated preview Player to actually load and play.

/** Max thumbnail video loads in flight at once. Kept a few below Chrome's ~6
 *  per-host connection cap so the ungated preview <video> always has headroom. */
export const MAX_CONCURRENT_MEDIA_LOADS = 4;

let maxConcurrent = MAX_CONCURRENT_MEDIA_LOADS;
let active = 0;

interface Waiter {
  grant: () => void;
}
const waiters: Waiter[] = [];

function pump(): void {
  while (active < maxConcurrent && waiters.length > 0) {
    const w = waiters.shift()!;
    active += 1;
    w.grant();
  }
}

export interface MediaSlot {
  /** Resolves once a load slot has been granted. Await before setting `src`. */
  readonly granted: Promise<void>;
  /** Release the slot — or cancel the pending request if not yet granted.
   *  Idempotent: safe to call from both a load-event handler and unmount. */
  release(): void;
}

/** Request a media-load slot. The returned `granted` promise resolves
 *  immediately if the gate has spare capacity, otherwise when an earlier
 *  caller releases. Always call `release()` (on load/error AND on unmount). */
export function acquireMediaSlot(): MediaSlot {
  let settled = false;
  let grantedFlag = false;
  let resolveGranted!: () => void;
  const granted = new Promise<void>((res) => {
    resolveGranted = res;
  });

  const waiter: Waiter = {
    grant: () => {
      grantedFlag = true;
      resolveGranted();
    },
  };
  waiters.push(waiter);

  const release = (): void => {
    if (settled) return;
    settled = true;
    if (grantedFlag) {
      active -= 1;
      pump();
    } else {
      // Cancelled before being granted — drop it from the queue so it never
      // consumes a slot (e.g. a tile unmounted while still waiting in line).
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
    }
  };

  pump();
  return { granted, release };
}

/** Test-only — observe gate internals. */
export function __mediaGateStats(): { active: number; queued: number } {
  return { active, queued: waiters.length };
}

/** Test-only — override the concurrency ceiling. */
export function __setMaxConcurrentForTests(n: number): void {
  maxConcurrent = n;
  pump();
}

/** Test-only — reset all gate state between tests. */
export function __resetMediaGateForTests(): void {
  maxConcurrent = MAX_CONCURRENT_MEDIA_LOADS;
  active = 0;
  waiters.length = 0;
}
