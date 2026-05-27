import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App /> shell", () => {
  it("renders TopNav", () => {
    // App's shell now reads from react-query (TopNav surfaces work/query
    // state), so the tree must be wrapped in a QueryClientProvider or the
    // render throws "No QueryClient set".
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<App />}>
              <Route index element={<div>idx</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Autoviral")).toBeInTheDocument();
  });
});
