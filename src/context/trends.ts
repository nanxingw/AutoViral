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
      if (!source || typeof (source as { fetch?: unknown }).fetch !== "function") {
        continue;
      }
      // Each source's signature varies — best-effort invocation; on any
      // failure we just skip the platform.
      const rawItems = (await (source as {
        fetch: (q?: string) => Promise<unknown[]>;
      }).fetch(opts.topic).catch(() => [])) as Array<{
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
