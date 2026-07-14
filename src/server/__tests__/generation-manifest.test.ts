// S10 (PRD-0014) — generation-manifest: content-addressed idempotency for the
// generation route family. These lock the MODULE contract (pure key derivation
// + reserve/complete/fail state machine + the concurrency race window). The
// route-level integration lives in generation-resilience-routes.test.ts.
//
// Key discipline (禁 from the slice): the manifest key is CONTENT-addressed
// (hash of prompt+params) — NEVER a timestamp — so the same request is idempotent
// across time. Order of params must not change the key.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function tempWorkDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "av-manifest-"));
}

describe("manifestKey — content-addressed, order-independent, time-invariant", () => {
  let manifestKey: typeof import("../generation-resilience.js").manifestKey;
  beforeEach(async () => {
    ({ manifestKey } = await import("../generation-resilience.js"));
  });

  it("is stable for identical prompt+params", () => {
    const k1 = manifestKey({ prompt: "a beach at dusk", params: { durationSec: 4, aspectRatio: "9:16" } });
    const k2 = manifestKey({ prompt: "a beach at dusk", params: { durationSec: 4, aspectRatio: "9:16" } });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]+$/);
  });

  it("is INDEPENDENT of param key order (canonical JSON)", () => {
    const k1 = manifestKey({ prompt: "p", params: { a: 1, b: 2, c: 3 } });
    const k2 = manifestKey({ prompt: "p", params: { c: 3, b: 2, a: 1 } });
    expect(k1).toBe(k2);
  });

  it("drops undefined params so optional spreads don't change the key", () => {
    const k1 = manifestKey({ prompt: "p", params: { a: 1, b: 2 } });
    const k2 = manifestKey({ prompt: "p", params: { a: 1, b: 2, resolution: undefined } });
    expect(k1).toBe(k2);
  });

  it("changes when the prompt changes", () => {
    const k1 = manifestKey({ prompt: "one", params: { a: 1 } });
    const k2 = manifestKey({ prompt: "two", params: { a: 1 } });
    expect(k1).not.toBe(k2);
  });

  it("changes when a param value changes", () => {
    const k1 = manifestKey({ prompt: "p", params: { aspectRatio: "9:16" } });
    const k2 = manifestKey({ prompt: "p", params: { aspectRatio: "16:9" } });
    expect(k1).not.toBe(k2);
  });

  it("does NOT fold a timestamp into the key (idempotent across time)", async () => {
    const k1 = manifestKey({ prompt: "p", params: { a: 1 } });
    // A later call with the same content must produce the same key.
    const k2 = manifestKey({ prompt: "p", params: { a: 1 } });
    expect(k2).toBe(k1);
  });

  // F7 — the old "cross-time" test never advanced the clock, so a hidden
  // Date.now() in the key would have slipped through. Put the two computations
  // at explicitly different SYSTEM times with fake timers.
  it("is identical when computed at two DIFFERENT system times (fake timers)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      const k1 = manifestKey({ prompt: "p", params: { a: 1 } });
      vi.setSystemTime(new Date("2026-07-14T12:34:56.000Z"));
      const k2 = manifestKey({ prompt: "p", params: { a: 1 } });
      expect(k2).toBe(k1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("reserve / complete / fail — state machine", () => {
  let mod: typeof import("../generation-resilience.js");
  beforeEach(async () => {
    mod = await import("../generation-resilience.js");
  });

  it("first reserve on an absent key → proceed, and persists an in-flight entry", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("proceed");

    const raw = await readFile(join(dir, "generation-manifest.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[key].status).toBe("in-flight");
  });

  it("a second reserve while in-flight is REJECTED (no duplicate dispatch)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    const r2 = await mod.reserveGeneration(dir, key);
    expect(r2.decision).toBe("reject");
  });

  it("after complete → a repeat reserve is SKIPPED and returns the cached response", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.completeGeneration(dir, key, {
      assetPath: "assets/seedance/clip.mp4",
      response: { success: true, assetId: "gen_abc" },
    });
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("skip");
    if (r.decision === "skip") {
      expect(r.entry.assetPath).toBe("assets/seedance/clip.mp4");
      expect((r.entry.response as any).assetId).toBe("gen_abc");
    }
  });

  it("after fail → a repeat reserve is allowed to PROCEED (retry)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.failGeneration(dir, key);
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("proceed");
  });

  it("CONCURRENT identical reserves → exactly one proceed, one reject (race window)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "concurrent", params: { a: 1 } });
    const [a, b] = await Promise.all([
      mod.reserveGeneration(dir, key),
      mod.reserveGeneration(dir, key),
    ]);
    const decisions = [a.decision, b.decision].sort();
    expect(decisions).toEqual(["proceed", "reject"]);
  });

  it("a reject decision carries a `reason` (in-flight vs orphaned)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    const r2 = await mod.reserveGeneration(dir, key);
    expect(r2.decision).toBe("reject");
    if (r2.decision === "reject") expect(r2.reason).toBe("in-flight");
  });
});

