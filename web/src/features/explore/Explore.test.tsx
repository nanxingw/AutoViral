import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";

// The Explore page now mounts the grounded coach (S7), which hosts a real
// ChatPanel → useChatSocket → `new WebSocket` (absent in jsdom). Page tests
// mock the chat socket (same pattern as Editor.test.tsx / Studio.layout.test).
vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn(), state: "open" }),
}));

import Explore from "@/pages/Explore";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe("Explore page", () => {
  // "POV: cat is chef" comes from MSW mock at web/src/test/msw.ts (GET /api/trends/:platform).
  it("renders hero, angles, platform tabs, trending panel", async () => {
    render(wrap(<Explore />));
    expect(screen.getByText(/PULSE OF THE ALGORITHM/i)).toBeInTheDocument();
    expect(screen.getByText(/starter angles/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/POV: cat is chef/i)).toBeInTheDocument());
  });
});
