// src/server/cost-ledger/types.ts
//
// B1 (PRD-0010) — the cost-ledger's domain vocabulary. A cost event records ONE
// paid (or estimated) provider call attributed to a work. `kind` is a loose
// union (typed for the writers' benefit) but stored as free text so a future
// kind never needs a schema migration or a read-time assertion.

export const COST_EVENT_KINDS = [
  "video",
  "bgm",
  "image",
  "tts",
  "translate",
  "agent",
] as const;
export type CostEventKind = (typeof COST_EVENT_KINDS)[number];

/** What a caller hands to recordCostEvent / store.insert. */
export interface CostEventInput {
  workId: string;
  /** One of COST_EVENT_KINDS; a string is accepted for forward-compat. */
  kind: CostEventKind | (string & {});
  provider?: string;
  model?: string;
  /** USD cost. Real (metered) for video; flat/estimated for BGM etc. */
  usd: number;
  /**
   * True when `usd` is NOT a real metered charge (a flat rate, a token-based
   * estimate, etc.). Honesty discipline: never present an estimate as truth.
   */
  estimated?: boolean;
  /** Arbitrary JSON detail (assetId, tokens, durationMs…). */
  meta?: Record<string, unknown>;
}

/** A persisted cost event (what the store reads back). */
export interface CostEvent {
  id: string;
  ts: string; // ISO 8601
  workId: string;
  kind: string;
  provider?: string;
  model?: string;
  usd: number;
  estimated: boolean;
  meta?: Record<string, unknown>;
}

/** One kind's rollup within a work. */
export interface CostKindGroup {
  kind: string;
  usd: number;
  count: number;
  /** True when ANY event in this kind was estimated. */
  estimated: boolean;
}

/** Per-work cost summary — the shape the GET endpoint returns. */
export interface CostSummary {
  workId: string;
  totalUsd: number;
  /** True when ANY event in the work was estimated. */
  estimated: boolean;
  count: number;
  byKind: CostKindGroup[];
}
