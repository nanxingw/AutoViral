import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrendingPanel } from "./TrendingPanel";
import { useLocaleStore } from "@/i18n/store";
import type { TrendItem } from "@/queries/trends";

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// #65 — TrendingPanel gains an optional "create from this trend" button.

function trend(over: Partial<TrendItem> = {}): TrendItem {
  return {
    id: "t1",
    platform: "xiaohongshu",
    title: "猫咪做饭",
    sourceUrl: "https://example.com/1",
    source: "agent_websearch",
    scrapedAt: "2026-05-27T00:00:00Z",
    cover: { url: "", aspect: "9:16" },
    metrics: { views: 1000, likes: 50, comments: 5 },
    analysis: {
      opportunity: "蓝海",
      exampleHook: "POV: 你的猫是米其林大厨",
      category: "萌宠",
    },
    ...over,
  } as TrendItem;
}

afterEach(() => useLocaleStore.getState().setLocale("en"));

describe("<TrendingPanel /> create-from-trend (#65)", () => {
  it("renders a 'create from this' button per row when onUse is provided", () => {
    render(<TrendingPanel platform="xiaohongshu" items={[trend()]} onUse={() => {}} />);
    expect(screen.getByRole("button", { name: /create from this/i })).toBeInTheDocument();
  });

  it("clicking the button hands the trend up to onUse", () => {
    const onUse = vi.fn();
    const item = trend();
    render(<TrendingPanel platform="xiaohongshu" items={[item]} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: /create from this/i }));
    expect(onUse).toHaveBeenCalledWith(item);
  });

  it("stays read-only (no button) when onUse is absent", () => {
    render(<TrendingPanel platform="xiaohongshu" items={[trend()]} />);
    expect(screen.queryByRole("button", { name: /create from this/i })).toBeNull();
  });

  it("disables the button while busy", () => {
    render(<TrendingPanel platform="xiaohongshu" items={[trend()]} onUse={() => {}} busy />);
    expect(screen.getByRole("button", { name: /create from this/i })).toBeDisabled();
  });
});

// Regression: the Explore panel got "stuck" — after visiting YouTube/TikTok,
// switching platforms left the body frozen on the previous platform's cards and
// accumulated stale rows. Root cause (proven by browser repro + on-disk data):
// the youtube collector emitted 22 items ALL sharing id "youtube_d1085ffa"
// (tiktok had partial dupes too), and TrendingPanel keyed rows by item.id —
// duplicate React keys break list reconciliation, so old rows never unmount.
describe("<TrendingPanel /> resilient to non-unique trend ids (stuck-on-switch bug)", () => {
  it("renders every row and emits NO duplicate-key warning when ids collide", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dupId = "youtube_d1085ffa"; // the real shared id from ~/.autoviral/trends/youtube
    render(
      <TrendingPanel
        platform="youtube"
        items={[
          trend({ id: dupId, platform: "youtube", title: "Y1" }),
          trend({ id: dupId, platform: "youtube", title: "Y2" }),
          trend({ id: dupId, platform: "youtube", title: "Y3" }),
        ]}
      />,
    );
    // All three distinct rows must render despite the shared id...
    expect(screen.getByText("Y1")).toBeInTheDocument();
    expect(screen.getByText("Y2")).toBeInTheDocument();
    expect(screen.getByText("Y3")).toBeInTheDocument();
    // ...and React must NOT warn about colliding keys (the root cause).
    const dupKeyWarning = errSpy.mock.calls.find((c) => String(c[0]).includes("same key"));
    expect(dupKeyWarning).toBeUndefined();
    errSpy.mockRestore();
  });

  it("swaps the whole body on platform switch even if the prior list had duplicate ids", () => {
    const { rerender } = render(
      <TrendingPanel
        platform="youtube"
        items={[
          trend({ id: "youtube_d1085ffa", platform: "youtube", title: "Y1" }),
          trend({ id: "youtube_d1085ffa", platform: "youtube", title: "Y2" }),
        ]}
      />,
    );
    rerender(
      <TrendingPanel
        platform="douyin"
        items={[
          trend({ id: "douyin_a", platform: "douyin", title: "D1" }),
          trend({ id: "douyin_b", platform: "douyin", title: "D2" }),
        ]}
      />,
    );
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();
    // No stale rows from the previous (duplicate-keyed) platform.
    expect(screen.queryByText("Y1")).toBeNull();
    expect(screen.queryByText("Y2")).toBeNull();
  });
});

// S14 — month-old data must be badged STALE, never presented as live.
describe("<TrendingPanel /> freshness badge (S14/B2)", () => {
  it("renders a STALE badge when stale is true, with the day count", () => {
    render(
      <TrendingPanel platform="douyin" items={[trend()]} stale ageDays={26} collectedAt="2026-04-01T00:00:00.000Z" />,
    );
    // The badge text carries both the STALE marker and the age.
    expect(screen.getByText(/STALE · 26d old/i)).toBeInTheDocument();
  });

  it("does NOT render a STALE badge for fresh data", () => {
    render(
      <TrendingPanel platform="douyin" items={[trend()]} stale={false} ageDays={1} collectedAt="2026-06-05T00:00:00.000Z" />,
    );
    expect(screen.queryByText(/STALE/i)).toBeNull();
  });

  it("shows a collected-at line when collectedAt is known", () => {
    render(
      <TrendingPanel platform="douyin" items={[trend()]} stale={false} ageDays={3} collectedAt="2026-06-03T00:00:00.000Z" />,
    );
    expect(screen.getByText(/collected 3d ago/i)).toBeInTheDocument();
  });

  it("renders no freshness line when collectedAt is null (no data)", () => {
    render(<TrendingPanel platform="douyin" items={[]} stale={false} ageDays={0} collectedAt={null} />);
    // No "collected Nd ago" line and no today line; only the empty-state copy.
    expect(screen.queryByText(/collected \d+d ago/i)).toBeNull();
    expect(screen.queryByText(/collected today/i)).toBeNull();
    expect(screen.queryByText(/STALE/i)).toBeNull();
  });
});

// S13 — each row can expand an inline drill-down.
describe("<TrendingPanel /> trend drill-down toggle (S13)", () => {
  function drillTrend(over: Partial<TrendItem> = {}): TrendItem {
    return trend({
      analysis: {
        heat: 5,
        competition: "中",
        opportunity: "金矿",
        description: "为什么火",
        tags: ["萌宠"],
        contentAngles: ["第一人称萌宠视角"],
        exampleHook: "POV: 你的猫是米其林大厨",
        category: "萌宠",
      },
      ...over,
    } as TrendItem);
  }

  it("opens the drill-down when the expand button is clicked, closes on toggle", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    renderWithClient(<TrendingPanel platform="xiaohongshu" items={[drillTrend()]} />);
    // Closed initially — no drill-down region.
    expect(screen.queryByRole("region", { name: /drill-down/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /open drill-down/i }));
    expect(screen.getByRole("region", { name: /drill-down/i })).toBeInTheDocument();
    // The angle surfaces inside the drill-down.
    expect(screen.getByText("第一人称萌宠视角")).toBeInTheDocument();
    // Toggle closed again via the row's expand/collapse button (the first
    // "close" control; the drill-down's own ✕ shares the label).
    const closers = screen.getAllByRole("button", { name: /close drill-down/i });
    fireEvent.click(closers[0]);
    expect(screen.queryByRole("region", { name: /drill-down/i })).toBeNull();
    vi.restoreAllMocks();
  });
});
