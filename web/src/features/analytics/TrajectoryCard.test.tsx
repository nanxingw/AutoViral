import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { TrajectoryCard } from "./TrajectoryCard";
import { useLocaleStore } from "@/i18n/store";

afterEach(() => useLocaleStore.getState().setLocale("en"));

// The user's real frozen Douyin reality: 5 followers, 9 works, best 2705,
// ~5621 total reach.
const REAL = {
  followerCount: 5,
  worksCount: 9,
  bestPlay: 2705,
  totalReach: 5621,
};

describe("<TrajectoryCard /> (PRD-0006 S11)", () => {
  it("renders the next follower milestone as a from→to goal (5 → 50)", () => {
    render(<TrajectoryCard {...REAL} />);
    const section = screen.getByRole("region", { name: /growth trajectory/i });
    // current 5 surfaces as the real "from" value (followers goal row)…
    expect(within(section).getByText("5")).toBeInTheDocument();
    // …and the next round target 50 is the "to" value of that goal.
    expect(within(section).getByText("50")).toBeInTheDocument();
  });

  it("frames the milestone as a TARGET / goal, not a measured or forecast fact (honesty)", () => {
    render(<TrajectoryCard {...REAL} />);
    const section = screen.getByRole("region", { name: /growth trajectory/i });
    // The load-bearing honesty contract: the card must explicitly mark the
    // projection as a goal/target, never claim it as measured or predicted.
    // The badge says it out loud ("Target · not measured").
    expect(within(section).getByText(/target · not measured/i)).toBeInTheDocument();
  });

  it("surfaces the real already-reached signposts (9 published works, best play 2705)", () => {
    render(<TrajectoryCard {...REAL} />);
    const section = screen.getByRole("region", { name: /growth trajectory/i });
    expect(within(section).getByText(/\b9\b/)).toBeInTheDocument();
    expect(within(section).getByText(/2\.7K|2705/)).toBeInTheDocument();
  });

  it("localizes to Chinese", () => {
    act(() => useLocaleStore.getState().setLocale("zh"));
    render(<TrajectoryCard {...REAL} />);
    // ZH aria-label for the region
    const section = screen.getByRole("region", { name: /成长轨迹/i });
    expect(section).toBeInTheDocument();
    // ZH target/goal wording present (诚实标注为目标，非实测) — badge is exact.
    expect(within(section).getByText("目标 · 非实测")).toBeInTheDocument();
  });

  it("still renders the works/best-play signposts even when the follower goal is exhausted", () => {
    render(
      <TrajectoryCard
        followerCount={9_999_999}
        worksCount={9}
        bestPlay={2705}
        totalReach={5621}
      />,
    );
    const section = screen.getByRole("region", { name: /growth trajectory/i });
    // no fabricated follower goal past the top rung, but the real signposts stay
    expect(within(section).getByText(/\b9\b/)).toBeInTheDocument();
  });
});
