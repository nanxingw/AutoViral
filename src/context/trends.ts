/**
 * Trends extension for the agent context aggregator.
 *
 * Wraps the existing src/trends/sources/ scrapers behind a single
 * getTrends() facade so the bridge and CLI don't have to know which
 * platform implementations exist or how to combine them.
 *
 * H0.4 ships a minimal facade — scrapers are platform-by-platform and
 * many require external API keys / browser sessions to actually fetch
 * live data. When a scraper isn't available, we return an empty array
 * rather than throwing, so context endpoint stays robust.
 */
import { getSource } from "../trends/sources/index.js";

export type Platform = "douyin" | "bilibili" | "youtube" | "xiaohongshu";

/**
 * Some legacy/alternate source shapes expose a `fetch(topic?)` method instead
 * of the current `Source.collect()` signature. We probe for it structurally so
 * the facade stays robust to either shape; the current `Source` implementations
 * don't carry `fetch`, so this guard returns false for them and we skip — same
 * best-effort behaviour as before, just without the unsafe cast.
 */
type FetchableSource = { fetch: (topic?: string) => Promise<unknown[]> };

function hasFetch(source: unknown): source is FetchableSource {
  return (
    typeof source === "object" &&
    source !== null &&
    typeof (source as { fetch?: unknown }).fetch === "function"
  );
}

export interface TrendItem {
  platform: Platform;
  title: string;
  url?: string;
  score?: number;
}

export interface TrendsSummary {
  generatedAt: string;
  platforms: Platform[];
  items: TrendItem[];
}

const SUPPORTED_PLATFORMS: Platform[] = [
  "douyin",
  "bilibili",
  "youtube",
  "xiaohongshu",
];

export async function getTrends(opts: {
  platforms?: Platform[];
  topic?: string;
  limit?: number;
} = {}): Promise<TrendsSummary> {
  const limit = opts.limit ?? 10;
  const requested = opts.platforms ?? SUPPORTED_PLATFORMS;
  const items: TrendItem[] = [];

  for (const platform of requested) {
    try {
      const source = getSource(platform as never);
      if (!hasFetch(source)) {
        continue;
      }
      // Each source's signature varies — best-effort invocation; on any
      // failure we just skip the platform.
      const rawItems = (await source.fetch(opts.topic).catch(() => [])) as Array<{
        title?: string;
        url?: string;
        score?: number;
      }>;
      for (const r of rawItems.slice(0, limit)) {
        if (!r.title) continue;
        items.push({
          platform,
          title: r.title,
          url: r.url,
          score: r.score,
        });
      }
    } catch {
      // skip platform
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    platforms: requested,
    items,
  };
}
