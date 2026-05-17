// `autoviral lint`           run lint only
// `autoviral inspect`        run inspect only (H1.2 — Puppeteer)
// `autoviral validate`       run WCAG contrast (H1.3 — Puppeteer)
// `autoviral animation-map`  tween Gantt (H1.4)
// `autoviral check`          umbrella — runs all four sequentially
//
// H1.1 ships `lint` only; the others land in their respective issues.
// The umbrella `check` command in H1.4 will fold them all in.

import { bridgeRequest, readContext } from "../client.js";

interface LintReport {
  findings: Array<{
    severity: "error" | "warning" | "info";
    ruleId: string;
    message: string;
    locator?: string;
  }>;
  counts: { error: number; warning: number; info?: number };
}

function exitCodeForCounts(counts: { error: number; warning: number }): number {
  if (counts.error > 0) return 6;
  if (counts.warning > 0) return 5;
  return 0;
}

function renderFindings(report: { findings: LintReport["findings"] }): void {
  for (const f of report.findings) {
    const tag =
      f.severity === "error" ? "✗ ERROR" : f.severity === "warning" ? "⚠ WARN" : "ℹ INFO";
    const loc = f.locator ? ` [${f.locator}]` : "";
    process.stdout.write(`${tag} ${f.ruleId}${loc}: ${f.message}\n`);
  }
}

async function runQualityCommand(
  args: string[],
  label: string,
  path: string,
): Promise<void> {
  const json = args.includes("--json");
  const ctx = readContext();
  const report = await bridgeRequest<LintReport>(ctx, "POST", path, {});
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.findings.length === 0) {
    process.stdout.write(`autoviral ${label}: clean — no findings\n`);
  } else {
    renderFindings(report);
    process.stdout.write(
      `\n${report.counts.error} error(s), ${report.counts.warning} warning(s)\n`,
    );
  }
  process.exitCode = exitCodeForCounts(report.counts);
}

export async function lintCommand(args: string[]): Promise<void> {
  return runQualityCommand(args, "lint", "/quality/lint");
}

export async function inspectCommand(args: string[]): Promise<void> {
  return runQualityCommand(args, "inspect", "/quality/inspect");
}

export async function validateCommand(args: string[]): Promise<void> {
  return runQualityCommand(args, "validate", "/quality/validate");
}

export async function animationMapCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const ctx = readContext();
  const result = await bridgeRequest<unknown>(
    ctx,
    "POST",
    "/quality/animation-map",
    {},
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!json) {
    // Could render ASCII Gantt here when stdout is a TTY; deferred for now.
  }
}

export async function checkCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const ctx = readContext();
  const result = await bridgeRequest<{
    lint: LintReport;
    inspect: LintReport;
    validate: LintReport;
    summary: { totalErrors: number; totalWarnings: number; exitCode: number };
  }>(ctx, "POST", "/quality/check", {});
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const section of ["lint", "inspect", "validate"] as const) {
      const report = result[section];
      if (report.findings.length === 0) continue;
      process.stdout.write(`\n=== ${section} ===\n`);
      renderFindings(report);
    }
    process.stdout.write(
      `\nautoviral check: ${result.summary.totalErrors} error(s), ${result.summary.totalWarnings} warning(s)\n`,
    );
  }
  process.exitCode = result.summary.exitCode;
}
