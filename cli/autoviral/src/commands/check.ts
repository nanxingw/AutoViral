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
  counts: { error: number; warning: number; info: number };
}

function exitCodeForCounts(counts: { error: number; warning: number }): number {
  if (counts.error > 0) return 6;
  if (counts.warning > 0) return 5;
  return 0;
}

export async function lintCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const ctx = readContext();
  const report = await bridgeRequest<LintReport>(ctx, "POST", "/quality/lint", {});
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.findings.length === 0) {
    process.stdout.write("autoviral lint: clean — no findings\n");
  } else {
    for (const f of report.findings) {
      const tag =
        f.severity === "error"
          ? "✗ ERROR"
          : f.severity === "warning"
            ? "⚠ WARN"
            : "ℹ INFO";
      const loc = f.locator ? ` [${f.locator}]` : "";
      process.stdout.write(`${tag} ${f.ruleId}${loc}: ${f.message}\n`);
    }
    process.stdout.write(
      `\n${report.counts.error} error(s), ${report.counts.warning} warning(s)\n`,
    );
  }
  process.exitCode = exitCodeForCounts(report.counts);
}
