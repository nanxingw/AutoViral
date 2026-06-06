import { enrichWithAnalysis } from "./enrichment.js";
import { rankByInterests } from "./ranking.js";
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
  /**
   * S14 — the user's content interests (config.interests). When present the
   * validated items are reordered by fit-to-channel before they're written to
   * disk, so the on-disk YAML is already ranked for THIS user's niche. Absent /
   * empty → no reordering (degrades to the agent's heat-implied order).
   */
  interests?: string[];
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
  // S14 — rank by fit-to-channel before returning so the persisted order is
  // already personalized. No-op when interests is empty/undefined.
  const interests = deps.interests ?? [];
  if (interests.length > 0) {
    enriched.items = rankByInterests(enriched.items, interests);
  }
  return enriched;
}

export const defaultPipelineDeps = (
  runCli: (p: string) => Promise<string>,
  interests: string[] = [],
): PipelineDeps => ({
  getSource: defaultGetSource,
  runCli,
  downloadCover: defaultDownloadCover,
  coversDir: defaultCoversDir,
  interests,
});
