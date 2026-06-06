import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrendDrilldown } from "./TrendDrilldown";
import { useLocaleStore } from "@/i18n/store";
import type { TrendItem } from "@/queries/trends";

function trend(over: Partial<TrendItem> = {}): TrendItem {
  return {
    id: "t1",
    platform: "xiaohongshu",
    title: "猫咪做饭",
    sourceUrl: "https://example.com/watch/1",
    source: "scraper",
    scrapedAt: "2026-05-27T00:00:00Z",
    cover: { url: "", aspect: "9:16" },
    metrics: { views: 120000, likes: 5000, comments: 300, shares: 80, fetchedAt: "x" },
    analysis: {
      heat: 5,
      competition: "中",
      opportunity: "金矿",
      description: "为什么火",
      tags: ["萌宠", "做饭"],
      contentAngles: ["第一人称萌宠视角", "反差萌料理"],
      exampleHook: "POV: 你的猫是米其林大厨",
      category: "萌宠",
    },
    ...over,
  } as TrendItem;
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  useLocaleStore.getState().setLocale("en");
  vi.restoreAllMocks();
});

describe("<TrendDrilldown /> (S13)", () => {
  it("renders the urgency badge with a publish-window hint for a breakout trend", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    renderWithClient(<TrendDrilldown platform="xiaohongshu" item={trend()} onClose={() => {}} />);
    // heat 5 + 金矿 → breakout, 72h window. DOM-second-confirm the text.
    expect(screen.getByTestId("trend-urgency")).toHaveTextContent(/72/);
  });

  it("renders related angles from the analysis", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    renderWithClient(<TrendDrilldown platform="xiaohongshu" item={trend()} onClose={() => {}} />);
    expect(screen.getByText("第一人称萌宠视角")).toBeInTheDocument();
    expect(screen.getByText("反差萌料理")).toBeInTheDocument();
  });

  it("offers a watchable example link when the source provides one", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    renderWithClient(<TrendDrilldown platform="xiaohongshu" item={trend()} onClose={() => {}} />);
    const link = screen.getByTestId("trend-watch-link") as HTMLAnchorElement;
    expect(link).toHaveAttribute("href", "https://example.com/watch/1");
  });

  it("does NOT offer a watchable link for an inferred (agent_websearch) row", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    renderWithClient(
      <TrendDrilldown
        platform="youtube"
        item={trend({ source: "agent_websearch", metrics: null, sourceUrl: "https://x.com/y" })}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("trend-watch-link")).toBeNull();
    // ...and it honestly labels itself as inferred.
    expect(screen.getByTestId("trend-provenance")).toHaveTextContent(/inference/i);
  });

  it("does NOT show real metrics in the trendline when metrics are null (covers-only)", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    renderWithClient(
      <TrendDrilldown platform="xiaohongshu" item={trend({ metrics: null })} onClose={() => {}} />,
    );
    // The "no platform metrics" honesty note stands in for the missing numbers.
    expect(screen.getByTestId("trend-no-metrics")).toBeInTheDocument();
    expect(screen.queryByText(/120/)).toBeNull();
  });

  it("surfaces the report.md content once fetched", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("# 小红书 趋势研究报告\n\n整体趋势概述：萌宠料理升温。", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    );
    renderWithClient(<TrendDrilldown platform="xiaohongshu" item={trend()} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("trend-report")).toHaveTextContent(/整体趋势概述/),
    );
  });

  it("calls onClose when the close button is clicked", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    const onClose = vi.fn();
    renderWithClient(<TrendDrilldown platform="xiaohongshu" item={trend()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
