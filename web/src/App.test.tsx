import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App /> shell", () => {
  function renderAt(pathname: string) {
    // App's shell now reads from react-query (TopNav surfaces work/query
    // state), so the tree must be wrapped in a QueryClientProvider or the
    // render throws "No QueryClient set".
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[pathname]}>
          <Routes>
            <Route element={<App />}>
              <Route index element={<div>idx</div>} />
              <Route path="works" element={<div>works</div>} />
              <Route path="studio/:workId/*" element={<div>studio</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("hides global navigation in Studio", () => {
    renderAt("/studio/w1");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it.each(["/", "/works"])("keeps global navigation on %s", (pathname) => {
    renderAt(pathname);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});
