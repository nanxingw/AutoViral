const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchStatus() {
  return request<{
    state: string;
    lastRun: string | null;
    nextRun: string | null;
    isSchedulerActive: boolean;
  }>("/api/status");
}

export async function triggerEvolution() {
  return request<{ triggered: boolean }>("/api/trigger", { method: "POST" });
}

export async function fetchReports() {
  const data = await request<{ reports: { filename: string; date: string }[] }>("/api/reports");
  return data.reports;
}

export async function fetchReport(filename: string) {
  return request<{ filename: string; content: string }>(
    `/api/reports/${encodeURIComponent(filename)}`
  );
}

export async function fetchContext(pillar: string) {
  return request<{
    context: unknown[];
    tmp: unknown[];
  }>(`/api/context/${encodeURIComponent(pillar)}`);
}

export interface Skill {
  name: string;
  exists: boolean;
  description: string;
  summary: string;
  path: string;
}

export async function fetchSkills() {
  const data = await request<{ skills: Skill[] }>("/api/skills");
  return data.skills;
}

export async function openSkillDir(name: string): Promise<void> {
  await request<{ opened: boolean }>(`/api/skills/${encodeURIComponent(name)}/open`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export interface DashboardReport {
  filename: string;
  date: string;
  summary: string;
  agentType: string;
}

export interface DashboardTask {
  id: string;
  name: string;
  status: string;
  schedule?: TaskSchedule;
  lastRun?: string;
  runCount: number;
  tags?: string[];
}

export interface DashboardData {
  state: string;
  lastRun: string | null;
  nextRun: string | null;
  evolutionMode: string;
  activeAgents: { id: string; type: string }[];
  recentReports: DashboardReport[];
  scheduledTasks: DashboardTask[];
  skillCount: number;
  totalReports: number;
}

export async function fetchDashboard(): Promise<DashboardData> {
  return request<DashboardData>("/api/dashboard");
}

export async function fetchConfig() {
  return request<{
    interval: string;
    model: string;
    autoRun: boolean;
    port: number;
    maxReports: number;
    reportsToFeed: number;
  }>("/api/config");
}

export async function updateConfig(config: Record<string, unknown>) {
  return request<Record<string, unknown>>("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export interface TaskSchedule {
  type: "cron" | "one-shot";
  cron?: string;
  at?: string;
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  schedule?: TaskSchedule;
  status: string;
  approved?: boolean;
  model?: string;
  tags?: string[];
  runCount: number;
  lastRun?: string;
  createdAt: string;
  // Scheduling constraints
  priority?: "high" | "normal" | "low";
  failCount?: number;
  nextRetryAfter?: string;
  completedAt?: string;
  timeoutMinutes?: number;
}

export interface Idea {
  idea: string;
  reason: string;
  added: string;
}

// ---------------------------------------------------------------------------
// Task API
// ---------------------------------------------------------------------------

export async function fetchTasks(status?: string): Promise<Task[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await request<{ tasks: Task[] }>(`/api/tasks${query}`);
  return data.tasks;
}

export async function fetchTask(id: string): Promise<Task> {
  return request<Task>(`/api/tasks/${encodeURIComponent(id)}`);
}

export async function createTask(task: Partial<Task>): Promise<Task> {
  return request<Task>("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task> {
  return request<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await request<void>(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function approveTask(id: string): Promise<Task> {
  return request<Task>(`/api/tasks/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

export async function rejectTask(id: string): Promise<void> {
  await request<void>(`/api/tasks/${encodeURIComponent(id)}/reject`, { method: "POST" });
}

export async function retryTask(id: string): Promise<Task> {
  return request<Task>(`/api/tasks/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

export async function triggerTask(id: string): Promise<void> {
  await request<void>(`/api/tasks/${encodeURIComponent(id)}/trigger`, { method: "POST" });
}

export async function fetchTaskRuns(id: string): Promise<{ filename: string; date: string }[]> {
  const data = await request<{ runs: { filename: string; date: string }[] }>(
    `/api/tasks/${encodeURIComponent(id)}/runs`
  );
  return data.runs;
}

export async function fetchTaskRun(id: string, filename: string): Promise<string> {
  const data = await request<{ content: string }>(
    `/api/tasks/${encodeURIComponent(id)}/runs/${encodeURIComponent(filename)}`
  );
  return data.content;
}

export async function fetchTaskArtifacts(id: string): Promise<string[]> {
  const data = await request<{ artifacts: string[] }>(
    `/api/tasks/${encodeURIComponent(id)}/artifacts`
  );
  return data.artifacts;
}

export async function fetchTaskArtifact(id: string, path: string): Promise<string> {
  const data = await request<{ content: string }>(
    `/api/tasks/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(path)}`
  );
  return data.content;
}

export async function openTaskArtifacts(id: string): Promise<void> {
  await request<void>(`/api/tasks/${encodeURIComponent(id)}/artifacts/open`, { method: "POST" });
}

export async function fetchIdeas(): Promise<Idea[]> {
  const data = await request<{ ideas: Idea[] }>("/api/ideas");
  return data.ideas;
}

// ---------------------------------------------------------------------------
// Work types
// ---------------------------------------------------------------------------

export type WorkType = "short-video" | "image-text" | "long-video" | "livestream";
export type WorkStatus = "draft" | "creating" | "ready" | "publishing" | "published" | "failed";

export interface WorkSummary {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  updatedAt: string;
}

export interface PipelineStep {
  name: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: string;
  completedAt?: string;
  note?: string;
}

export interface PlatformEntry {
  platform: string;
  publishedUrl?: string;
  publishedAt?: string;
}

export interface Work {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  platforms: PlatformEntry[];
  pipeline: Record<string, PipelineStep>;
  cliSessionId?: string;
  coverImage?: string;
  topicHint?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Work API
// ---------------------------------------------------------------------------

export async function fetchWorks(): Promise<WorkSummary[]> {
  const data = await request<{ works: WorkSummary[] }>("/api/works");
  return data.works;
}

export async function fetchWork(id: string): Promise<Work> {
  return request<Work>(`/api/works/${encodeURIComponent(id)}`);
}

export async function createWorkApi(input: {
  title: string;
  type: WorkType;
  platforms: string[];
  topicHint?: string;
}): Promise<Work> {
  return request<Work>("/api/works", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateWorkApi(id: string, updates: Partial<Work>): Promise<Work> {
  return request<Work>(`/api/works/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteWorkApi(id: string): Promise<void> {
  await request<{ deleted: boolean }>(`/api/works/${encodeURIComponent(id)}`, { method: "DELETE" });
}