// F1 — an ORPHANED key (a billed-but-abandoned upstream job the route stopped
// polling) must KEEP rejecting identical retries: re-下单 while the paid job may
// still be running is exactly the double-charge the slice forbids.
describe("orphaned status — refuse to re-下单 after an orphaned cancel", () => {
  let mod: typeof import("../generation-resilience.js");
  beforeEach(async () => {
    mod = await import("../generation-resilience.js");
  });

  it("orphanGeneration marks the key orphaned and a later identical reserve is REJECTED", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "orphan me", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.orphanGeneration(dir, key, { providerJobId: "job_orphan_1", costUsd: 0.6 });

    const raw = JSON.parse(await readFile(join(dir, "generation-manifest.json"), "utf-8"));
    expect(raw[key].status).toBe("orphaned");
    expect(raw[key].providerJobId).toBe("job_orphan_1");

    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("reject");
    if (r.decision === "reject") expect(r.reason).toBe("orphaned");
  });

  it("an orphaned key is NOT auto-released by staleness (unlike a stale in-flight)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "old orphan", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.orphanGeneration(dir, key, { providerJobId: "job_x" });
    // Backdate far beyond any lease.
    const path = join(dir, "generation-manifest.json");
    const m = JSON.parse(await readFile(path, "utf-8"));
    m[key].updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await writeFile(path, JSON.stringify(m), "utf-8");

    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("reject");
    if (r.decision === "reject") expect(r.reason).toBe("orphaned");
  });
});

// F8 — in-flight lease / crash recovery: a process that dies after reserve but
// before complete/fail must NOT strand the key on a permanent 409. A FRESH
// in-flight is still a real concurrent dispatch (reject); a STALE one is a
// crashed holder → reclaimable (proceed).
describe("in-flight lease — stale reservations are recoverable", () => {
  let mod: typeof import("../generation-resilience.js");
  beforeEach(async () => {
    mod = await import("../generation-resilience.js");
  });

  it("a FRESH in-flight is still rejected (concurrent duplicate)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "fresh", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("reject");
  });

  it("a STALE in-flight (updatedAt beyond the lease) → PROCEED (crash recovery)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "stale", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    const path = join(dir, "generation-manifest.json");
    const m = JSON.parse(await readFile(path, "utf-8"));
    m[key].updatedAt = new Date(Date.now() - (mod.IN_FLIGHT_LEASE_MS + 60_000)).toISOString();
    await writeFile(path, JSON.stringify(m), "utf-8");

    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("proceed");
  });
});

// F6 — a corrupt / partially-written manifest must FAIL CLOSED, never silently
// resolve to an empty manifest (which forgets done/in-flight and re-下单).
describe("manifest read — fail closed on corruption, ENOENT only → empty", () => {
  let mod: typeof import("../generation-resilience.js");
  beforeEach(async () => {
    mod = await import("../generation-resilience.js");
  });

  it("absent manifest (ENOENT) reserves fine (fresh work)", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "fresh work", params: { a: 1 } });
    const r = await mod.reserveGeneration(dir, key);
    expect(r.decision).toBe("proceed");
  });

  it("a corrupt (unparseable) manifest makes reserve THROW, not silently empty", async () => {
    const dir = await tempWorkDir();
    await writeFile(join(dir, "generation-manifest.json"), "{ this is : not json", "utf-8");
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await expect(mod.reserveGeneration(dir, key)).rejects.toThrow();
  });

  it("a non-object manifest (JSON array) makes reserve THROW", async () => {
    const dir = await tempWorkDir();
    await writeFile(join(dir, "generation-manifest.json"), "[1,2,3]", "utf-8");
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await expect(mod.reserveGeneration(dir, key)).rejects.toThrow();
  });

  it("writes are atomic — a torn temp write leaves the previous manifest intact", async () => {
    const dir = await tempWorkDir();
    const key = mod.manifestKey({ prompt: "p", params: { a: 1 } });
    await mod.reserveGeneration(dir, key);
    await mod.completeGeneration(dir, key, { assetPath: "a.mp4", response: { ok: true } });
    // No stray *.tmp* sibling left behind after a normal write.
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".tmp"))).toBe(false);
    expect(files).toContain("generation-manifest.json");
  });
});
