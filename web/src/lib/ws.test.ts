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
});
