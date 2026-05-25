# Trends 4-Platform Collection Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's "agent WebSearch generates everything including fake metrics" trends pipeline with a per-platform real-data collector that emits a zod-validated structure with honest provenance and cached cover images for YouTube / TikTok / 小红书 / 抖音.

**Architecture:** Three layers — `sources/` collect raw items per platform (RSS for YouTube, headless playwright for 小红书, agent WebSearch for TikTok/抖音 marked `source: "agent_websearch"`), `enrichment.ts` asks the agent to fill only `analysis` fields and retries against zod validation up to 2 times, `covers.ts` downloads each item's real cover image to local disk and serves through `/api/trends/:platform/covers/:id`. Frontend drops the `heat × 1000` cosmetic, renders true metrics when present, and shows a per-item source badge.

**Tech Stack:** TypeScript, zod, hono (existing server), playwright (new dep for 小红书 only), Vitest, claude-cli (existing agent), React 18.

**Locked decisions (from planning Q&A):**
- TikTok / 抖音 → `agent_websearch` fallback (no playwright stealth). Explicit `source` field on every item.
- Cover images → cached to `~/.autoviral/trends/<platform>/covers/<id>.jpg`. No realtime proxy.
- Refresh → keep existing cron `7 9,21 * * *` calling `POST /api/trends/refresh`; user-triggered button hits the same endpoint with `platforms: ["youtube","tiktok","xiaohongshu","douyin"]`.
- Rollout → strict Phase 1 → 6 sequential. Each phase commits + verifies independently.

---

## File Structure Map

**New files:**

| Path | Responsibility |
|---|---|
| `src/trends/schema.ts` | zod `TrendItemSchema` + `TrendsCollectionResultSchema` + types + `validateCollection()` |
| `src/trends/__tests__/schema.test.ts` | edge cases for every required / nullable field |
| `src/trends/sources/types.ts` | `Source` interface + `RawTrendItem` (no `analysis` field, that comes later) |
| `src/trends/sources/youtube.ts` | RSS endpoint scraper; cover from `i.ytimg.com/vi/<id>/hqdefault.jpg` |
| `src/trends/sources/xiaohongshu.ts` | playwright headless → `/explore` page → DOM scrape |
| `src/trends/sources/agentFallback.ts` | TikTok / 抖音 via claude-cli WebSearch; sets `source: "agent_websearch"` |
| `src/trends/sources/index.ts` | `dispatchSource(platform)` switch + `Source` exports |
| `src/trends/sources/__tests__/youtube.test.ts` | mock fetch with fixture RSS xml |
| `src/trends/sources/__tests__/xiaohongshu.test.ts` | mock playwright Page |
| `src/trends/sources/__tests__/agentFallback.test.ts` | mock claude-cli output |
| `src/trends/enrichment.ts` | `enrichWithAnalysis(raw[], platform)` — agent prompt + retry-on-validation-fail loop |
| `src/trends/__tests__/enrichment.test.ts` | retry-on-bad-output + max-retries-reached cases |
| `src/trends/covers.ts` | `downloadCover(url, dest)` + `coversDir(platform)` + GC of old covers |
| `src/trends/__tests__/covers.test.ts` | sanitize id, write file, GC |
| `src/trends/pipeline.ts` | `collect(platforms): Promise<TrendsCollectionResult>` orchestrator |
| `src/trends/__tests__/pipeline.test.ts` | end-to-end mock — every layer wired |
| `docs/qa/e2e-report.md` | (status block on the round that closes the F1/F132 lineage) |

**Modified files:**

| Path | Change |
|---|---|
| `src/server/api.ts` | Replace `researchTrends()` body with `pipeline.collect()`; expand default `platforms`; add `GET /api/trends/:platform/covers/:id` route |
| `web/src/queries/trends.ts` | New `TrendItem` shape (matches schema); drop `(t.heat ?? 0) * 1000`; expand `SUPPORTED_REFRESH_PLATFORMS` to 4 |
| `web/src/features/explore/TrendingPanel.tsx` | `<img>` for cover; `<SourceBadge>` per row; conditional metrics |
| `web/src/features/explore/TrendingPanel.module.css` | `.thumb` for image rendering; `.sourceBadge` class |
| `web/src/pages/Explore.tsx` | `platforms` array of 4 in `/api/trends/refresh` body |
| `web/src/i18n/messages.ts` | New `sourceBadge.*` keys (EN+ZH) |
| `package.json` | Add `playwright` (production dep) + `@types/...` if needed |

---

## Phase 1 — Schema + Validation

### Task 1: Define zod schema for TrendItem

**Files:**
- Create: `src/trends/schema.ts`
- Test: `src/trends/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/trends/__tests__/schema.test.ts
import { describe, it, expect } from "vitest";
import { TrendItemSchema, TrendsCollectionResultSchema, validateCollection } from "../schema.js";

describe("TrendItemSchema", () => {
  const validItem = {
    id: "yt_abc123",
    platform: "youtube",
    title: "Sample trending title",
    sourceUrl: "https://youtube.com/watch?v=abc123",
    source: "rss",
    scrapedAt: "2026-05-12T10:00:00.000Z",
    cover: {
      url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      aspect: "16:9",
    },
    metrics: {
      views: 100000, likes: 5000, comments: 200, shares: null,
      fetchedAt: "2026-05-12T10:00:00.000Z",
    },
    analysis: {
      heat: 4,
      competition: "中",
      opportunity: "金矿",
      description: "A trending topic about something that matters this week.",
      tags: ["tag1", "tag2", "tag3"],
      contentAngles: ["angle1", "angle2"],
      exampleHook: "Hook one-liner",
      category: "tech",
    },
  };

  it("accepts a complete valid item", () => {
    expect(TrendItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects item missing required cover.url", () => {
    const bad = { ...validItem, cover: { aspect: "16:9" } };
    expect(TrendItemSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects analysis.heat out of [1,5]", () => {
    const bad = { ...validItem, analysis: { ...validItem.analysis, heat: 6 } };
    expect(TrendItemSchema.safeParse(bad).success).toBe(false);
  });

  it("allows metrics null (e.g. agent_websearch source has no real numbers)", () => {
    const r = TrendItemSchema.safeParse({ ...validItem, metrics: null });
    expect(r.success).toBe(true);
  });

  it("rejects platform outside the 4-enum", () => {
    const bad = { ...validItem, platform: "weibo" };
    expect(TrendItemSchema.safeParse(bad).success).toBe(false);
  });
});

describe("TrendsCollectionResultSchema", () => {
  it("requires at least 5 items", () => {
    const r = TrendsCollectionResultSchema.safeParse({
      platform: "youtube",
      items: [],
      collectedAt: "2026-05-12T10:00:00.000Z",
      pipelineStatus: "failed",
      errors: ["no items"],
      validation: { passed: false, issues: [] },
    });
    expect(r.success).toBe(false);
  });
});

describe("validateCollection", () => {
  it("returns issues with path string on failure", () => {
    const out = validateCollection({ platform: "youtube", items: "not-an-array" });
    expect(out.passed).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);
    expect(typeof out.issues[0].path).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/schema.test.ts`
