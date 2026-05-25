import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireMediaSlot,
  __mediaGateStats,
  __setMaxConcurrentForTests,
  __resetMediaGateForTests,
} from "./mediaLoadGate";

beforeEach(() => __resetMediaGateForTests());

// Regression net for #37: dozens of concurrent <video> loads exhausted the
// browser's ~6/host connection pool and deadlocked the whole preview. This
// gate caps concurrency and queues the rest. The invariants below are what
// keep that deadlock from ever recurring.
describe("mediaLoadGate", () => {
  it("grants immediately while under the concurrency ceiling", async () => {
    __setMaxConcurrentForTests(2);
    const a = acquireMediaSlot();
    const b = acquireMediaSlot();
    await Promise.all([a.granted, b.granted]); // resolve == granted
    expect(__mediaGateStats().active).toBe(2);
    expect(__mediaGateStats().queued).toBe(0);
  });

  it("queues requests beyond the ceiling and never exceeds it", async () => {
    __setMaxConcurrentForTests(2);
    const a = acquireMediaSlot();
    const b = acquireMediaSlot();
    const c = acquireMediaSlot();
    await Promise.all([a.granted, b.granted]);
    expect(__mediaGateStats().active).toBe(2);
    expect(__mediaGateStats().queued).toBe(1);

    let cGranted = false;
    void c.granted.then(() => {
      cGranted = true;
    });
    // c must NOT be granted while the gate is full.
    await Promise.resolve();
    expect(cGranted).toBe(false);
  });

  it("releasing a slot pumps the next queued waiter (FIFO)", async () => {
    __setMaxConcurrentForTests(1);
    const a = acquireMediaSlot();
    const b = acquireMediaSlot();
    await a.granted;

    let bGranted = false;
    void b.granted.then(() => {
      bGranted = true;
    });
    await Promise.resolve();
    expect(bGranted).toBe(false); // still full

    a.release();
    await b.granted; // a's release must hand the slot to b
    expect(bGranted).toBe(true);
    expect(__mediaGateStats().active).toBe(1);
    expect(__mediaGateStats().queued).toBe(0);
  });

  it("cancelling a not-yet-granted request removes it from the queue without consuming a slot", async () => {
    __setMaxConcurrentForTests(1);
    const a = acquireMediaSlot();
    const b = acquireMediaSlot(); // queued
    const c = acquireMediaSlot(); // queued
    await a.granted;
    expect(__mediaGateStats().queued).toBe(2);

    b.release(); // cancel while still waiting in line
    expect(__mediaGateStats().queued).toBe(1);

    let cGranted = false;
    void c.granted.then(() => {
      cGranted = true;
    });
    a.release(); // should skip the cancelled b and grant c
    await c.granted;
    expect(cGranted).toBe(true);
  });

  it("release is idempotent (safe from both load handler and unmount)", async () => {
    __setMaxConcurrentForTests(1);
    const a = acquireMediaSlot();
    await a.granted;
    a.release();
    a.release(); // second call must be a no-op, not a double-decrement
    expect(__mediaGateStats().active).toBe(0);

    // A fresh acquire must still grant — proves active didn't go negative.
    const b = acquireMediaSlot();
    await b.granted;
    expect(__mediaGateStats().active).toBe(1);
  });

  it("raising the ceiling pumps waiting requests", async () => {
    __setMaxConcurrentForTests(1);
    const a = acquireMediaSlot();
    const b = acquireMediaSlot();
    await a.granted;
    expect(__mediaGateStats().queued).toBe(1);

    __setMaxConcurrentForTests(2); // now b can run
    await b.granted;
    expect(__mediaGateStats().active).toBe(2);
  });
});
