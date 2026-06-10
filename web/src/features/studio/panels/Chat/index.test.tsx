import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPanel } from "./index";
import { useChatStore } from "@/features/chat/store";
import { useComposerDraft } from "@/stores/composerDraft";
import { useActiveSession } from "@/features/chat/activeSession";
import { useToastStore } from "@/stores/toast";
import { apiFetch } from "@/lib/api";

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn(), state: "open" }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    // B1 — abort returns aborted:false when the kill targeted the wrong/empty
    // session. Tests override the mockResolvedValueOnce per case.
    if (path.endsWith("/abort")) return { aborted: true };
    // Stub the two endpoints ChatPanel hits on mount: chat history + the
    // checkpoints list (used for the per-turn rollback chips).
    if (path.endsWith("/checkpoints")) return { items: [] };
    if (path.includes("/chat")) {
      // Session-aware (I24): the HTTP seed carries ?sessionId=. The default
      // session returns s_1's blocks; a non-default session returns its OWN
      // blocks so a reload never shows the default session's bubbles.
      const sessionId = new URL(path, "http://x").searchParams.get("sessionId");
      if (sessionId && sessionId !== "s_1") {
        return { blocks: [{ type: "user", text: `Session ${sessionId} only` }] };
      }
      return {
        blocks: [
          { type: "user", text: "Hello" },
          { type: "assistant", text: "**bold** and a list:\n- item 1\n- item 2" },
          { type: "step_divider", text: "" },
        ],
      };
    }
    return {};
  }),
}));

beforeEach(() => {
  useChatStore.setState({ blocks: [], streaming: false });
  useActiveSession.setState({ byWork: {} });
  useToastStore.setState({ entries: [] });
  vi.mocked(apiFetch).mockClear();
  localStorage.clear();
});

function withQueryClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("ChatPanel", () => {
  it("hydrates conversation from /api/works/:id/chat on mount", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    await waitFor(() => {
      expect(useChatStore.getState().blocks.length).toBe(2);
    });
  });

  // I24 — the HTTP seed must agree with the WS reseed (same session). A reload
  // of a work whose persisted active session is non-default must seed THAT
  // session's log, never the default session's (s_1) bubbles.
  it("seeds the persisted non-default active session, not s_1's history", async () => {
    act(() => useActiveSession.getState().set("w_sess", "s_2"));
    render(withQueryClient(<ChatPanel workId="w_sess" />));
    await waitFor(() => {
      expect(useChatStore.getState().blocks.length).toBe(1);
    });
    const texts = useChatStore.getState().blocks.map((b) => b.text);
    expect(texts).toContain("Session s_2 only");
    // s_1's opening line must NOT bleed into the non-default session view.
    expect(texts).not.toContain("Hello");
    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("renders markdown in assistant bubbles (bold + list items)", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    await waitFor(() => {
      const strongs = screen
        .getAllByText(/bold/i)
        .find((el) => el.tagName.toLowerCase() === "strong");
      expect(strongs).toBeTruthy();
    });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the editorial header with the live model TIER (no version number)", async () => {
    // The mocked apiFetch returns no `model` field, so the switcher falls back
    // to the "opus" tier → badge reads "Opus". We deliberately show only the
    // tier, never a pinned version (4.x), so the badge never goes stale.
    render(withQueryClient(<ChatPanel workId="w1" />));
    expect(await screen.findByText(/Opus/i)).toBeTruthy();
  });

  // #5 — element affordances inject a reference phrase into the composer via
  // the composer-draft store (the textarea has no external setter otherwise).
  it("appends composer-draft inject() text into the composer textarea", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = (await screen.findByPlaceholderText(/问点什么|ask anything/i)) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    act(() => {
      useComposerDraft.getState().inject("字幕「樱花季」(3.2s)");
    });
    expect(textarea.value).toBe("字幕「樱花季」(3.2s) ");

    // A second add appends after the first (space-separated), so multiple
    // elements can be referenced in one message.
    act(() => {
      useComposerDraft.getState().inject("视频「sakura」(0.0s)");
    });
    expect(textarea.value).toBe("字幕「樱花季」(3.2s) 视频「sakura」(0.0s) ");
  });

  it("re-fires for the SAME injected text (nonce bump, not text dedupe)", async () => {
    render(withQueryClient(<ChatPanel workId="w1" />));
    const textarea = (await screen.findByPlaceholderText(/问点什么|ask anything/i)) as HTMLTextAreaElement;
    act(() => useComposerDraft.getState().inject("叠加(1.0s)"));
    act(() => useComposerDraft.getState().inject("叠加(1.0s)"));
    expect(textarea.value).toBe("叠加(1.0s) 叠加(1.0s) ");
  });

  // B1 — the stop button must POST /abort WITH the active session id so the
  // backend kills the session the user is actually streaming in (s_2), not s_1.
  it("abort POSTs /abort with the active sessionId in the body", async () => {
    act(() => useActiveSession.getState().set("w_abort", "s_2"));
    render(withQueryClient(<ChatPanel workId="w_abort" />));
    // Stop button only renders while streaming.
    act(() => useChatStore.setState({ streaming: true }));

    // aria-label is now i18n'd (chat.stopAria) — match either locale, mirroring
    // the placeholder query above.
    const stopBtn = await screen.findByLabelText(/停止当前回合|Stop running turn/);
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/works/w_abort/abort",
        expect.objectContaining({ method: "POST", body: { sessionId: "s_2" } }),
      );
    });
  });

  // B1 — when the kill reports aborted:false (nothing was running / wrong
  // session), the user must see a visible toast instead of silent nothing.
  it("renders a visible toast when abort returns aborted:false", async () => {
    act(() => useActiveSession.getState().set("w_noop", "s_2"));
    render(withQueryClient(<ChatPanel workId="w_noop" />));
    act(() => useChatStore.setState({ streaming: true }));

    // aria-label is now i18n'd (chat.stopAria) — match either locale, mirroring
    // the placeholder query above.
    const stopBtn = await screen.findByLabelText(/停止当前回合|Stop running turn/);
    // Override AFTER mount so the /chat + /checkpoints seed calls don't consume
    // the one-shot mock; only the abort call sees aborted:false.
    vi.mocked(apiFetch).mockResolvedValueOnce({ aborted: false });
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    await waitFor(() => {
      const entries = useToastStore.getState().entries;
      expect(entries.length).toBe(1);
      expect(entries[0].variant).toBe("warn");
      // Message is the localized abort-failed copy, not an empty/raw string.
      expect(entries[0].message.length).toBeGreaterThan(0);
    });
  });

  // B1 — a thrown request (server gone / network) must also surface a toast,
  // not be swallowed by the catch.
  it("renders a visible toast when the abort request throws", async () => {
    act(() => useActiveSession.getState().set("w_throw", "s_2"));
    render(withQueryClient(<ChatPanel workId="w_throw" />));
    act(() => useChatStore.setState({ streaming: true }));

    // aria-label is now i18n'd (chat.stopAria) — match either locale, mirroring
    // the placeholder query above.
    const stopBtn = await screen.findByLabelText(/停止当前回合|Stop running turn/);
    // Override AFTER mount so only the abort call rejects, not the seed calls.
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    await waitFor(() => {
      const entries = useToastStore.getState().entries;
      expect(entries.length).toBe(1);
      expect(entries[0].variant).toBe("error");
    });
  });
});
