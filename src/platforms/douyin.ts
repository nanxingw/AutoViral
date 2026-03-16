// Douyin (Chinese TikTok) platform adapter
// Uses Playwright for browser automation — all page params typed as `any`.

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import type {
  PlatformAdapter,
  PublishContent,
  PublishResult,
  Metrics,
  TrendData,
  CompetitorData,
} from "./base.js";

const AUTH_DIR = join(homedir(), ".skill-evolver", "auth", "douyin");

export const douyinAdapter: PlatformAdapter = {
  name: "douyin",
  loginUrl: "https://creator.douyin.com",
  publishUrl: "https://creator.douyin.com/creator-micro/content/upload",

  // ── Auth ────────────────────────────────────────────────────────────────

  async checkLogin(page: any): Promise<boolean> {
    try {
      await page.goto("https://creator.douyin.com", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      const url: string = page.url();
      // Douyin redirects to login if not authenticated
      return !url.includes("/login") && !url.includes("passport");
    } catch {
      return false;
    }
  },

  async login(page: any): Promise<boolean> {
    try {
      await page.goto("https://creator.douyin.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      // Wait for user to scan QR code — 120s timeout
      await page.waitForURL((url: any) => {
        const s = typeof url === "string" ? url : url.toString();
        return !s.includes("/login") && !s.includes("passport");
      }, { timeout: 120_000 });

      return true;
    } catch {
      return false;
    }
  },

  // ── Publish ─────────────────────────────────────────────────────────────

  async publish(page: any, content: PublishContent): Promise<PublishResult> {
    try {
      await mkdir(AUTH_DIR, { recursive: true });

      await page.goto("https://creator.douyin.com/creator-micro/content/upload", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      // Upload media files
      if (content.mediaFiles.length > 0) {
        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
          await fileInput.setInputFiles(content.mediaFiles);
          // Wait for upload and processing
          await page.waitForTimeout(5_000);
        }
      }

      // Fill description (Douyin uses a description field, max 4000 chars)
      const descText = content.body.slice(0, 4000);
      // Douyin's editor is often a contenteditable div
      try {
        const editor = page.locator('[contenteditable="true"], [class*="editor"]').first();
        await editor.click();
        // Clear existing content and type new
        await page.keyboard.press("Meta+A");
        await page.keyboard.type(content.title + "\n\n" + descText);
      } catch {
        // Fallback: try textarea
        const textarea = page.locator('textarea, [class*="desc"] input');
        await textarea.first().fill(content.title + "\n\n" + descText);
      }

      // Add tags (max 5 for Douyin)
      const tags = content.tags.slice(0, 5);
      for (const tag of tags) {
        try {
          // Douyin uses # prefix for tags in the description
          await page.keyboard.type(` #${tag}`);
          await page.waitForTimeout(1_000);
          // If a suggestion dropdown appears, press Enter to confirm
          try {
            const suggestion = page.locator('[class*="suggest"], [class*="mention-list"]').first();
            const isVisible = await suggestion.isVisible().catch(() => false);
            if (isVisible) {
              await page.keyboard.press("Enter");
            }
          } catch { /* ignore */ }
        } catch {
          break;
        }
      }

      // Upload cover image if provided
      if (content.coverImage) {
        try {
          const coverInput = page.locator('[class*="cover"] input[type="file"], [class*="upload-cover"] input');
          await coverInput.first().setInputFiles([content.coverImage]);
          await page.waitForTimeout(2_000);
        } catch {
          // Cover upload is optional
        }
      }

      // Take screenshot before publishing
      const screenshotPath = join(AUTH_DIR, `publish_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // Click publish button
      const publishBtn = page.locator('button:has-text("发布"), [class*="publish"] button, [class*="submit"] button');
      await publishBtn.first().click();

      // Wait for navigation or confirmation
      await page.waitForTimeout(5_000);

      const finalUrl = page.url();
      return {
        success: true,
        postUrl: finalUrl,
        screenshotPath,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Publish failed",
      };
    }
  },

  // ── Metrics ─────────────────────────────────────────────────────────────

  async scrapeMetrics(page: any, postUrl: string): Promise<Metrics> {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(2_000);

    const extractNumber = async (selector: string): Promise<number> => {
      try {
        const text: string = await page.locator(selector).first().innerText();
        const num = parseInt(text.replace(/[^\d]/g, ""), 10);
        return isNaN(num) ? 0 : num;
      } catch {
        return 0;
      }
    };

    return {
      views: await extractNumber('[class*="play-count"], [class*="view"]'),
      likes: await extractNumber('[class*="like"] span, [class*="digg"]'),
      comments: await extractNumber('[class*="comment"] span'),
      shares: await extractNumber('[class*="share"] span, [class*="forward"]'),
      collectedAt: new Date().toISOString(),
    };
  },

  // ── Trends ──────────────────────────────────────────────────────────────

  async scrapeTrending(page: any): Promise<TrendData> {
    await page.goto("https://www.douyin.com/hot", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForTimeout(3_000);

    const videos: TrendData["videos"] = [];

    try {
      const items = await page.locator('[class*="hot-item"], [class*="trending-item"], li[class*="item"]').all();
      const limit = Math.min(items.length, 20);

      for (let i = 0; i < limit; i++) {
        try {
          const item = items[i];
          const title = await item.locator('[class*="title"], [class*="content"] a').first().innerText().catch(() => "");
          const link = await item.locator("a").first().getAttribute("href").catch(() => "");
          const viewText = await item.locator('[class*="hot-value"], [class*="count"]').first().innerText().catch(() => "0");
          const views = parseInt(viewText.replace(/[^\d]/g, ""), 10) || 0;

          if (title) {
            videos.push({
              title: title.slice(0, 100),
              url: link ? (link.startsWith("http") ? link : `https://www.douyin.com${link}`) : "",
              views,
              likes: 0,
              comments: 0,
              creator: "",
            });
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Page structure may have changed
    }

    return {
      platform: "douyin",
      collectedAt: new Date().toISOString(),
      videos,
      tags: [],
    };
  },

  // ── Competitor ──────────────────────────────────────────────────────────

  async scrapeCompetitor(page: any, profileUrl: string): Promise<CompetitorData> {
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForTimeout(3_000);

    let name = "";
    try {
      name = await page.locator('[class*="nickname"], [class*="user-name"], h1').first().innerText();
    } catch { /* ignore */ }

    const recentPosts: CompetitorData["recentPosts"] = [];

    try {
      const posts = await page.locator('[class*="video-card"], [class*="post-item"]').all();
      const limit = Math.min(posts.length, 10);

      for (let i = 0; i < limit; i++) {
        try {
          const post = posts[i];
          const title = await post.locator('[class*="title"], [class*="desc"]').first().innerText().catch(() => "");
          const link = await post.locator("a").first().getAttribute("href").catch(() => "");
          const likeText = await post.locator('[class*="like"], [class*="digg"]').first().innerText().catch(() => "0");
          const likes = parseInt(likeText.replace(/[^\d]/g, ""), 10) || 0;

          recentPosts.push({
            title: title.slice(0, 100) || `Video ${i + 1}`,
            url: link ? (link.startsWith("http") ? link : `https://www.douyin.com${link}`) : profileUrl,
            likes,
            comments: 0,
          });
        } catch {
          continue;
        }
      }
    } catch {
      // Page structure may have changed
    }

    return {
      platform: "douyin",
      profileUrl,
      name: name || "Unknown",
      recentPosts,
      collectedAt: new Date().toISOString(),
    };
  },
};
