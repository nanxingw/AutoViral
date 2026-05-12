import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateCollection, type ValidationIssue } from "./schema.js";

export interface WriteOutcome {
  written: boolean;
  path: string | null;
  issues: ValidationIssue[];
}

export async function writeValidatedTrendsYaml(
  dir: string,
  dateStr: string,
  collection: unknown,
): Promise<WriteOutcome> {
  const outcome = validateCollection(collection);
  if (!outcome.passed || !outcome.result) {
    return { written: false, path: null, issues: outcome.issues };
  }
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${dateStr}.yaml`);
  await writeFile(path, yaml.dump(outcome.result, { lineWidth: -1 }), "utf-8");
  return { written: true, path, issues: [] };
}
