/**
 * angle-briefs — shape a small push-feed of concrete, personalized 选题 briefs
 * (PRD-0006 S9) from the SAME grounded context the coach reads (works +
 * selected-platform trends + interests).
 *
 * This is the honest replacement for the old hard-coded 3-sample 起手切角 card.
 * It is a PURE, deterministic function over the assembled context — no LLM round
 * trip on page load (so the feed is instant + free) and, crucially, NO
 * FABRICATION:
 *
 *   · Each brief's hook + why-it-is-rising is grounded in a REAL trend topic
 *     and/or the user's REAL interests; the title weaves the user's niche into
 *     the rising topic.
 *   · With THIN/zero work data we lean entirely on trends + interests and the
 *     `grounding` field says so — we never invent per-work precision ("3 of 5
 *     top creators abandoned…" style invented magnitudes the old samples used).
 *   · We never reference a metric AutoViral has not measured. Work grounding,
 *     when present, only cites the five real metrics already in CoachWorkInput.
 *
 * The shaping is intentionally template-light: it composes real fragments
 * (interest, trend title, the top work's actual play count) rather than writing
 * prose, so there is nothing for the function to hallucinate.
 */

import type { CoachWorkInput } from "./coach-session.js";

/** The grounding basis for a brief — drives the honest "why" + the UI chip. */
export type AngleGrounding =
  | "trend+interest" // a rising trend crossed with the user's niche (richest)
  | "trend" // a rising trend, no interest configured yet
  | "interest" // an interest with no live trend to cross (thin trend data)
  | "thin"; // neither trend nor interest — honest empty-ish fallback

export interface AngleBrief {
  /** Stable id (index-derived) so React keys + click handlers are stable. */
  id: string;
  /** The selection's name — also the new work's title + brief lead line. */
  title: string;
  /** A concrete opening hook the creator can shoot. */
  hook: string;
  /** Why this is worth doing now — grounded in the real trend/interest. */
  why: string;
  /** What this brief is grounded in — the UI shows an honest chip from this. */
  grounding: AngleGrounding;
}

/** The context the shaper grounds on — the coach's assembled context shape. */
export interface AngleBriefContext {
  platform: string;
  works: CoachWorkInput[];
  trendTopics: string[];
  interests: string[];
}

export interface ShapeAngleBriefsOptions {
  /** How many briefs to push (the feed is intentionally short). Default 5. */
  limit?: number;
}

/** Below this work count the per-work signal is too weak to cite confidently. */
const THIN_WORKS = 3;

/** A non-empty trimmed string or undefined. */
function clean(s: string | undefined): string | undefined {
  const v = (s ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/** The single best work by play count, if any — for an honest weak-signal cite. */
function topWork(works: CoachWorkInput[]): CoachWorkInput | undefined {
  if (works.length === 0) return undefined;
  return [...works].sort((a, b) => b.playCount - a.playCount)[0];
}

/**
 * Shape the push feed of angle briefs from the grounded context. Deterministic
 * and honest: crosses each rising trend with the user's interests, leans on
 * interests alone when trend data is thin, and degrades to an honest single
 * "no signal yet" brief when there is neither trend nor interest to ground on.
 */
export function shapeAngleBriefs(
  ctx: AngleBriefContext,
  opts: ShapeAngleBriefsOptions = {},
): AngleBrief[] {
  const limit = Math.max(0, opts.limit ?? 5);
  if (limit === 0) return [];

  const trends = ctx.trendTopics.map(clean).filter((t): t is string => !!t);
  const interests = ctx.interests.map(clean).filter((i): i is string => !!i);
  const top = topWork(ctx.works);
  const thinWorks = ctx.works.length < THIN_WORKS;

  // A short, honest weak-signal cite for the top work — ONLY the real play
  // metric, and ONLY when the sample isn't too thin to mean anything.
  const workSignal =
    top && !thinWorks && clean(top.desc)
      ? `你过去表现最好的《${clean(top.desc)!.slice(0, 24)}》拿到 ${top.playCount} 播放，这条延续了同一脉络。`
      : undefined;

  const briefs: AngleBrief[] = [];

  // 1) Richest: cross each rising trend with one of the user's interests.
  if (trends.length > 0) {
    for (let i = 0; i < trends.length && briefs.length < limit; i++) {
      const trend = trends[i];
      const interest = interests.length > 0 ? interests[i % interests.length] : undefined;
      if (interest) {
        briefs.push({
          id: `brief-${briefs.length}`,
          title: `${interest} × ${trend}`,
          hook: `用你「${interest}」的视角切入「${trend}」——开场就把两者的反差摆出来。`,
          why: workSignal
            ? `「${trend}」正在${ctx.platform}上涨，而你的赛道是「${interest}」，正好接得住这波热度。${workSignal}`
            : `「${trend}」正在${ctx.platform}上涨，与你「${interest}」的赛道高度契合，是顺势而为的选题。`,
          grounding: "trend+interest",
        });
      } else {
        briefs.push({
          id: `brief-${briefs.length}`,
          title: trend,
          hook: `针对「${trend}」做一个你的版本——开场 1.5 秒先抛出最反常识的那一点。`,
          why: `「${trend}」正在${ctx.platform}上涨。你还没配置赛道兴趣，这是按平台热度给的方向。`,
          grounding: "trend",
        });
      }
    }
  }

  // 2) Thin trend data but real interests → ground on interests alone.
  if (briefs.length < limit && trends.length === 0 && interests.length > 0) {
    for (let i = 0; i < interests.length && briefs.length < limit; i++) {
      const interest = interests[i];
      briefs.push({
        id: `brief-${briefs.length}`,
        title: `深做「${interest}」`,
        hook: `挑「${interest}」里一个最具体的小切口，开场直接给结论再倒叙。`,
        why: `暂时没有抓到${ctx.platform}的实时趋势数据，这条是按你配置的「${interest}」赛道给的方向，建议点「采集趋势」拿到更准的热度后再迭代。`,
        grounding: "interest",
      });
    }
  }

  // 3) Honest empty-ish fallback — neither trend nor interest to ground on.
  if (briefs.length === 0) {
    briefs.push({
      id: "brief-0",
      title: "先告诉 AutoViral 你的赛道",
      hook: "",
      why: `还没有可用的${ctx.platform}趋势数据，你也还没配置赛道兴趣，所以这里给不出个性化选题。配置兴趣或点「采集趋势」后，这里会换成为你赛道量身的选题。`,
      grounding: "thin",
    });
  }

  return briefs.slice(0, limit);
}
