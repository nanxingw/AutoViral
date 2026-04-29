import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Editor from "./Editor";

vi.mock("@/features/editor/services/carousel", () => ({
  loadCarousel: vi.fn(async () => null),
  saveCarousel: vi.fn(async () => undefined),
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

describe("Editor (A3 — SlidesNav restored)", () => {
  it("mounts SlidesNav in the left column (NOT ChatPanel)", () => {
    mount();
    // SlidesNav header reads "Slides · N" — uniquely identifies the panel.
    expect(screen.queryByText(/^Slides\s*·/i)).toBeTruthy();
  });

  it("does not render the Studio ChatPanel header (A3 contract)", () => {
    mount();
    // ChatPanel (SV.E) shows a "CLAUDE-SONNET" eyebrow header — must be absent.
    expect(screen.queryByText(/CLAUDE-SONNET/i)).toBeNull();
  });
});
