import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CarouselExportProgress } from "./CarouselExportProgress";

// #85 — the carousel "export all" flow had zero feedback and visibly cycled
// the live canvas through every slide. This overlay reports N/M and (mounted
// over the canvas) hides the cycle. These pin the user-visible feedback.

describe("<CarouselExportProgress /> (#85)", () => {
  it("renders a labelled dialog with the N/M counter", () => {
    render(<CarouselExportProgress progress={{ done: 2, total: 5 }} />);
    const dialog = screen.getByRole("dialog", { name: /exporting slides/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("export-progress-counter")).toHaveTextContent("2 / 5");
  });

  it("exposes a progressbar with truthful aria bounds", () => {
    render(<CarouselExportProgress progress={{ done: 3, total: 8 }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
  });

  it("does not divide by zero when total is 0 (pre-seed frame)", () => {
    render(<CarouselExportProgress progress={{ done: 0, total: 0 }} />);
    // 0/0 → 0% width, no NaN crash.
    expect(screen.getByTestId("export-progress-counter")).toHaveTextContent("0 / 0");
  });
});
