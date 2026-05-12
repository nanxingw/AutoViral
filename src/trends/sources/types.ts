import type { Platform, ItemSource, CoverAspect } from "../schema.js";

export interface RawTrendItem {
  id: string;
  platform: Platform;
  title: string;
  sourceUrl: string;
  source: ItemSource;
  scrapedAt: string;
  cover: { url: string; aspect: CoverAspect } | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    fetchedAt: string;
  } | null;
}

export interface Source {
  platform: Platform;
  collect(opts: { limit: number; signal?: AbortSignal }): Promise<RawTrendItem[]>;
}
