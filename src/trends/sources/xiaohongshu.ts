import { chromium, type Browser } from "playwright";
import type { Source, RawTrendItem } from "./types.js";

interface DomFeedItem {
  id: string;
  title: string;
  url: string;
  coverUrl: string;
  likes: number | null;
  views: number | null;
}

/** Pure parser, exposed for test injection. */
export function xiaohongshuSourceFromDom(feed: DomFeedItem[]): RawTrendItem[] {
  const now = new Date().toISOString();
  return feed.map((f): RawTrendItem => ({
    id: `xhs_${f.id}`,
    platform: "xiaohongshu",
    title: f.title,
    sourceUrl: `https://www.xiaohongshu.com${f.url}`,
    source: "scraper",
    scrapedAt: now,
    cover: { url: f.coverUrl, aspect: "9:16" },
    metrics: {
      views: f.views,
      likes: f.likes,
      comments: null,
      shares: null,
      fetchedAt: now,
    },
  }));
}

async function scrapeExplore(limit: number, signal?: AbortSignal): Promise<DomFeedItem[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      viewport: { width: 1366, height: 900 },
    });
    const page = await ctx.newPage();
    if (signal?.aborted) throw new Error("aborted");
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector('section[class*="note-item"], a[href*="/explore/"]', { timeout: 10_000 }).catch(() => {});
    const feed = await page.evaluate((max: number): DomFeedItem[] => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/explore/"]'));
      const seen = new Set<string>();
      const out: DomFeedItem[] = [];
      for (const a of anchors) {
        const href = a.getAttribute("href") ?? "";
        const idMatch = href.match(/\/explore\/([a-zA-Z0-9_-]+)/);
        if (!idMatch) continue;
        const id = idMatch[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const titleEl = a.querySelector('[class*="title"], [class*="footer"]');
        const imgEl = a.querySelector("img");
        if (!titleEl || !imgEl) continue;
        out.push({
          id,
          title: titleEl.textContent?.trim() ?? "",
          url: href.startsWith("/") ? href : `/explore/${id}`,
          coverUrl: imgEl.getAttribute("src") ?? "",
          likes: null,
          views: null,
        });
        if (out.length >= max) break;
      }
      return out;
    }, limit);
    return feed;
  } finally {
    await browser?.close();
  }
}

export const xiaohongshuSource: Source = {
  platform: "xiaohongshu",
  async collect({ limit, signal }) {
    const feed = await scrapeExplore(limit, signal);
    return xiaohongshuSourceFromDom(feed);
  },
};
