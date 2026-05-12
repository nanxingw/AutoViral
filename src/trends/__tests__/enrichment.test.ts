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

// Tests must pad raws to ≥5 items (schema minimum). Create 5 raws.
const fiveRaws: RawTrendItem[] = Array.from({ length: 5 }).map((_, i) => ({
  ...baseRaw, id: `yt_${i}`,
}));

describe("enrichWithAnalysis", () => {
  it("returns enriched items when agent first try passes validation", async () => {
    const runCli = vi.fn().mockResolvedValueOnce(JSON.stringify({
      items: fiveRaws.map((r) => ({ id: r.id, analysis: validAnalysis })),
    }));
    const out = await enrichWithAnalysis(fiveRaws, "youtube", { runCli, maxRetries: 2 });
    expect(out.validation.passed).toBe(true);
    expect(out.items[0].analysis.heat).toBe(4);
  });

  it("retries with feedback when first agent output fails validation", async () => {
    const runCli = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({
        items: fiveRaws.map((r) => ({ id: r.id, analysis: { ...validAnalysis, heat: 9 } })),
      }))
      .mockResolvedValueOnce(JSON.stringify({
        items: fiveRaws.map((r) => ({ id: r.id, analysis: validAnalysis })),
      }));
    const out = await enrichWithAnalysis(fiveRaws, "youtube", { runCli, maxRetries: 2 });
    expect(runCli).toHaveBeenCalledTimes(2);
    expect(out.validation.passed).toBe(true);
    expect(runCli.mock.calls[1][0]).toMatch(/issue|invalid|heat/i);
  });

  it("returns partial pipelineStatus when retries exhausted", async () => {
    const runCli = vi.fn().mockResolvedValue(JSON.stringify({
      items: fiveRaws.map((r) => ({ id: r.id, analysis: { ...validAnalysis, heat: 9 } })),
    }));
    const out = await enrichWithAnalysis(fiveRaws, "youtube", { runCli, maxRetries: 1 });
    expect(out.pipelineStatus).toBe("partial");
    expect(out.validation.passed).toBe(false);
    expect(out.validation.issues.length).toBeGreaterThan(0);
  });
});
