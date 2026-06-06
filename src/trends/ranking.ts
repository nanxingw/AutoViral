import type { TrendItem } from "./schema.js";

/**
 * S14 — interest-aware trend ranking.
 *
 * `config.interests` (穿搭 / 健身 / 科技 …) was collected and persisted but never
 * consumed in the ranking path: trends were served in raw file order. This module
 * scores each trend by how well it fits the user's declared niche, then reorders
 * so the most on-channel trends surface first. Heat is the tiebreaker, so within
 * one fit tier the hottest trend still wins.
 *
 * Honesty caveat (PRD 门控): 3 of 4 platforms are LLM-fabricated rows with null
 * metrics — ranking can only sort what's there, it can't manufacture relevance.
 * The provenance badges stay; this just orders the same honest rows by fit.
 */

const FIT_CATEGORY = 3; // category is the strongest niche signal
const FIT_TAG = 2; // each matching tag
const FIT_TITLE = 1; // a niche word appearing in the title

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * How well one trend fits the user's interests. Pure, side-effect free, and
 * order-independent so it's trivial to unit-test. 0 means "no interest match"
 * (also the value when no interests are configured).
 */
export function interestFitScore(item: TrendItem, interests: string[]): number {
  if (!interests || interests.length === 0) return 0;
  const a = item.analysis;
  if (!a) return 0;
  const category = norm(a.category ?? "");
  const tags = (a.tags ?? []).map(norm);
  const title = norm(item.title ?? "");
  let score = 0;
  for (const raw of interests) {
    const interest = norm(raw);
    if (!interest) continue;
    // Category: bidirectional substring so "穿搭" matches "穿搭风格" and vice versa.
    if (category && (category.includes(interest) || interest.includes(category))) {
      score += FIT_CATEGORY;
    }
    for (const tag of tags) {
      if (tag && (tag.includes(interest) || interest.includes(tag))) score += FIT_TAG;
    }
    if (title.includes(interest)) score += FIT_TITLE;
  }
  return score;
}

/**
 * Return a NEW array of items ordered by interest fit (desc), then heat (desc).
 * Never mutates the input. With an empty interests list this degrades to a pure
 * heat sort (every fit score is 0), so callers always get a sensibly ordered list
 * even before the user has configured a niche.
 */
export function rankByInterests<T extends TrendItem>(items: T[], interests: string[]): T[] {
  const scored = items.map((item, idx) => ({
    item,
    idx,
    fit: interestFitScore(item, interests),
    heat: item.analysis?.heat ?? 0,
  }));
  scored.sort((a, b) => {
    if (b.fit !== a.fit) return b.fit - a.fit;
    if (b.heat !== a.heat) return b.heat - a.heat;
    return a.idx - b.idx; // stable: preserve original order on a full tie
  });
  return scored.map((s) => s.item);
}
