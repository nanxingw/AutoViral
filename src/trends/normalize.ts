import { createHash } from "node:crypto";
import type { Platform, TrendItem } from "./schema.js";

/**
 * Bridge the two trend-data schemas that coexist on disk (#49).
 *
 * Two formats were ever written under `~/.autoviral/trends/<platform>/`:
 *   - legacy `{ topics: [{ title, heat, competition, opportunity, description,
 *     tags, contentAngles, exampleHook, category }] }` — what the
 *     `refresh-stream` agent prompt still emits, and what xiaohongshu's latest
 *     real file uses;
 *   - current `{ items: TrendItem[] }` (with id / source / cover / metrics /
 *     analysis) — what the scraper pipeline writes.
 *
 * The Explore frontend (`usePlatformTrends`) reads ONLY `.items`, so a legacy
 * `{topics}` file rendered "NO DATA" even though real trends were on disk —
 * and xiaohongshu (the default landing platform) happened to be legacy, so the
 * first screen was blank. Normalizing on the GET path makes every consumer
 * (frontend, CLI, future callers) see one shape. Pass-through when the payload
 * is already `{items}`; only `{topics}` is rewritten.
 */

interface LegacyTopic {
  title?: unknown;
  heat?: unknown;
  competition?: unknown;
  opportunity?: unknown;
  description?: unknown;
  tags?: unknown;
  contentAngles?: unknown;
  exampleHook?: unknown;
  category?: unknown;
}

function clampHeat(v: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5;
}

function normCompetition(v: unknown): "低" | "中" | "高" {
  return v === "低" || v === "中" || v === "高" ? v : "中";
}

function normOpportunity(v: unknown): "金矿" | "蓝海" | "红海" {
  return v === "金矿" || v === "蓝海" || v === "红海" ? v : "蓝海";
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

const SEARCH_BASE: Record<Platform, string> = {
  youtube: "https://www.youtube.com/results?search_query=",
  tiktok: "https://www.tiktok.com/search?q=",
  xiaohongshu: "https://www.xiaohongshu.com/search_result?keyword=",
  douyin: "https://www.douyin.com/search/",
};

function searchUrlFor(platform: Platform, title: string): string {
  const base = SEARCH_BASE[platform] ?? SEARCH_BASE.xiaohongshu;
  return base + encodeURIComponent(title);
}

function topicToItem(
  topic: LegacyTopic,
  platform: Platform,
  idx: number,
  collectedAt: string,
): TrendItem {
  const title = String(topic.title ?? `Trend ${idx + 1}`).slice(0, 200);
  // Salt the hash with the array index so duplicate titles can't collide on the
  // same id (the #41 enrichment-collision lesson, applied to synthesized ids).
  const hash = createHash("sha1")
    .update(`${idx}:${title}`)
    .digest("hex")
    .slice(0, 12);
  return {
    id: `legacy_${platform}_${hash}`,
    platform,
    title,
    sourceUrl: searchUrlFor(platform, title),
    source: "agent_websearch",
    scrapedAt: collectedAt,
    // Legacy topics carry no cover; TrendingPanel renders no thumbnail (rank is
    // the visual anchor), so an empty placeholder is safe.
    cover: { url: "", aspect: "9:16" },
    metrics: null,
    analysis: {
      heat: clampHeat(topic.heat),
      competition: normCompetition(topic.competition),
      opportunity: normOpportunity(topic.opportunity),
      description: String(topic.description ?? ""),
      tags: toStringArray(topic.tags),
      contentAngles: toStringArray(topic.contentAngles),
      exampleHook: String(topic.exampleHook ?? ""),
      category: String(topic.category ?? "趋势"),
    },
  };
}

export interface NormalizedTrends {
  platform: Platform;
  items: TrendItem[];
  collectedAt: string;
  pipelineStatus: "ok" | "partial" | "failed";
  [key: string]: unknown;
}

/**
 * Returns a payload the frontend's `{items}` contract understands. Already-new
 * `{items}` payloads pass through untouched; legacy `{topics}` payloads are
 * mapped to `{items}`. Anything else is returned as-is.
 */
export function normalizeTrendsPayload(
  data: unknown,
  platform: Platform,
  collectedAtFallback: string,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj; // current schema — leave alone
  if (Array.isArray(obj.topics)) {
    const collectedAt =
      typeof obj.collectedAt === "string" ? obj.collectedAt : collectedAtFallback;
    const items = (obj.topics as LegacyTopic[]).map((topic, idx) =>
      topicToItem(topic, platform, idx, collectedAt),
    );
    return {
      platform,
      items,
      collectedAt,
      pipelineStatus: "ok",
    } satisfies NormalizedTrends;
  }
  return obj;
}
