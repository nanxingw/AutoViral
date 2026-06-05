import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrendingPanel } from "./TrendingPanel";
import { useLocaleStore } from "@/i18n/store";
import type { TrendItem } from "@/queries/trends";

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
