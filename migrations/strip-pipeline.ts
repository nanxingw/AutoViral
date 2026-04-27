import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";

const STRIP_KEYS = ["pipeline", "evaluationMode", "evalSessionIds", "evalAttempts"] as const;

export interface RunOpts {
  dataDir: string;
  dryRun?: boolean;
}

export interface RunReport {
  scanned: number;
  wouldStrip: number;
  stripped: number;
  backups: string[];
}

export async function run({ dataDir, dryRun = false }: RunOpts): Promise<RunReport> {
  const worksDir = join(dataDir, "works");
  let entries: string[] = [];
  try {
    entries = await readdir(worksDir);
  } catch {
    return { scanned: 0, wouldStrip: 0, stripped: 0, backups: [] };
  }

  const report: RunReport = { scanned: 0, wouldStrip: 0, stripped: 0, backups: [] };

  for (const id of entries) {
    const file = join(worksDir, id, "work.yaml");
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    report.scanned++;

    let obj: Record<string, unknown> | null;
    try {
      obj = yaml.load(raw) as Record<string, unknown> | null;
    } catch {
      // Corrupted YAML — skip but record as scanned.
      continue;
    }
    if (!obj || typeof obj !== "object") continue;

    const hasLegacy = STRIP_KEYS.some((k) => k in obj!);
    if (!hasLegacy) continue;

    if (dryRun) {
      report.wouldStrip++;
      continue;
    }

    // 1) backup first (spec §14: always dump before strip)
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = join(worksDir, id, `work.${ts}.bak.yaml`);
    await copyFile(file, bak);
    report.backups.push(bak);

    // 2) strip
    for (const k of STRIP_KEYS) delete obj[k];
    await writeFile(file, yaml.dump(obj, { lineWidth: -1, sortKeys: false }), "utf-8");
    report.stripped++;
  }

  return report;
}

// CLI entry: `tsx migrations/strip-pipeline.ts [--dry-run]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = process.env.AUTOVIRAL_DATA_DIR ?? "./data";
  const dryRun = process.argv.includes("--dry-run");
  run({ dataDir, dryRun }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
