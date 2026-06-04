/**
 * killTerminalSession tests (ADR-008 §6 / I25).
 *
 * The strip's delete path opens a one-shot WS on the session's terminal path,
 * sends a single {"t":"kill"} frame (the only thing that disposes a pty — a
 * plain ws.close does NOT, the pty survives reconnect), then closes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { killTerminalSession } from "../killTerminalSession";

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1;
  readyState = 0; // CONNECTING — onopen fires async like the real thing
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWS.OPEN;
      this.onopen?.();
    });
  }
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).WebSocket = MockWS;
  MockWS.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).WebSocket;
});

describe("killTerminalSession (I25)", () => {
  it("opens a socket on the 3-segment terminal path for (workId, sessionId)", async () => {
    killTerminalSession("w_kill", "s_2");
    await vi.advanceTimersByTimeAsync(0);
    expect(MockWS.instances).toHaveLength(1);
    expect(MockWS.instances[0].url).toBe("ws://localhost:3000/ws/terminal/w_kill/s_2");
  });

  it("sends exactly one {t:'kill'} frame once the socket opens, then closes", async () => {
    killTerminalSession("w_kill", "s_3");
    await vi.advanceTimersByTimeAsync(0); // flush onopen
    const ws = MockWS.instances[0];
    expect(ws.sent).toEqual(['{"t":"kill"}']);
    // Close is deferred a tick so the frame flushes first.
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.closed).toBe(true);
  });

  it("does nothing (no throw) when WebSocket is unavailable", () => {
    delete (globalThis as any).WebSocket;
    expect(() => killTerminalSession("w_kill", "s_1")).not.toThrow();
  });
});
