import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import Explore from "@/pages/Explore";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe("Explore page", () => {
  // "POV: cat is chef" comes from MSW mock at web/src/test/msw.ts (GET /api/trends/:platform).
  it("renders hero, angles, platform tabs, trending panel", async () => {
    render(wrap(<Explore />));
    expect(screen.getByText(/PULSE OF THE ALGORITHM/i)).toBeInTheDocument();
    expect(screen.getByText(/starter angles/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/POV: cat is chef/i)).toBeInTheDocument());
  });
});
