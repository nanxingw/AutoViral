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

// User reversed the A3 decision (2026-05-07): the carousel editor now
// mounts the same ChatPanel as Studio, with SlidesNav moved to a bottom
// sub-pane in the same left column. Both surfaces render together.
describe("Editor (post-A3 — ChatPanel + SlidesNav co-mount)", () => {
  it("mounts SlidesNav in the left column", () => {
    mount();
    expect(screen.queryByText(/^Slides\s*·/i)).toBeTruthy();
  });

  it("renders the ChatPanel header alongside SlidesNav", () => {
    mount();
    // ChatPanel header shows the CLAUDE-SONNET eyebrow.
    expect(screen.queryByText(/CLAUDE-SONNET/i)).toBeTruthy();
  });
});
