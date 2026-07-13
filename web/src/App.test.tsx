import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App /> shell", () => {
  function renderAt(pathname: string) {
    // The application shell hosts the settings panel, so the tree must be
    // wrapped in a QueryClientProvider or render throws "No QueryClient set".
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[pathname]}>
          <Routes>
            <Route element={<App />}>
              <Route index element={<div>idx</div>} />
              <Route path="works" element={<div>works</div>} />
              <Route path="studio/:workId/*" element={<div>studio</div>} />
              <Route path="editor/:workId" element={<div>editor</div>} />
              <Route path="*" element={<div>missing</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it.each(["/", "/works", "/studio/w1", "/editor/w1", "/missing"])(
    "renders no retired global navigation on %s",
    (pathname) => {
      renderAt(pathname);
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    },
  );

  it.each(["/", "/works"])("renders the Works header on %s", (pathname) => {
    renderAt(pathname);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Autoviral" })).toBeInTheDocument();
  });

  it.each(["/studio/w1", "/editor/w1", "/missing"])(
    "does not render the Works header on %s",
    (pathname) => {
      renderAt(pathname);
      expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    },
  );
});
