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
    totalReports: number;
    evolvedSkills: number;
  }>("/api/status");
}

export async function triggerEvolution() {
  return request<{ ok: boolean }>("/api/trigger", { method: "POST" });
}

export async function fetchReports() {
  return request<{ filename: string; date: string }[]>("/api/reports");
}

export async function fetchReport(filename: string) {
  return request<{ filename: string; content: string }>(
    `/api/reports/${encodeURIComponent(filename)}`
  );
}

export async function fetchContext(pillar: string) {
  return request<{
    context: { content: string; graduated?: string }[];
    tmp: { content: string; times_seen: number; signals: string[] }[];
  }>(`/api/context/${encodeURIComponent(pillar)}`);
}

export async function fetchSkills() {
  return request<{ name: string; path: string }[]>("/api/skills");
}

export async function fetchConfig() {
  return request<{
    interval: string;
    model: string;
    autoRun: boolean;
    port: number;
  }>("/api/config");
}

export async function updateConfig(config: {
  interval?: string;
  model?: string;
  autoRun?: boolean;
  port?: number;
}) {
  return request<{ ok: boolean }>("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}
