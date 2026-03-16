// Publish engine — orchestrates browser-based publishing across platforms.
// Playwright is optional: all features gracefully degrade when unavailable.

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { loadPlaywright, type PlatformAdapter, type PublishContent, type PublishResult } from "./platforms/base.js";
import { xiaohongshuAdapter } from "./platforms/xiaohongshu.js";
import { douyinAdapter } from "./platforms/douyin.js";

const MAX_DAILY_PUBLISH = 5;

export class PublishEngine {
  private adapters = new Map<string, PlatformAdapter>();
  private pw: any = null;
  private contexts = new Map<string, any>();
  /** Track daily publish count per platform: key = "platform_YYYY-MM-DD" */
  private dailyCounts = new Map<string, number>();

  constructor() {
    this.adapters.set("xiaohongshu", xiaohongshuAdapter);
    this.adapters.set("douyin", douyinAdapter);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Try to load Playwright. Returns true if available. */
  async init(): Promise<boolean> {
    this.pw = await loadPlaywright();
    return this.pw !== null;
  }

  /** Check if Playwright is loaded. */
  isAvailable(): boolean {
    return this.pw !== null;
  }

  /** Get adapter by platform name. */
  getAdapter(platform: string): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  /** List all registered platform names. */
  listPlatforms(): string[] {
    return Array.from(this.adapters.keys());
  }

  // ── Browser context ───────────────────────────────────────────────────

  /** Get or create a persistent browser context for a platform. */
  async getContext(platform: string, headless = true): Promise<any> {
    if (!this.pw) throw new Error("Playwright is not available");

    // Reuse existing context if open
    const existing = this.contexts.get(platform);
    if (existing) return existing;

    const userDataDir = join(homedir(), ".skill-evolver", "auth", platform);
    await mkdir(userDataDir, { recursive: true });

    const context = await this.pw.chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    this.contexts.set(platform, context);
    return context;
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  /** Check login status for a platform. */
  async checkLoginStatus(platform: string): Promise<boolean> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`Unknown platform: ${platform}`);
    if (!this.pw) return false;

    try {
      const context = await this.getContext(platform, true);
      const page = await context.newPage();
      try {
        return await adapter.checkLogin(page);
      } finally {
        await page.close();
      }
    } catch {
      return false;
    }
  }

  /** Open a visible browser for the user to log in (e.g. QR scan). */
  async openLogin(platform: string): Promise<boolean> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`Unknown platform: ${platform}`);
    if (!this.pw) throw new Error("Playwright is not available");

    // Close existing context to open a visible one
    await this.closeContext(platform);

    const context = await this.getContext(platform, false); // headless: false
    const page = await context.newPage();
    try {
      return await adapter.login(page);
    } finally {
      await page.close();
      // Close the visible context after login, next usage will be headless
      await this.closeContext(platform);
    }
  }

  // ── Publish ───────────────────────────────────────────────────────────

  /** Publish content to a platform. Enforces rate limits. */
  async publish(platform: string, content: PublishContent): Promise<PublishResult> {
    const adapter = this.adapters.get(platform);
    if (!adapter) return { success: false, error: `Unknown platform: ${platform}` };
    if (!this.pw) return { success: false, error: "Playwright is not available" };

    // Rate limit check
    const today = new Date().toISOString().slice(0, 10);
    const key = `${platform}_${today}`;
    const count = this.dailyCounts.get(key) ?? 0;
    if (count >= MAX_DAILY_PUBLISH) {
      return { success: false, error: `Daily publish limit reached (${MAX_DAILY_PUBLISH}/day) for ${platform}` };
    }

    // Login check
    const loggedIn = await this.checkLoginStatus(platform);
    if (!loggedIn) {
      return { success: false, error: `Not logged in to ${platform}. Please log in first.` };
    }

    // Publish
    const context = await this.getContext(platform, true);
    const page = await context.newPage();
    try {
      const result = await adapter.publish(page, content);
      if (result.success) {
        this.dailyCounts.set(key, count + 1);
      }
      return result;
    } finally {
      await page.close();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  /** Close a specific platform's browser context. */
  private async closeContext(platform: string): Promise<void> {
    const ctx = this.contexts.get(platform);
    if (ctx) {
      try {
        await ctx.close();
      } catch { /* ignore */ }
      this.contexts.delete(platform);
    }
  }

  /** Close all browser contexts. */
  async close(): Promise<void> {
    for (const [platform] of this.contexts) {
      await this.closeContext(platform);
    }
  }
}

// ── Module-level singleton (lazily initialized) ─────────────────────────────

let _engine: PublishEngine | null = null;

export function getPublishEngine(): PublishEngine {
  if (!_engine) {
    _engine = new PublishEngine();
  }
  return _engine;
}
