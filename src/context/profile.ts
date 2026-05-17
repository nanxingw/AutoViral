/**
 * User creation history snapshot — last 30 days of works + aggregate
 * preferences. Cached in-process for 5 minutes to avoid hammering disk
 * on rapid `autoviral profile` polls.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ProfileSnapshot {
  generatedAt: string;
  windowDays: number;
  workCount: number;
  totalDurationSec: number;
  averageDurationSec: number;
  topAspects: Array<{ aspect: string; count: number }>;
  topPlatforms: Array<{ platform: string; count: number }>;
  topCaptionTypes: Array<{ type: string; count: number }>;
  recentWorkIds: string[];
}

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; value: ProfileSnapshot } | null = null;

function worksRoot(): string {
  return process.env.AUTOVIRAL_WORKS_ROOT ?? join(homedir(), ".autoviral/works");
}

function topN<T extends string>(
  counter: Map<T, number>,
  n = 5,
): Array<{ [k: string]: string | number; count: number }> {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, count]) => ({ value: k as string, count }));
}

export async function getProfile(opts: {
  noCache?: boolean;
  windowDays?: number;
} = {}): Promise<ProfileSnapshot> {
  const windowDays = opts.windowDays ?? 30;
  if (!opts.noCache && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const root = worksRoot();
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    // No works directory yet — return empty profile rather than throwing.
    const empty: ProfileSnapshot = {
      generatedAt: new Date().toISOString(),
      windowDays,
      workCount: 0,
      totalDurationSec: 0,
      averageDurationSec: 0,
      topAspects: [],
      topPlatforms: [],
      topCaptionTypes: [],
      recentWorkIds: [],
    };
    cached = { at: Date.now(), value: empty };
    return empty;
  }

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const aspectCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();
  const captionCounts = new Map<string, number>();
  const recentWorkIds: Array<{ id: string; mtime: number }> = [];
  let workCount = 0;
  let totalDurationSec = 0;

  for (const entry of entries) {
    if (!entry.startsWith("w_")) continue;
    const workDir = join(root, entry);
    let mtime = 0;
    try {
      const s = await stat(workDir);
      mtime = s.mtimeMs;
    } catch {
      continue;
    }
    if (mtime < cutoff) continue;
    recentWorkIds.push({ id: entry, mtime });

    const compPath = join(workDir, "composition.yaml");
    let comp: Record<string, unknown> | null = null;
    try {
      const raw = await readFile(compPath, "utf-8");
      comp = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Skip malformed / missing — still count toward recentWorkIds
    }
    if (comp) {
      workCount += 1;
      const dur = typeof comp.duration === "number" ? comp.duration : 0;
      totalDurationSec += dur;
      const aspect = typeof comp.aspect === "string" ? comp.aspect : "unknown";
      aspectCounts.set(aspect, (aspectCounts.get(aspect) ?? 0) + 1);
      const captions = comp.captions as { groups?: Array<{ animation?: { highlight?: { type?: string } } }> } | undefined;
      const firstHighlightType =
        captions?.groups?.[0]?.animation?.highlight?.type ?? null;
      if (firstHighlightType) {
        captionCounts.set(
          firstHighlightType,
          (captionCounts.get(firstHighlightType) ?? 0) + 1,
        );
      }
    }

    // Read platforms from work.json if present (best-effort)
    try {
      const work = JSON.parse(
        await readFile(join(workDir, "work.json"), "utf-8"),
      ) as { platforms?: string[] };
      for (const p of work.platforms ?? []) {
        platformCounts.set(p, (platformCounts.get(p) ?? 0) + 1);
      }
    } catch {
      /* ignore */
    }
  }

  recentWorkIds.sort((a, b) => b.mtime - a.mtime);

  const snapshot: ProfileSnapshot = {
    generatedAt: new Date().toISOString(),
    windowDays,
    workCount,
    totalDurationSec,
    averageDurationSec: workCount > 0 ? totalDurationSec / workCount : 0,
    topAspects: topN(aspectCounts).map((e) => ({
      aspect: e.value as string,
      count: e.count,
    })),
    topPlatforms: topN(platformCounts).map((e) => ({
      platform: e.value as string,
      count: e.count,
    })),
    topCaptionTypes: topN(captionCounts).map((e) => ({
      type: e.value as string,
      count: e.count,
    })),
    recentWorkIds: recentWorkIds.slice(0, 10).map((w) => w.id),
  };
  cached = { at: Date.now(), value: snapshot };
  return snapshot;
}

export function clearProfileCache(): void {
  cached = null;
}
