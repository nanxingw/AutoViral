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