Expected: FAIL with module-not-found for `../schema.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trends/schema.ts
import { z } from "zod";

export const PlatformSchema = z.enum(["youtube", "tiktok", "xiaohongshu", "douyin"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const ItemSourceSchema = z.enum(["scraper", "rss", "agent_websearch", "proxy"]);
export type ItemSource = z.infer<typeof ItemSourceSchema>;

export const CoverAspectSchema = z.enum(["9:16", "1:1", "16:9"]);
export type CoverAspect = z.infer<typeof CoverAspectSchema>;

export const TrendItemSchema = z.object({
  id: z.string().min(1),
  platform: PlatformSchema,
  title: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  source: ItemSourceSchema,
  scrapedAt: z.string().datetime(),
  cover: z.object({
    url: z.string().url(),
    aspect: CoverAspectSchema,
    cachedPath: z.string().optional(),
  }),
  metrics: z.object({
    views: z.number().nullable(),
    likes: z.number().nullable(),
    comments: z.number().nullable(),
    shares: z.number().nullable(),
    fetchedAt: z.string().datetime(),
  }).nullable(),
  analysis: z.object({
    heat: z.number().int().min(1).max(5),
    competition: z.enum(["低", "中", "高"]),
    opportunity: z.enum(["金矿", "蓝海", "红海"]),
    description: z.string().min(20).max(500),
    tags: z.array(z.string()).min(3).max(5),
    contentAngles: z.array(z.string()).min(2).max(3),
    exampleHook: z.string().min(5).max(100),
    category: z.string().min(1),
  }),
});
export type TrendItem = z.infer<typeof TrendItemSchema>;

export const TrendsCollectionResultSchema = z.object({
  platform: PlatformSchema,
  items: z.array(TrendItemSchema).min(5).max(30),
  collectedAt: z.string().datetime(),
  pipelineStatus: z.enum(["ok", "partial", "failed"]),
  errors: z.array(z.string()),
  validation: z.object({
    passed: z.boolean(),
    issues: z.array(z.object({
      itemId: z.string().optional(),
      path: z.string(),
      message: z.string(),
    })),
  }),
});
export type TrendsCollectionResult = z.infer<typeof TrendsCollectionResultSchema>;

export interface ValidationIssue { path: string; message: string; itemId?: string }
export interface ValidationOutcome {
  passed: boolean;
  result: TrendsCollectionResult | null;
  issues: ValidationIssue[];
}

export function validateCollection(input: unknown): ValidationOutcome {
  const parsed = TrendsCollectionResultSchema.safeParse(input);
  if (parsed.success) return { passed: true, result: parsed.data, issues: [] };
  return {
    passed: false,
    result: null,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/schema.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/trends/schema.ts src/trends/__tests__/schema.test.ts
git commit -m "feat(trends): zod schema + validation outcome for TrendItem / Collection"
```

---

### Task 2: Add validation gate to existing researchTrends write path

**Files:**
- Modify: `src/server/api.ts:1945-1956` (the yaml write block inside `researchTrends`)
- Test: `src/server/__tests__/research-trends-validation.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/research-trends-validation.test.ts
import { describe, it, expect } from "vitest";
import { writeValidatedTrendsYaml } from "../trends-write.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("writeValidatedTrendsYaml", () => {
  it("refuses to write when collection fails validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trends-"));
    try {
      const bad = { platform: "youtube", items: [] };
      const r = await writeValidatedTrendsYaml(dir, "2026-05-12", bad);
      expect(r.written).toBe(false);
      expect(r.issues.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/server/__tests__/research-trends-validation.test.ts`
Expected: FAIL with module-not-found `../trends-write.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trends/write.ts
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateCollection, type ValidationIssue } from "./schema.js";

export interface WriteOutcome {
  written: boolean;
  path: string | null;
  issues: ValidationIssue[];
}

export async function writeValidatedTrendsYaml(
  dir: string,
  dateStr: string,
  collection: unknown,
): Promise<WriteOutcome> {
  const outcome = validateCollection(collection);
  if (!outcome.passed || !outcome.result) {
    return { written: false, path: null, issues: outcome.issues };
  }
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${dateStr}.yaml`);
  await writeFile(path, yaml.dump(outcome.result, { lineWidth: -1 }), "utf-8");
  return { written: true, path, issues: [] };
}
```

Also create a re-export so tests can import from `src/server/trends-write.js`:

```ts
// src/server/trends-write.ts
export { writeValidatedTrendsYaml } from "../trends/write.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/server/__tests__/research-trends-validation.test.ts`
Expected: PASS, 1 test

- [ ] **Step 5: Commit**

```bash
git add src/trends/write.ts src/server/trends-write.ts src/server/__tests__/research-trends-validation.test.ts
git commit -m "feat(trends): writeValidatedTrendsYaml refuses non-conforming output"
```

---

### Task 3: Run full server test suite to confirm no regression

- [ ] **Step 1: Run full server tests**

Run: `npm run test:server`
Expected: all green, including the 3 new schema tests + 1 new write-gate test

- [ ] **Step 2: Commit if any test files needed adjustment**

(Usually this step is a no-op; if regressions appear, fix and commit before moving to Phase 2.)

---

## Phase 2 — Per-platform sources

### Task 4: Define Source interface + RawTrendItem type

**Files:**
- Create: `src/trends/sources/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// src/trends/sources/types.ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/trends/sources/types.ts
git commit -m "feat(trends): Source interface + RawTrendItem type"
```

---

### Task 5: YouTube RSS source

**Files:**
- Create: `src/trends/sources/youtube.ts`
- Create: `src/trends/sources/__tests__/youtube.test.ts`
- Create: `src/trends/sources/__tests__/fixtures/youtube-trending.xml`

- [ ] **Step 1: Save the fixture**

```bash
mkdir -p src/trends/sources/__tests__/fixtures
```

```xml
<!-- src/trends/sources/__tests__/fixtures/youtube-trending.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Trending Videos</title>
  <entry>
    <id>yt:video:dQw4w9WgXcQ</id>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Sample Trending Video Title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <published>2026-05-12T08:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" width="480" height="360"/>
      <media:community>
        <media:statistics views="1234567"/>
        <media:starRating count="98000"/>
      </media:community>
    </media:group>
  </entry>
</feed>
```

- [ ] **Step 2: Write the failing test**

