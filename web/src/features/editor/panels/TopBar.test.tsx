import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";

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
});
