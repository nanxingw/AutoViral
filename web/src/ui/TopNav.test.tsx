import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { TopNav } from "./TopNav";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopNav />
      <Routes>
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<TopNav />", () => {
  it("highlights Works tab on /", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /works/i })).toHaveAttribute("aria-current", "page");
  });
  it("highlights Explore on /explore", () => {
    renderAt("/explore");
    expect(screen.getByRole("link", { name: /explore/i })).toHaveAttribute("aria-current", "page");
  });
  it("highlights Analytics on /analytics", () => {
    renderAt("/analytics");
    expect(screen.getByRole("link", { name: /analytics/i })).toHaveAttribute("aria-current", "page");
  });
});
