/**
 * Agent-facing context aggregator.
 *
 * Combines work meta + focus snapshot + composition summary into a single
 * JSON shape the CLI / chat / terminal surfaces can all read. H0.4 will
 * extend this with trends + profile fields.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { read as readFocus, type FocusSnapshot } from "../focus/index.js";
import { CompositionSchema, type Composition } from "../shared/composition.js";

export interface CompositionSummary {
  duration: number;
  trackCount: number;
  captionCount: number;
  hasVariables: boolean;
}

export interface AgentContext {
  workId: string;
  focus: FocusSnapshot;
  composition: CompositionSummary | null;
  // H0.4 will add `trends` and `profile`.
}

function worksRoot(): string {
  return process.env.AUTOVIRAL_WORKS_ROOT ?? join(homedir(), ".autoviral/works");
}

async function readCompositionSummary(
  workId: string,
): Promise<CompositionSummary | null> {
  const path = join(worksRoot(), workId, "composition.yaml");
  try {
    const raw = await readFile(path, "utf-8");
    // composition.yaml is YAML on disk; for the summary we just need rough
    // counts. Parse via the existing JSON-or-YAML helper if present,
    // otherwise skip. Keep this best-effort — context endpoint must never
    // fail because of a malformed composition file.
    const parsed: unknown = JSON.parse(raw); // try JSON first (some works are JSON)
    const comp = CompositionSchema.safeParse(parsed);
    if (!comp.success) return null;
    return summarize(comp.data);
  } catch {
    return null;
  }
}

function summarize(comp: Composition): CompositionSummary {
  return {
    duration: comp.duration,
    trackCount: comp.tracks.length,
    captionCount: comp.captions?.segments.length ?? 0,
    hasVariables: (comp.variables?.length ?? 0) > 0,
  };
}

export async function getContext(workId: string): Promise<AgentContext> {
  const focus = readFocus(workId);
  const composition = await readCompositionSummary(workId);
  return { workId, focus, composition };
}
