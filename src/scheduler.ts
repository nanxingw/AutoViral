import cron from "node-cron";
import { orchestrator } from "./orchestrator.js";

let task: cron.ScheduledTask | null = null;
let currentExpression: string = "";

export function parseInterval(interval: string): string {
  const match = interval.match(/^(\d+)(m|h)$/);
  if (!match) {
    throw new Error(`Invalid interval format: "${interval}". Use e.g. "30m", "1h", "2h".`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "m") {
    if (value <= 0 || value > 59) throw new Error("Minute interval must be 1-59");
    return `*/${value} * * * *`;
  }
  // unit === "h"
  if (value <= 0 || value > 23) throw new Error("Hour interval must be 1-23");
  return `0 */${value} * * *`;
}

export function startScheduler(interval: string): void {
  if (task) {
    stopScheduler();
  }
  currentExpression = parseInterval(interval);
  task = cron.schedule(currentExpression, async () => {
    if (orchestrator.state === "running") {
      return; // skip if already running
    }
    try {
      await orchestrator.runEvolutionCycle();
    } catch {
      // errors emitted via orchestrator events
    }
  });
}

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    currentExpression = "";
  }
}

export function isSchedulerRunning(): boolean {
  return task !== null;
}

export function getNextRun(): Date | null {
  if (!task || !currentExpression) return null;
  // node-cron doesn't expose next run directly; calculate from cron expression
  try {
    const interval = cron.getTasks();
    // Simple approximation: return null if we can't determine
    return null;
  } catch {
    return null;
  }
}
