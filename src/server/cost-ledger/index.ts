// src/server/cost-ledger/index.ts
//
// B1 (PRD-0010) — the cost-ledger deep module. Owns the SQLite handle, exposes a
// single BEST-EFFORT `record()` write boundary that NEVER throws (a ledger
// failure must never break a paid generation), and a `summaryForWork()` read for
// the per-work summary endpoint. Mirrors render-queue/index.ts (dbPath →
// mkdir → new Database → store). The process-wide singleton + the free
// `recordCostEvent()` entry point live here so routes call one function.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CostLedgerStore, defaultCostDbPath } from "./store.js";
import type { CostEvent, CostEventInput, CostSummary } from "./types.js";

export { defaultCostDbPath };
export type {
  CostEvent,
  CostEventInput,
  CostSummary,
  CostKindGroup,
  CostEventKind,
} from "./types.js";

export interface CostLedgerOptions {
  /** Defaults to defaultCostDbPath(). Use ":memory:" for tests. */
  dbPath?: string;
}

export class CostLedger {
  private readonly db: Database.Database;
  private readonly store: CostLedgerStore;

  constructor(opts: CostLedgerOptions = {}) {
    const path = opts.dbPath ?? defaultCostDbPath();
    if (path !== ":memory:") {
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch {
        /* ok — falls through to Database which will surface a real open error */
      }
    }
    this.db = new Database(path);
    this.store = new CostLedgerStore(this.db);
  }

  /**
   * Record a cost event. BEST-EFFORT: any failure (closed db, disk full, locked
   * table) is swallowed with a warning — recording a cost must NEVER break the
   * generation that produced it. This is the contract the unit test locks.
   */
  record(input: CostEventInput): void {
    try {
      this.store.insert(input);
    } catch (err) {
      console.warn(
        `[cost-ledger] record failed (ignored, best-effort): ${(err as Error).message}`,
      );
    }
  }

  summaryForWork(workId: string): CostSummary {
    return this.store.summaryForWork(workId);
  }

  listForWork(workId: string): CostEvent[] {
    return this.store.listForWork(workId);
  }

  /** Test helper / shutdown — close the underlying db handle. */
  shutdown(): void {
    this.db.close();
  }
}

// ── Process-wide singleton (set by server/index.ts after construction) ───────
// Kept in this module (not routes/_shared.ts) so the free recordCostEvent()
// entry point can reach it with no dependency on the routes layer.
let ledger: CostLedger | null = null;

export function setCostLedger(l: CostLedger | null): void {
  ledger = l;
}

/** Read the process-lifetime CostLedger singleton (null until index.ts sets it). */
export function getCostLedger(): CostLedger | null {
  return ledger;
}

/**
 * The single cost-recording entry point the routes call. Resolves the singleton
 * and records best-effort; a null ledger (unwired, or some tests) is a silent
 * no-op. Never throws — safe to call inline in a generation handler.
 */
export function recordCostEvent(input: CostEventInput): void {
  ledger?.record(input);
}

/** Zero-state summary for a work with no ledger / no events. */
export function emptyCostSummary(workId: string): CostSummary {
  return { workId, totalUsd: 0, estimated: false, count: 0, byKind: [] };
}
