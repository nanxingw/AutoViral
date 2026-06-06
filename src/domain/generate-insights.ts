/**
 * generate-insights — S12 orchestrator (PRD-0006 v0.1.5).
 *
 * Wires the local insight agent to the D3 honesty guardrail:
 *   1. read the user's frozen on-disk works (the only real data we have),
 *   2. ask a local agent for candidate "最新洞察" lines grounded on them,
 *   3. filter the agent's output through D3 (insight-guardrail) so anything
 *      citing a never-measured metric (retention / 完播 / hook-timing) is
 *      dropped before it can reach the UI,
 *   4. shape the survivors into dated UI rows (InsightsList items).
 *
 * The disk reader + agent runner are INJECTED (GenerateInsightsDeps) so this is
 * unit-testable without ~/.autoviral or a real CLI. With no on-disk data the
 * agent is never called — we degrade to [] honestly rather than fabricate.
 */

import type { CreatorData } from "./analytics-collector.js";
import {
  buildInsightPrompt,
  parseAgentInsights,
  type InsightWorkInput,
} from "./insight-guardrail.js";

/** A UI-ready insight row (matches InsightsList's item shape). */
export interface InsightRow {
  date: string;
  body: string;
  tag: string;
}

export interface GenerateInsightsDeps {
  /** Load the latest frozen creator scrape (or null when none on disk). */
  getLatestCreatorData: () => Promise<CreatorData | null>;
  /** Run the local agent with a prompt and return its raw text output. */
  runAgent: (prompt: string) => Promise<string>;
}

/** Map a raw scrape work into the guardrail's metric-only input shape. */
function toInsightWork(w: CreatorData["works"][number]): InsightWorkInput {
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
 * Generate the honest "最新洞察" rows. Returns [] (never throws) when there is
 * no on-disk data or the agent fails — the page then shows the honest empty
 * state rather than a fabricated or errored insight list.
 */
export async function generateHonestInsights(
  deps: GenerateInsightsDeps,
): Promise<InsightRow[]> {
  let data: CreatorData | null = null;
  try {
    data = await deps.getLatestCreatorData();
  } catch {
    return [];
  }
  // No real data → no insights. Don't call the agent, don't fabricate.
  if (!data?.works || !Array.isArray(data.works) || data.works.length === 0) {
    return [];
  }

  const works = data.works.map(toInsightWork);
  const prompt = buildInsightPrompt(works);

  let raw = "";
  try {
    raw = await deps.runAgent(prompt);
  } catch {
    return [];
  }

  // D3 honesty gate: parse + filter. Anything citing a never-measured metric is
  // dropped here, by the SAME pure core that the unit regression test guards.
  const passed = parseAgentInsights(raw);

  // Date the rows off the scrape's truthful collection time (provenance), not
  // now() — these insights describe the frozen snapshot.
  const date = (data.collected_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  return passed.map((c) => ({ date, body: c.body, tag: c.tag }));
}
