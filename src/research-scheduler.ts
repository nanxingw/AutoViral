import cron from "node-cron";
import { loadConfig } from "./infra/config.js";

/**
 * #64 — the Settings "启用自动调研" toggle + cron expression were fully surfaced
 * (config.research.{enabled,schedule,platforms}, GET-reflected, PUT-persisted,
 * UI-bound) but NOTHING consumed them: the only cron in the codebase was the
 * analytics collector (a different field). So scheduled research never fired —
 * trends only refreshed on a manual click. This scheduler closes that loop.
 *
 * It runs the SAME researchTrends() collection the manual "refresh" button uses
 * (imported lazily to avoid a static cycle with the route module), so scheduled
 * and manual research stay identical. Mirrors startAnalyticsCollector.
 */

const DEFAULT_CRON = "7 9,21 * * *";
const DEFAULT_PLATFORMS = ["douyin", "xiaohongshu"];

let task: cron.ScheduledTask | null = null;

export async function startResearchScheduler(): Promise<void> {
  // Idempotent: always tear down any prior task so this doubles as a restart.
  stopResearchScheduler();
  const config = await loadConfig();
  const research = config.research;
  if (!research?.enabled) {
    console.log("[research] Auto-research disabled — scheduler not started");
    return;
  }
  const cronExpr = (research.schedule ?? "").trim() || DEFAULT_CRON;
  // An invalid cron would throw inside cron.schedule and take down boot, so we
  // refuse to schedule it. The PUT handler validates too, but config can also
  // arrive hand-edited on disk.
  if (!cron.validate(cronExpr)) {
    console.error(`[research] Invalid cron "${cronExpr}" — scheduler not started`);
    return;
  }
  task = cron.schedule(cronExpr, () => {
    void runScheduledResearch();
  });
  const platforms = research.platforms?.length ? research.platforms : DEFAULT_PLATFORMS;
  console.log(`[research] Scheduled auto-research "${cronExpr}" for ${platforms.join(", ")}`);
}

/**
 * Re-read config and run one collection. Re-checks `enabled` at fire time so a
 * toggle-off between fires takes effect immediately (mirrors how the analytics
 * collector re-reads its URL in its own callback). Errors are swallowed with a
 * log — a failed scheduled run must never crash the long-lived server process.
 */
async function runScheduledResearch(): Promise<void> {
  try {
    const cfg = await loadConfig();
    if (!cfg.research?.enabled) return;
    const platforms = cfg.research.platforms?.length ? cfg.research.platforms : DEFAULT_PLATFORMS;
    const { researchTrends } = await import("./server/api.js");
    const { collected, errors } = await researchTrends(platforms);
    console.log(
      `[research] Scheduled run — collected: ${collected.join(", ") || "none"}` +
        (errors.length ? `; errors: ${errors.join("; ")}` : ""),
    );
  } catch (err) {
    console.error("[research] Scheduled run failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Apply a Settings change (research.enabled / research.schedule) live, without a
 * server restart. startResearchScheduler is already idempotent, so this is just
 * a clearly-named alias for the PUT call site.
 */
export async function restartResearchScheduler(): Promise<void> {
  await startResearchScheduler();
}

export function stopResearchScheduler(): void {
  task?.stop();
  task = null;
}
