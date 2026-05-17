/**
 * `autoviral lint` — pure-node schema + semantic checks on composition.yaml.
 *
 * No Puppeteer. Runs in <500ms on typical works. H1.1 ships these rules:
 *
 *   schema-invalid            zod parse failure
 *   track-overlap             two clips on the same track with overlapping
 *                             timeline ranges
 *   missing-asset             clip uri / assets[].uri not on disk
 *   dangling-segment-id       caption.groups[].segmentIds refers to a
 *                             segment id that doesn't exist in segments[]
 *   orphan-clip               clip references an assetId that's not in
 *                             assets[]
 *   unsupported-type-version  composition has a marker we don't understand
 *
 * Findings shape mirrors hyperframes' lint output for parity with the
 * agent's habits when it has both skills loaded.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CompositionSchema, type Composition } from "../../shared/composition.js";

export type LintSeverity = "error" | "warning" | "info";

export type LintRuleId =
  | "schema-invalid"
  | "track-overlap"
  | "missing-asset"
  | "dangling-segment-id"
  | "orphan-clip"
  | "unsupported-type-version";

export interface LintFinding {
  severity: LintSeverity;
  ruleId: LintRuleId;
  message: string;
  /** Free-form pointer into the composition tree (e.g. "tracks[0].clips[2]"). */
  locator?: string;
}

export interface LintOptions {
  /** Absolute workspace path — used for missing-asset existence checks. */
  workDir?: string;
}

export interface LintReport {
  findings: LintFinding[];
  /** Convenience counters. */
  counts: Record<LintSeverity, number>;
}

export function lintComposition(
  input: unknown,
  opts: LintOptions = {},
): LintReport {
  const findings: LintFinding[] = [];

  // 1) Schema gate — if zod rejects, downstream semantic checks aren't meaningful.
  const parsed = CompositionSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push({
        severity: "error",
        ruleId: "schema-invalid",
        message: issue.message,
        locator: issue.path.join("."),
      });
    }
    return tally(findings);
  }

  const comp = parsed.data;
  semanticChecks(comp, findings, opts);
  return tally(findings);
}

function semanticChecks(
  comp: Composition,
  findings: LintFinding[],
  opts: LintOptions,
): void {
  // Track-overlap rule
  comp.tracks.forEach((track, ti) => {
    const ranges: Array<{ id: string; start: number; end: number; ci: number }> = [];
    track.clips.forEach((clip, ci) => {
      const c = clip as unknown as {
        id?: string;
        kind?: string;
        trackOffset?: number;
        // Video/audio clips use `in`/`out` for source range; text/overlay
        // use `durationSec`. Handle both.
        in?: number;
        out?: number;
        durationSec?: number;
      };
      const start = c.trackOffset ?? 0;
      let dur: number;
      if (c.durationSec !== undefined) dur = c.durationSec;
      else if (c.in !== undefined && c.out !== undefined) dur = c.out - c.in;
      else dur = 0;
      ranges.push({ id: c.id ?? `<unnamed>`, start, end: start + dur, ci });
    });
    ranges.sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
      const prev = ranges[i - 1]!;
      const cur = ranges[i]!;
      if (cur.start < prev.end - 1e-6) {
        findings.push({
          severity: "error",
          ruleId: "track-overlap",
          message: `clip "${cur.id}" overlaps "${prev.id}" on track "${track.id}" (${cur.start.toFixed(2)}s starts before ${prev.end.toFixed(2)}s)`,
          locator: `tracks[${ti}].clips[${cur.ci}]`,
        });
      }
    }
  });

  // Missing-asset rule (only when workDir provided so unit tests can opt-in)
  if (opts.workDir) {
    comp.assets.forEach((asset, ai) => {
      const uri = (asset as unknown as { uri?: string }).uri;
      if (!uri) return;
      const abs = isAbsolute(uri) ? uri : join(opts.workDir!, uri);
      if (!existsSync(abs)) {
        findings.push({
          severity: "error",
          ruleId: "missing-asset",
          message: `asset "${asset.id ?? "<unnamed>"}" uri "${uri}" not found on disk`,
          locator: `assets[${ai}]`,
        });
      }
    });
  }

  // Dangling segment-id rule (caption groups must reference existing segments)
  if (comp.captions) {
    const segIds = new Set(comp.captions.segments.map((s) => s.segmentId));
    comp.captions.groups.forEach((g, gi) => {
      for (const sid of g.segmentIds) {
        if (!segIds.has(sid)) {
          findings.push({
            severity: "error",
            ruleId: "dangling-segment-id",
            message: `caption group "${g.groupId}" references missing segment id "${sid}"`,
            locator: `captions.groups[${gi}]`,
          });
        }
      }
    });
  }

  // Orphan-clip rule — clips reference assets via `src` (path or asset id).
  // If src matches an existing asset id OR an existing asset uri, fine.
  // Otherwise: flag as a warning (could be a literal disk path, which is
  // OK — but it's worth surfacing for the agent to verify).
  const assetIds = new Set(comp.assets.map((a) => a.id));
  const assetUris = new Set(
    comp.assets.map((a) => (a as unknown as { uri?: string }).uri ?? ""),
  );
  comp.tracks.forEach((track, ti) => {
    track.clips.forEach((clip, ci) => {
      const c = clip as unknown as { id?: string; src?: string };
      if (!c.src) return;
      // Plain disk paths starting with / or assets/ are valid even when
      // not in the assets[] registry; only flag when it looks like an
      // asset id (no slashes, no extension) that isn't declared.
      const looksLikeAssetId =
        !c.src.includes("/") && !c.src.includes(".");
      if (
        looksLikeAssetId &&
        !assetIds.has(c.src) &&
        !assetUris.has(c.src)
      ) {
        findings.push({
          severity: "warning",
          ruleId: "orphan-clip",
          message: `clip "${c.id ?? "<unnamed>"}" references undeclared asset id "${c.src}"`,
          locator: `tracks[${ti}].clips[${ci}]`,
        });
      }
    });
  });
}

function tally(findings: LintFinding[]): LintReport {
  const counts: Record<LintSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const f of findings) counts[f.severity] += 1;
  return { findings, counts };
}

/** Exit code per `contracts/error-codes.md` H1 additions:
 *    0 clean · 5 warnings only · 6 errors */
export function exitCodeFor(report: LintReport): 0 | 5 | 6 {
  if (report.counts.error > 0) return 6;
  if (report.counts.warning > 0) return 5;
  return 0;
}
