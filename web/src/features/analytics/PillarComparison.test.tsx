import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { PillarComparison } from "./PillarComparison";
import { useLocaleStore } from "@/i18n/store";
import type { WorkMetricInput } from "@/lib/creator-analytics";

afterEach(() => useLocaleStore.getState().setLocale("en"));

// Real-shaped works spanning three pillars: fashion / anime / lifestyle.
// lifestyle avg (565+2705)/2 = 1635 is the strongest → leads the comparison.
const WORKS: WorkMetricInput[] = [
  { desc: "lights on the street #街头穿搭 #蕾丝", playCount: 967, diggCount: 60, commentCount: 0, shareCount: 0, collectCount: 2 },
  { desc: "🖤#二次元 #壁纸", playCount: 67, diggCount: 8, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "月球战争PV #科幻 #月球 #战争", playCount: 581, diggCount: 10, commentCount: 2, shareCount: 0, collectCount: 0 },
  { desc: "陪女朋友看球赛~ #女球迷", playCount: 565, diggCount: 20, commentCount: 0, shareCount: 1, collectCount: 0 },
  { desc: "埃及奇遇 #日常volg #我要上热门", playCount: 2705, diggCount: 23, commentCount: 0, shareCount: 0, collectCount: 3 },
];

describe("<PillarComparison /> (PRD-0006 S10)", () => {
  it("renders one comparison row per non-empty pillar with the real avg plays", () => {
    render(<PillarComparison works={WORKS} />);
    const section = screen.getByRole("region", { name: /content pillar comparison/i });
    // three pillars represented: Lifestyle, Fashion, Anime
    expect(within(section).getByText("Lifestyle & vlog")).toBeInTheDocument();
    expect(within(section).getByText("Fashion & style")).toBeInTheDocument();
    expect(within(section).getByText("Anime & sci-fi")).toBeInTheDocument();
    // lifestyle avg play 1635 surfaces (truthful aggregate, compact-formatted)
    expect(within(section).getByText("1.6K")).toBeInTheDocument();
  });

  it("shows the lead 'N×' comparison line so the user sees which pillar wins", () => {
    render(<PillarComparison works={WORKS} />);
    const section = screen.getByRole("region", { name: /content pillar comparison/i });
    // top lifestyle (1635) vs weakest anime (avg 324) → 5.0×
    expect(within(section).getByText("5.0×")).toBeInTheDocument();
  });

  it("localizes to Chinese pillar names", () => {
    act(() => useLocaleStore.getState().setLocale("zh"));
    render(<PillarComparison works={WORKS} />);
    const section = screen.getByRole("region", { name: /内容支柱对比/i });
    expect(within(section).getByText("日常 · vlog")).toBeInTheDocument();
    expect(within(section).getByText("穿搭 · 时尚")).toBeInTheDocument();
  });

  it("renders nothing when fewer than two pillars (a single bucket is not a comparison)", () => {
    const onePillar: WorkMetricInput[] = [
      { desc: "#街头穿搭 a", playCount: 100, diggCount: 5, commentCount: 0, shareCount: 0, collectCount: 0 },
      { desc: "#街头穿搭 b", playCount: 200, diggCount: 9, commentCount: 0, shareCount: 0, collectCount: 0 },
    ];
    const { container } = render(<PillarComparison works={onePillar} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for empty input (no fabricated pillars)", () => {
    const { container } = render(<PillarComparison works={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
