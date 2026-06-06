/**
 * D1 extension — content-pillar tagging + per-pillar aggregation (PRD-0006 S10).
 *
 * The user has 9 published works but no way to compare them: a single
 * lifetime average flattens "your fashion posts out-engage your anime posts
 * 2×" into one meaningless number. S10 tags each work into a small set of
 * content pillars and aggregates per-pillar performance so the 9 works become
 * comparable.
 *
 * HONESTY constraint (the load-bearing rule of this slice): the PRD allows
 * pillar tagging to be "rule-based or agent-assisted, but kept
 * deterministic/testable at the aggregation boundary". We choose **rule-based**
 * — a fixed keyword/hashtag → pillar map — so `assignPillar` is a pure,
 * total function with no model call, no randomness, no I/O. Same caption in,
 * same pillar out, asserted in the test. The aggregation never fabricates a
 * metric: it only sums/averages the real on-disk play/digg/comment/share/
 * collect counts already derived by `creator-analytics.ts`.
 *
 * The pure core returns i18n message *keys* (via the stable `PillarKey`), not
 * localised strings, so the comparison view stays bilingual via `t()` (matches
 * the codebase i18n pattern; see useT.ts and the sibling benchmark core).
 */
import type { WorkMetricInput } from "./creator-analytics";

/**
 * Stable pillar identifiers. Five pillars (PRD: 3–5) cover the user's real
 * content: fashion / anime-&-sci-fi / pets / lifestyle, plus an explicit
 * `other` bucket for captions that match no rule (e.g. bare sentimental
 * quotes) — so nothing is silently dropped or force-fit.
 */
export type PillarKey = "fashion" | "anime" | "pets" | "lifestyle" | "other";

/** Order pillars are *considered* in; first match wins (deterministic). */
const PILLAR_ORDER: Exclude<PillarKey, "other">[] = [
  "fashion",
  "pets",
  "anime",
  "lifestyle",
];

/**
 * Keyword/hashtag sets per pillar. Matching is plain substring containment on
 * the lower-cased caption — captions carry hashtags inline (`#街头穿搭`), so a
 * substring match is enough and stays dependency-free. Fashion/pets are
 * checked before anime/lifestyle so a more specific tag wins over a broad one.
 */
const PILLAR_KEYWORDS: Record<Exclude<PillarKey, "other">, string[]> = {
  fashion: ["穿搭", "蕾丝", "ootd", "outfit", "fashion", "时尚", "街头"],
  pets: ["萌宠", "小狗", "狗狗", "猫", "宠物", "puppy", "哮天犬"],
  anime: [
    "二次元",
    "壁纸",
    "科幻",
    "月球",
    "战争",
    "生化危机",
    "游戏",
    "anime",
    "pv",
  ],
  lifestyle: [
    "日常",
    "volg",
    "vlog",
    "球赛",
    "女球迷",
    "看台",
    "奇遇",
    "生活",
    "热门",
  ],
};

/**
 * Deterministically assign one caption to a content pillar.
 *
 * Pure + total: any string maps to exactly one `PillarKey`; unmatched
 * captions land in `"other"` rather than being force-fit or dropped.
 */
export function assignPillar(desc: string): PillarKey {
  const hay = (desc ?? "").toLowerCase();
  for (const pillar of PILLAR_ORDER) {
    if (PILLAR_KEYWORDS[pillar].some((kw) => hay.includes(kw.toLowerCase()))) {
      return pillar;
    }
  }
  return "other";
}

/** Aggregated performance for one content pillar (real, never fabricated). */
export interface PillarAggregate {
  key: PillarKey;
  /** Number of works tagged into this pillar. */
  workCount: number;
  /** Sum of real play counts across the pillar's works. */
  totalPlay: number;
  /** Floored mean play per work in this pillar (matches backend rounding). */
  avgPlay: number;
  /**
   * Pillar engagement rate = Σ(digg+comment+share+collect) / Σ(play), a
   * fraction in [0,1]. 0 when the pillar has no plays (no fabricated divide).
   */
  engagementRate: number;
}

export interface PillarComparison {
  /**
   * One entry per *non-empty* pillar, sorted by `avgPlay` descending so the
   * strongest-performing pillar leads.
   */
  pillars: PillarAggregate[];
  /** The best pillar by avg play, or null when there are no works. */
  topPillar: PillarAggregate | null;
  /**
   * How many times the top pillar out-plays the weakest pillar (avgPlay
   * ratio), so the UI can say "你的 X 类作品是 Y 类的 N 倍". null when fewer
   * than two pillars, or when the weakest pillar has 0 avg play (avoid /0).
   */
  multiple: number | null;
}

/**
 * Tag every work into a pillar and aggregate per-pillar performance.
 *
 * @param works per-post metrics (already adapter-normalised; see
 *              {@link WorkMetricInput})
 */
export function derivePillarComparison(works: WorkMetricInput[]): PillarComparison {
  // Bucket works by pillar. Insertion order of buckets doesn't matter — we
  // sort the final list by avgPlay.
  const buckets = new Map<PillarKey, WorkMetricInput[]>();
  for (const w of works) {
    const key = assignPillar(w.desc ?? "");
    const list = buckets.get(key) ?? [];
    list.push(w);
    buckets.set(key, list);
  }

  const pillars: PillarAggregate[] = [];
  for (const [key, list] of buckets) {
    const totalPlay = list.reduce((s, w) => s + (w.playCount ?? 0), 0);
    const totalEngagements = list.reduce(
      (s, w) =>
        s +
        (w.diggCount ?? 0) +
        (w.commentCount ?? 0) +
        (w.shareCount ?? 0) +
        (w.collectCount ?? 0),
      0,
    );
    pillars.push({
      key,
      workCount: list.length,
      totalPlay,
      avgPlay: list.length > 0 ? Math.floor(totalPlay / list.length) : 0,
      engagementRate: totalPlay > 0 ? totalEngagements / totalPlay : 0,
    });
  }

  // Strongest pillar first. Ties broken by workCount desc, then key for
  // determinism so the same input always renders in the same order.
  pillars.sort((a, b) => {
    if (b.avgPlay !== a.avgPlay) return b.avgPlay - a.avgPlay;
    if (b.workCount !== a.workCount) return b.workCount - a.workCount;
    return a.key.localeCompare(b.key);
  });

  const topPillar = pillars.length > 0 ? pillars[0] : null;
  const weakest = pillars.length > 0 ? pillars[pillars.length - 1] : null;
  const multiple =
    topPillar && weakest && pillars.length >= 2 && weakest.avgPlay > 0
      ? topPillar.avgPlay / weakest.avgPlay
      : null;

  return { pillars, topPillar, multiple };
}
