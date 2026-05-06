// src/server/render-queue/store.ts

import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type RenderJob,
  type RenderJobLogEntry,
  type RenderJobOptions,
  type RenderJobStatus,
  type RenderStage,
  assertStatus,
  assertStage,
  assertType,
} from "./job.js";

export function defaultDbPath(): string {
  return join(homedir(), ".autoviral", "render-queue.db");
}

interface JobRow {
  id: string;
  work_id: string;
  type: string;
  preset_id: string | null;
  status: string;
  progress: number;
  stage: string | null;
  log: string;
  output_path: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS render_jobs (
  id           TEXT PRIMARY KEY,
  work_id      TEXT NOT NULL,
  type         TEXT NOT NULL,
  preset_id    TEXT,
  status       TEXT NOT NULL,
  progress     REAL NOT NULL DEFAULT 0,
  stage        TEXT,
  log          TEXT NOT NULL DEFAULT '[]',
  output_path  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_render_jobs_work ON render_jobs(work_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
`;

function rowToJob(row: JobRow): RenderJob {
  const job: RenderJob = {
    id: row.id,
    workId: row.work_id,
    type: assertType(row.type),
    status: assertStatus(row.status),
    progress: row.progress,
    log: JSON.parse(row.log) as RenderJobLogEntry[],
    createdAt: row.created_at,
  };
  if (row.preset_id) job.presetId = row.preset_id;
  const stage = assertStage(row.stage);
  if (stage) job.stage = stage;
  if (row.output_path) job.outputPath = row.output_path;
  if (row.error) job.error = row.error;
  if (row.started_at) job.startedAt = row.started_at;
  if (row.finished_at) job.finishedAt = row.finished_at;
  return job;
}

function genJobId(): string {
  return `job_${randomBytes(8).toString("hex")}`;
}

export interface UpdatePatch {
  status?: RenderJobStatus;
  progress?: number;
  stage?: RenderStage;
  outputPath?: string;
  error?: string;
}

export class RenderQueueStore {
  constructor(private readonly db: Database.Database) {
    db.exec(SCHEMA);
    // Crash recovery: on construction, any "running" rows are stale (the
    // worker process exited mid-render). Mark them failed; the operator can
    // re-enqueue from the UI.
    db.prepare(
      "UPDATE render_jobs SET status='failed', error='process restarted before completion', finished_at=? WHERE status='running'",
    ).run(new Date().toISOString());
  }

  insert(opts: RenderJobOptions): RenderJob {
    const id = genJobId();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO render_jobs(id, work_id, type, preset_id, status, progress, log, created_at) VALUES (?, ?, ?, ?, 'queued', 0, '[]', ?)",
      )
      .run(id, opts.workId, opts.type, opts.presetId ?? null, createdAt);
    const row = this.get(id);
    if (!row)
      throw new Error("RenderQueueStore.insert: row missing after insert");
    return row;
  }

  get(id: string): RenderJob | null {
    const row = this.db
      .prepare("SELECT * FROM render_jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  list(workId: string): RenderJob[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM render_jobs WHERE work_id = ? ORDER BY created_at DESC, id DESC",
      )
      .all(workId) as JobRow[];
    return rows.map(rowToJob);
  }

  /**
   * Returns the next queued job's id (FIFO), or null.
   *
   * Tiebreak by SQLite's monotonic `rowid` rather than the random `id` —
   * two jobs inserted in the same millisecond share `created_at`, and a
   * random-id tiebreak made FIFO non-deterministic (~50/50), which surfaced
   * as a flake in the concurrency=1 serial-processing test.
   */
  nextQueued(): string | null {
    const row = this.db
      .prepare(
        "SELECT id FROM render_jobs WHERE status='queued' ORDER BY created_at ASC, rowid ASC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  update(id: string, patch: UpdatePatch): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
      if (patch.status === "running") {
        fields.push("started_at = COALESCE(started_at, ?)");
        values.push(new Date().toISOString());
      } else if (
        patch.status === "done" ||
        patch.status === "failed" ||
        patch.status === "cancelled"
      ) {
        fields.push("finished_at = ?");
        values.push(new Date().toISOString());
      }
    }
    if (patch.progress !== undefined) {
      fields.push("progress = ?");
      values.push(patch.progress);
    }
    if (patch.stage !== undefined) {
      fields.push("stage = ?");
      values.push(patch.stage);
    }
    if (patch.outputPath !== undefined) {
      fields.push("output_path = ?");
      values.push(patch.outputPath);
    }
    if (patch.error !== undefined) {
      fields.push("error = ?");
      values.push(patch.error);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db
      .prepare(`UPDATE render_jobs SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  appendLog(id: string, entry: RenderJobLogEntry): void {
    const cur = this.db
      .prepare("SELECT log FROM render_jobs WHERE id = ?")
      .get(id) as { log: string } | undefined;
    if (!cur) return;
    const arr = JSON.parse(cur.log) as RenderJobLogEntry[];
    arr.push(entry);
    this.db
      .prepare("UPDATE render_jobs SET log = ? WHERE id = ?")
      .run(JSON.stringify(arr), id);
  }
}
