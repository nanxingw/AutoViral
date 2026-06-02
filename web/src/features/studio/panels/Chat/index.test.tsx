import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPanel } from "./index";
import { useChatStore } from "@/features/chat/store";
import { useComposerDraft } from "@/stores/composerDraft";

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    // Stub the two endpoints ChatPanel hits on mount: chat history + the
    // checkpoints list (used for the per-turn rollback chips).
    if (path.endsWith("/checkpoints")) return { items: [] };
    if (path.endsWith("/chat")) {
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

beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

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

  it("renders the editorial header with the live Claude model label", async () => {
    // The mocked apiFetch returns no `model` field, so the alias resolver
    // falls back to "opus" → CLAUDE-OPUS-4.7. Assert on the family slug so
    // the test stays robust as the alias map evolves.
    render(withQueryClient(<ChatPanel workId="w1" />));
    expect(await screen.findByText(/CLAUDE-OPUS/i)).toBeTruthy();
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
});
