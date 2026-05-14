import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Editor from "./Editor";

vi.mock("@/features/editor/services/carousel", () => ({
  loadCarousel: vi.fn(async () => null),
  saveCarousel: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ blocks: [] })),
}));

vi.mock("@/features/editor/hooks/useExport", () => ({
  useExport: () => ({
    setStage: vi.fn(),
    exportCurrent: vi.fn(),
    exportAll: vi.fn(),
  }),
}));

// Stage uses Konva — stub to avoid canvas in JSDOM.
vi.mock("@/features/editor/canvas/Stage", () => ({
  Stage: () => <div data-testid="stage-stub" />,
}));

// Stub TerminalPanel — its useEffect constructs `new WebSocket(...)` and
// xterm.js Terminal which neither happy-dom nor jsdom provide.
vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => (
    <div data-testid="terminal-panel-stub">TERMINAL · {workId}</div>
  ),
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/editor/w1"]}>
        <Routes>
          <Route path="/editor/:workId" element={<Editor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 2026-05-14 (Phase 1 agentic-terminal): Editor's left column now mounts
// TerminalPanel instead of ChatPanel — same agentic shell as Studio.
describe("Editor (Phase 1 agentic-terminal layout)", () => {
  it("renders the TerminalPanel in the left column", () => {
    mount();
    expect(screen.queryByTestId("terminal-panel-stub")).toBeTruthy();
  });

  it("does NOT mount the legacy SlidesNav in the left column", () => {
    mount();
    // SlidesNav header reads "Slides · N" — must be absent.
    expect(screen.queryByText(/^Slides\s*·/i)).toBeNull();
  });

  it("still renders the bottom Filmstrip tray (DRAG TO REORDER)", () => {
    mount();
    expect(screen.queryByText(/drag to reorder/i)).toBeTruthy();
  });
});
