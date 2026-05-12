import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import NotFound from "./NotFound";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotFound", () => {
  beforeEach(() => {
    // Each test enters with a clean document.title so we can assert the
    // R110 F488 effect actually mutated it.
    document.title = "AutoViral";
  });

  it("renders 404 + the attempted path + a back-home link", () => {
    renderAt("/foo/bar/typo");
    // Editorial 404 glyph
    expect(screen.getByText("404")).toBeInTheDocument();
    // Attempted path surfaced so the user can spot the typo
    expect(screen.getByText("/foo/bar/typo")).toBeInTheDocument();
    // Back-home link present and points to root
    const backLink = screen.getByTestId("notfound-back-home");
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("works for any unknown path under nested segments", () => {
    renderAt("/editor");
    // /editor lives in the route table as /editor/:workId; bare /editor
    // is unknown, so the catch-all surfaces it verbatim.
    expect(screen.getByText("/editor")).toBeInTheDocument();
  });

  // R110 F488 — document title reflects 404 state for tab/bookmark differentiation.
  it("updates document.title to a 404-flavored value (F488)", () => {
    renderAt("/anything");
    expect(document.title).toMatch(/404/);
    expect(document.title).toMatch(/AutoViral/);
  });

  // R110 F492 — echo full URL including query + hash.
  it("echoes pathname + search + hash, not just pathname (F492)", () => {
    renderAt("/broken?id=abc&from=slack#section-2");
    const pathEl = screen.getByTestId("notfound-path");
    expect(pathEl.textContent).toBe("/broken?id=abc&from=slack#section-2");
  });

  // R110 F493 — screen-reader-only error code so SR users don't miss "404".
  it("provides sr-only Error 404 text inside the h1 (F493)", () => {
    renderAt("/foo");
    const h1 = screen.getByRole("heading", { level: 1 });
    // h1 textContent concatenates sr-only span + visible title; both
    // should be present so SR users hear "Error 404 — This page took…".
    expect(h1.textContent).toMatch(/Error 404|错误 404/);
  });

  // R110 F495 — primary recovery CTA auto-focused for keyboard users.
  it("auto-focuses the Back-home link on mount (F495)", () => {
    renderAt("/foo");
    const backLink = screen.getByTestId("notfound-back-home");
    expect(document.activeElement).toBe(backLink);
  });

  // R110 F490 — Levenshtein fuzzy match against known top-level routes
  // surfaces a "Did you mean:" suggestion when the typo is within 2 edits.
  describe("fuzzy route suggestion (F490)", () => {
    it("suggests /explore for /explor (distance 1)", () => {
      renderAt("/explor");
      const sug = screen.getByTestId("notfound-suggestion");
      expect(sug.textContent).toMatch(/\/explore/);
    });

    it("suggests /settings analogues — /anlytics → /analytics (distance 1)", () => {
      renderAt("/anlytics");
      const sug = screen.getByTestId("notfound-suggestion");
      expect(sug.textContent).toMatch(/\/analytics/);
    });

    it("does NOT suggest anything for /completely-foreign (distance > 2)", () => {
      renderAt("/completely-foreign");
      expect(screen.queryByTestId("notfound-suggestion")).not.toBeInTheDocument();
    });

    it("does NOT suggest when path is an empty segment (suppresses '/' guess)", () => {
      renderAt("/");
      expect(screen.queryByTestId("notfound-suggestion")).not.toBeInTheDocument();
    });
  });
});
