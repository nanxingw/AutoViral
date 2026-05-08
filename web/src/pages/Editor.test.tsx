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

// 2026-05-07: align with Studio layout. Left column is full-height
// ChatPanel; SlidesNav has been removed (selection + reorder handled
// by the bottom Filmstrip, which gained a hover × delete button).
describe("Editor (post-A3 — Studio-aligned layout)", () => {
  it("renders the ChatPanel header in the left column", () => {
    mount();
    // ChatPanel header shows a Claude-family eyebrow. The default alias
    // resolves to opus, but assert on the family root so the test stays
    // robust as version numbers move.
    expect(screen.queryByText(/CLAUDE-(OPUS|SONNET|HAIKU)/i)).toBeTruthy();
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
