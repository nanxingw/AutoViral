import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";

// B4 (PRD-0010) — the Editor TopBar now hosts the shared CostBadge, which reads
// GET /api/works/:id/cost via useCostSummary. Mock apiFetch so the badge query
// resolves without MSW flagging an unhandled request.
const apiFetch = vi.fn(async (..._args: unknown[]) => ({
  workId: "w1",
  totalUsd: 0.05,
  estimated: false,
  count: 1,
  byKind: [{ kind: "image", usd: 0.05, count: 1, estimated: false }],
}));
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TopBar", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("renders saved label and export menu items", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const onCurrent = vi.fn();
    const onAll = vi.fn();
    renderWithProviders(
      <TopBar
        workId="w1"
        savedAt="12:34"
        onExportCurrent={onCurrent}
        onExportAll={onAll}
      />,
    );
    expect(screen.getByText(/Saved · 12:34/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Export/));
    fireEvent.click(screen.getByText(/Current slide/));
    expect(onCurrent).toHaveBeenCalled();
  });

  it("All-slides menu item triggers onExportAll", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const onCurrent = vi.fn();
    const onAll = vi.fn();
    renderWithProviders(
      <TopBar
        workId="w1"
        savedAt={null}
        onExportCurrent={onCurrent}
        onExportAll={onAll}
      />,
    );
    fireEvent.click(screen.getByText(/Export/));
    fireEvent.click(screen.getByText(/All slides/));
    expect(onAll).toHaveBeenCalled();
  });

  it("renders the shared cost badge (Editor parity with Studio)", async () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    renderWithProviders(
      <TopBar
        workId="w1"
        savedAt="12:34"
        onExportCurrent={vi.fn()}
        onExportAll={vi.fn()}
      />,
    );
    const badge = await screen.findByTestId("cost-badge");
    await waitFor(() => expect(badge.textContent).toContain("$0.05"));
  });
});
