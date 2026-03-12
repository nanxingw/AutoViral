// Task store — manages persistent task definitions
// This module provides the types and CRUD needed by executor/scheduler/prompt/api/cli.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskSchedule {
  type: "cron" | "one-shot";
  cron?: string;       // 5-field cron expression (for type=cron)
  at?: string;         // ISO date string (for type=one-shot)
}

export type TaskPriority = "high" | "normal" | "low";

export interface Task {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  type?: "recurring" | "one-shot";
  schedule?: TaskSchedule;
  scheduled_at?: string;
  status: "active" | "paused" | "completed" | "running" | "pending" | "expired";
  approved?: boolean;
  model?: string;
  tags?: string[];
  source?: string;
  next_run?: string | null;
  max_runs?: number | null;
  runCount: number;
  lastRun?: string;    // ISO date string
  createdAt: string;   // ISO date string
  relatedSkills?: string[];  // skills this task should leverage
  skillTarget?: string;      // for skill-building tasks: the skill to create/update
  // Scheduling constraints
  priority?: TaskPriority;     // default: "normal"
  failCount?: number;          // consecutive failures (reset on success)
  nextRetryAfter?: string;     // ISO date: don't retry before this time
  completedAt?: string;        // when task finished (for cleanup)
  timeoutMinutes?: number;     // per-task timeout override
}

// ── Storage ──────────────────────────────────────────────────────────────────

const TASKS_DIR = join(homedir(), ".skill-evolver", "tasks");
const TASKS_FILE = join(TASKS_DIR, "tasks.yaml");

interface TasksFile {
  tasks: Task[];
}

async function ensureTasksDir(): Promise<void> {
  await mkdir(TASKS_DIR, { recursive: true });
}

async function readTasksFile(): Promise<TasksFile> {
  await ensureTasksDir();
  let raw: string;
  try {
    raw = await readFile(TASKS_FILE, "utf-8");
  } catch {
    // File doesn't exist yet — that's fine
    return { tasks: [] };
  }
  try {
    const parsed = yaml.load(raw) as TasksFile | null;
    return parsed ?? { tasks: [] };
  } catch (err) {
    // YAML is corrupted — log loudly so it doesn't silently vanish
    console.error(`[task-store] Failed to parse ${TASKS_FILE}: ${err}`);
    console.error("[task-store] Attempting auto-repair...");
    const repaired = repairYaml(raw);
    try {
      const parsed = yaml.load(repaired) as TasksFile | null;
      await writeFile(TASKS_FILE, repaired, "utf-8");
      console.error("[task-store] Auto-repair succeeded, file rewritten.");
      return parsed ?? { tasks: [] };
    } catch (err2) {
      console.error(`[task-store] Auto-repair failed: ${err2}`);
      return { tasks: [] };
    }
  }
}

/** Remove duplicate consecutive YAML keys (the most common corruption pattern). */
function repairYaml(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trimEnd();
    if (i > 0 && stripped === lines[i - 1].trimEnd() && stripped.includes(":")) {
      continue; // skip duplicate key line
    }
    result.push(lines[i]);
  }
  return result.join("\n");
}

async function writeTasksFile(data: TasksFile): Promise<void> {
  await ensureTasksDir();
  const raw = yaml.dump(data, { lineWidth: -1 });
  await writeFile(TASKS_FILE, raw, "utf-8");
}

function generateId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function listTasks(filter?: { status?: string }): Promise<Task[]> {
  const data = await readTasksFile();
  if (filter?.status) {
    return data.tasks.filter(t => t.status === filter.status);
  }
  return data.tasks;
}

export async function getTask(id: string): Promise<Task | undefined> {
  const data = await readTasksFile();
  return data.tasks.find(t => t.id === id);
}

export async function createTask(input: Omit<Task, "id" | "runCount" | "createdAt"> & { id?: string; runCount?: number; createdAt?: string }): Promise<Task> {
  const data = await readTasksFile();
  const task: Task = {
    ...input,
    id: input.id ?? generateId(),
    runCount: input.runCount ?? 0,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  data.tasks.push(task);
  await writeTasksFile(data);
  return task;
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
  const data = await readTasksFile();
  const idx = data.tasks.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  data.tasks[idx] = { ...data.tasks[idx], ...updates };
  await writeTasksFile(data);
  return data.tasks[idx];
}

export async function deleteTask(id: string): Promise<boolean> {
  const data = await readTasksFile();
  const before = data.tasks.length;
  data.tasks = data.tasks.filter(t => t.id !== id);
  if (data.tasks.length === before) return false;
  await writeTasksFile(data);
  return true;
}

// ── Scheduling helpers ───────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

/** Count tasks in schedulable states (active + running + pending). */
export async function countActiveTasks(): Promise<number> {
  const data = await readTasksFile();
  return data.tasks.filter(
    t => t.status === "active" || t.status === "running" || t.status === "pending",
  ).length;
}

/** Sort tasks by priority, then by longest wait (fairness), then by creation date. */
export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? "normal"] ?? 1;
    const pb = PRIORITY_ORDER[b.priority ?? "normal"] ?? 1;
    if (pa !== pb) return pa - pb;
    // Fairness: longest time since last run first
    const aLast = a.lastRun ? new Date(a.lastRun).getTime() : 0;
    const bLast = b.lastRun ? new Date(b.lastRun).getTime() : 0;
    if (aLast !== bLast) return aLast - bLast;
    // Tie-breaker: older tasks first
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/** Archive old completed/expired tasks, keeping at most `maxRetain`. */
export async function archiveCompletedTasks(maxRetain: number): Promise<void> {
  const data = await readTasksFile();
  const terminal = data.tasks.filter(t => t.status === "completed" || t.status === "expired");
  if (terminal.length <= maxRetain) return;

  // Sort by completedAt/lastRun descending — keep newest
  terminal.sort((a, b) => {
    const aTime = new Date(a.completedAt ?? a.lastRun ?? a.createdAt).getTime();
    const bTime = new Date(b.completedAt ?? b.lastRun ?? b.createdAt).getTime();
    return bTime - aTime;
  });

  const toRemove = new Set(terminal.slice(maxRetain).map(t => t.id));
  if (toRemove.size === 0) return;

  data.tasks = data.tasks.filter(t => !toRemove.has(t.id));
  await writeTasksFile(data);
  console.log(`[task-store] Archived ${toRemove.size} old completed tasks.`);
}

