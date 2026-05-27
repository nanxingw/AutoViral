import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightRibbon, type Insight } from "./InsightRibbon";

// #76 — the sample InsightRibbon CTA was a fake-clickable <span> (accent
// color + arrow, no role / handler / disabled / tooltip). In demo mode it
// must be a real disabled <button> with an explanatory label, matching the
// Explore AnglesCard pattern. Content localization is verified upstream
// (Works.tsx builds the cards from t(...)); here we pin the CTA semantics.

const SAMPLE: Insight[] = [
  { tag: "Competitor gap", body: "Tutorial content under-served.", date: "—", cta: "+ Generate work →" },
];

describe("<InsightRibbon /> CTA semantics (#76)", () => {
  it("renders the demo CTA as a DISABLED button (not a fake-clickable span)", () => {
    render(
      <InsightRibbon
        insights={SAMPLE}
        note="Static placeholder cards"
        ctaDisabledLabel="Available once the analytics agent generates insights."
      />,
    );
    const btn = screen.getByRole("button", { name: /Generate work/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/analytics agent/i);
    expect(btn.getAttribute("aria-label")).toMatch(/analytics agent/i);
  });

  it("shows the SAMPLE chip + localized note in demo mode", () => {
    render(
      <InsightRibbon
        insights={SAMPLE}
        note="静态占位卡"
        ctaDisabledLabel="x"
      />,
    );
    expect(screen.getByText("Sample")).toBeInTheDocument();
    expect(screen.getByText(/静态占位卡/)).toBeInTheDocument();
  });

  it("renders the CTA as a plain span (no button) when NOT in demo mode", () => {
    // Real insights (no `note`) keep the lightweight inline CTA — there's no
    // disabled state to communicate because the data is real.
    render(<InsightRibbon insights={SAMPLE} />);
    expect(screen.queryByRole("button", { name: /Generate work/i })).toBeNull();
    expect(screen.getByText("+ Generate work →")).toBeInTheDocument();
  });
});
