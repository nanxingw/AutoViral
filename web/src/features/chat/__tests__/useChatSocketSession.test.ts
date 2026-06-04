/**
 * useChatSocket session-keying tests (I24).
 *
 * The hook now carries the active chat session in the WS path:
 *   /ws/browser/{workId}/{sessionId}
 * Switching the active session (via the activeSession store) must close the
 * old socket and open a NEW one at the switched-to session's path. This is the
 * client half of ADR-008 multi-session — the backend reseeds history over the
 * `message_history` frame on the new connection.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatSocket } from "../useChatSocket";
import { useActiveSession, DEFAULT_SESSION_ID } from "../activeSession";

class MockWS {
  static instances: MockWS[] = [];
  readyState = 0;
  closed = false;
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
    this.closed = true;
    this.readyState = 3;
    this.listeners.close.forEach((fn) => fn(new CloseEvent("close")));
  }
}

beforeEach(() => {
  MockWS.instances = [];
  (globalThis as any).WebSocket = MockWS;
  useActiveSession.setState({ byWork: {} });
});

describe("useChatSocket session keying (I24)", () => {
  it("connects to the 3-segment path with the default session", () => {
    renderHook(() => useChatSocket("w1"));
    expect(MockWS.instances).toHaveLength(1);
    expect(MockWS.instances[0].url).toBe(`/ws/browser/w1/${DEFAULT_SESSION_ID}`);
  });

  it("connects to the active session set in the store", () => {
    act(() => useActiveSession.getState().set("w2", "s_3"));
    renderHook(() => useChatSocket("w2"));
    expect(MockWS.instances[0].url).toBe("/ws/browser/w2/s_3");
  });

  it("honours an explicit sessionId arg over the store", () => {
    act(() => useActiveSession.getState().set("w3", "s_2"));
    renderHook(() => useChatSocket("w3", undefined, undefined, undefined, "s_5"));
    expect(MockWS.instances[0].url).toBe("/ws/browser/w3/s_5");
  });

  it("switching the active session closes the old socket and opens a new path", () => {
    const { rerender } = renderHook(() => useChatSocket("w4"));
    expect(MockWS.instances).toHaveLength(1);
    expect(MockWS.instances[0].url).toBe(`/ws/browser/w4/${DEFAULT_SESSION_ID}`);

    act(() => useActiveSession.getState().set("w4", "s_2"));
    rerender();

    // Old socket disposed, a new one opened at the s_2 path.
    expect(MockWS.instances[0].closed).toBe(true);
    expect(MockWS.instances).toHaveLength(2);
    expect(MockWS.instances[1].url).toBe("/ws/browser/w4/s_2");
  });
});
