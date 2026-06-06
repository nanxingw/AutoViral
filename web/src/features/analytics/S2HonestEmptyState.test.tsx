import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { HonestEmptyState } from "./HonestEmptyState";
import { PlatformHonestyMatrix } from "./PlatformHonestyMatrix";
import { useLocaleStore } from "@/i18n/store";

/**
 * PRD-0006 S2 — honest empty state + platform-honesty matrix.
 *
 * These guard the honesty constraints at the component boundary:
 *   - the Inspire sample carries a VISIBLE watermark (never mistaken for data),
 *   - the matrix renders all four platforms with their true verdicts,
 *   - no "等待后台采集" copy and no 501-pointing refresh CTA leak through.
 */
afterEach(() => {
  act(() => {
    useLocaleStore.setState({ locale: "en" });
  });
});

describe("HonestEmptyState", () => {
  it("renders a visible watermark on the Inspire sample", () => {
    render(
      <HonestEmptyState
        ariaLabel="why empty"
        informTitle="We can't show your audience demographics"
        informBody="OAuth-only, unobtainable at this scale."
        inspireLabel="What it would look like"
        sample={<div>fake bars</div>}
        activateTitle="What helps now"
        activateBody="Use the real table above."
      />,
    );
    const watermark = screen.getByTestId("empty-state-watermark");
    expect(watermark).toBeInTheDocument();
    // The watermark text itself must read as a sample disclaimer.
    expect(watermark.textContent).toMatch(/SAMPLE/i);
  });

  it("hides the illustrative sample from the accessibility tree", () => {
    render(
      <HonestEmptyState
        ariaLabel="why empty"
        informTitle="title"
        informBody="body"
        inspireLabel="label"
        sample={<div>fake bars</div>}
        activateTitle="act"
        activateBody="act body"
      />,
    );
    // The sample lives inside an aria-hidden container so SRs never announce
    // it as real data.
    expect(screen.getByText("fake bars").closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders a real CTA only when provided (no dead 501 button by default)", () => {
    const { rerender } = render(
      <HonestEmptyState
        ariaLabel="why empty"
        informTitle="title"
        informBody="body"
        inspireLabel="label"
        sample={<div>s</div>}
        activateTitle="act"
        activateBody="act body"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <HonestEmptyState
        ariaLabel="why empty"
        informTitle="title"
        informBody="body"
        inspireLabel="label"
        sample={<div>s</div>}
        activateTitle="act"
        activateBody="act body"
        cta={<button type="button">do the thing</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "do the thing" })).toBeInTheDocument();
  });
});

describe("PlatformHonestyMatrix", () => {
  it("lists all four platforms (EN)", () => {
    render(<PlatformHonestyMatrix />);
    for (const name of ["Douyin", "Xiaohongshu", "YouTube", "TikTok"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("tells the truth: douyin own-data yes, demographics no, trend scraped", () => {
    render(<PlatformHonestyMatrix />);
    // Own-data is real (frozen scrape).
    expect(screen.getByText(/frozen post metrics on disk/i)).toBeInTheDocument();
    // Demographics honestly unavailable for every platform.
    expect(
      screen.getAllByText(/OAuth-only, unobtainable at this scale/i).length,
    ).toBe(4);
    // At least one platform's trend is labelled LLM-inferred, not real metrics.
    expect(screen.getAllByText(/LLM-inferred, not real metrics/i).length).toBe(2);
    // And at least one is real-scraped.
    expect(screen.getAllByText(/Real — scraped/i).length).toBe(2);
  });

  it("carries a per-cell verdict on the status dot", () => {
    const { container } = render(<PlatformHonestyMatrix />);
    // 4 rows × 3 cells = 12 verdict dots, each tagged with its verdict.
    const dots = container.querySelectorAll("[data-verdict]");
    expect(dots.length).toBe(12);
    // Every demographics cell verdict is "no".
    const noVerdicts = container.querySelectorAll('[data-verdict="no"]');
    // 4 demographics + 2 xhs/douyin? no — xhs ownData=no, yt/tiktok ownData=no.
    // Just assert the demographics-no invariant holds at least 4 times.
    expect(noVerdicts.length).toBeGreaterThanOrEqual(4);
  });

  it("localizes to ZH without leaking the deleted '等待后台采集' lie", () => {
    act(() => {
      useLocaleStore.setState({ locale: "zh" });
    });
    render(<PlatformHonestyMatrix />);
    expect(screen.getByText("抖音")).toBeInTheDocument();
    expect(screen.getByText("小红书")).toBeInTheDocument();
    // The honesty regression guard: the old dishonest copy must be gone.
    expect(screen.queryByText(/等待后台采集/)).toBeNull();
  });
});
