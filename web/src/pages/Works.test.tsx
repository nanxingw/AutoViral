import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { mswServer } from "@/test/msw";
import type { WorkSummary } from "@/queries/works";
import Works from "./Works";

// #69 — the old "Processing" chip bucketed creating+ready+failed together, so a
// finished work read as "处理中" and — worse — a FAILED work hid inside it with no
// way to surface or filter for it. These tests assert the lifecycle is split into
// honest, status-accurate chips and that failures are discoverable.

function work(id: string, title: string, status: WorkSummary["status"]): WorkSummary {
  return {
    id,
    title,
    type: "short-video",
    status,
    thumbnail: null,
    updatedAt: "2026-01-01T00:00:00Z",
    coverImage: null,
    coverIsVideo: false,
  };
}

function renderWorks(works: WorkSummary[]) {
  mswServer.use(
    http.get("*/api/works", () => HttpResponse.json({ works })),
  );
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Works />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const MIXED = [
  work("w_draft", "Draft work", "draft"),
  work("w_creating", "Creating work", "creating"),
  work("w_ready", "Ready work", "ready"),
  work("w_failed", "Failed work", "failed"),
];

describe("Works lifecycle filter (#69)", () => {
  it("has no generic 'Processing' chip — the conflation bucket is gone", async () => {
    renderWorks(MIXED);
    await screen.findByText("Ready work");
    expect(screen.queryByRole("button", { name: /Processing/i })).toBeNull();
  });

  it("surfaces a 'Failed' chip so a failed work is discoverable, not hidden", async () => {
    renderWorks(MIXED);
    await screen.findByText("Failed work");
    const failedChip = screen.getByRole("button", { name: /Failed/i });
    expect(failedChip).toBeInTheDocument();

    // Clicking it narrows the grid to exactly the failed work.
    fireEvent.click(failedChip);
    expect(screen.getByText("Failed work")).toBeInTheDocument();
    expect(screen.queryByText("Ready work")).toBeNull();
    expect(screen.queryByText("Creating work")).toBeNull();
  });

  it("treats a 'ready' work as done, not in-progress — its own chip shows only it", async () => {
    renderWorks(MIXED);
    await screen.findByText("Ready work");
    fireEvent.click(screen.getByRole("button", { name: /^Ready/i }));
    expect(screen.getByText("Ready work")).toBeInTheDocument();
    expect(screen.queryByText("Failed work")).toBeNull();
    expect(screen.queryByText("Creating work")).toBeNull();
  });

  it("hides lifecycle chips with zero works (failed chip absent on a clean slate)", async () => {
    renderWorks([work("w_ready", "Only ready", "ready")]);
    await screen.findByText("Only ready");
    // No failed/creating/draft works → those chips don't clutter the row.
    expect(screen.queryByRole("button", { name: /Failed/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Creating/i })).toBeNull();
    // "All" and the present-status chip remain.
    expect(screen.getByRole("button", { name: /^All/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ready/i })).toBeInTheDocument();
  });
});
