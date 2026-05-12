import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { youtubeSource } from "../youtube.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, "fixtures/youtube-trending.xml");

describe("youtubeSource.collect", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => (await readFile(FIXTURE_PATH, "utf-8")),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
