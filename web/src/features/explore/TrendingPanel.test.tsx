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
