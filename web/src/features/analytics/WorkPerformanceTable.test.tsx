import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { WorkPerformanceTable } from "./WorkPerformanceTable";
import { useLocaleStore } from "@/i18n/store";
import type { WorkMetricInput } from "@/lib/creator-analytics";

afterEach(() => useLocaleStore.getState().setLocale("en"));

// Three real-shaped works: B has the most plays, A has the most likes.
const WORKS: WorkMetricInput[] = [
  { desc: "A street-style", playCount: 967, diggCount: 60, commentCount: 0, shareCount: 0, collectCount: 2 },
  { desc: "B egypt vlog", playCount: 2705, diggCount: 23, commentCount: 0, shareCount: 0, collectCount: 3 },
  { desc: "C farewell", playCount: 20, diggCount: 2, commentCount: 1, shareCount: 0, collectCount: 0 },
];

function dataRows() {
  // tbody rows only (thead has no rowgroup ancestor we query here).
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1); // drop header row
}

describe("<WorkPerformanceTable /> (PRD-0006 S1)", () => {
  it("renders one row per work with the real play counts, sorted by play desc by default", () => {
    render(<WorkPerformanceTable works={WORKS} />);
    const rows = dataRows();
    expect(rows).toHaveLength(3);
    // top row is the 2705-play egypt vlog (truthful number on screen)
    expect(within(rows[0]).getByText("2.7K")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/egypt vlog/i)).toBeInTheDocument();
    // bottom row is the 20-play farewell
    expect(within(rows[2]).getByText("20")).toBeInTheDocument();
  });

  it("re-sorts by likes (digg) descending when the Likes header is clicked", () => {
    render(<WorkPerformanceTable works={WORKS} />);
    fireEvent.click(screen.getByRole("button", { name: /sort by likes/i }));
    const rows = dataRows();
    // street-style (60 likes) now leads
    expect(within(rows[0]).getByText(/street-style/i)).toBeInTheDocument();
    expect(within(rows[0]).getByText("60")).toBeInTheDocument();
  });

  it("renders nothing when there are no works (no fabricated rows)", () => {
    const { container } = render(<WorkPerformanceTable works={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
