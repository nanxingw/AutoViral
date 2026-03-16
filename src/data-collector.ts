// Data Collector — collects post metrics and trending data from platforms.
// Works with PublishEngine for browser contexts and platform adapters.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import type { TrendData, Metrics, PlatformAdapter } from "./platforms/base.js";
import { listWorks, getWork, updateWork, type Work, type MetricsSnapshot } from "./work-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal interface for PublishEngine — avoids hard dependency on a file that may not exist yet. */
export interface PublishEngineLike {
  getAdapter(platform: string): PlatformAdapter | undefined;
  /** Get or create a Playwright page for a platform. */
  getPage?(platform: string): Promise<any>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TRENDS_BASE = join(homedir(), ".skill-evolver", "trends");
const CIRCUIT_BREAKER_LIMIT = 5;

// Age-decay collection schedule thresholds (in milliseconds)
const HOUR = 3_600_000;
const DAY = 86_400_000;

const SCHEDULE = [
  { maxAge: 2 * DAY, interval: 4 * HOUR },   // 0-48h: every 4h
  { maxAge: 7 * DAY, interval: 1 * DAY },     // 2-7d: daily
  { maxAge: 30 * DAY, interval: 7 * DAY },    // 7-30d: weekly
] as const;

// ── DataCollector class ─────────────────────────────────────────────────────

export class DataCollector {
  private publishEngine: PublishEngineLike | null;
  private circuitBreaker: Map<string, number> = new Map();

  constructor(publishEngine: PublishEngineLike | null) {
    this.publishEngine = publishEngine;
  }

  /** Replace the publish engine reference (for lazy initialization). */
  setPublishEngine(engine: PublishEngineLike): void {
    this.publishEngine = engine;
  }

  // ── Schedule logic ──────────────────────────────────────────────────────

  /**
   * Determine if metrics should be collected for a post published at the given time.
   * Returns true if enough time has elapsed since the last collection based on the
   * age-decay schedule.
   */
  shouldCollectMetrics(publishedAt: string, lastCollectedAt?: string): boolean {
    const pubTime = new Date(publishedAt).getTime();
    const now = Date.now();
    const age = now - pubTime;

    // 30d+ — stop collecting
    if (age > 30 * DAY) return false;

    // Find the applicable interval for this age
    let interval = 0;
    for (const tier of SCHEDULE) {
      if (age <= tier.maxAge) {
        interval = tier.interval;
        break;
      }
    }
    if (interval === 0) return false;

    // If never collected, collect now
    if (!lastCollectedAt) return true;

    const lastTime = new Date(lastCollectedAt).getTime();
    return (now - lastTime) >= interval;
  }

  // ── Metrics collection ──────────────────────────────────────────────────

  /**
   * Iterate all published works and collect metrics for each platform entry
   * that has a postUrl and passes the age-decay schedule.
   */
  async collectPostMetrics(): Promise<{ collected: number; errors: number }> {
    if (!this.publishEngine) {
      return { collected: 0, errors: 0 };
    }

    const summaries = await listWorks();
    let collected = 0;
    let errors = 0;

    for (const summary of summaries) {
      if (summary.status !== "published") continue;

      const work = await getWork(summary.id);
      if (!work) continue;

      let workUpdated = false;

      for (const entry of work.platforms) {
        const postUrl = entry.publishedUrl;
        if (!postUrl || !entry.publishedAt) continue;

        // Check circuit breaker
        const cbKey = entry.platform;
        const failures = this.circuitBreaker.get(cbKey) ?? 0;
        if (failures >= CIRCUIT_BREAKER_LIMIT) continue;

        // Check schedule
        const lastSnapshot = entry.metrics?.length
          ? entry.metrics[entry.metrics.length - 1]
          : undefined;
        if (!this.shouldCollectMetrics(entry.publishedAt, lastSnapshot?.collectedAt)) {
          continue;
        }

        // Get adapter and scrape
        const adapter = this.publishEngine.getAdapter(entry.platform);
        if (!adapter) continue;

        try {
          const page = this.publishEngine.getPage
            ? await this.publishEngine.getPage(entry.platform)
            : null;
          const metrics: Metrics = await adapter.scrapeMetrics(page, postUrl);

          // Append snapshot
          const snapshot: MetricsSnapshot = {
            platform: entry.platform,
            views: metrics.views,
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
            collectedAt: metrics.collectedAt,
          };
          if (!entry.metrics) entry.metrics = [];
          entry.metrics.push(snapshot);
          workUpdated = true;
          collected++;

          // Reset circuit breaker on success
          this.circuitBreaker.set(cbKey, 0);
        } catch {
          errors++;
          this.circuitBreaker.set(cbKey, failures + 1);
        }
      }

      if (workUpdated) {
        await updateWork(work.id, { platforms: work.platforms });
      }
    }

    return { collected, errors };
  }

  // ── Trend collection ──────────────────────────────────────────────────

  /**
   * Scrape trending pages for the given platforms and save results
   * to ~/.skill-evolver/trends/{platform}/{date}.yaml
   */
  async collectTrends(platforms: string[]): Promise<{ collected: string[]; errors: string[] }> {
    const collectedPlatforms: string[] = [];
    const errorPlatforms: string[] = [];

    if (!this.publishEngine) {
      return { collected: collectedPlatforms, errors: platforms };
    }

    for (const platform of platforms) {
      const adapter = this.publishEngine.getAdapter(platform);
      if (!adapter) {
        errorPlatforms.push(platform);
        continue;
      }

      try {
        const page = this.publishEngine.getPage
          ? await this.publishEngine.getPage(platform)
          : null;
        const trendData: TrendData = await adapter.scrapeTrending(page);

        // Save to file
        const platformDir = join(TRENDS_BASE, platform);
        await mkdir(platformDir, { recursive: true });
        const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const filePath = join(platformDir, `${dateStr}.yaml`);
        await writeFile(filePath, yaml.dump(trendData, { lineWidth: -1 }), "utf-8");

        collectedPlatforms.push(platform);
      } catch {
        errorPlatforms.push(platform);
      }
    }

    return { collected: collectedPlatforms, errors: errorPlatforms };
  }

  // ── Trend retrieval ─────────────────────────────────────────────────────

  /**
   * Read the most recent trend file for a platform.
   * Returns null if no trend data is available.
   */
  async getLatestTrends(platform: string): Promise<TrendData | null> {
    const platformDir = join(TRENDS_BASE, platform);

    try {
      const files = await readdir(platformDir);
      const yamlFiles = files.filter(f => f.endsWith(".yaml")).sort();
      if (yamlFiles.length === 0) return null;

      const latest = yamlFiles[yamlFiles.length - 1];
      const raw = await readFile(join(platformDir, latest), "utf-8");
      return yaml.load(raw) as TrendData;
    } catch {
      return null;
    }
  }

  // ── Circuit breaker status ──────────────────────────────────────────────

  getCircuitBreakerStatus(): Record<string, { failures: number; disabled: boolean }> {
    const status: Record<string, { failures: number; disabled: boolean }> = {};
    for (const [platform, failures] of this.circuitBreaker) {
      status[platform] = { failures, disabled: failures >= CIRCUIT_BREAKER_LIMIT };
    }
    return status;
  }

  resetCircuitBreaker(platform?: string): void {
    if (platform) {
      this.circuitBreaker.delete(platform);
    } else {
      this.circuitBreaker.clear();
    }
  }
}