/** Retry backoff delays in ms: 5min, 15min, 30min */
const RETRY_DELAYS = [5 * 60_000, 15 * 60_000, 30 * 60_000];

export function getRetryDelay(failCount: number): number {
  return RETRY_DELAYS[Math.min(failCount, RETRY_DELAYS.length) - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
}

// ── Run history ──────────────────────────────────────────────────────────────

export interface RunInfo {
  filename: string;
  date: Date;
}

export function getRunsDir(taskId: string): string {
  return join(TASKS_DIR, taskId, "reports");
}

export async function listRuns(taskId: string): Promise<RunInfo[]> {
  const dir = getRunsDir(taskId);
  try {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    return files
      .filter(f => f.endsWith(".md"))
      .map(filename => {
        const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
        const date = match
          ? new Date(`${match[1]}T${match[2].replace("-", ":")}:00`)
          : new Date(0);
        return { filename, date };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  } catch {
    return [];
  }
}

export async function readRun(taskId: string, filename: string): Promise<string> {
  return readFile(join(getRunsDir(taskId), filename), "utf-8");
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export function getArtifactsDir(taskId: string): string {
  return join(TASKS_DIR, taskId, "artifacts");
}

export async function listArtifacts(taskId: string): Promise<string[]> {
  const dir = getArtifactsDir(taskId);
  try {
    await mkdir(dir, { recursive: true });
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function readArtifact(taskId: string, filename: string): Promise<string> {
  return readFile(join(getArtifactsDir(taskId), filename), "utf-8");
}

// ── Ideas / Rejected ─────────────────────────────────────────────────────────

const IDEAS_FILE = join(homedir(), ".claude", "skills", "task-planner", "buffer", "ideas.yaml");
const REJECTED_FILE = join(homedir(), ".claude", "skills", "task-planner", "tasks", "_rejected.yaml");

export async function listIdeas(): Promise<unknown[]> {
  try {
    const raw = await readFile(IDEAS_FILE, "utf-8");
    const parsed = yaml.load(raw) as { entries?: unknown[]; ideas?: unknown[] } | null;
    return parsed?.entries ?? parsed?.ideas ?? [];
  } catch {
    return [];
  }
}

export async function addRejected(entry: Record<string, unknown>): Promise<void> {
  await ensureTasksDir();
  let entries: unknown[] = [];
  try {
    const raw = await readFile(REJECTED_FILE, "utf-8");
    const parsed = yaml.load(raw) as { entries?: unknown[] } | null;
    entries = parsed?.entries ?? [];
  } catch { /* empty */ }
  entries.push({ ...entry, date: entry.date ?? new Date().toISOString() });
  const raw = yaml.dump({ entries }, { lineWidth: -1 });
  await writeFile(REJECTED_FILE, raw, "utf-8");
}

// ── Skill Needs (task→skill bridge) ──────────────────────────────────────────

export interface SkillNeed {
  need: string;
  source_task?: string;
  task_name?: string;
  evidence: string;
  priority: "high" | "medium";
  date: string;
  addressed?: boolean;
}

const SKILL_NEEDS_FILE = join(homedir(), ".claude", "skills", "skill-evolver", "tmp", "skill_needs.yaml");

export async function listSkillNeeds(): Promise<SkillNeed[]> {
  try {
    const raw = await readFile(SKILL_NEEDS_FILE, "utf-8");
    const parsed = yaml.load(raw) as { entries?: SkillNeed[] } | null;
    return parsed?.entries ?? [];
  } catch {
    return [];
  }
}

export async function addSkillNeed(need: SkillNeed): Promise<void> {
  const dir = join(homedir(), ".claude", "skills", "skill-evolver", "tmp");
  await mkdir(dir, { recursive: true });
  const entries = await listSkillNeeds();
  // Deduplicate by need text
  const existing = entries.find(e => e.need === need.need);
  if (existing) {
    existing.evidence += `\n${need.evidence}`;
    existing.priority = need.priority === "high" ? "high" : existing.priority;
    existing.date = need.date;
  } else {
    entries.push(need);
  }
  const raw = yaml.dump({ entries }, { lineWidth: -1 });
  await writeFile(SKILL_NEEDS_FILE, raw, "utf-8");
}
