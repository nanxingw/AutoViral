/**
 * coach-context — assemble a CoachContext (the grounding for D5's coach prompt)
 * from the on-disk artifacts: the frozen creator scrape (works), the selected
 * platform's trend topics, and the user's configured interests.
 *
 * The disk-reading sources are injected (CoachContextSources) so this stays
 * unit-testable without touching ~/.autoviral. Each source degrades to an empty
 * value on error — the honesty contract is that missing data shows up as empty
 * (the prompt then says so) rather than a fabricated stand-in or a thrown error.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { CoachWorkInput } from "./coach-session.js";
import type { CreatorData } from "./analytics-collector.js";

export interface CoachContextSources {
  getLatestCreatorData: () => Promise<CreatorData | null>;
  getTrendTopics: (platform: string) => Promise<string[]>;
  getInterests: () => Promise<string[]>;
}

/** Injected fs/config deps so the disk-backed sources stay unit-testable. */
export interface CoachContextDiskDeps {
  /** Root data dir (e.g. ~/.autoviral) — trends live under `${root}/trends/<p>/data.json`. */
  dataRoot: string;
  getLatestCreatorData: () => Promise<CreatorData | null>;
  loadInterests: () => Promise<string[]>;
}

/**
 * Build the disk-backed CoachContextSources — the SINGLE source of truth for the
 * coach's grounding (works + selected-platform trends + interests). Both the
 * coach system prompt (ws-bridge) and the S9 angle-brief feed read through this,
 * so they can never drift to two different "what the user's data is" answers.
 *
 * Each source degrades to empty on any failure (honest empty, never fabricated).
 */
export function buildCoachContextSourcesFromDisk(
  deps: CoachContextDiskDeps,
): CoachContextSources {
  return {
    getLatestCreatorData: deps.getLatestCreatorData,
    getTrendTopics: async (p) => {
      // Read the on-disk trends artifact for the platform and pull topic titles
      // (data.json `{topics:[{title}]}` written by the research agent).
      try {
        const file = join(deps.dataRoot, "trends", p, "data.json");
        const raw = await readFile(file, "utf-8");
        const data = JSON.parse(raw) as { topics?: Array<{ title?: string }> };
        return (data.topics ?? [])
          .map((t) => t?.title)
          .filter((t): t is string => typeof t === "string" && t.length > 0)
          .slice(0, 12);
      } catch {
        return [];
      }
    },
    getInterests: async () => {
      try {
        return (await deps.loadInterests()) ?? [];
      } catch {
        return [];
      }
    },
  };
}

export interface AssembledCoachContext {
  platform: string;
  works: CoachWorkInput[];
  trendTopics: string[];
  interests: string[];
}

/** Map a raw scrape work into the coach's metric-only input shape. */
function toWorkInput(w: CreatorData["works"][number]): CoachWorkInput {
  return {
    desc: typeof w.desc === "string" ? w.desc : "",
    playCount: w.play_count ?? 0,
    diggCount: w.digg_count ?? 0,
    commentCount: w.comment_count ?? 0,
    shareCount: w.share_count ?? 0,
    collectCount: w.collect_count ?? 0,
  };
}

/**
 * Build the CoachContext for `platform` from the injected disk sources. Any
 * source failure degrades to empty (works → [], trends → [], interests → []) so
 * the coach grounds honestly on whatever IS available instead of crashing or
 * inventing data.
 */
export async function assembleCoachContext(
  platform: string,
  sources: CoachContextSources,
): Promise<AssembledCoachContext> {
  let works: CoachWorkInput[] = [];
  try {
    const data = await sources.getLatestCreatorData();
    if (data?.works && Array.isArray(data.works)) {
      works = data.works.map(toWorkInput);
    }
  } catch {
    works = [];
  }

  let trendTopics: string[] = [];
  try {
    trendTopics = (await sources.getTrendTopics(platform)) ?? [];
  } catch {
    trendTopics = [];
  }

  let interests: string[] = [];
  try {
    interests = (await sources.getInterests()) ?? [];
  } catch {
    interests = [];
  }

  return { platform, works, trendTopics, interests };
}
