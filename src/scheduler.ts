import { executor, runEvolutionCycle } from "./executor.js";
import {
  listTasks, updateTask, getArtifactsDir,
  sortByPriority, archiveCompletedTasks, getRetryDelay,
  type Task,
} from "./task-store.js";
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

// Queue for post-task cycles that were debounced (bounded)
const POST_TASK_QUEUE_MAX = 5;
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
  const timeout = task.timeoutMinutes ?? config.taskTimeoutMinutes;

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
      timeoutMinutes: timeout,
    });

    const updatedRunCount = task.runCount + 1;
    const isOneShot = task.schedule?.type === "one-shot";
    const now = new Date().toISOString();

    await updateTask(task.id, {
      status: isOneShot ? "completed" : "active",
      runCount: updatedRunCount,
      lastRun: now,
      failCount: 0,              // reset on success
      nextRetryAfter: undefined,
      ...(isOneShot ? { completedAt: now } : {}),
    });

    // Trigger post-task review if auto-approve is on
    if (config.taskAutoApprove) {
      triggerPostTaskCycle(
        { ...task, runCount: updatedRunCount },
        result.output,
      );
    }
  } catch {
    const newFailCount = (task.failCount ?? 0) + 1;

    if (newFailCount >= config.taskMaxRetries) {
      // Auto-pause after max retries
      console.error(`[scheduler] Task "${task.name}" failed ${newFailCount} times, auto-pausing.`);
      await updateTask(task.id, {
        status: "paused",
        lastRun: new Date().toISOString(),
        failCount: newFailCount,
      });
    } else {
      // Set retry backoff
      const delay = getRetryDelay(newFailCount);
      const retryAfter = new Date(Date.now() + delay).toISOString();
      console.error(`[scheduler] Task "${task.name}" failed (${newFailCount}/${config.taskMaxRetries}), retry after ${retryAfter}`);
      await updateTask(task.id, {
        status: "active",
        lastRun: new Date().toISOString(),
        failCount: newFailCount,
        nextRetryAfter: retryAfter,
      });
    }
  }
}

// ── Tick: 6-step scheduling algorithm ────────────────────────────────────────

async function tick(): Promise<void> {
  if (!active) return;

  const config = await loadConfig();
  const now = new Date();

  let tasks: Task[];
  try {
    tasks = await listTasks();
  } catch {
    return;
  }

  // ── Step 1: CLEANUP — archive old completed/expired tasks ──
  await archiveCompletedTasks(config.taskCompletedRetention).catch(() => {});

  // ── Step 2: EXPIRE — one-shot tasks past expiry window ──
  const expiryMs = config.taskOneShotExpiryHours * 60 * 60 * 1000;
  for (const task of tasks) {
    if (
      task.status === "active" &&
      task.schedule?.type === "one-shot" &&
      task.schedule.at
    ) {
      const scheduledTime = new Date(task.schedule.at).getTime();
      if (now.getTime() - scheduledTime > expiryMs) {
        console.log(`[scheduler] One-shot task "${task.name}" expired (missed by ${Math.round((now.getTime() - scheduledTime) / 60000)}min).`);
        await updateTask(task.id, { status: "expired", completedAt: now.toISOString() });
      }
    }
  }

  // ── Step 3: TIMEOUT — kill running tasks exceeding their timeout ──
  for (const [jobId, job] of executor.running.entries()) {
    if (job.type !== "task") continue;
    const startedAt = executor.getJobStartTime(jobId);
    if (!startedAt) continue;
    const timeoutMs = (job.timeoutMinutes ?? config.taskTimeoutMinutes) * 60 * 1000;
    if (Date.now() - startedAt > timeoutMs) {
      console.error(`[scheduler] Task job ${jobId} exceeded ${job.timeoutMinutes ?? config.taskTimeoutMinutes}min timeout, killing.`);
      executor.killJob(jobId);
    }
  }

  // ── Step 4: Count active execution slots ──
  const runningTaskJobs = Array.from(executor.running.values()).filter(
    j => j.type === "task" || j.type === "post-task",
  ).length;

  if (runningTaskJobs >= config.taskMaxConcurrent) return;

  // ── Step 5: Process queued post-task cycles (higher priority than new tasks) ──
  if (postTaskQueue.length > 0 && runningTaskJobs < config.taskMaxConcurrent) {
    const queued = postTaskQueue.shift()!;
    runPostTaskJob(queued.task, queued.taskReport).catch(() => {});
    // Re-check slots after dispatch
    const afterPostTask = Array.from(executor.running.values()).filter(
      j => j.type === "task" || j.type === "post-task",
    ).length;
    if (afterPostTask >= config.taskMaxConcurrent) return;
  }

  // ── Step 6: BUILD QUEUE & DISPATCH — collect due tasks, sorted by priority ──
  // Reload tasks (expiry/archive may have changed statuses)
  try {
    tasks = await listTasks();
  } catch {
    return;
  }

  const activeTasks = tasks.filter(t => t.status === "active" && t.schedule);
  const dueTasks: Task[] = [];

  for (const task of activeTasks) {
    // Skip if already running
    const alreadyRunning = Array.from(executor.running.values()).some(
      j => j.taskId === task.id,
    );
    if (alreadyRunning) continue;

    // Skip if max runs reached
    if (task.runCount >= config.taskMaxRunsPerTask) {
      await updateTask(task.id, { status: "paused" });
      continue;
    }

    // Skip if in retry backoff
    if (task.nextRetryAfter && now < new Date(task.nextRetryAfter)) {
      continue;
    }

    const schedule = task.schedule!;
    let isDue = false;

    if (schedule.type === "one-shot") {
      const scheduledTime = new Date(schedule.at!);
      isDue = now >= scheduledTime;
    } else if (schedule.type === "cron") {
      const lastRun = task.lastRun ? new Date(task.lastRun) : new Date(0);
      try {
        const cronExpr = parseCron(schedule.cron!);
        const nextRun = nextCronRun(cronExpr, lastRun);
        isDue = now >= nextRun;
      } catch {
        // Invalid cron, skip
      }
    }

    if (isDue) dueTasks.push(task);
  }

  // Sort by priority (high first), then fairness (longest wait), then age
  const sorted = sortByPriority(dueTasks);

  // Dispatch up to available slots
  let availableSlots = config.taskMaxConcurrent - Array.from(executor.running.values()).filter(
    j => j.type === "task" || j.type === "post-task",
  ).length;

  for (const task of sorted) {
    if (availableSlots <= 0) break;
    runTaskJob(task).catch(() => {});
    availableSlots--;
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
      // Within debounce window — queue for next tick (bounded)
      if (postTaskQueue.length < POST_TASK_QUEUE_MAX) {
        postTaskQueue.push({ task, taskReport });
      } else {
        console.warn("[scheduler] Post-task queue full, dropping oldest entry.");
        postTaskQueue.shift();
        postTaskQueue.push({ task, taskReport });
      }
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
