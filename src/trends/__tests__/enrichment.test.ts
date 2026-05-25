import { describe, it, expect, vi } from "vitest";
import { enrichWithAnalysis, mergeAnalysisIntoRaws } from "../enrichment.js";
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

// #41 — a colliding raw id used to collapse the by-id Map so every trend got
// the SAME analysis. mergeAnalysisIntoRaws must align by index when ids repeat.
describe("mergeAnalysisIntoRaws", () => {
  const raw = (id: string, title: string): RawTrendItem => ({
    ...baseRaw, id, title,
  });
  const analysisFor = (n: number) => ({ ...validAnalysis, exampleHook: `hook ${n}`, category: `cat ${n}` });

  it("aligns by id when ids are unique (tolerates agent reordering)", () => {
    const raws = [raw("yt_a", "A"), raw("yt_b", "B"), raw("yt_c", "C")];
    // Agent returns them out of order — id alignment must still match.
    const agentItems = [
      { id: "yt_c", analysis: analysisFor(2) },
      { id: "yt_a", analysis: analysisFor(0) },
      { id: "yt_b", analysis: analysisFor(1) },
    ];
    const merged = mergeAnalysisIntoRaws(raws, agentItems, "youtube");
    expect((merged[0].analysis as any).category).toBe("cat 0");
    expect((merged[1].analysis as any).category).toBe("cat 1");
    expect((merged[2].analysis as any).category).toBe("cat 2");
  });

  it("does NOT collapse to one analysis when every raw shares the same id (#41 repro)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The 22-item collision, scaled down: all raws carry youtube_d1085ffa.
    const raws = Array.from({ length: 4 }).map((_, i) => raw("youtube_d1085ffa", `标题 ${i}`));
    const agentItems = raws.map((_, i) => ({ id: "youtube_d1085ffa", analysis: analysisFor(i) }));
    const merged = mergeAnalysisIntoRaws(raws, agentItems, "youtube");
    // Each trend keeps its OWN analysis (index-aligned), not all the last one.
    const cats = merged.map((m) => (m.analysis as any).category);
    expect(cats).toEqual(["cat 0", "cat 1", "cat 2", "cat 3"]);
    expect(new Set(cats).size).toBe(4); // the bug would make this 1
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate raw id"));
    warn.mockRestore();
  });
});
