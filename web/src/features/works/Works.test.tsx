import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import Works from "@/pages/Works";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Works page", () => {
  // "Hook Formula" originates from the MSW mock at web/src/test/msw.ts (GET /api/works fixture).
  it("renders hero and grid with mock works", async () => {
    render(wrap(<Works />));
    await waitFor(() => expect(screen.getByText(/Hook Formula/i)).toBeInTheDocument());
    expect(screen.getByText(/PICK UP WHERE YOU LEFT OFF/i)).toBeInTheDocument();
    // PRD-0013 S4 — the retired "Latest Inspiration" ribbon is gone; the
    // library heading ("My Works", with "Works" in an <em>) is the stable
    // section marker now.
    expect(screen.getByText("Works", { selector: "em" })).toBeInTheDocument();
  });
  it("does not display autopilot / cron copy", async () => {
    render(wrap(<Works />));
    await waitFor(() => expect(screen.getByText(/Hook Formula/i)).toBeInTheDocument());
    expect(screen.queryByText(/auto.research/i)).toBeNull();
    expect(screen.queryByText(/every 1h/i)).toBeNull();
  });
});
