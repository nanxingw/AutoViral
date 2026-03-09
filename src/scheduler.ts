import { executor, runEvolutionCycle } from "./executor.js";
import { listTasks, updateTask, getArtifactsDir, type Task } from "./task-store.js";
import { nextCronRun, parseCron } from "./cron.js";
import { loadConfig } from "./config.js";
import { buildTaskPrompt, buildPostTaskPrompt } from "./prompt.js";
import { readRecentReports } from "./reports.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

// ── Interval parsing (same as before) ───────────────────────────────────────

export function parseIntervalMs(interval: string): number {
  const match = interval.match(/^(\d+)(m|h)$/);
  if (!match) {
    throw new Error(`Invalid interval format: "${interval}". Use e.g. "30m", "1h", "2h".`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "m") {
    if (value <= 0 || value > 59) throw new Error("Minute interval must be 1-59");
    return value * 60 * 1000;
  }
  // unit === "h"
  if (value <= 0 || value > 23) throw new Error("Hour interval must be 1-23");
  return value * 60 * 60 * 1000;
}

// ── State ────────────────────────────────────────────────────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null;
let evolutionTimer: ReturnType<typeof setTimeout> | null = null;
let intervalMs: number = 0;
let nextRunTime: Date | null = null;
let active: boolean = false;

// Post-task debounce tracking: taskId -> last trigger timestamp
const postTaskLastTrigger = new Map<string, number>();

// Queue for post-task cycles that were debounced
const postTaskQueue: Array<{ task: Task; taskReport: string }> = [];

// ── Evolution scheduling ─────────────────────────────────────────────────────

function scheduleEvolutionTimer(): void {
  if (!active || intervalMs <= 0) return;
  if (evolutionTimer) clearTimeout(evolutionTimer);

  nextRunTime = new Date(Date.now() + intervalMs);
  evolutionTimer = setTimeout(async () => {
    evolutionTimer = null;
    nextRunTime = null;

    // If any evolution job is already running (single or multi-agent), retry in 60s
    if (executor.hasEvolutionRunning) {
      evolutionTimer = setTimeout(() => scheduleEvolutionTimer(), 60_000);
      return;
    }

    try {
      await runEvolutionCycle();
    } catch {
      // errors emitted via executor events
    }
    // After cycle completes, schedule the next one
    scheduleEvolutionTimer();
  }, intervalMs);
}

// ── Task scheduling helpers ──────────────────────────────────────────────────

let taskJobCounter = 0;

function getTaskReportPath(taskId: string): string {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  return join(homedir(), ".skill-evolver", "tasks", taskId, "reports", `${ts}_report.md`);
}

async function runTaskJob(task: Task): Promise<void> {
  const config = await loadConfig();

  // Check max runs
  if (task.runCount >= config.taskMaxRunsPerTask) {
    await updateTask(task.id, { status: "paused" });
    return;
  }

  const artifactsDir = getArtifactsDir(task.id);
  const reportPath = getTaskReportPath(task.id);

  // Ensure directories exist
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(join(homedir(), ".skill-evolver", "tasks", task.id, "reports"), { recursive: true });

  const prompt = buildTaskPrompt(task, artifactsDir, reportPath);
  const jobId = `task-${++taskJobCounter}-${Date.now()}`;

  try {
    await updateTask(task.id, {
      status: "running",
      lastRun: new Date().toISOString(),
    });

    const result = await executor.run({
      id: jobId,
      type: "task",
      prompt,
      model: config.model,
      taskId: task.id,
      taskName: task.name,
    });

    const updatedRunCount = task.runCount + 1;
    const isOneShot = task.schedule?.type === "one-shot";

    await updateTask(task.id, {
      status: isOneShot ? "completed" : "active",
      runCount: updatedRunCount,
      lastRun: new Date().toISOString(),
    });

    // Trigger post-task review if auto-approve is on
    if (config.taskAutoApprove) {
      triggerPostTaskCycle(
        { ...task, runCount: updatedRunCount },
        result.output,
      );
    }
  } catch {
    await updateTask(task.id, {
      status: "active",
      lastRun: new Date().toISOString(),
    });
  }
}

// ── Tick: check tasks ────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!active) return;

  const config = await loadConfig();
  const now = new Date();

  // Count active task/post-task jobs
  const activeTaskJobs = Array.from(executor.running.values()).filter(
    j => j.type === "task" || j.type === "post-task",
  ).length;

  if (activeTaskJobs >= config.taskMaxConcurrent) return;

  // Process queued post-task cycles first (higher priority)
  while (postTaskQueue.length > 0 && activeTaskJobs < config.taskMaxConcurrent) {
    const queued = postTaskQueue.shift()!;
    runPostTaskJob(queued.task, queued.taskReport).catch(() => {});
    break; // one per tick to avoid flooding
  }

  // Check active tasks for due schedules
  let tasks: Task[];
  try {
    tasks = await listTasks();
  } catch {
    return;
  }

  const activeTasks = tasks.filter(t => t.status === "active" && t.schedule);

  for (const task of activeTasks) {
    // Respect concurrency limit
    const currentActive = Array.from(executor.running.values()).filter(
      j => j.type === "task" || j.type === "post-task",
    ).length;
    if (currentActive >= config.taskMaxConcurrent) break;

    // Skip if this task is already running
    const alreadyRunning = Array.from(executor.running.values()).some(
      j => j.taskId === task.id,
    );
    if (alreadyRunning) continue;

    // Check max runs
    if (task.runCount >= config.taskMaxRunsPerTask) {
      await updateTask(task.id, { status: "paused" });
      continue;
    }

    const schedule = task.schedule!;

    if (schedule.type === "one-shot") {
      const scheduledTime = new Date(schedule.at!);
      if (now >= scheduledTime) {
        runTaskJob(task).catch(() => {});
      }
    } else if (schedule.type === "cron") {
      // Check if it's time to run based on cron expression
      const lastRun = task.lastRun ? new Date(task.lastRun) : new Date(0);
      try {
        const cronExpr = parseCron(schedule.cron!);
        const nextRun = nextCronRun(cronExpr, lastRun);
        if (now >= nextRun) {
          runTaskJob(task).catch(() => {});
        }
      } catch {
        // Invalid cron, skip
      }
    }
  }
}

