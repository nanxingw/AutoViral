import { readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureDir } from "./config.js";

const REPORTS_DIR = join(homedir(), ".skill-evolver", "reports");

export function getReportsDir(): string {
  return REPORTS_DIR;
}

export interface ReportInfo {
  filename: string;
  date: Date;
}

export async function listReports(): Promise<ReportInfo[]> {
  await ensureDir(REPORTS_DIR);
  const files = await readdir(REPORTS_DIR);
  return files
    .filter((f) => f.endsWith("_report.md"))
    .map((filename) => {
      const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})_report\.md$/);
      const date = match
        ? new Date(`${match[1]}T${match[2].replace("-", ":")}:00`)
        : new Date(0);
      return { filename, date };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function readReport(filename: string): Promise<string> {
  return readFile(join(REPORTS_DIR, filename), "utf-8");
}

export async function readRecentReports(n: number): Promise<string[]> {
  const reports = await listReports();
  const recent = reports.slice(-n);
  const contents: string[] = [];
  for (const r of recent) {
    contents.push(await readReport(r.filename));
  }
  return contents;
}

export async function cleanupReports(max: number): Promise<void> {
  const reports = await listReports();
  if (reports.length <= max) return;
  const toDelete = reports.slice(0, reports.length - max);
  for (const r of toDelete) {
    await unlink(join(REPORTS_DIR, r.filename));
  }
}
