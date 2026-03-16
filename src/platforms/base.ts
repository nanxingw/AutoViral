// Platform adapter base interfaces for the publish engine.
// Playwright is optional — all usage goes through loadPlaywright().

// ── Publish types ───────────────────────────────────────────────────────────

export interface PublishContent {
  title: string;
  body: string;
  tags: string[];
  /** Absolute paths to media files (images/videos) */
  mediaFiles: string[];
  /** Absolute path to cover image */
  coverImage?: string;
  /** ISO date string for scheduled publishing */
  scheduledAt?: string;
}

export interface PublishResult {
  success: boolean;
  postUrl?: string;
  screenshotPath?: string;
  error?: string;
}

// ── Metrics types ───────────────────────────────────────────────────────────

export interface Metrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collectedAt: string;
}

// ── Trend types ─────────────────────────────────────────────────────────────

export interface TrendVideo {
  title: string;
  url: string;
  views: number;
  likes: number;
  comments: number;
  creator: string;
  thumbnail?: string;
}

export interface TrendTag {
  name: string;
  postCount: number;
  trend: "up" | "down" | "stable";
}

export interface TrendData {
  platform: string;
  collectedAt: string;
  videos: TrendVideo[];
  tags: TrendTag[];
}

// ── Competitor types ────────────────────────────────────────────────────────

export interface CompetitorPost {
  title: string;
  url: string;
  likes: number;
  comments: number;
  publishedAt?: string;
}

export interface CompetitorData {
  platform: string;
  profileUrl: string;
  name: string;
  recentPosts: CompetitorPost[];
  collectedAt: string;
}

// ── Platform adapter interface ──────────────────────────────────────────────

export interface PlatformAdapter {
  /** Platform identifier e.g. "xiaohongshu", "douyin" */
  name: string;
  /** Login page URL */
  loginUrl: string;
  /** Publish/upload page URL */
  publishUrl: string;

  /** Check if already logged in. Page type is `any` (Playwright Page). */
  checkLogin(page: any): Promise<boolean>;
  /** Open login page and wait for user to complete login (e.g. QR scan). */
  login(page: any): Promise<boolean>;
  /** Publish content to the platform. */
  publish(page: any, content: PublishContent): Promise<PublishResult>;
  /** Scrape engagement metrics for a given post URL. */
  scrapeMetrics(page: any, postUrl: string): Promise<Metrics>;
  /** Scrape trending content from the platform. */
  scrapeTrending(page: any): Promise<TrendData>;
  /** Scrape a competitor's profile for recent posts. */
  scrapeCompetitor(page: any, profileUrl: string): Promise<CompetitorData>;
}

// ── Helper: dynamic Playwright import ───────────────────────────────────────

let _pw: any = undefined;
let _attempted = false;

/**
 * Dynamically import playwright. Returns the module or null if unavailable.
 * Result is cached after the first call.
 */
export async function loadPlaywright(): Promise<any> {
  if (_attempted) return _pw ?? null;
  _attempted = true;
  try {
    // Dynamic import — playwright is optional
    _pw = await (Function('return import("playwright")')() as Promise<any>);
    return _pw;
  } catch {
    _pw = null;
    return null;
  }
}
