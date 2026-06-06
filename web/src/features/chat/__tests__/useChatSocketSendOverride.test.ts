/**
 * useChatSocket sendOverride (PRD-0006 S7).
 *
 * The grounded coach reuses the chat WS channel for streaming + history reseed,
 * but its SEND must NOT go out as a raw `{action:"send"}` frame — it has to hit
 * POST /api/coach/message so the first turn spins up the grounded session. The
 * `sendOverride` decouples the send path from the WS while keeping the optimistic
 * local echo + the viewer-context / attachments envelope behaviour intact.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatSocket } from "../useChatSocket";
import { useChatStore } from "../store";
import { useActiveSession } from "../activeSession";

class MockWS {
  static instances: MockWS[] = [];
  // Mirror the real WebSocket static readyState enum so ReconnectingWS's
  // `readyState === WebSocket.OPEN` guard flushes the buffer on open.
  static OPEN = 1;
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
  useChatStore.setState({ blocks: [], streaming: false });
});

describe("useChatSocket sendOverride", () => {
  it("routes send() through the override instead of the WS frame, but still echoes the user bubble", () => {
    const override = vi.fn();
    const { result } = renderHook(() =>
      useChatSocket("coach_main", undefined, undefined, undefined, undefined, override),
    );

    act(() => {
      result.current.send("下一个该做什么选题");
    });

    // The override got the user's text…
    expect(override).toHaveBeenCalledTimes(1);
    expect(override.mock.calls[0][0]).toBe("下一个该做什么选题");
    // …and NO raw {action:"send"} frame went onto the WS.
    const ws = MockWS.instances[0];
    expect(ws.sent.some((s) => s.includes('"action":"send"'))).toBe(false);
    // …but the optimistic local echo still appended the user bubble.
    const blocks = useChatStore.getState().blocks;
    expect(blocks.at(-1)?.type).toBe("user");
    expect(blocks.at(-1)?.text).toBe("下一个该做什么选题");
  });

  it("without an override, send() still goes out as the raw WS frame (work mode unchanged)", async () => {
    const { result } = renderHook(() => useChatSocket("w1"));
    // let the mock socket flip to OPEN so the buffered frame flushes.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.send("hello");
    });
    const ws = MockWS.instances[0];
    expect(ws.sent.some((s) => s.includes('"action":"send"') && s.includes("hello"))).toBe(true);
  });
});
