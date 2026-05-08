import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPanel } from "./index";
import { useChatStore } from "@/features/chat/store";

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
});