```ts
// src/trends/sources/__tests__/youtube.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { youtubeSource } from "../youtube.js";

const FIXTURE_PATH = join(__dirname, "fixtures/youtube-trending.xml");

describe("youtubeSource.collect", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => (await readFile(FIXTURE_PATH, "utf-8")),
    })));
  });

  it("parses RSS entries into RawTrendItem[]", async () => {
    const items = await youtubeSource.collect({ limit: 10 });
    expect(items.length).toBe(1);
    const it = items[0];
    expect(it.id).toBe("yt_dQw4w9WgXcQ");
    expect(it.platform).toBe("youtube");
    expect(it.title).toBe("Sample Trending Video Title");
    expect(it.sourceUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(it.source).toBe("rss");
    expect(it.cover).toEqual({
      url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      aspect: "16:9",
    });
    expect(it.metrics?.views).toBe(1234567);
    expect(it.metrics?.likes).toBe(98000);
  });

  it("respects limit parameter", async () => {
    const items = await youtubeSource.collect({ limit: 0 });
    expect(items.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/sources/__tests__/youtube.test.ts`
Expected: FAIL with module-not-found `../youtube.js`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/trends/sources/youtube.ts
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
```

- [ ] **Step 5: Install fast-xml-parser if not already present**

Run: `node -e "console.log(require.resolve('fast-xml-parser'))" 2>&1 | head -1`

If error "Cannot find module": `npm install fast-xml-parser`

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/sources/__tests__/youtube.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 7: Commit**

```bash
git add src/trends/sources/youtube.ts src/trends/sources/__tests__/youtube.test.ts src/trends/sources/__tests__/fixtures/youtube-trending.xml package.json package-lock.json
git commit -m "feat(trends): YouTube RSS source with real metrics + cover URL"
```

---

### Task 6: Xiaohongshu playwright source

**Files:**
- Create: `src/trends/sources/xiaohongshu.ts`
- Create: `src/trends/sources/__tests__/xiaohongshu.test.ts`

- [ ] **Step 1: Install playwright (if not present)**

Run: `node -e "console.log(require.resolve('playwright'))" 2>&1 | head -1`

If error "Cannot find module":
```bash
npm install playwright
npx playwright install chromium
```

- [ ] **Step 2: Write the failing test**

```ts
// src/trends/sources/__tests__/xiaohongshu.test.ts
import { describe, it, expect, vi } from "vitest";
import { xiaohongshuSourceFromDom } from "../xiaohongshu.js";

