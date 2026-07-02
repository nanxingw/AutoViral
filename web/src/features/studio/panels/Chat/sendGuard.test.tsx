import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPanel } from "./index";
import { useChatStore } from "@/features/chat/store";
import { useActiveSession } from "@/features/chat/activeSession";
import { useToastStore } from "@/stores/toast";

// PRD-0010 A2 — send double-safety at the composer.
//   1. useRef in-flight lock: a same-tick double submit (double-click / repeated
//      ⌘↵) fires send() exactly ONCE. `input`/`canSend` are useState → stale on
//      the second synchronous call; only a ref written synchronously blocks it
//      (feedback_useref_race_lock, #62/#51 lockRef precedent).
//   2. Disconnect-disable: when the bridge WS is not `open`, the send button is
//      disabled and a hint is visible — the message is NOT silently buffered for
//      a reconnect resend (the double-落盘 root cause). Reconnecting re-enables.

// Configurable useChatSocket mock: a STABLE send fn (so we can count calls) and
// a mutable ws state. vi.hoisted so the (hoisted) vi.mock factory can close over
// them.
const { sendMock, wsState } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  wsState: { value: "open" as "open" | "connecting" | "reconnecting" },
}));
vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: sendMock, state: wsState.value }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.endsWith("/checkpoints")) return { items: [] };
    if (path.includes("/chat")) return { blocks: [] };
    return {};
  }),
}));

beforeEach(() => {
  sendMock.mockClear();
  wsState.value = "open";
  useChatStore.setState({ blocks: [], streaming: false });
  useActiveSession.setState({ byWork: {} });
  useToastStore.setState({ entries: [] });
  localStorage.clear();
});

function withQueryClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

async function findComposer() {
  return (await screen.findByPlaceholderText(/问点什么|ask anything/i)) as HTMLTextAreaElement;
}

describe("ChatPanel — A2 send double-safety", () => {
  it("fires send() exactly once for a same-tick double-click", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = await findComposer();
    fireEvent.change(textarea, { target: { value: "hello" } });

    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    // Two synchronous native clicks in ONE act(): React batches the setInput("")
    // until act() flushes, so both handlers read the stale (non-empty) input.
    // Only the ref lock can gate the second — canSend is still true for both.
    act(() => {
      sendBtn.click();
      sendBtn.click();
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("hello", undefined);
  });

  it("releases the lock between real sends: two sequential messages both fire", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = await findComposer();
    const sendBtn = () => screen.getByLabelText("Send") as HTMLButtonElement;

    fireEvent.change(textarea, { target: { value: "one" } });
    act(() => sendBtn().click());
    // Let the microtask that releases the lock flush before the next send.
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(textarea, { target: { value: "two" } });
    act(() => sendBtn().click());

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenNthCalledWith(1, "one", undefined);
    expect(sendMock).toHaveBeenNthCalledWith(2, "two", undefined);
  });

  it("fires send() exactly once for a same-tick repeated ⌘↵", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = await findComposer();
    fireEvent.change(textarea, { target: { value: "hello" } });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("disables the send button and shows a hint when the WS is not open", async () => {
    wsState.value = "reconnecting";
    render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = await findComposer();
    fireEvent.change(textarea, { target: { value: "hello" } });

    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    // Even with sendable text, a dropped bridge disables send (no buffered resend).
    expect(sendBtn.disabled).toBe(true);
    // A visible hint explains why send is blocked.
    expect(screen.getByTestId("chat-send-disconnected")).toBeInTheDocument();

    // Clicking a disabled-intent button must not send.
    act(() => sendBtn.click());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("re-enables send once the connection is restored", async () => {
    wsState.value = "reconnecting";
    const { rerender } = render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = await findComposer();
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);

    // Bridge recovers → open. Re-render so the mocked hook returns "open".
    wsState.value = "open";
    rerender(withQueryClient(<ChatPanel workId="w1" />));

    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    expect(screen.queryByTestId("chat-send-disconnected")).toBeNull();

    act(() => sendBtn.click());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("hello", undefined);
  });
});
