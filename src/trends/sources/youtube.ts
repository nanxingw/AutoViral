import { XMLParser } from "fast-xml-parser";
import type { Source, RawTrendItem } from "./types.js";

const TRENDING_RSS =
  "https://www.youtube.com/feeds/videos.xml?chart=most-popular";

export const youtubeSource: Source = {
  platform: "youtube",
  async collect({ limit, signal }) {
    const res = await fetch(TRENDING_RSS, { signal });
    if (!res.ok) throw new Error(`youtube rss fetch failed: ${res.status}`);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const parsed = parser.parse(xml);
    const entries = parsed?.feed?.entry ?? [];
    const arr = Array.isArray(entries) ? entries : [entries];
    const now = new Date().toISOString();
    return arr.slice(0, limit).map((e: any): RawTrendItem => {
      const videoId = e["yt:videoId"];
      const stats = e["media:group"]?.["media:community"]?.["media:statistics"];
      const rating = e["media:group"]?.["media:community"]?.["media:starRating"];
      return {
        id: `yt_${videoId}`,
        platform: "youtube",
        title: e.title,
        sourceUrl: Array.isArray(e.link)
          ? e.link.find((l: any) => l.rel === "alternate")?.href
          : e.link?.href ?? `https://www.youtube.com/watch?v=${videoId}`,
        source: "rss",
        scrapedAt: now,
        cover: {
          url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          aspect: "16:9",
        },
        metrics: {
          views: stats?.views != null ? Number(stats.views) : null,
          likes: rating?.count != null ? Number(rating.count) : null,
          comments: null,
          shares: null,
          fetchedAt: now,
        },
      };
    });
  },
};
