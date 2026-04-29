import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatPanel } from "./index";
import { useChatStore } from "@/features/chat/store";

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({
    blocks: [
      { type: "user", text: "Hello" },
      { type: "assistant", text: "**bold** and a list:\n- item 1\n- item 2" },
      { type: "step_divider", text: "" },
    ],
  })),
}));

beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

describe("ChatPanel", () => {
  it("hydrates conversation from /api/works/:id/chat on mount", async () => {
    render(<ChatPanel workId="w1" />);
    await waitFor(() => {
      expect(useChatStore.getState().blocks.length).toBe(2);
    });
  });

  it("renders markdown in assistant bubbles (bold + list items)", async () => {
    render(<ChatPanel workId="w1" />);
    await waitFor(() => {
      const strongs = screen
        .getAllByText(/bold/i)
        .find((el) => el.tagName.toLowerCase() === "strong");
      expect(strongs).toBeTruthy();
    });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the editorial header with CLAUDE-SONNET model label", async () => {
    render(<ChatPanel workId="w1" />);
    expect(await screen.findByText(/CLAUDE-SONNET/i)).toBeTruthy();
  });
});
