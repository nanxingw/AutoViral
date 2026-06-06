import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { BenchmarkBand } from "./BenchmarkBand";
import { positionInBand } from "@/lib/benchmark";
import { useLocaleStore } from "@/i18n/store";

afterEach(() => useLocaleStore.getState().setLocale("en"));

/**
 * Rendering shell for the D2 band (PRD-0006 S3). The diagnostic/reassurance
 * logic is owned + unit-tested in `benchmark.test.ts`; here we only assert the
 * shell turns a BenchmarkResult into the on-screen diagnostic statement, shows
 * the small-account reassurance when present, and — the honesty AC — labels a
 * reference-only band as 「参考性、非你所在平台」 (never a silent comparison).
 */
describe("<BenchmarkBand /> (PRD-0006 S3)", () => {
  it("renders the user's real Douyin engagement KPI as a diagnostic statement (not an isolated number)", () => {
    // 2.6% engagement, nano tier, real Douyin band → 'below the nano median'.
    const result = positionInBand("douyin", "nano", "engagement", 0.026);
    render(<BenchmarkBand result={result} metricLabel="Engagement rate" />);
    // diagnostic statement is on screen with the target band edges interpolated
    expect(screen.getByText(/below the nano median/i)).toBeInTheDocument();
    expect(screen.getByText(/6\.0%–12\.0%/)).toBeInTheDocument();
  });

  it("shows the 'small accounts engage harder' reassurance for a below-band nano account", () => {
    const result = positionInBand("douyin", "nano", "engagement", 0.026);
    render(<BenchmarkBand result={result} metricLabel="Engagement rate" />);
    expect(screen.getByText(/small accounts engage harder/i)).toBeInTheDocument();
  });

  it("does NOT show reassurance when the KPI is healthy (within band)", () => {
    const result = positionInBand("douyin", "nano", "engagement", 0.09);
    render(<BenchmarkBand result={result} metricLabel="Engagement rate" />);
    expect(screen.queryByText(/small accounts engage harder/i)).not.toBeInTheDocument();
    expect(screen.getByText(/right in the nano band/i)).toBeInTheDocument();
  });

  it("labels a reference-only band as '参考性、非你所在平台' — no silent apples-to-oranges", () => {
    // tiktok engagement band is referenceOnly:true in the data.
    const result = positionInBand("tiktok", "nano", "engagement", 0.026);
    expect(result.referenceOnly).toBe(true);
    render(<BenchmarkBand result={result} metricLabel="Engagement rate" />);
    expect(screen.getByText(/reference only/i)).toBeInTheDocument();
  });

  it("does NOT show the reference-only note for the platform-correct Douyin band", () => {
    const result = positionInBand("douyin", "nano", "engagement", 0.026);
    expect(result.referenceOnly).toBe(false);
    render(<BenchmarkBand result={result} metricLabel="Engagement rate" />);
    expect(screen.queryByText(/reference only/i)).not.toBeInTheDocument();
  });

  it("renders nothing when there is no baseline for the metric (honest absence, no fake band)", () => {
    const result = positionInBand("douyin", "nano", "playCount" as never, 624);
    const { container } = render(
      <BenchmarkBand result={result} metricLabel="Avg plays / post" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("localizes the diagnostic into Chinese", () => {
    act(() => useLocaleStore.getState().setLocale("zh"));
    const result = positionInBand("douyin", "nano", "engagement", 0.026);
    render(<BenchmarkBand result={result} metricLabel="互动率" />);
    expect(screen.getByText(/低于 nano 层中位数/)).toBeInTheDocument();
    expect(screen.getByText(/小账号天然互动更高/)).toBeInTheDocument();
  });
});
