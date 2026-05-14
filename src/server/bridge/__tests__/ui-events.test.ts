// UiEventBus pub/sub — Phase 3 Task 3.1. The bridge HTTP routes publish
// "ui-*" events on this bus; the /ws/bridge/:workId WebSocket subscribes
// and forwards JSON to the Studio. Per-workId isolation is the only
// non-trivial invariant here.

import { describe, expect, it, vi } from "vitest";
import { UiEventBus, uiEventBus } from "../ui-events.js";

describe("UiEventBus", () => {
  it("delivers a published event to all subscribers of the same workId", () => {
    const bus = new UiEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    bus.subscribe("w1", a);
    bus.subscribe("w1", b);
    bus.subscribe("w2", c);
    bus.publish("w1", {
      type: "ui-toast",
      workId: "w1",
      ts: 0,
      payload: { message: "x", kind: "info", durationMs: 1000 },
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).not.toHaveBeenCalled();
  });

  it("unsubscribe() stops further deliveries", () => {
    const bus = new UiEventBus();
    const fn = vi.fn();
    const off = bus.subscribe("w1", fn);
    bus.publish("w1", { type: "ui-play", workId: "w1", ts: 1, payload: null });
    off();
    bus.publish("w1", { type: "ui-pause", workId: "w1", ts: 2, payload: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("publish to a workId with no subscribers is a no-op (no throw)", () => {
    const bus = new UiEventBus();
    expect(() => bus.publish("orphan", { type: "ui-toast", workId: "orphan", ts: 0, payload: null })).not.toThrow();
  });

  it("module-level uiEventBus is a singleton (same reference per import)", () => {
    expect(uiEventBus).toBe(uiEventBus);
    expect(uiEventBus).toBeInstanceOf(UiEventBus);
  });
});