// ── Post-task ────────────────────────────────────────────────────────────────

let postTaskJobCounter = 0;

async function runPostTaskJob(task: Task, taskReport: string): Promise<void> {
  const config = await loadConfig();
  const recentReports = await readRecentReports(config.reportsToFeed);
  const prompt = buildPostTaskPrompt(task, taskReport, recentReports);

  const jobId = `post-task-${++postTaskJobCounter}-${Date.now()}`;

  try {
    await executor.run({
      id: jobId,
      type: "post-task",
      prompt,
      model: config.model,
      taskId: task.id,
      taskName: task.name,
    });
  } catch {
    // errors emitted via executor events
  }
}

export function triggerPostTaskCycle(task: Task, taskReport: string): void {
  const now = Date.now();
  const lastTrigger = postTaskLastTrigger.get(task.id) ?? 0;

  loadConfig().then(config => {
    const debounceMs = config.postTaskDebounce * 1000;

    if (now - lastTrigger < debounceMs) {
      // Within debounce window — queue for next tick
      postTaskQueue.push({ task, taskReport });
      return;
    }

    postTaskLastTrigger.set(task.id, now);
    runPostTaskJob(task, taskReport).catch(() => {});
  }).catch(() => {});
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startScheduler(interval: string): void {
  stopScheduler();
  intervalMs = parseIntervalMs(interval);
  active = true;

  // Schedule evolution timer
  scheduleEvolutionTimer();

  // Start 30-second tick for task checking
  tickInterval = setInterval(() => {
    tick().catch(() => {});
  }, 30_000);
}

export function reschedule(): void {
  if (active && intervalMs > 0) {
    scheduleEvolutionTimer();
  }
}

export function stopScheduler(): void {
  active = false;
  if (evolutionTimer) {
    clearTimeout(evolutionTimer);
    evolutionTimer = null;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  nextRunTime = null;
  intervalMs = 0;
}

export function isSchedulerRunning(): boolean {
  return active;
}

export function getNextRun(): Date | null {
  return nextRunTime;
}
