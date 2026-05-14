import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalSocket } from "../useTerminalSocket";

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1;
  /** When true, MockWS suppresses the auto-open so reconnect tests can
   *  simulate a connect-then-immediate-fail backoff sequence. */
  static autoOpen = true;
  readyState = MockWS.OPEN;
  sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(public url: string) {
    MockWS.instances.push(this);
    if (MockWS.autoOpen) {
      queueMicrotask(() => this.onopen?.(new Event("open")));
    }
  }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(new CloseEvent("close")); }
  /** Test helper — simulate the server dropping the socket. */
  fail() { this.onclose?.(new CloseEvent("close")); }
}

describe("useTerminalSocket", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    MockWS.autoOpen = true;
  });
  afterEach(() => {
    delete (globalThis as any).WebSocket;
    vi.useRealTimers();
  });

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

  it("auto-reconnects with bounded backoff and gives up after 3 tries", async () => {
    vi.useFakeTimers();
    const onData = vi.fn();
    const { result } = renderHook(() => useTerminalSocket("w_test", onData));
    // Flush queueMicrotask → first connection opens.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(MockWS.instances).toHaveLength(1);
    expect(result.current.status).toBe("open");

    // Disable auto-open so subsequent connect attempts stay pending — we
    // simulate the server being persistently unavailable to exercise the
    // bounded backoff schedule.
    MockWS.autoOpen = false;

    // Drop the live socket. First reconnect scheduled at 1s.
    act(() => MockWS.instances[0].fail());
    expect(result.current.status).toBe("reconnecting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockWS.instances).toHaveLength(2);
    // Attempt 1 fails before opening — second reconnect at 2s.
    act(() => MockWS.instances[1].fail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(MockWS.instances).toHaveLength(3);
    // Attempt 2 fails — third reconnect at 5s.
    act(() => MockWS.instances[2].fail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(MockWS.instances).toHaveLength(4);
    // Final attempt also fails → give up; UI surfaces Reconnect button.
    act(() => MockWS.instances[3].fail());
    expect(result.current.status).toBe("gave-up");
    // No further reconnect scheduled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(MockWS.instances).toHaveLength(4);
  });

  it("manual reconnect() resets the backoff and tries again", async () => {
    vi.useFakeTimers();
    const onData = vi.fn();
    const { result } = renderHook(() => useTerminalSocket("w_test", onData));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Drive into give-up by suppressing reopens.
    MockWS.autoOpen = false;
    act(() => MockWS.instances[0].fail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => MockWS.instances[1].fail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => MockWS.instances[2].fail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    act(() => MockWS.instances[3].fail());
    expect(result.current.status).toBe("gave-up");
    const countBefore = MockWS.instances.length;

    // User clicks the Reconnect button; this time the server is back up.
    MockWS.autoOpen = true;
    act(() => result.current.reconnect());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(MockWS.instances.length).toBe(countBefore + 1);
    expect(result.current.status).toBe("open");
  });

  it("writes [reconnected] line on successful reconnect", async () => {
    vi.useFakeTimers();
    const onData = vi.fn();
    renderHook(() => useTerminalSocket("w_test", onData));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    onData.mockClear();
    act(() => MockWS.instances[0].fail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onData).toHaveBeenCalledWith(expect.stringContaining("[reconnected]"));
  });

  it("does not reconnect after intentional close (component unmount)", async () => {
    vi.useFakeTimers();
    const onData = vi.fn();
    const { unmount } = renderHook(() => useTerminalSocket("w_test", onData));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(MockWS.instances).toHaveLength(1);
    unmount();
    // Unmount triggered close() which sets intent=closed; the onclose
    // should NOT schedule a reconnect.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(MockWS.instances).toHaveLength(1);
  });
});
