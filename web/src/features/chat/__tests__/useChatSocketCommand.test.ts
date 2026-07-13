import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../store";
import { useChatSocket } from "../useChatSocket";

class MockWS {
  static OPEN = 1;
  static instances: MockWS[] = [];
  readyState = 0;
  sent: string[] = [];
  listeners: Record<string, Array<(event: Event | MessageEvent) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWS.OPEN;
      this.listeners.open.forEach((fn) => fn(new Event("open")));
    });
  }

  addEventListener(type: string, fn: (event: Event | MessageEvent) => void) {
    this.listeners[type].push(fn);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.listeners.close.forEach((fn) => fn(new Event("close")));
  }

  emit(frame: unknown) {
    const event = new MessageEvent("message", { data: JSON.stringify(frame) });
    this.listeners.message.forEach((fn) => fn(event));
  }
}

beforeEach(() => {
  MockWS.instances = [];
  vi.stubGlobal("WebSocket", MockWS);
  useChatStore.setState({ blocks: [], streaming: false });
});

describe("useChatSocket.sendCommand", () => {
  it("sends only the structured command frame, without context, attachments, or optimistic echo", async () => {
    const getViewerContext = vi.fn(() => "<viewer-context>secret</viewer-context>");
    const { result } = renderHook(() => useChatSocket("w1", getViewerContext));
    await act(async () => Promise.resolve());

    act(() => result.current.sendCommand("compact", ""));

    expect(MockWS.instances[0].sent).toHaveLength(1);
    const payload = JSON.parse(MockWS.instances[0].sent[0]) as Record<string, unknown>;
    expect(payload).toEqual({ action: "command", name: "compact", args: "" });
    expect(payload).not.toHaveProperty("text");
    expect(JSON.stringify(payload)).not.toContain("viewer-context");
    expect(JSON.stringify(payload)).not.toContain("attachments");
    expect(getViewerContext).not.toHaveBeenCalled();
    expect(useChatStore.getState().blocks).toEqual([]);
  });

  it("turns command lifecycle frames into one command history block", async () => {
    renderHook(() => useChatSocket("w1"));
    await act(async () => Promise.resolve());

    act(() => {
      MockWS.instances[0].emit({
        event: "command_started",
        data: { command: "compact", args: "", sessionId: "s_1" },
      });
      MockWS.instances[0].emit({
        event: "command_result",
        data: {
          status: "ok",
          command: "compact",
          sessionId: "s_1",
          data: { result: "Context compacted." },
        },
      });
    });

    expect(useChatStore.getState().blocks).toEqual([
      expect.objectContaining({
        type: "command",
        text: "/compact",
        commandName: "compact",
        commandStatus: "ok",
        commandResult: "Context compacted.",
      }),
    ]);
  });
});
