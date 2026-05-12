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

  // Download covers; mutate cachedPath in-place. Safe because items are
  // freshly allocated by enrichWithAnalysis on each call — never cached or
  // shared. If enrichment ever starts memoizing return values, revisit.
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
