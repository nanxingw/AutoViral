import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import Analytics from "@/pages/Analytics";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe("Analytics page", () => {
  // Mock data sourced from web/src/test/msw.ts: nickname @alex_creates, todayLikes 2847, etc.
  it("renders hero KPIs and profile when data loaded", async () => {
    render(wrap(<Analytics />));
    await waitFor(() => expect(screen.getAllByText(/@alex_creates/i).length).toBeGreaterThan(0));
    // KPI shows compactNumber(2847) === "2.8K"
    expect(screen.getByText(/2\.8K/)).toBeInTheDocument();
    // Hero copy
    expect(screen.getByText(/CHANNEL HEALTH/i)).toBeInTheDocument();
  });
});
