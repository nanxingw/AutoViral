const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

export async function triggerEvolution() {
  return request<{ triggered: boolean }>("/api/trigger", { method: "POST" });
}

export async function fetchStatus() {
  return request<{
    state: string;
    lastRun: string | null;
    nextRun: string | null;
    isSchedulerActive: boolean;
  }>("/api/status");
}

// ---------------------------------------------------------------------------
// Work types
// ---------------------------------------------------------------------------

export type WorkType = "short-video" | "image-text";
export type WorkStatus = "draft" | "creating" | "ready" | "failed";

export interface WorkSummary {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  platforms: string[];
  coverImage?: string;
  updatedAt: string;
}

export interface PipelineStep {
  name: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: string;
  completedAt?: string;
  note?: string;
}

export interface Work {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  platforms: string[];
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

export async function startWorkSession(id: string): Promise<{ status: string; workId: string; step?: string }> {
  return request(`/api/works/${encodeURIComponent(id)}/session`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Generation API
// ---------------------------------------------------------------------------

export async function generateImage(opts: any) {
  return post<any>("/api/generate/image", opts);
}

export async function generateVideo(opts: any) {
  return post<any>("/api/generate/video", opts);
}

export async function fetchProviders() {
  return get<any>("/api/generate/providers");
}

// ---------------------------------------------------------------------------
// Shared assets & Trends
// ---------------------------------------------------------------------------

export async function fetchSharedAssets() {
  return get<any>("/api/shared-assets");
}

export async function fetchTrends(platform: string) {
  return get<any>(`/api/trends/${platform}`);
}

export async function refreshTrends() {
  return post<any>("/api/trends/refresh", {});
}
