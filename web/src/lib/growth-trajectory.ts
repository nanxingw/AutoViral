/**
 * D1 extension — growth trajectory + next-milestone pure core (PRD-0006 S11).
 *
 * With only 5 followers and 9 published works, a *retrospective* growth chart
 * is meaningless — there is no time-series on disk, just a single frozen
 * snapshot. So the truthful, useful thing to surface is **forward-looking**: a
 * concrete next milestone to aim at (the PRD's worked example: "from 5 to 50
 * followers") plus the real signposts the creator has already passed.
 *
 * HONESTY constraint (the load-bearing rule of this slice): the milestone is a
 * **target / estimate**, never a measured or forecast fact. We have no
 * time-series, so we deliberately do NOT invent an ETA / date / projected
 * curve — that would be a fabricated number. Every {@link Milestone} carries
 * `isProjection: true` so the rendering shell can label it a goal, and the
 * `current` / `published` / `bestPlay` fields are the creator's real on-disk
 * numbers, passed through truthfully.
 *
 * Pure + UI-agnostic so it is unit-testable in isolation (see
 * `growth-trajectory.test.ts`). Returns no i18n strings — the view localises.
 */

/** The kinds of value a milestone ladder is chosen for. */
export type MilestoneKind = "follower" | "play" | "work";

/**
 * Round milestone rungs per kind. Each ladder is "ambitious but reachable":
 * the next rung above a tiny value is a clear stretch goal (5 followers → 50,
 * the PRD's worked example), not a trivial +1. Followers/plays share a 1-2.5-5
 * decade pattern (the follower ladder starts at 50 — a 10-follower bump isn't a
 * milestone worth a card); works step
 * in smaller human-sized increments. Ladders are finite on purpose — past the
 * top we return null rather than fabricate an ever-larger fake goal.
 */
const LADDERS: Record<MilestoneKind, number[]> = {
  follower: [
    50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000,
    250_000, 500_000, 1_000_000,
  ],
  play: [
    100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000,
    250_000, 500_000, 1_000_000,
  ],
  work: [10, 25, 50, 100, 250, 500, 1_000],
};

/**
 * The next round milestone strictly above `current`, or `null` once the value
 * is past the top of its ladder (no fabricated infinite goal).
 */
export function nextMilestone(current: number, kind: MilestoneKind): number | null {
  const ladder = LADDERS[kind];
  for (const rung of ladder) {
    if (rung > current) return rung;
  }
  return null;
}

/** Raw inputs, all the creator's real on-disk numbers. */
export interface GrowthInput {
  /** Current follower count (e.g. 5). */
  followerCount: number;
  /** Number of published works (e.g. 9). */
  worksCount: number;
  /** Highest play count across works (e.g. 2705). */
  bestPlay: number;
  /** Sum of plays across all works — total lifetime reach (e.g. 5621). */
  totalReach: number;
}

/** One forward-looking milestone, always framed as a target. */
export interface Milestone {
  kind: MilestoneKind;
  /** The creator's real current value for this dimension. */
  current: number;
  /** The next round target above `current`. */
  target: number;
  /** How many more to reach the target (target − current, floored at 0). */
  remaining: number;
  /** Progress current/target, clamped to [0,1], never NaN. */
  progress: number;
  /**
   * Always `true`: this is a goal, not a measurement or forecast. The UI MUST
   * label it as such (honesty constraint) — we never claim to predict it.
   */
  isProjection: true;
}

export interface GrowthTrajectory {
  /** Next follower milestone, or null when past the top of the ladder. */
  follower: Milestone | null;
  /** Next total-reach (play) milestone, or null when past the ladder. */
  reach: Milestone | null;
  /** Real count of published works (a signpost already reached). */
  published: number;
  /** Real best single-work play count (a signpost already reached). */
  bestPlay: number;
}

function buildMilestone(current: number, kind: MilestoneKind): Milestone | null {
  const target = nextMilestone(current, kind);
  if (target === null) return null;
  const remaining = Math.max(0, target - current);
  // Clamp to [0,1]; target is always > current and > 0 here, so no /0.
  const progress = Math.min(1, Math.max(0, current / target));
  return { kind, current, target, remaining, progress, isProjection: true };
}

/**
 * Derive the forward-looking growth trajectory from the creator's real numbers.
 *
 * @param input the creator's current follower / works / reach numbers
 */
export function deriveGrowthTrajectory(input: GrowthInput): GrowthTrajectory {
  return {
    follower: buildMilestone(input.followerCount ?? 0, "follower"),
    reach: buildMilestone(input.totalReach ?? 0, "play"),
    published: input.worksCount ?? 0,
    bestPlay: input.bestPlay ?? 0,
  };
}
