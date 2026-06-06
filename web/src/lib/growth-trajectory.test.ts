import { describe, it, expect } from "vitest";
import {
  deriveGrowthTrajectory,
  nextMilestone,
  type GrowthInput,
} from "./growth-trajectory";

/**
 * S11 (PRD-0006) — growth trajectory + next-milestone pure core.
 *
 * Fixture mirrors the user's frozen Douyin reality: 5 followers, 9 published
 * works, best post 2705 plays, ~5621 total reach. With this few data points a
 * retrospective chart is meaningless, so the contract is a *forward-looking
 * target*: the next round milestone above the current value, framed as a goal —
 * NEVER a measured/forecast fact (honesty constraint).
 */
const REAL: GrowthInput = {
  followerCount: 5,
  worksCount: 9,
  bestPlay: 2705,
  totalReach: 5621,
};

describe("nextMilestone", () => {
  it("returns the next round rung strictly above the current value", () => {
    // PRD's worked example: 5 followers → next milestone 50. The first
    // follower milestone worth a forward-looking card is 50 (a 10-follower
    // bump isn't a milestone) — so the ladder's first rung is 50.
    expect(nextMilestone(5, "follower")).toBe(50);
  });

  it("skips a rung the user has already passed", () => {
    expect(nextMilestone(60, "follower")).toBe(100);
    expect(nextMilestone(100, "follower")).toBe(250); // strictly above, not equal
  });

  it("scales the ladder for large play counts", () => {
    expect(nextMilestone(2705, "play")).toBe(5000);
    expect(nextMilestone(9, "work")).toBe(10);
  });

  it("returns null once the value is past the top of the ladder (no fake goal)", () => {
    expect(nextMilestone(9_999_999, "follower")).toBeNull();
  });
});

describe("deriveGrowthTrajectory", () => {
  it("derives a follower trajectory: current 5, target 50, remaining 45", () => {
    const t = deriveGrowthTrajectory(REAL);
    expect(t.follower).not.toBeNull();
    expect(t.follower!.current).toBe(5);
    expect(t.follower!.target).toBe(50);
    expect(t.follower!.remaining).toBe(45);
  });

  it("reports progress toward the milestone as a [0,1] fraction", () => {
    const t = deriveGrowthTrajectory(REAL);
    // 5 / 50 = 0.1
    expect(t.follower!.progress).toBeCloseTo(0.1, 5);
  });

  it("clamps progress into [0,1] and never NaN even at zero", () => {
    const t = deriveGrowthTrajectory({
      followerCount: 0,
      worksCount: 0,
      bestPlay: 0,
      totalReach: 0,
    });
    expect(t.follower!.progress).toBe(0);
    expect(t.follower!.progress).not.toBeNaN();
    // next follower rung above 0 is the first ladder rung (50)
    expect(t.follower!.target).toBe(50);
  });

  it("marks every milestone as a target/estimate, not a measured fact", () => {
    const t = deriveGrowthTrajectory(REAL);
    // The honesty flag is the load-bearing contract for this slice: the UI
    // must be able to label the projection a goal, never a measurement.
    expect(t.follower!.isProjection).toBe(true);
    expect(t.reach!.isProjection).toBe(true);
  });

  it("derives a reach milestone from the real total plays", () => {
    const t = deriveGrowthTrajectory(REAL);
    // total reach 5621 → next play-ladder rung is 10000
    expect(t.reach!.current).toBe(5621);
    expect(t.reach!.target).toBe(10_000);
  });

  it("surfaces the real already-reached signposts (works published, best play) truthfully", () => {
    const t = deriveGrowthTrajectory(REAL);
    expect(t.published).toBe(9);
    expect(t.bestPlay).toBe(2705);
  });

  it("yields no follower goal when already past the top rung (honest, not fabricated)", () => {
    const t = deriveGrowthTrajectory({
      followerCount: 9_999_999,
      worksCount: 9,
      bestPlay: 2705,
      totalReach: 5621,
    });
    expect(t.follower).toBeNull();
  });
});