describe("xiaohongshuSourceFromDom (pure parser exposed for tests)", () => {
  it("extracts items from a mock explore feed payload", () => {
    const fakeFeed = [
      {
        id: "abc12345",
        title: "笔记标题 A",
        url: "/explore/abc12345",
        coverUrl: "https://sns-img-bd.xhscdn.com/abc12345.jpg",
        likes: 3500,
        views: null,
      },
      {
        id: "def67890",
        title: "笔记标题 B",
        url: "/explore/def67890",
        coverUrl: "https://sns-img-bd.xhscdn.com/def67890.jpg",
        likes: 12000,
        views: 87000,
      },
    ];
    const items = xiaohongshuSourceFromDom(fakeFeed);
    expect(items.length).toBe(2);
    expect(items[0].id).toBe("xhs_abc12345");
    expect(items[0].platform).toBe("xiaohongshu");
    expect(items[0].source).toBe("scraper");
    expect(items[0].sourceUrl).toBe("https://www.xiaohongshu.com/explore/abc12345");
    expect(items[0].cover?.aspect).toBe("9:16");
    expect(items[1].metrics?.likes).toBe(12000);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/sources/__tests__/xiaohongshu.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 4: Write minimal implementation**

```ts
// src/trends/sources/xiaohongshu.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/sources/__tests__/xiaohongshu.test.ts`
Expected: PASS, 1 test (pure parser; the playwright path is exercised in Task 21 live)

- [ ] **Step 6: Commit**

```bash
git add src/trends/sources/xiaohongshu.ts src/trends/sources/__tests__/xiaohongshu.test.ts package.json package-lock.json
git commit -m "feat(trends): xiaohongshu playwright scraper + pure parser"
```

---

### Task 7: Agent-fallback source (TikTok + 抖音)

**Files:**
- Create: `src/trends/sources/agentFallback.ts`
- Create: `src/trends/sources/__tests__/agentFallback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/trends/sources/__tests__/agentFallback.test.ts
import { describe, it, expect, vi } from "vitest";
import { agentFallbackSource, agentFallbackFromAgentJson } from "../agentFallback.js";

describe("agentFallbackFromAgentJson", () => {
  it("normalizes agent output into RawTrendItem[]", () => {
    const agentJson = {
      topics: [
        {
          title: "Hot topic 1",
          sourceUrl: "https://www.tiktok.com/discover/hot1",
          coverUrl: "https://www.tiktok.com/img/hot1.jpg",
        },
        {
          title: "Hot topic 2",
          sourceUrl: "https://www.tiktok.com/discover/hot2",
          coverUrl: "https://www.tiktok.com/img/hot2.jpg",
        },
      ],
    };
    const items = agentFallbackFromAgentJson("tiktok", agentJson);
    expect(items.length).toBe(2);
    expect(items[0].platform).toBe("tiktok");
    expect(items[0].source).toBe("agent_websearch");
    expect(items[0].metrics).toBeNull();
    expect(items[0].cover?.aspect).toBe("9:16");
    expect(items[0].id).toBe("tiktok_a3c1b8e5");
  });

  it("falls back to placeholder cover when agent gives empty cover", () => {
    const items = agentFallbackFromAgentJson("douyin", {
      topics: [
        { title: "Topic A", sourceUrl: "https://www.douyin.com/x", coverUrl: "" },
      ],
    });
    expect(items[0].cover).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/sources/__tests__/agentFallback.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trends/sources/agentFallback.ts
import { createHash } from "node:crypto";
import { runCliBrief } from "../../cli-brief.js";
import type { Source, RawTrendItem } from "./types.js";
import type { Platform } from "../schema.js";

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

interface AgentTopic {
  title: string;
  sourceUrl: string;
  coverUrl: string;
}

export function agentFallbackFromAgentJson(
  platform: Platform,
  agentJson: { topics: AgentTopic[] },
): RawTrendItem[] {
  const now = new Date().toISOString();
  return (agentJson.topics ?? []).map((t): RawTrendItem => ({
    id: `${platform}_${shortHash(t.sourceUrl || t.title)}`,
    platform,
    title: t.title,
    sourceUrl: t.sourceUrl,
    source: "agent_websearch",
    scrapedAt: now,
    cover: t.coverUrl
      ? { url: t.coverUrl, aspect: "9:16" }
      : null,
    // No real numbers — fallback is honest about lack of metrics.
    metrics: null,
  }));
}

const PROMPT_TEMPLATE = (platform: Platform, label: string, limit: number) => `
你是一个社交媒体趋势研究员。用 WebSearch 找当下 ${label} 平台真实 trending 的内容（不要生成想象的内容；要可点开链接验证的）。

返回严格 JSON（无其他文字）：
{
  "topics": [
    { "title": "...", "sourceUrl": "https://...", "coverUrl": "https://..." }
  ]
}

要求：
- 至少 ${limit} 条
- title: 实际 trending item 标题（短，<60 字符）
- sourceUrl: 平台上真实可访问的 URL
- coverUrl: 该 item 的封面图绝对 URL；找不到就给空字符串 ""
- 优先返回今天 / 本周热门
- 仅输出 JSON，无 \`\`\` 包裹，无解释
`;

export const agentFallbackSource = (platform: Platform): Source => ({
  platform,
  async collect({ limit }) {
    const label =
      platform === "tiktok" ? "TikTok"
      : platform === "douyin" ? "抖音"
      : platform === "youtube" ? "YouTube"
      : "小红书";
    const raw = await runCliBrief(PROMPT_TEMPLATE(platform, label, limit));
    const stripped = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return [];
    const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    return agentFallbackFromAgentJson(platform, parsed);
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/sources/__tests__/agentFallback.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/trends/sources/agentFallback.ts src/trends/sources/__tests__/agentFallback.test.ts
git commit -m "feat(trends): agent_websearch fallback source for TikTok + 抖音"
```

---

### Task 8: Source dispatcher

**Files:**
- Create: `src/trends/sources/index.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/trends/sources/index.ts
import { youtubeSource } from "./youtube.js";
import { xiaohongshuSource } from "./xiaohongshu.js";
import { agentFallbackSource } from "./agentFallback.js";
import type { Source } from "./types.js";
import type { Platform } from "../schema.js";

export function getSource(platform: Platform): Source {
  switch (platform) {
    case "youtube":
      return youtubeSource;
    case "xiaohongshu":
      return xiaohongshuSource;
    case "tiktok":
      return agentFallbackSource("tiktok");
    case "douyin":
      return agentFallbackSource("douyin");
  }
}

export type { Source, RawTrendItem } from "./types.js";
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/trends/sources/index.ts
git commit -m "feat(trends): platform → Source dispatcher"
```

---

### Task 9: Phase 2 sanity check

- [ ] **Step 1: Run all trends-related tests**

Run: `npx vitest run --config vitest.server.config.ts src/trends`
Expected: all green (schema + youtube + xiaohongshu + agentFallback)

---

## Phase 3 — Enrichment + retry loop

### Task 10: Enrichment prompt + retry implementation

**Files:**
- Create: `src/trends/enrichment.ts`
- Create: `src/trends/__tests__/enrichment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/trends/__tests__/enrichment.test.ts
import { describe, it, expect, vi } from "vitest";
import { enrichWithAnalysis } from "../enrichment.js";
import type { RawTrendItem } from "../sources/types.js";

const baseRaw: RawTrendItem = {
  id: "yt_x", platform: "youtube", title: "T", sourceUrl: "https://y/x",
  source: "rss", scrapedAt: "2026-05-12T10:00:00.000Z",
  cover: { url: "https://i/h.jpg", aspect: "16:9" }, metrics: null,
};

const validAnalysis = {
  heat: 4, competition: "中", opportunity: "金矿",
  description: "A description with enough length for the schema.",
  tags: ["a", "b", "c"], contentAngles: ["ang1", "ang2"],
  exampleHook: "Hook.", category: "tech",
};

describe("enrichWithAnalysis", () => {
  it("returns enriched items when agent first try passes validation", async () => {
    const runCli = vi.fn().mockResolvedValueOnce(JSON.stringify({
      items: [{ id: "yt_x", analysis: validAnalysis }],
    }));
    const out = await enrichWithAnalysis([baseRaw], "youtube", { runCli, maxRetries: 2 });
    expect(out.validation.passed).toBe(true);
    expect(out.items[0].analysis.heat).toBe(4);
  });

  it("retries with feedback when first agent output fails validation", async () => {
    const runCli = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({
        items: [{ id: "yt_x", analysis: { ...validAnalysis, heat: 9 } }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        items: [{ id: "yt_x", analysis: validAnalysis }],
      }));
    const out = await enrichWithAnalysis([baseRaw], "youtube", { runCli, maxRetries: 2 });
    expect(runCli).toHaveBeenCalledTimes(2);
    expect(out.validation.passed).toBe(true);
    expect(runCli.mock.calls[1][0]).toMatch(/issue|invalid|heat/i);
  });

  it("returns partial pipelineStatus when retries exhausted", async () => {
    const runCli = vi.fn().mockResolvedValue(JSON.stringify({
      items: [{ id: "yt_x", analysis: { ...validAnalysis, heat: 9 } }],
    }));
    const out = await enrichWithAnalysis([baseRaw], "youtube", { runCli, maxRetries: 1 });
    expect(out.pipelineStatus).toBe("partial");
    expect(out.validation.passed).toBe(false);
    expect(out.validation.issues.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/enrichment.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trends/enrichment.ts
import { TrendsCollectionResultSchema, validateCollection } from "./schema.js";
import type { TrendsCollectionResult, ValidationIssue } from "./schema.js";
import type { RawTrendItem } from "./sources/types.js";
import type { Platform } from "./schema.js";

interface EnrichDeps {
  runCli: (prompt: string) => Promise<string>;
  maxRetries?: number;
}

function buildPrompt(raws: RawTrendItem[], platform: Platform, previousIssues?: ValidationIssue[]): string {
  const itemsJson = JSON.stringify(raws.map((r) => ({
    id: r.id, title: r.title, sourceUrl: r.sourceUrl, metrics: r.metrics,
  })));
  const feedback = previousIssues && previousIssues.length > 0
    ? `\n上一次输出 validation 失败，issues:\n${previousIssues.map((i) => `- path: ${i.path}\n  message: ${i.message}`).join("\n")}\n请按 issue 修正后重新输出整个 JSON。\n`
    : "";
  return `
我已经为 ${platform} 平台采集到 ${raws.length} 个 raw trending items（已带真实 title/url/metrics）：

\`\`\`json
${itemsJson}
\`\`\`

请仅为每个 item 补充 analysis 字段，并保留其 id 不变。返回严格 JSON：
{
  "items": [
    {
      "id": "<原 id>",
      "analysis": {
        "heat": 1-5 整数,
        "competition": "低" | "中" | "高",
        "opportunity": "金矿" | "蓝海" | "红海",
        "description": ">=20 <=500 字符的描述",
        "tags": ["", "", ""] (3-5 个),
        "contentAngles": ["", ""] (2-3 个),
        "exampleHook": "<5-100 字符>",
        "category": "<分类>"
      }
    }
  ]
}

heat 评级参考: views > 1M → 5, 100K-1M → 4, 10K-100K → 3, < 10K → 2。无 metrics 时根据 title 主题热度判断。

输出纯 JSON，无 \`\`\` 包裹，无解释。${feedback}
`;
}

function stripFence(s: string): string {
  return s.replace(/\`\`\`json?\s*/gi, "").replace(/\`\`\`/g, "").trim();
}

export async function enrichWithAnalysis(
  raws: RawTrendItem[],
  platform: Platform,
  deps: EnrichDeps,
): Promise<TrendsCollectionResult> {
  const maxRetries = deps.maxRetries ?? 2;
  let lastIssues: ValidationIssue[] = [];
  const collectedAt = new Date().toISOString();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = buildPrompt(raws, platform, attempt > 0 ? lastIssues : undefined);
    const agentRaw = await deps.runCli(prompt);
    const stripped = stripFence(agentRaw);
    let agentParsed: any;
    try {
      agentParsed = JSON.parse(stripped);
    } catch {
      lastIssues = [{ path: "<root>", message: "agent returned non-JSON" }];
      continue;
    }
    const byId = new Map<string, any>(
      (agentParsed.items ?? []).map((x: any) => [x.id, x.analysis]),
    );
    const merged = raws.map((r) => ({ ...r, analysis: byId.get(r.id) }));
    const candidate = {
      platform, items: merged, collectedAt,
      pipelineStatus: "ok" as const, errors: [],
      validation: { passed: true, issues: [] },
    };
    const outcome = validateCollection(candidate);
    if (outcome.passed && outcome.result) return outcome.result;
    lastIssues = outcome.issues;
  }

  // Retries exhausted: emit partial result so caller can decide whether to surface.
  // Strip enrichment fields from items so the schema-level Required guard
  // would also trip; we instead return a hand-built struct that intentionally
  // bypasses schema (caller checks pipelineStatus).
  return {
    platform,
    items: [] as any,
    collectedAt,
    pipelineStatus: "partial",
    errors: [`enrichment failed after ${maxRetries + 1} attempts`],
    validation: { passed: false, issues: lastIssues },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/enrichment.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/trends/enrichment.ts src/trends/__tests__/enrichment.test.ts
git commit -m "feat(trends): enrichment retry loop with schema-issue feedback to agent"
```

---

## Phase 4 — Cover image cache + serve

### Task 11: Cover download helper

**Files:**
- Create: `src/trends/covers.ts`
- Create: `src/trends/__tests__/covers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/trends/__tests__/covers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCover, sanitizeCoverId, coversDir, gcOldCovers } from "../covers.js";

describe("sanitizeCoverId", () => {
  it("strips dangerous chars and limits length", () => {
    expect(sanitizeCoverId("../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeCoverId("yt_abc-123_def")).toBe("yt_abc-123_def");
    expect(sanitizeCoverId("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("downloadCover", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
    })));
  });

  it("writes the binary to disk under <coversDir>/<sanitizedId>.jpg", async () => {
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    try {
      const path = await downloadCover("https://i.ytimg.com/vi/abc/hqdefault.jpg", dir, "yt_abc");
      expect(path).toBe(join(dir, "yt_abc.jpg"));
      const buf = await readFile(path);
      expect(buf.length).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null on non-OK fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    try {
      const path = await downloadCover("https://blocked/x.jpg", dir, "yt_x");
      expect(path).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("gcOldCovers", () => {
  it("keeps only the N newest files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    try {
      const fs = await import("node:fs/promises");
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(join(dir, `c${i}.jpg`), "x");
        // ensure mtime ordering
        await new Promise((r) => setTimeout(r, 5));
      }
      await gcOldCovers(dir, 2);
      const remaining = await readdir(dir);
      expect(remaining.length).toBe(2);
      expect(remaining.sort()).toEqual(["c3.jpg", "c4.jpg"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/covers.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trends/covers.ts
import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export function sanitizeCoverId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export function coversDir(platform: string): string {
  return join(homedir(), ".autoviral", "trends", platform, "covers");
}

export async function downloadCover(
  url: string,
  dir: string,
  rawId: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    const filename = `${sanitizeCoverId(rawId)}.jpg`;
    const path = join(dir, filename);
    await writeFile(path, buf);
    return path;
  } catch {
    return null;
  }
}

export async function gcOldCovers(dir: string, keepMax: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const stats = await Promise.all(
    entries.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
  );
  stats.sort((a, b) => b.mtime - a.mtime); // newest first
  for (const old of stats.slice(keepMax)) {
    await unlink(join(dir, old.name)).catch(() => {});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/covers.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/trends/covers.ts src/trends/__tests__/covers.test.ts
git commit -m "feat(trends): cover image download + disk cache + GC"
```

---

### Task 12: Cover-serve API endpoint

**Files:**
- Modify: `src/server/api.ts` (add new route near line 1989 right after existing trends endpoints)
- Create: `src/server/__tests__/api.cover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/api.cover.test.ts
import { describe, it, expect } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

describe("GET /api/trends/:platform/covers/:id", () => {
  it("returns 404 when cover file does not exist", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/youtube/covers/missing"));
      expect(res.status).toBe(404);
    });
  });

  it("returns 200 + image/jpeg when file exists", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const dir = join(homedir(), ".autoviral", "trends", "youtube", "covers");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "yt_test.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/youtube/covers/yt_test"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/image\/jpeg/);
    });
  });

  it("returns 400 when id contains traversal characters", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(jsonReq("GET", "/api/trends/youtube/covers/..%2Fpasswd"));
      expect([400, 404]).toContain(res.status);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/server/__tests__/api.cover.test.ts`
Expected: FAIL (route not yet defined)

- [ ] **Step 3: Add the route in api.ts**

Add right below the existing `/api/trends/:platform/report` route (around line 2002):

```ts
// GET /api/trends/:platform/covers/:id — serve cached cover jpg.
// e2e-report follow-up: real cover images replace the 9:16 placeholder.
apiRoutes.get("/api/trends/:platform/covers/:id", async (c) => {
  const platform = c.req.param("platform");
  const rawId = c.req.param("id");
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return c.body(null, 400);
  const path = join(homedir(), ".autoviral", "trends", platform, "covers", `${safeId}.jpg`);
  try {
    const buf = await readFile(path);
    c.header("content-type", "image/jpeg");
    c.header("cache-control", "public, max-age=86400");
    return c.body(buf);
  } catch {
    return c.body(null, 404);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/server/__tests__/api.cover.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts src/server/__tests__/api.cover.test.ts
git commit -m "feat(api): GET /api/trends/:platform/covers/:id serves cached jpg"
```

---

### Task 13: Pipeline orchestrator

**Files:**
- Create: `src/trends/pipeline.ts`
- Create: `src/trends/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/trends/__tests__/pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { collectPlatform } from "../pipeline.js";
import type { RawTrendItem } from "../sources/types.js";

const fakeRaw: RawTrendItem[] = Array.from({ length: 6 }).map((_, i) => ({
  id: `yt_${i}`, platform: "youtube", title: `T${i}`,
  sourceUrl: `https://y/${i}`, source: "rss",
  scrapedAt: "2026-05-12T10:00:00.000Z",
  cover: { url: `https://i/${i}.jpg`, aspect: "16:9" },
  metrics: null,
}));

const validAnalysis = {
  heat: 4, competition: "中", opportunity: "金矿",
  description: "Description long enough for schema validation.",
  tags: ["a", "b", "c"], contentAngles: ["x", "y"],
  exampleHook: "Hook.", category: "tech",
};

describe("collectPlatform", () => {
  it("orchestrates source → enrich → cover download → validated result", async () => {
    const source = { platform: "youtube" as const, collect: vi.fn().mockResolvedValue(fakeRaw) };
    const runCli = vi.fn().mockResolvedValue(JSON.stringify({
      items: fakeRaw.map((r) => ({ id: r.id, analysis: validAnalysis })),
    }));
    const downloadCover = vi.fn().mockResolvedValue("/tmp/x.jpg");

    const out = await collectPlatform("youtube", {
      getSource: () => source,
      runCli,
      downloadCover,
      coversDir: () => "/tmp",
      maxRetries: 1,
      limit: 10,
    });

    expect(out.pipelineStatus).toBe("ok");
    expect(out.validation.passed).toBe(true);
    expect(out.items.length).toBe(6);
    expect(downloadCover).toHaveBeenCalledTimes(6);
    expect(out.items[0].cover.cachedPath).toBe("/tmp/x.jpg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/pipeline.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trends/pipeline.ts
import { enrichWithAnalysis } from "./enrichment.js";
import { getSource as defaultGetSource } from "./sources/index.js";
import {
  downloadCover as defaultDownloadCover,
  coversDir as defaultCoversDir,
} from "./covers.js";
import type { Platform, TrendsCollectionResult } from "./schema.js";
import type { Source } from "./sources/types.js";

export interface PipelineDeps {
  getSource: (p: Platform) => Source;
  runCli: (prompt: string) => Promise<string>;
  downloadCover: (url: string, dir: string, id: string) => Promise<string | null>;
  coversDir: (platform: string) => string;
  maxRetries?: number;
  limit?: number;
}

export async function collectPlatform(
  platform: Platform,
  deps: PipelineDeps,
): Promise<TrendsCollectionResult> {
  const source = deps.getSource(platform);
  const raws = await source.collect({ limit: deps.limit ?? 20 });
  if (raws.length < 5) {
    return {
      platform, items: [] as any, collectedAt: new Date().toISOString(),
      pipelineStatus: "failed", errors: [`source returned ${raws.length} items, need >=5`],
      validation: { passed: false, issues: [] },
    };
  }
  const enriched = await enrichWithAnalysis(raws, platform, {
    runCli: deps.runCli, maxRetries: deps.maxRetries ?? 2,
  });
  if (enriched.pipelineStatus !== "ok") return enriched;

  // Download covers; mutate cachedPath in-place.
  const dir = deps.coversDir(platform);
  await Promise.all(enriched.items.map(async (item) => {
    if (!item.cover.url) return;
    const path = await deps.downloadCover(item.cover.url, dir, item.id);
    if (path) item.cover.cachedPath = path;
  }));
  return enriched;
}

export const defaultPipelineDeps = (runCli: (p: string) => Promise<string>): PipelineDeps => ({
  getSource: defaultGetSource,
  runCli,
  downloadCover: defaultDownloadCover,
  coversDir: defaultCoversDir,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.server.config.ts src/trends/__tests__/pipeline.test.ts`
Expected: PASS, 1 test

- [ ] **Step 5: Commit**

```bash
git add src/trends/pipeline.ts src/trends/__tests__/pipeline.test.ts
git commit -m "feat(trends): pipeline orchestrator wiring source → enrich → cover"
```

---

### Task 14: Wire pipeline into POST /api/trends/refresh

**Files:**
- Modify: `src/server/api.ts:1881-1965` (replace `researchTrends` body)
- Modify: `src/server/api.ts:2003-2012` (the POST handler — update default platforms)

- [ ] **Step 1: Find and replace researchTrends body**

Replace the entire body of `researchTrends` (lines 1881-1965) with:

```ts
async function researchTrends(platforms: string[]): Promise<{ collected: string[]; errors: string[] }> {
  const { collectPlatform, defaultPipelineDeps } = await import("../trends/pipeline.js");
  const { writeValidatedTrendsYaml } = await import("../trends/write.js");
  const { gcOldCovers, coversDir } = await import("../trends/covers.js");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const collected: string[] = [];
  const errors: string[] = [];
  const deps = defaultPipelineDeps(runCliBrief);
  for (const platform of platforms) {
    if (!["youtube", "tiktok", "xiaohongshu", "douyin"].includes(platform)) {
      errors.push(`${platform} (unsupported)`);
      continue;
    }
    try {
      const result = await collectPlatform(platform as any, deps);
      if (result.pipelineStatus !== "ok") {
        errors.push(`${platform} (${result.errors.join("; ")})`);
        continue;
      }
      const trendsDir = join(homedir(), ".autoviral", "trends", platform);
      const dateStr = new Date().toISOString().slice(0, 10);
      const w = await writeValidatedTrendsYaml(trendsDir, dateStr, result);
      if (!w.written) {
        errors.push(`${platform} (write-failed: ${w.issues.map(i => i.path).join(",")})`);
        continue;
      }
      // Keep 80 newest covers per platform.
      await gcOldCovers(coversDir(platform), 80);
      collected.push(platform);
    } catch (e) {
      errors.push(`${platform} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { collected, errors };
}
```

Then change the POST default at line 2007 from:

```ts
const platforms = (body as any).platforms ?? ["xiaohongshu", "douyin"];
```

to:

```ts
const platforms = (body as any).platforms ?? ["youtube", "tiktok", "xiaohongshu", "douyin"];
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 3: Run full server tests**

Run: `npm run test:server`
Expected: all green (pipeline, enrichment, covers, schema, write-gate, cover-serve)

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(api): wire 4-platform pipeline into /api/trends/refresh"
```

---

## Phase 5 — Frontend overhaul

### Task 15: Frontend TrendItem type + adapter rewrite

**Files:**
- Modify: `web/src/queries/trends.ts`

- [ ] **Step 1: Open the file and replace the adapter section**

Replace lines 1-97 with:

```ts
// web/src/queries/trends.ts
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

export type Platform = "youtube" | "tiktok" | "xiaohongshu" | "douyin";
export type ItemSource = "scraper" | "rss" | "agent_websearch" | "proxy";

// e2e-report (2026-05-12): all four platforms are now first-class citizens.
// Source field on each item distinguishes real scrape from agent inference.
export const SUPPORTED_REFRESH_PLATFORMS: readonly Platform[] = [
  "youtube", "tiktok", "xiaohongshu", "douyin",
] as const;

export interface TrendItem {
  id: string;
  platform: Platform;
  title: string;
  sourceUrl: string;
  source: ItemSource;
  scrapedAt: string;
  cover: {
    url: string;          // remote (platform CDN) — only used when cachedPath missing
    aspect: "9:16" | "1:1" | "16:9";
    cachedPath?: string;  // server-side disk path; UI uses /api/trends/<p>/covers/<id>
  };
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    fetchedAt: string;
  } | null;
  analysis: {
    heat: 1 | 2 | 3 | 4 | 5;
    competition: "低" | "中" | "高";
    opportunity: "金矿" | "蓝海" | "红海";
    description: string;
    tags: string[];
    contentAngles: string[];
    exampleHook: string;
    category: string;
  };
}

export interface TrendsResponse {
  platform: Platform;
  items: TrendItem[];
  collectedAt: string;
  pipelineStatus: "ok" | "partial" | "failed";
}

export function coverUrlFor(platform: Platform, item: TrendItem): string {
  // Prefer locally cached image (server endpoint) to bypass CDN hotlink
  // protection. Fall back to remote URL when cache missed.
  return item.cover.cachedPath
    ? `/api/trends/${platform}/covers/${encodeURIComponent(item.id)}`
    : item.cover.url;
}

export function usePlatformTrends(platform: Platform) {
  return useQuery({
    queryKey: ["trends", platform],
    queryFn: async (): Promise<TrendsResponse> => {
      try {
        const raw = await apiFetch<any>(`/api/trends/${platform}`);
        return {
          platform,
          items: Array.isArray(raw?.items) ? raw.items : [],
          collectedAt: raw?.collectedAt ?? new Date().toISOString(),
          pipelineStatus: raw?.pipelineStatus ?? "ok",
        };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { platform, items: [], collectedAt: new Date().toISOString(), pipelineStatus: "ok" };
        }
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 2: Run web tests**

Run: `npx vitest --config web/vitest.config.ts run web/src/queries/trends.test.tsx`
Expected: FAIL (test mocks old shape)

- [ ] **Step 3: Update web/src/queries/trends.test.tsx fixtures to match new shape**

Replace the fixture in each `http.get` mock with a single-item TrendItem matching the new schema. Example for `xiaohongshu`:

```ts
http.get("/api/trends/xiaohongshu", () =>
  HttpResponse.json({
    platform: "xiaohongshu",
    items: [{
      id: "xhs_a", platform: "xiaohongshu", title: "T",
      sourceUrl: "https://x/", source: "scraper",
      scrapedAt: "2026-05-12T10:00:00.000Z",
      cover: { url: "https://x/c.jpg", aspect: "9:16" },
      metrics: { views: 100, likes: 50, comments: 5, shares: null, fetchedAt: "2026-05-12T10:00:00.000Z" },
      analysis: { heat: 4, competition: "中", opportunity: "金矿",
        description: "D".repeat(30), tags: ["a","b","c"], contentAngles: ["x","y"],
        exampleHook: "Hook.", category: "tech" },
    }],
    collectedAt: "2026-05-12T10:00:00.000Z",
    pipelineStatus: "ok",
  }),
),
```

Adjust the test assertions to check `result.current.data!.items[0].metrics?.likes`.

- [ ] **Step 4: Run web tests again**

Run: `npx vitest --config web/vitest.config.ts run web/src/queries/trends.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/queries/trends.ts web/src/queries/trends.test.tsx
git commit -m "refactor(web/trends): new TrendItem shape with source provenance"
```

---

### Task 16: Update TrendingPanel to render real cover + source badge

**Files:**
- Modify: `web/src/features/explore/TrendingPanel.tsx`
- Modify: `web/src/features/explore/TrendingPanel.module.css`
- Modify: `web/src/i18n/messages.ts`

- [ ] **Step 1: Add i18n keys for source labels**

In `web/src/i18n/messages.ts`, locate the `explore:` section (line ~340 EN and ~820 ZH) and add:

```ts
// EN
sourceBadge: {
  rss: "RSS",
  scraper: "Scraped",
  agentWebsearch: "Agent inference",
  proxy: "Proxy",
},
// ZH
sourceBadge: {
  rss: "RSS",
  scraper: "实采",
  agentWebsearch: "Agent 推理",
  proxy: "代理源",
},
```

- [ ] **Step 2: Replace TrendingPanel.tsx body**

Replace the rendering block (lines 14-76) with:

```tsx
import clsx from "clsx";
import {
  type TrendItem, type Platform, SUPPORTED_REFRESH_PLATFORMS, coverUrlFor,
} from "@/queries/trends";
import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import styles from "./TrendingPanel.module.css";

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "▶ YouTube",
  tiktok: "♪ TikTok",
  xiaohongshu: "小红书",
  douyin: "抖音",
};

export function TrendingPanel({ platform, items }: { platform: Platform; items: TrendItem[] }) {
  const t = useT();
  const list = items ?? [];
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {PLATFORM_LABEL[platform]} <em>{t("explore.trendingTitleEm")}</em>
        </h2>
        <span className={styles.meta}>
          {list.length === 0
            ? t("explore.trendingNoData")
            : t("explore.trendingTopMeta", { count: list.length })}
        </span>
      </div>
      {list.length === 0 && (
        <div style={{ padding: "20px 0", color: "var(--text-dimmer)", fontSize: 12 }}>
          {SUPPORTED_REFRESH_PLATFORMS.includes(platform)
            ? t("explore.trendingPanelEmpty")
            : t("explore.trendingPanelUnsupported")}
        </div>
      )}
      {list.map((item, idx) => (
        <div key={item.id} className={styles.row}>
          <div className={styles.rank}>{String(idx + 1).padStart(2, "0")}</div>
          <img
            className={styles.thumb}
            src={coverUrlFor(platform, item)}
            alt={item.title}
            loading="lazy"
            data-aspect={item.cover.aspect}
          />
          <div>
            <h3 className={styles.title3}>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.title}</a>
            </h3>
            <div className={styles.stats}>
              {item.metrics?.views != null && <span>▶ {compactNumber(item.metrics.views)}</span>}
              {item.metrics?.likes != null && <span>♥ {compactNumber(item.metrics.likes)}</span>}
              {item.metrics?.comments != null && <span>💬 {compactNumber(item.metrics.comments)}</span>}
              <span className={clsx(styles.sourceBadge, styles[`src_${item.source}`])}>
                {t(`explore.sourceBadge.${item.source === "agent_websearch" ? "agentWebsearch" : item.source}`)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Update CSS**

Add to `web/src/features/explore/TrendingPanel.module.css`:

```css
.thumb {
  width: 60px;
  height: 80px;
  object-fit: cover;
  border-radius: var(--radius-sm, 6px);
  background: var(--surface-2);
}
.thumb[data-aspect="16:9"] { width: 80px; height: 45px; }
.thumb[data-aspect="1:1"]  { width: 60px; height: 60px; }
.sourceBadge {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: var(--radius-sm, 4px);
  background: var(--surface-2);
  color: var(--text-dimmer);
  margin-left: 8px;
}
.src_rss, .src_scraper {
  background: var(--accent-glow);
  color: var(--accent-hi);
}
.src_agent_websearch {
  background: rgba(255, 196, 0, 0.10);
  color: rgba(255, 196, 0, 0.95);
}
```

- [ ] **Step 4: Run web tests**

Run: `npx vitest --config web/vitest.config.ts run web/src/features/explore`
Expected: PASS (Explore.test should still pass; if it asserts old DOM you may need to adjust)

- [ ] **Step 5: Commit**

```bash
git add web/src/features/explore/TrendingPanel.tsx web/src/features/explore/TrendingPanel.module.css web/src/i18n/messages.ts
git commit -m "feat(explore): real cover image + source provenance badge per row"
```

---

### Task 17: Update Explore.tsx to send 4 platforms

**Files:**
- Modify: `web/src/pages/Explore.tsx:47` (collectTrends body)

- [ ] **Step 1: Edit Explore.tsx**

Change line 47 from:

```ts
body: { platforms: ["xiaohongshu", "douyin"] },
```

to:

```ts
body: { platforms: ["youtube", "tiktok", "xiaohongshu", "douyin"] },
```

- [ ] **Step 2: Run web tests**

Run: `npx vitest --config web/vitest.config.ts run web/src/features/explore`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Explore.tsx
git commit -m "feat(explore): collect button refreshes all 4 platforms"
```

---

## Phase 6 — Wire + e2e validation

### Task 18: Live cron-style end-to-end run

- [ ] **Step 1: Recompile backend so running dist picks up changes**

Run: `npm run build:backend`
Expected: no TS errors

- [ ] **Step 2: Restart backend** (user-facing step — server is foreground process)

Tell user: "Backend changes need a restart. Please Ctrl+C and re-run your `autocode start --foreground` so dist/server reloads."

(If user permits, alternative for automated test: directly invoke via integration test or skip live run.)

- [ ] **Step 3: Trigger a refresh**

Run: `curl -s -X POST http://localhost:3271/api/trends/refresh -H 'Content-Type: application/json' -d '{"platforms":["youtube"]}' | head -200`

Expected: response contains `{ triggered: true, collected: ["youtube"], errors: [] }` (or non-empty errors if YouTube RSS fetch fails — that's a real-world signal).

- [ ] **Step 4: Verify yaml landed and validation passed**

Run: `ls -la ~/.autoviral/trends/youtube/$(date -u +%Y-%m-%d).yaml && head -30 ~/.autoviral/trends/youtube/$(date -u +%Y-%m-%d).yaml`

Expected: file exists; first ~20 lines include `pipelineStatus: ok` and `validation: { passed: true ... }`.

- [ ] **Step 5: Verify a cover was downloaded**

Run: `ls -la ~/.autoviral/trends/youtube/covers/ | head -5`

Expected: 5–20 `.jpg` files.

- [ ] **Step 6: Verify cover endpoint serves the file**

Run: `curl -s -I http://localhost:3271/api/trends/youtube/covers/$(ls ~/.autoviral/trends/youtube/covers/ | head -1 | sed 's/\.jpg$//')`

Expected: `200 OK` + `content-type: image/jpeg`.

---

### Task 19: Browser visual verification

- [ ] **Step 1: Open `/explore` in browser**

Use `mcp__claude-in-chrome__navigate` to load `http://localhost:5173/explore`.

- [ ] **Step 2: Switch to YouTube tab and screenshot**

Click YouTube tab → wait 2s → screenshot.

Expected user-visible state:
- Real cover images render (not the `9:16` text placeholder)
- Metrics row shows real numbers (`▶ 1.2M ♥ 98K`) — not `▶ 0 ♥ 5.0K 💬 0`
- Each row has an `RSS` badge in green/accent color

- [ ] **Step 3: Switch to TikTok tab and screenshot**

Expected:
- Real cover images (or proxy placeholder if cover URL was empty)
- Metrics may be absent (TikTok is `agent_websearch` source — no real numbers)
- Each row shows `Agent 推理` badge in amber color (visually distinct from RSS)

- [ ] **Step 4: zoom on one row to capture badge + real numbers as hard evidence**

Save zoom screenshots for the e2e-report.

- [ ] **Step 5: Update docs/qa/e2e-report.md**

Add a new round entry under `## Round 69 — trends 4-platform refactor`:

- Reference the screenshot IDs
- Close F1 ("抖音 vs 小红书 schema mismatch") with Status: ✅ 已修复
- Close F132 disabled-tab follow-up (now replaced by source badge transparency model)
- Note new sediments: "data provenance as first-class field", "schema-validation-as-feedback to agent"

---

### Task 20: Full test suite green

- [ ] **Step 1: Server tests**

Run: `npm run test:server`
Expected: all green

- [ ] **Step 2: Web tests**

Run: `npm run test:web`
Expected: all green

- [ ] **Step 3: TypeScript**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 4: Final commit closing the refactor**

```bash
git add docs/qa/e2e-report.md
git commit -m "docs(qa): close R69 trends 4-platform refactor with E2E evidence"
```

---

## Acceptance Criteria

A PR built from this plan ships when:

1. ✅ All 4 platforms collect via `POST /api/trends/refresh` with default body
2. ✅ Every persisted yaml passes `TrendsCollectionResultSchema` validation
3. ✅ Each `TrendItem` has a populated `source` field (`rss` | `scraper` | `agent_websearch`)
4. ✅ Cover images cached to `~/.autoviral/trends/<platform>/covers/` and served via `/api/trends/<platform>/covers/<id>`
5. ✅ Browser at `/explore` shows real cover images and real metrics (when available); fake `heat × 1000` numbers removed
6. ✅ UI shows `source` badge so user knows real data vs agent inference
7. ✅ Existing cron `7 9,21 * * *` continues to work (same endpoint)
8. ✅ All Vitest server + web tests green
9. ✅ E2E browser screenshots captured in docs/qa/e2e-report.md

---

## Risk + Rollback

- **YouTube RSS endpoint changes URL**: source returns 0 items → pipelineStatus=`failed` → no yaml written, no UI regression (just empty state). Rollback by patching the RSS URL.
- **playwright install fails on CI**: Phase 2 Task 6 unblocks `xiaohongshuSource` test via the pure parser; live scrape only runs at refresh time. Worst case: ship without playwright, fall xhs to agent fallback.
- **Agent retry loop diverges (cost)**: max 2 retries × 4 platforms × cron 2/day = at most 24 agent calls/day. Plus a hard timeout of 60s on `runCliBrief`. Cost ceiling: ~$2/day at OPUS rates.
- **CDN hotlink protection on covers**: implementation downloads server-side before render, so user-side browser only ever hits our own endpoint. Safe.
