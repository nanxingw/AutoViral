import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalSocket } from "../useTerminalSocket";

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1;
  readyState = MockWS.OPEN;
  sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(new CloseEvent("close")); }
}

describe("useTerminalSocket", () => {
  beforeEach(() => { (globalThis as any).WebSocket = MockWS; MockWS.instances = []; });
  afterEach(() => { delete (globalThis as any).WebSocket; });

  it("sends keystrokes as {t:'data'} frames", async () => {
    const onData = vi.fn();
    const { result } = renderHook(() => useTerminalSocket("w_test", onData));
    await act(() => Promise.resolve());
    act(() => result.current.send("hello"));
    expect(MockWS.instances[0].sent).toContain('{"t":"data","d":"hello"}');
  });

  it("forwards server data frames to onData callback", async () => {
    const onData = vi.fn();
    renderHook(() => useTerminalSocket("w_test", onData));
    await act(() => Promise.resolve());
    act(() => {
      MockWS.instances[0].onmessage?.(new MessageEvent("message", {
        data: JSON.stringify({ t: "data", d: "from-server" }),
      }));
    });
    expect(onData).toHaveBeenCalledWith("from-server");
  });
});
