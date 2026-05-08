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
  it("also highlights Works tab on /works (the alias route)", () => {
    // Round 1 added /works as an alias to /. The active() helper has to
    // treat both as the same logical destination so the tab still lights
    // up — otherwise direct navigation to /works leaves the user without
    // a "you are here" cue.
    renderAt("/works");
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
