// src/server/cost-ledger/store.ts
//
// B1 (PRD-0010) — SQLite-backed cost store. Copies the render-queue store's
// shape verbatim: defaultDbPath / schema-in-code / a raw better-sqlite3 handle
// injected via the constructor (tests pass `:memory:`). All SQL lives here; the
// CostLedger wrapper (index.ts) adds the best-effort record() boundary and owns
// the process-wide singleton.

import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CostEvent,
  CostEventInput,
  CostKindGroup,
  CostSummary,
} from "./types.js";

export function defaultCostDbPath(): string {
  return join(homedir(), ".autoviral", "cost-ledger.db");
}

interface CostRow {
  id: string;
  ts: string;
  work_id: string;
  kind: string;
  provider: string | null;
  model: string | null;
  usd: number;
  estimated: number;
  meta: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cost_events (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  work_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  provider   TEXT,
  model      TEXT,
  usd        REAL NOT NULL DEFAULT 0,
  estimated  INTEGER NOT NULL DEFAULT 0,
  meta       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cost_events_work ON cost_events(work_id, ts DESC);
`;

function genCostId(): string {
  return `cost_${randomBytes(8).toString("hex")}`;
}

function rowToEvent(row: CostRow): CostEvent {
  const ev: CostEvent = {
    id: row.id,
    ts: row.ts,
    workId: row.work_id,
    kind: row.kind,
    usd: row.usd,
    estimated: row.estimated === 1,
  };
  if (row.provider) ev.provider = row.provider;
  if (row.model) ev.model = row.model;
  if (row.meta) {
    try {
      ev.meta = JSON.parse(row.meta) as Record<string, unknown>;
    } catch {
      /* corrupt meta — drop it rather than fail the read */
    }
  }
  return ev;
}

export class CostLedgerStore {
  constructor(private readonly db: Database.Database) {
    db.exec(SCHEMA);
  }

  insert(input: CostEventInput): CostEvent {
    const id = genCostId();
    const ts = new Date().toISOString();
    const meta = input.meta ? JSON.stringify(input.meta) : null;
    this.db
      .prepare(
        "INSERT INTO cost_events(id, ts, work_id, kind, provider, model, usd, estimated, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        ts,
        input.workId,
        input.kind,
        input.provider ?? null,
        input.model ?? null,
        input.usd,
        input.estimated ? 1 : 0,
        meta,
      );
    return {
      id,
      ts,
      workId: input.workId,
      kind: input.kind,
      usd: input.usd,
      estimated: Boolean(input.estimated),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    };
  }

  listForWork(workId: string): CostEvent[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM cost_events WHERE work_id = ? ORDER BY ts DESC, rowid DESC",
      )
      .all(workId) as CostRow[];
    return rows.map(rowToEvent);
  }

  summaryForWork(workId: string): CostSummary {
    const rows = this.db
      .prepare(
        `SELECT kind,
                SUM(usd)   AS usd,
                COUNT(*)   AS cnt,
                MAX(estimated) AS est
         FROM cost_events
         WHERE work_id = ?
         GROUP BY kind
         ORDER BY usd DESC`,
      )
      .all(workId) as { kind: string; usd: number; cnt: number; est: number }[];

    const byKind: CostKindGroup[] = rows.map((r) => ({
      kind: r.kind,
      usd: r.usd ?? 0,
      count: r.cnt,
      estimated: r.est === 1,
    }));
    const totalUsd = byKind.reduce((s, k) => s + k.usd, 0);
    const count = byKind.reduce((s, k) => s + k.count, 0);
    const estimated = byKind.some((k) => k.estimated);
    return { workId, totalUsd, estimated, count, byKind };
  }
}
