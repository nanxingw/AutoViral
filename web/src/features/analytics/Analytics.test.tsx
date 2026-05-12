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
  // Mock data sourced from web/src/test/msw.ts: nickname @alex_creates,
  // avg_digg 2847 (mapped via adapter to summary.avgLikes).
  it("renders hero KPIs and profile when data loaded", async () => {
    render(wrap(<Analytics />));
    await waitFor(() => expect(screen.getAllByText(/@alex_creates/i).length).toBeGreaterThan(0));
    // KPI shows compactNumber(2847) === "2.8K" — proves adapter wired
    // avg_digg (snake_case backend key) through to KPIBar avgLikes prop.
    expect(screen.getByText(/2\.8K/)).toBeInTheDocument();
    // R104 F443 — hero eyebrow no longer falsely claims "last 7 days";
    // shows "LIFETIME" until backend ships time-windowed summaries.
    expect(screen.getByText(/LIFETIME|自有记录以来/i)).toBeInTheDocument();
  });
});
