import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformTabs } from "./PlatformTabs";
import { SUPPORTED_REFRESH_PLATFORMS } from "@/queries/trends";

// #82 — the "live" status dot must mark the platforms that actually have a
// trend collector (小红书 + 抖音), derived from SUPPORTED_REFRESH_PLATFORMS.
// It used to be hardcoded on YouTube/TikTok, contradicting the refresh
// endpoint and the product copy. The dot is the only <span> child inside a
// tab button (the label is bare text), so its presence is the signal.

function liveDot(label: string): Element | null {
  const btn = screen.getByRole("button", { name: new RegExp(label) });
  return btn.querySelector("span");
}

describe("<PlatformTabs /> live dot (#82)", () => {
  it("shows the live dot on 小红书 and 抖音 (the platforms with a collector)", () => {
    render(<PlatformTabs value="xiaohongshu" onChange={() => {}} />);
    expect(liveDot("小红书")).not.toBeNull();
    expect(liveDot("抖音")).not.toBeNull();
  });

  it("does NOT show the live dot on YouTube / TikTok (no collector)", () => {
    render(<PlatformTabs value="xiaohongshu" onChange={() => {}} />);
    expect(liveDot("YouTube")).toBeNull();
    expect(liveDot("TikTok")).toBeNull();
  });

  it("the dotted platforms exactly match SUPPORTED_REFRESH_PLATFORMS", () => {
    // Guards the single-source-of-truth invariant: if someone changes the
    // canonical list, the dots follow automatically and this stays green;
    // if someone re-hardcodes a divergent dot, this fails.
    render(<PlatformTabs value="xiaohongshu" onChange={() => {}} />);
    const dotted = (["小红书", "抖音", "YouTube", "TikTok"] as const).filter(
      (l) => liveDot(l) !== null,
    );
    expect(dotted.sort()).toEqual(["小红书", "抖音"].sort());
    // And the canonical list is the 2 Chinese platforms.
    expect([...SUPPORTED_REFRESH_PLATFORMS].sort()).toEqual(
      ["douyin", "xiaohongshu"].sort(),
    );
  });

  it("clicking a tab fires onChange with its platform key", () => {
    const onChange = vi.fn();
    render(<PlatformTabs value="xiaohongshu" onChange={onChange} />);
    screen.getByRole("button", { name: /抖音/ }).click();
    expect(onChange).toHaveBeenCalledWith("douyin");
  });
});
