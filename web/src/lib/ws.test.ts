import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReconnectingWS } from "./ws";

class MockWS {
  static instances: MockWS[] = [];
  readyState = 0;
  listeners: Record<string, Function[]> = { open: [], message: [], close: [], error: [] };
  sent: string[] = [];

  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.listeners.open.forEach((fn) => fn(new Event("open")));
    });
  }
  addEventListener(type: string, fn: Function) { this.listeners[type].push(fn); }
  send(data: string) { this.sent.push(data); }
  close() {
    this.readyState = 3;
    this.listeners.close.forEach((fn) => fn(new CloseEvent("close")));
  }
}

describe("ReconnectingWS", () => {
  beforeEach(() => {
    MockWS.instances = [];
    (globalThis as any).WebSocket = MockWS;
  });

  it("buffers messages while disconnected and replays on open", async () => {
    const ws = new ReconnectingWS("ws://x");
    ws.send("queued");
    await Promise.resolve(); // let microtasks resolve open
    expect(MockWS.instances[0].sent).toContain("queued");
    ws.dispose();
  });

  it("attempts reconnect after close", async () => {
    vi.useFakeTimers();
    const ws = new ReconnectingWS("ws://x", { backoffMs: 50 });
    await Promise.resolve();
    MockWS.instances[0].close();
    vi.advanceTimersByTime(60);
    expect(MockWS.instances.length).toBe(2);
    ws.dispose();
    vi.useRealTimers();
  });

  it("resets backoff after successful open", async () => {
    vi.useFakeTimers();
    const ws = new ReconnectingWS("ws://x", { backoffMs: 50, maxBackoffMs: 800 });

    await Promise.resolve(); // first open
    // simulate close → reconnect → open → close again
    MockWS.instances[0].close();
    vi.advanceTimersByTime(60); // 50ms backoff first wait
    await Promise.resolve(); // open second instance
    // After successful open, backoff should reset to 50; close again and verify next reconnect uses ~50ms
    MockWS.instances[1].close();
    vi.advanceTimersByTime(60); // if backoff reset, this should fire; if it grew to 100ms, it would not
    expect(MockWS.instances.length).toBe(3);

    ws.dispose();
    vi.useRealTimers();
  });
});
