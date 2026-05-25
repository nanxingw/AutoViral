// src/server/render-queue/job.ts

export const RENDER_JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

export const RENDER_STAGES = [
  "render",
  "duck",
  "loudnorm",
  "burn",
  "encode",
] as const;
export type RenderStage = (typeof RENDER_STAGES)[number];

export const RENDER_JOB_TYPES = ["full", "proxy"] as const;
export type RenderJobType = (typeof RENDER_JOB_TYPES)[number];

export interface RenderJobLogEntry {
  at: string; // ISO 8601
  level: "info" | "warn" | "error";
  msg: string;
}

export interface RenderJob {
  id: string;
  workId: string;
  type: RenderJobType;
  presetId?: string;
  status: RenderJobStatus;
  progress: number; // 0..1
  stage?: RenderStage;
  log: RenderJobLogEntry[];
  outputPath?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RenderJobOptions {
  workId: string;
  type: RenderJobType;
  presetId?: string;
  /** Optional metadata forwarded to runRenderPipeline (burnSubtitles, loudnessTargetLufs). */
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
  /** Phase H (issue #35) — Resolve-model per-text-track caption strategy.
   *  Forwarded verbatim to runRenderPipeline. burnTrackId selects the lone
   *  text track to bake into the video; sidecarTrackIds enumerate text
   *  tracks emitted as `<output>.<lang>.srt` next to the final mp4. */
  captionTracks?: {
    burnTrackId?: string | null;
    sidecarTrackIds?: string[];
  };
}

export const TERMINAL_STATUSES: ReadonlySet<RenderJobStatus> = new Set([
  "done",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(s: RenderJobStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}

export function assertStatus(s: string): RenderJobStatus {
  if ((RENDER_JOB_STATUSES as readonly string[]).includes(s)) {
    return s as RenderJobStatus;
  }
  throw new Error(`render-queue: invalid status "${s}"`);
}

export function assertStage(
  s: string | null | undefined,
): RenderStage | undefined {
  if (s == null || s === "") return undefined;
  if ((RENDER_STAGES as readonly string[]).includes(s)) {
    return s as RenderStage;
  }
  throw new Error(`render-queue: invalid stage "${s}"`);
}

export function assertType(s: string): RenderJobType {
  if ((RENDER_JOB_TYPES as readonly string[]).includes(s)) {
    return s as RenderJobType;
  }
  throw new Error(`render-queue: invalid type "${s}"`);
}
