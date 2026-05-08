import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import NotFound from "./NotFound";

describe("NotFound", () => {
  it("renders 404 + the attempted path + a back-home link", () => {
    render(
      <MemoryRouter initialEntries={["/foo/bar/typo"]}>
        <Routes>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    // Editorial 404 glyph
    expect(screen.getByText("404")).toBeInTheDocument();
    // Attempted path surfaced so the user can spot the typo
    expect(screen.getByText("/foo/bar/typo")).toBeInTheDocument();
    // Back-home link present and points to root
    const backLink = screen.getByRole("link", { name: /works/i });
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("works for any unknown path under nested segments", () => {
    render(
      <MemoryRouter initialEntries={["/editor"]}>
        <Routes>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("/editor")).toBeInTheDocument();
  });
});
