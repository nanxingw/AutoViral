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

import type { CoachWorkInput } from "./coach-session.js";
import type { CreatorData } from "./analytics-collector.js";

export interface CoachContextSources {
  getLatestCreatorData: () => Promise<CreatorData | null>;
  getTrendTopics: (platform: string) => Promise<string[]>;
  getInterests: () => Promise<string[]>;
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
