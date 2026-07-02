// B1 (PRD-0010) — cost-ledger deep-module unit tests. Mirrors the render-queue
// store test precedent: a `:memory:` SQLite db is injected directly into the
// store so we exercise real SQL with zero disk side effects. We test OUTWARD
// behaviour (a row lands + summary aggregates), never the internal SQL shape.

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { CostLedgerStore } from "../store.js";
import { CostLedger } from "../index.js";

describe("CostLedgerStore — schema + insert + summary (:memory:)", () => {
  let db: Database.Database;
  let store: CostLedgerStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new CostLedgerStore(db);
  });

  it("creates the cost_events table on construction", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='cost_events'",
      )
      .get();
    expect(row).toBeDefined();
  });

  it("insert lands a row and round-trips its fields", () => {
    const ev = store.insert({
      workId: "w-1",
      kind: "video",
      provider: "seedance",
      usd: 0.5,
    });
    expect(ev.id).toMatch(/^cost_/);
    expect(ev.estimated).toBe(false);

    const list = store.listForWork("w-1");
    expect(list).toHaveLength(1);
    expect(list[0].usd).toBe(0.5);
    expect(list[0].provider).toBe("seedance");
    expect(list[0].kind).toBe("video");
  });

  it("estimated flag is persisted and read back as a boolean", () => {
    store.insert({
      workId: "w-1",
      kind: "bgm",
      provider: "lyria",
      usd: 0.08,
      estimated: true,
    });
    const list = store.listForWork("w-1");
    expect(list[0].estimated).toBe(true);
  });

  it("meta round-trips as JSON", () => {
    store.insert({
      workId: "w-1",
      kind: "video",
      usd: 0.5,
      meta: { model: "seedance-2", assetId: "a1" },
    });
    const list = store.listForWork("w-1");
    expect(list[0].meta).toEqual({ model: "seedance-2", assetId: "a1" });
  });

  it("summaryForWork totals + groups by kind, scoped to the workId", () => {
    store.insert({ workId: "w-1", kind: "video", provider: "seedance", usd: 0.5 });
    store.insert({ workId: "w-1", kind: "video", provider: "seedance", usd: 0.3 });
    store.insert({ workId: "w-1", kind: "bgm", provider: "lyria", usd: 0.08, estimated: true });
    // A different work — must be excluded from w-1's summary.
    store.insert({ workId: "w-2", kind: "video", usd: 9.9 });

    const s = store.summaryForWork("w-1");
    expect(s.totalUsd).toBeCloseTo(0.88, 5);
    expect(s.count).toBe(3);

    const video = s.byKind.find((k) => k.kind === "video")!;
    const bgm = s.byKind.find((k) => k.kind === "bgm")!;
    expect(video.usd).toBeCloseTo(0.8, 5);
    expect(video.count).toBe(2);
    expect(video.estimated).toBe(false);
    expect(bgm.usd).toBeCloseTo(0.08, 5);
    expect(bgm.estimated).toBe(true);
    // Any estimated event in the work → the work-level estimated flag is true.
    expect(s.estimated).toBe(true);
  });

  it("summaryForWork on an unknown work is a zero state (empty ledger)", () => {
    const s = store.summaryForWork("nope");
    expect(s.workId).toBe("nope");
    expect(s.totalUsd).toBe(0);
    expect(s.count).toBe(0);
    expect(s.byKind).toEqual([]);
    expect(s.estimated).toBe(false);
  });
});

describe("CostLedger — best-effort record never throws", () => {
  it("record swallows a DB error (closed db) and does NOT throw", () => {
    const ledger = new CostLedger({ dbPath: ":memory:" });
    // Sanity: the happy path works and the summary reflects it.
    ledger.record({ workId: "w-1", kind: "video", usd: 0.5 });
    expect(ledger.summaryForWork("w-1").totalUsd).toBeCloseTo(0.5, 5);

    // Close the underlying db so the next insert would throw internally.
    ledger.shutdown();

    // The best-effort contract: recording MUST NOT throw even with a dead db —
    // a ledger failure can never break generation.
    expect(() =>
      ledger.record({ workId: "w-1", kind: "video", usd: 1.0 }),
    ).not.toThrow();
  });
});
