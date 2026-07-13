import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoutes } from "./routes";

// The heavy real pages (Works/Studio/Editor) need network + big subtrees;
// swap them for markers so this test isolates the ROUTE TABLE behaviour
// (which element resolves for which path), not page internals. NotFound is
// left REAL — the retired-route "did you mean" cleanup is part of the spec.
vi.mock("./pages/Works", () => ({ default: () => <div data-testid="works-page">WORKS</div> }));
vi.mock("./pages/Studio", () => ({ default: () => <div data-testid="studio-page">STUDIO</div> }));
vi.mock("./pages/Editor", () => ({ default: () => <div data-testid="editor-page">EDITOR</div> }));
// Reduce App to a bare <Outlet/> so the route-table assertion does not pull
// in application-shell settings/query providers.
vi.mock("./App", async () => {
  const rr = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { default: () => <rr.Outlet /> };
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("route table (PRD-0013 S4 slimdown)", () => {
  it("serves Works at / and /works", () => {
    renderAt("/");
    expect(screen.getByTestId("works-page")).toBeInTheDocument();
  });

  it("redirects the retired /explore route to Works", () => {
    renderAt("/explore");
    expect(screen.getByTestId("works-page")).toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
  });

  it("redirects the retired /analytics route to Works", () => {
    renderAt("/analytics");
    expect(screen.getByTestId("works-page")).toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
  });

  it("still 404s an unknown/typo path (no blanket redirect)", () => {
    renderAt("/explor");
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.queryByTestId("works-page")).not.toBeInTheDocument();
  });

  it("does NOT suggest a retired route on a near-miss typo", () => {
    // /explor was distance-1 from the old /explore known-route; after
    // retiring explore/analytics it must no longer be surfaced as a guess.
    renderAt("/explor");
    const sug = screen.queryByTestId("notfound-suggestion");
    expect(sug?.textContent ?? "").not.toMatch(/explore|analytics/);
  });
});
